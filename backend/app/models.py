from pydantic import BaseModel


class LotResult(BaseModel):
    ticker: str
    purchased: str
    quantity: float
    total_cost: float
    current_price: float | None
    market_value: float | None
    gain_loss: float | None
    gain_loss_percent: float | None
    years_held: float
    cagr_percent: float | None
    status: str


class TickerSummary(BaseModel):
    ticker: str
    lots: int
    total_cost: float
    market_value: float
    gain_loss: float
    gain_loss_percent: float
    weighted_cagr_percent: float | None


class PortfolioSummary(BaseModel):
    total_lots: int
    priced_lots: int
    skipped_lots: int
    total_cost: float
    market_value: float
    gain_loss: float
    gain_loss_percent: float
    weighted_cagr_percent: float | None
    best_ticker: str | None
    worst_ticker: str | None


class AnalyzeResponse(BaseModel):
    summary: PortfolioSummary
    tickers: list[TickerSummary]
    lots: list[LotResult]
    warnings: list[str]
    csv: str

