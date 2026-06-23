# Portfolio CAGR Analyzer

A privacy-friendly web app that analyzes brokerage holdings CSV exports, fetches the most recent available market prices from free web quote sources, and calculates lot-level and ticker-level performance metrics.

Built as a practical resume project from a Python CAGR script:

- Upload an Altruist-style holdings CSV from the browser
- Clean currency, quantity, ticker, and purchase-date fields
- Fetch recent market prices without paid APIs
- Fall back from current quotes to the latest available market close when needed
- Calculate CAGR, market value, unrealized gain/loss, and holding period
- View dashboard cards, charts, and a sortable results table
- Download an enriched CSV report
- Process uploads in memory without storing user brokerage files

## Tech Stack

- Backend: FastAPI, pandas, requests
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

For separately deployed frontends, set `ALLOWED_ORIGINS` on the backend to the frontend URL:

```bash
ALLOWED_ORIGINS=https://your-frontend.netlify.app
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env` when the backend is not running at `http://localhost:8000`.

For Netlify deploys, this repo includes a same-origin Netlify Function at `/.netlify/functions/analyze`, so `VITE_API_BASE` can be left unset.

For a separately deployed FastAPI backend, set:

```text
VITE_API_BASE=https://your-fastapi-backend.example.com
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

## Free Price Data Note

The app tries free web quote sources first and uses the most recent available quote or latest close it can retrieve. It does not use the uploaded CSV's stale `Current` column for calculations. Production financial software should use a licensed market-data provider.

## Deployment Note

The Netlify config builds the React frontend and deploys a serverless analyzer function from `netlify/functions/analyze.mjs`. Local development can still use the FastAPI backend. If you deploy the FastAPI backend separately instead of using the Netlify Function, configure `VITE_API_BASE` in the frontend and `ALLOWED_ORIGINS` in the backend.

## Privacy Note

Uploaded files are processed in memory. The backend does not intentionally save brokerage uploads to disk.
