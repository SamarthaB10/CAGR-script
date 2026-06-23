# Portfolio CAGR Analyzer

A privacy-friendly web app that analyzes brokerage holdings CSV exports, uses brokerage-provided current prices when available, and calculates lot-level and ticker-level performance metrics. If the uploaded file does not include current prices, the backend can try free `yfinance` prices as a fallback.

Built as a practical resume project from a Python CAGR script:

- Upload an Altruist-style holdings CSV from the browser
- Clean currency, quantity, ticker, and purchase-date fields
- Use current prices from the uploaded brokerage CSV when available
- Fall back to free market prices without paid APIs
- Calculate CAGR, market value, unrealized gain/loss, and holding period
- View dashboard cards, charts, and a sortable results table
- Download an enriched CSV report
- Process uploads in memory without storing user brokerage files

## Tech Stack

- Backend: FastAPI, pandas, yfinance
- Frontend: React, Vite, Recharts
- Deployment-friendly: frontend and backend can be deployed separately

## Required CSV Columns

The app expects these columns:

```text
Ticker, Purchased, Quantity, Total Cost
```

Extra columns are preserved in the lot-level output when possible.

## Run Locally

### Backend

```bash
cd backend
python3.12 -m venv .venv312
source .venv312/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

If `python3.12` is not found, install Python 3.12 or use another stable Python version such as 3.10 or 3.11. Avoid Python 3.14 for now because some data libraries may try to compile from source.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

## Free Price Data Note

Altruist holdings exports often include a `Current` column, and this app prefers that value because it came from the brokerage report itself. When an upload does not include current prices, the app can try `yfinance`, which is free but unofficial. Production financial software should use a licensed market-data provider.

## Privacy Note

Uploaded files are processed in memory. The backend does not intentionally save brokerage uploads to disk.
