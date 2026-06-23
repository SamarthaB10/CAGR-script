from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from io import StringIO
import math
import re
from typing import Any
from urllib.parse import quote

import pandas as pd
import requests

from .models import AnalyzeResponse, LotResult, PortfolioSummary, TickerSummary


REQUIRED_COLUMNS = {"Ticker", "Purchased", "Quantity", "Total Cost"}
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    )
}


def _clean_money_or_number(series: pd.Series) -> pd.Series:
    cleaned = (
        series.astype(str)
        .str.replace(r"[$,\s]", "", regex=True)
        .str.replace(r"^\((.*)\)$", r"-\1", regex=True)
    )
    return pd.to_numeric(cleaned, errors="coerce")


def _normalize_ticker(value: object) -> str | None:
    if pd.isna(value):
        return None
    ticker = str(value).strip().upper()
    if not ticker:
        return None
    if not re.fullmatch(r"[A-Z.\-]{1,12}", ticker):
        return None
    return ticker


def _safe_percent(numerator: float, denominator: float) -> float | None:
    if denominator == 0 or math.isnan(denominator):
        return None
    return round((numerator / denominator) * 100, 2)


def calculate_cagr(beginning_value: float, ending_value: float, years: float) -> float | None:
    if beginning_value <= 0 or ending_value <= 0:
        return None
    safe_years = max(years, 1 / 365.25)
    return round((((ending_value / beginning_value) ** (1 / safe_years)) - 1) * 100, 2)


def fetch_current_prices(tickers: list[str]) -> tuple[dict[str, float], dict[str, dict[str, str | None]], list[str]]:
    if not tickers:
        return {}, {}, []

    warnings: list[str] = []
    prices: dict[str, float] = {}
    metadata: dict[str, dict[str, str | None]] = {}

    with ThreadPoolExecutor(max_workers=24) as executor:
        futures = {executor.submit(_fetch_live_or_recent_price, ticker): ticker for ticker in tickers}
        for future in as_completed(futures):
            ticker = futures[future]
            quote_data = future.result()
            if quote_data:
                prices[ticker] = quote_data["price"]
                metadata[ticker] = {
                    "source": quote_data["source"],
                    "as_of": quote_data.get("as_of"),
                }
            else:
                warnings.append(f"No current or recent market price found for {ticker}.")

    if prices:
        warnings.append(f"Fetched current web prices for {len(prices)} ticker(s).")

    return prices, metadata, warnings


def _fetch_live_or_recent_price(ticker: str) -> dict[str, Any] | None:
    return (
        _fetch_yahoo_chart_price(ticker)
        or _fetch_nasdaq_price(ticker, "stocks")
        or _fetch_nasdaq_price(ticker, "etf")
    )


def _fetch_yahoo_chart_price(ticker: str) -> dict[str, Any] | None:
    yahoo_symbol = ticker.replace(".", "-")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(yahoo_symbol)}"
    try:
        response = requests.get(
            url,
            params={"range": "5d", "interval": "1d"},
            headers=HEADERS,
            timeout=4,
        )
        response.raise_for_status()
        payload = response.json()
        result = payload.get("chart", {}).get("result") or []
        if not result:
            return None

        chart = result[0]
        meta = chart.get("meta", {})
        price = meta.get("regularMarketPrice")
        timestamp = meta.get("regularMarketTime")
        source = "Yahoo Finance current quote"

        if price is None or not _is_valid_price(float(price)):
            price, timestamp = _latest_yahoo_close(chart)
            source = "Yahoo Finance latest close"

        if price is None or not _is_valid_price(float(price)):
            return None

        as_of = None
        if timestamp:
            as_of = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).isoformat()
        return {"price": round(float(price), 2), "source": source, "as_of": as_of}
    except Exception:
        return None


def _latest_yahoo_close(chart: dict[str, Any]) -> tuple[float | None, int | None]:
    timestamps = chart.get("timestamp") or []
    close_values = (
        (chart.get("indicators", {}).get("quote") or [{}])[0]
        .get("close", [])
    )

    for index in range(len(close_values) - 1, -1, -1):
        close = close_values[index]
        if close is None:
            continue
        price = float(close)
        if _is_valid_price(price):
            timestamp = timestamps[index] if index < len(timestamps) else None
            return price, timestamp

    return None, None


def _fetch_nasdaq_price(ticker: str, asset_class: str) -> dict[str, Any] | None:
    url = f"https://api.nasdaq.com/api/quote/{quote(ticker)}/info"
    try:
        response = requests.get(
            url,
            params={"assetclass": asset_class},
            headers=HEADERS,
            timeout=4,
        )
        response.raise_for_status()
        payload = response.json()
        primary_data = payload.get("data", {}).get("primaryData", {})
        price_text = primary_data.get("lastSalePrice")
        price = _parse_price_text(price_text)
        if price is None:
            return None
        return {
            "price": price,
            "source": f"Nasdaq delayed {asset_class} quote",
            "as_of": primary_data.get("lastTradeTimestamp"),
        }
    except Exception:
        return None


def _parse_price_text(value: object) -> float | None:
    if value is None:
        return None
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    if not cleaned:
        return None
    price = float(cleaned)
    if not _is_valid_price(price):
        return None
    return round(price, 2)


def _is_valid_price(price: float) -> bool:
    return not math.isnan(price) and price > 0


def extract_csv_prices(df: pd.DataFrame) -> dict[str, float]:
    if "Current" not in df.columns:
        return {}

    price_df = df[["Ticker", "Current"]].copy()
    price_df["Current"] = _clean_money_or_number(price_df["Current"])
    price_df = price_df.dropna(subset=["Ticker", "Current"])
    price_df = price_df[price_df["Current"] > 0]

    prices: dict[str, float] = {}
    for ticker, ticker_rows in price_df.groupby("Ticker"):
        price = float(ticker_rows["Current"].iloc[-1])
        prices[ticker] = round(price, 2)
    return prices


def analyze_holdings(csv_text: str) -> AnalyzeResponse:
    warnings: list[str] = []

    raw_df = pd.read_csv(StringIO(csv_text))
    missing_columns = REQUIRED_COLUMNS - set(raw_df.columns)
    if missing_columns:
        missing = ", ".join(sorted(missing_columns))
        raise ValueError(f"CSV is missing required columns: {missing}")

    df = raw_df.copy()
    df["Ticker"] = df["Ticker"].map(_normalize_ticker)
    df["Quantity"] = _clean_money_or_number(df["Quantity"])
    df["Total Cost"] = _clean_money_or_number(df["Total Cost"])
    df["Purchased"] = pd.to_datetime(df["Purchased"], errors="coerce")

    before = len(df)
    df = df.dropna(subset=["Ticker", "Purchased", "Quantity", "Total Cost"]).copy()
    dropped = before - len(df)
    if dropped:
        warnings.append(f"Skipped {dropped} row(s) with missing or invalid ticker, date, quantity, or cost.")

    if df.empty:
        raise ValueError("No valid holdings rows were found after cleaning the CSV.")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    df["Years Held"] = ((now - df["Purchased"]).dt.days / 365.25).clip(lower=1 / 365.25)

    tickers = sorted(df["Ticker"].unique().tolist())
    live_prices, price_metadata, price_warnings = fetch_current_prices(tickers)
    warnings.extend(price_warnings)

    prices = live_prices

    lot_results: list[LotResult] = []
    rows_for_csv: list[dict[str, object]] = []

    for _, row in df.sort_values(["Ticker", "Purchased"]).iterrows():
        ticker = row["Ticker"]
        quantity = float(row["Quantity"])
        total_cost = float(row["Total Cost"])
        years_held = round(float(row["Years Held"]), 4)
        current_price = prices.get(ticker)
        ticker_price_metadata = price_metadata.get(ticker, {})

        market_value = None
        gain_loss = None
        gain_loss_percent = None
        cagr_percent = None
        status = "missing_price"

        if current_price is not None:
            market_value = round(quantity * current_price, 2)
            gain_loss = round(market_value - total_cost, 2)
            gain_loss_percent = _safe_percent(gain_loss, total_cost)
            cagr_percent = calculate_cagr(total_cost, market_value, years_held)
            status = "priced"

        lot = LotResult(
            ticker=ticker,
            purchased=row["Purchased"].date().isoformat(),
            quantity=round(quantity, 6),
            total_cost=round(total_cost, 2),
            current_price=current_price,
            market_value=market_value,
            gain_loss=gain_loss,
            gain_loss_percent=gain_loss_percent,
            years_held=round(years_held, 2),
            cagr_percent=cagr_percent,
            status=status,
        )
        lot_results.append(lot)
        export_row = raw_df.loc[row.name].to_dict()
        export_row.update(
            {
                "Calculated Ticker": lot.ticker,
                "Calculated Purchased": lot.purchased,
                "Calculated Quantity": lot.quantity,
                "Calculated Total Cost": lot.total_cost,
                "Calculated Current Price": lot.current_price,
                "Calculated Market Value": lot.market_value,
                "Calculated Gain/Loss": lot.gain_loss,
                "Calculated Gain/Loss %": lot.gain_loss_percent,
                "Calculated Years Held": lot.years_held,
                "Calculated CAGR %": lot.cagr_percent,
                "Price Source": ticker_price_metadata.get("source"),
                "Price As Of": ticker_price_metadata.get("as_of"),
                "Pricing Status": lot.status,
            }
        )
        rows_for_csv.append(export_row)

    priced_lots = [lot for lot in lot_results if lot.status == "priced"]
    ticker_summaries: list[TickerSummary] = []

    for ticker in tickers:
        ticker_lots = [lot for lot in priced_lots if lot.ticker == ticker]
        if not ticker_lots:
            continue
        total_cost = round(sum(lot.total_cost for lot in ticker_lots), 2)
        market_value = round(sum(lot.market_value or 0 for lot in ticker_lots), 2)
        gain_loss = round(market_value - total_cost, 2)
        weighted_cagr = _weighted_average_cagr(ticker_lots)
        ticker_summaries.append(
            TickerSummary(
                ticker=ticker,
                lots=len(ticker_lots),
                total_cost=total_cost,
                market_value=market_value,
                gain_loss=gain_loss,
                gain_loss_percent=_safe_percent(gain_loss, total_cost) or 0,
                weighted_cagr_percent=weighted_cagr,
            )
        )

    portfolio_total_cost = round(sum(lot.total_cost for lot in priced_lots), 2)
    portfolio_market_value = round(sum(lot.market_value or 0 for lot in priced_lots), 2)
    portfolio_gain_loss = round(portfolio_market_value - portfolio_total_cost, 2)

    best_ticker = None
    worst_ticker = None
    if ticker_summaries:
        best_ticker = max(ticker_summaries, key=lambda item: item.gain_loss_percent).ticker
        worst_ticker = min(ticker_summaries, key=lambda item: item.gain_loss_percent).ticker

    summary = PortfolioSummary(
        total_lots=len(lot_results),
        priced_lots=len(priced_lots),
        skipped_lots=len(lot_results) - len(priced_lots),
        total_cost=portfolio_total_cost,
        market_value=portfolio_market_value,
        gain_loss=portfolio_gain_loss,
        gain_loss_percent=_safe_percent(portfolio_gain_loss, portfolio_total_cost) or 0,
        weighted_cagr_percent=_weighted_average_cagr(priced_lots),
        best_ticker=best_ticker,
        worst_ticker=worst_ticker,
    )

    enriched_csv = pd.DataFrame(rows_for_csv).to_csv(index=False)
    return AnalyzeResponse(
        summary=summary,
        tickers=sorted(ticker_summaries, key=lambda item: item.ticker),
        lots=lot_results,
        warnings=warnings,
        csv=enriched_csv,
    )


def _weighted_average_cagr(lots: list[LotResult]) -> float | None:
    weighted_values = [
        ((lot.cagr_percent or 0) * lot.total_cost, lot.total_cost)
        for lot in lots
        if lot.cagr_percent is not None and lot.total_cost > 0
    ]
    total_weight = sum(weight for _, weight in weighted_values)
    if total_weight == 0:
        return None
    return round(sum(value for value, _ in weighted_values) / total_weight, 2)
