const REQUIRED_COLUMNS = ["Ticker", "Purchased", "Quantity", "Total Cost"];
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
};
const RESPONSE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: RESPONSE_HEADERS,
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { detail: "Method not allowed." });
  }

  try {
    const { filename, csvText } = extractUpload(event);

    if (!filename.toLowerCase().endsWith(".csv")) {
      return jsonResponse(400, { detail: "Please upload a CSV file." });
    }

    if (!csvText.trim()) {
      return jsonResponse(400, { detail: "Uploaded CSV was empty." });
    }

    const result = await analyzeHoldings(csvText);
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(400, { detail: error.message || "Analysis failed." });
  }
}

function extractUpload(event) {
  const contentType = getHeader(event.headers, "content-type");

  if (contentType.includes("multipart/form-data")) {
    return extractMultipartUpload(event, contentType);
  }

  if (contentType.includes("application/json")) {
    const body = JSON.parse(getBodyBuffer(event).toString("utf8") || "{}");
    return {
      filename: body.filename || "",
      csvText: body.csvText || "",
    };
  }

  if (contentType.includes("text/csv")) {
    return {
      filename: "upload.csv",
      csvText: getBodyBuffer(event).toString("utf8"),
    };
  }

  throw new Error("Could not extract a CSV file from the upload.");
}

function extractMultipartUpload(event, contentType) {
  const boundary = getMultipartBoundary(contentType);
  if (!boundary) {
    throw new Error("Could not extract the uploaded file boundary.");
  }

  const parts = parseMultipartBody(getBodyBuffer(event), boundary);
  const filePart =
    parts.find((part) => part.name === "file" && part.filename) ||
    parts.find((part) => part.filename);
  const textPart = parts.find((part) => part.name === "csvText");

  if (filePart) {
    return {
      filename: filePart.filename,
      csvText: filePart.content.toString("utf8"),
    };
  }

  if (textPart) {
    return {
      filename: "upload.csv",
      csvText: textPart.content.toString("utf8"),
    };
  }

  throw new Error("Could not extract a CSV file from the upload.");
}

function getMultipartBoundary(contentType) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2]).trim() : null;
}

function parseMultipartBody(bodyBuffer, boundary) {
  const delimiter = `--${boundary}`;
  const body = bodyBuffer.toString("latin1");

  return body
    .split(delimiter)
    .slice(1, -1)
    .map((part) => part.replace(/^\r?\n/, "").replace(/\r?\n$/, ""))
    .map(parseMultipartPart)
    .filter(Boolean);
}

function parseMultipartPart(part) {
  const separator = part.indexOf("\r\n\r\n");
  if (separator === -1) return null;

  const rawHeaders = part.slice(0, separator).split("\r\n");
  const content = part.slice(separator + 4);
  const disposition = rawHeaders.find((header) => header.toLowerCase().startsWith("content-disposition:"));
  if (!disposition) return null;

  return {
    name: getDispositionValue(disposition, "name"),
    filename: getDispositionValue(disposition, "filename"),
    content: Buffer.from(content, "latin1"),
  };
}

function getDispositionValue(disposition, key) {
  const match = disposition.match(new RegExp(`${key}="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

function getHeader(headers = {}, name) {
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : "";
}

function getBodyBuffer(event) {
  if (!event.body) return Buffer.from("");
  return Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
}

async function analyzeHoldings(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) {
    throw new Error("No rows were found in the CSV.");
  }

  const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]));
  if (missingColumns.length) {
    throw new Error(`CSV is missing required columns: ${missingColumns.join(", ")}`);
  }

  const warnings = [];
  const cleanedRows = [];

  for (const row of rows) {
    const ticker = normalizeTicker(row.Ticker);
    const purchased = parseDate(row.Purchased);
    const quantity = parseNumber(row.Quantity);
    const totalCost = parseNumber(row["Total Cost"]);

    if (!ticker || !purchased || quantity === null || totalCost === null) {
      continue;
    }

    cleanedRows.push({
      original: row,
      ticker,
      purchased,
      quantity,
      totalCost,
    });
  }

  const dropped = rows.length - cleanedRows.length;
  if (dropped) {
    warnings.push(`Skipped ${dropped} row(s) with missing or invalid ticker, date, quantity, or cost.`);
  }

  if (!cleanedRows.length) {
    throw new Error("No valid holdings rows were found after cleaning the CSV.");
  }

  const tickers = [...new Set(cleanedRows.map((row) => row.ticker))].sort();
  const { prices, metadata, warnings: priceWarnings } = await fetchCurrentPrices(tickers);
  warnings.push(...priceWarnings);

  const now = new Date();
  const lotResults = cleanedRows
    .sort((left, right) => left.ticker.localeCompare(right.ticker) || left.purchased - right.purchased)
    .map((row) => {
      const currentPrice = prices[row.ticker] ?? null;
      const yearsHeld = Math.max((now - row.purchased) / (1000 * 60 * 60 * 24 * 365.25), 1 / 365.25);

      let marketValue = null;
      let gainLoss = null;
      let gainLossPercent = null;
      let cagrPercent = null;
      let status = "missing_price";

      if (currentPrice !== null) {
        marketValue = round(row.quantity * currentPrice, 2);
        gainLoss = round(marketValue - row.totalCost, 2);
        gainLossPercent = safePercent(gainLoss, row.totalCost);
        cagrPercent = calculateCagr(row.totalCost, marketValue, yearsHeld);
        status = "priced";
      }

      const lot = {
        ticker: row.ticker,
        purchased: toIsoDate(row.purchased),
        quantity: round(row.quantity, 6),
        total_cost: round(row.totalCost, 2),
        current_price: currentPrice,
        market_value: marketValue,
        gain_loss: gainLoss,
        gain_loss_percent: gainLossPercent,
        years_held: round(yearsHeld, 2),
        cagr_percent: cagrPercent,
        status,
      };

      const priceMetadata = metadata[row.ticker] || {};
      const exportRow = {
        ...row.original,
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
        "Price Source": priceMetadata.source || null,
        "Price As Of": priceMetadata.as_of || null,
        "Pricing Status": lot.status,
      };

      return { lot, exportRow };
    });

  const lots = lotResults.map((item) => item.lot);
  const pricedLots = lots.filter((lot) => lot.status === "priced");
  const tickerSummaries = buildTickerSummaries(tickers, pricedLots);
  const totalCost = round(sum(pricedLots.map((lot) => lot.total_cost)), 2);
  const marketValue = round(sum(pricedLots.map((lot) => lot.market_value || 0)), 2);
  const gainLoss = round(marketValue - totalCost, 2);

  const summary = {
    total_lots: lots.length,
    priced_lots: pricedLots.length,
    skipped_lots: lots.length - pricedLots.length,
    total_cost: totalCost,
    market_value: marketValue,
    gain_loss: gainLoss,
    gain_loss_percent: safePercent(gainLoss, totalCost) || 0,
    weighted_cagr_percent: weightedAverageCagr(pricedLots),
    best_ticker: tickerSummaries.length
      ? tickerSummaries.reduce((best, item) => (item.gain_loss_percent > best.gain_loss_percent ? item : best)).ticker
      : null,
    worst_ticker: tickerSummaries.length
      ? tickerSummaries.reduce((worst, item) => (item.gain_loss_percent < worst.gain_loss_percent ? item : worst)).ticker
      : null,
  };

  return {
    summary,
    tickers: tickerSummaries,
    lots,
    warnings,
    csv: toCsv(lotResults.map((item) => item.exportRow)),
  };
}

async function fetchCurrentPrices(tickers) {
  const prices = {};
  const metadata = {};
  const warnings = [];
  const concurrency = 12;

  for (let index = 0; index < tickers.length; index += concurrency) {
    const batch = tickers.slice(index, index + concurrency);
    const results = await Promise.all(batch.map((ticker) => fetchLiveOrRecentPrice(ticker)));

    results.forEach((quote, quoteIndex) => {
      const ticker = batch[quoteIndex];
      if (!quote) {
        warnings.push(`No current or recent market price found for ${ticker}.`);
        return;
      }
      prices[ticker] = quote.price;
      metadata[ticker] = {
        source: quote.source,
        as_of: quote.as_of,
      };
    });
  }

  if (Object.keys(prices).length) {
    warnings.push(`Fetched current web prices for ${Object.keys(prices).length} ticker(s).`);
  }

  return { prices, metadata, warnings };
}

async function fetchLiveOrRecentPrice(ticker) {
  return (
    (await fetchYahooChartPrice(ticker)) ||
    (await fetchNasdaqPrice(ticker, "stocks")) ||
    (await fetchNasdaqPrice(ticker, "etf"))
  );
}

async function fetchYahooChartPrice(ticker) {
  const yahooSymbol = ticker.replaceAll(".", "-");
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol
  )}?range=5d&interval=1d`;

  try {
    const response = await fetchWithTimeout(url, { headers: HEADERS }, 4000);
    if (!response.ok) return null;

    const payload = await response.json();
    const chart = payload?.chart?.result?.[0];
    if (!chart) return null;

    let price = chart.meta?.regularMarketPrice;
    let timestamp = chart.meta?.regularMarketTime;
    let source = "Yahoo Finance current quote";

    if (!isValidPrice(price)) {
      const latestClose = latestYahooClose(chart);
      price = latestClose.price;
      timestamp = latestClose.timestamp;
      source = "Yahoo Finance latest close";
    }

    if (!isValidPrice(price)) return null;

    return {
      price: round(Number(price), 2),
      source,
      as_of: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

async function fetchNasdaqPrice(ticker, assetClass) {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/info?assetclass=${assetClass}`;

  try {
    const response = await fetchWithTimeout(url, { headers: HEADERS }, 4000);
    if (!response.ok) return null;

    const payload = await response.json();
    const primaryData = payload?.data?.primaryData;
    const price = parseNumber(primaryData?.lastSalePrice);
    if (!isValidPrice(price)) return null;

    return {
      price: round(price, 2),
      source: `Nasdaq delayed ${assetClass} quote`,
      as_of: primaryData?.lastTradeTimestamp || null,
    };
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function latestYahooClose(chart) {
  const timestamps = chart.timestamp || [];
  const closeValues = chart.indicators?.quote?.[0]?.close || [];

  for (let index = closeValues.length - 1; index >= 0; index -= 1) {
    const price = closeValues[index];
    if (isValidPrice(price)) {
      return {
        price: Number(price),
        timestamp: timestamps[index] || null,
      };
    }
  }

  return { price: null, timestamp: null };
}

function buildTickerSummaries(tickers, pricedLots) {
  return tickers
    .map((ticker) => {
      const tickerLots = pricedLots.filter((lot) => lot.ticker === ticker);
      if (!tickerLots.length) return null;

      const totalCost = round(sum(tickerLots.map((lot) => lot.total_cost)), 2);
      const marketValue = round(sum(tickerLots.map((lot) => lot.market_value || 0)), 2);
      const gainLoss = round(marketValue - totalCost, 2);

      return {
        ticker,
        lots: tickerLots.length,
        total_cost: totalCost,
        market_value: marketValue,
        gain_loss: gainLoss,
        gain_loss_percent: safePercent(gainLoss, totalCost) || 0,
        weighted_cagr_percent: weightedAverageCagr(tickerLots),
      };
    })
    .filter(Boolean);
}

function weightedAverageCagr(lots) {
  const eligible = lots.filter((lot) => lot.cagr_percent !== null && lot.total_cost > 0);
  const totalWeight = sum(eligible.map((lot) => lot.total_cost));
  if (!totalWeight) return null;
  return round(sum(eligible.map((lot) => (lot.cagr_percent || 0) * lot.total_cost)) / totalWeight, 2);
}

function calculateCagr(beginningValue, endingValue, years) {
  if (beginningValue <= 0 || endingValue <= 0) return null;
  const safeYears = Math.max(years, 1 / 365.25);
  return round(((endingValue / beginningValue) ** (1 / safeYears) - 1) * 100, 2);
}

function safePercent(numerator, denominator) {
  if (!denominator || Number.isNaN(denominator)) return null;
  return round((numerator / denominator) * 100, 2);
}

function normalizeTicker(value) {
  if (value === undefined || value === null) return null;
  const ticker = String(value).trim().toUpperCase();
  if (!ticker || !/^[A-Z.-]{1,12}$/.test(ticker)) return null;
  return ticker;
}

function parseNumber(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value)
    .trim()
    .replace(/^\((.*)\)$/, "-$1")
    .replace(/[$,%\s,]/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isValidPrice(price) {
  const number = Number(price);
  return Number.isFinite(number) && number > 0;
}

function round(value, decimals) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const normalizedText = csvText.replace(/^\uFEFF/, "");

  for (let index = 0; index < normalizedText.length; index += 1) {
    const char = normalizedText[index];
    const nextChar = normalizedText[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmptyRows = rows.filter((items) => items.some((item) => String(item).trim()));
  if (!nonEmptyRows.length) return [];

  const headerRowIndex = findHeaderRowIndex(nonEmptyRows);
  if (headerRowIndex === -1) return [];

  const headers = normalizeHeaders(nonEmptyRows[headerRowIndex]);
  return nonEmptyRows.slice(headerRowIndex + 1).map((items) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = items[index] ?? "";
    });
    return record;
  });
}

function findHeaderRowIndex(rows) {
  return rows.findIndex((items) => {
    const normalizedHeaders = new Set(items.map(normalizeHeader));
    return REQUIRED_COLUMNS.every((column) => normalizedHeaders.has(normalizeHeader(column)));
  });
}

function normalizeHeaders(headers) {
  const requiredByNormalizedName = new Map(
    REQUIRED_COLUMNS.map((column) => [normalizeHeader(column), column])
  );

  return headers.map((header) => {
    const cleaned = String(header).trim().replace(/^\uFEFF/, "").replace(/\s+/g, " ");
    return requiredByNormalizedName.get(normalizeHeader(cleaned)) || cleaned;
  });
}

function normalizeHeader(header) {
  return String(header).trim().replace(/^\uFEFF/, "").replace(/\s+/g, " ").toLowerCase();
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.map(escapeCsvField).join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvField(row[header])).join(","));
  }

  return lines.join("\n");
}

function escapeCsvField(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify(body),
  };
}
