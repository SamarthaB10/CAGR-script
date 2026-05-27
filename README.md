
This Python script automates the process of reading an Altruist brokerage CSV holdings export, fetching real-time market prices from Yahoo Finance, and calculating the Compound Annual Growth Rate (CAGR) for every individual asset lot based on how many years it has been held.It handles automated data cleaning (removing system disclaimers and currency symbols), groups the data by stock ticker, processes datetime differences, and exports a unified, updated spreadsheet.Core Component Breakdown1. External Dependenciespandas: Powers the core data engineering pipeline, handles row filtering, formatting conversions, and chronological sorting.yfinance: Connects to the Yahoo Finance API to pull live market closing values for the entire portfolio simultaneously.datetime: Extracts the current time to perform vectorized elapsed-time math against historical purchase dates.2. Architecture & Functionality[Input: Raw Brokerage CSV] 
          │
          ▼
   ┌──────────────┐
   │  parseCsv()  │ ──► Drops footers, strips formatting ($/,), 
   └──────────────┘     groups by ticker, calculates 'Years_Held'.
          │
          ▼
   ┌──────────────┐
   │ currentCost()│ ──► Queries yfinance API for live data, 
   └──────────────┘     cleans up ticker symbols.
          │
          ▼
   ┌──────────────┐
   │   cagr()     │ ──► Math engine computing exponential returns.
   └──────────────┘
          │
          ▼
[Output: Consolidated Master CSV with Live CAGR]
parseCsv(csv_path)Data Sanitation: Drops blank rows and uses regular expressions to strip out trailing legal disclaimers, currency symbols ($), and structural commas from the financial values.Time Tracking: Groups the dataset into individual assets, sets the "Purchased" date as a DatetimeIndex, and calculates a precise, decimal-rounded Years_Held column relative to the current execution timestamp.currentCost(priceStr)Live Market Verification: Takes a space-separated string of active portfolio symbols and queries a single batched request via yf.download.Symbol Protection: Implements safety guardrails to ensure only valid, standard length  alphabetical tickers are processed, filtering out bad data or broken symbols.cagr(beginning_value, ending_value, years)Calculates the mathematical compound annual rate of return using the formula safety layer on the fractional time denominator to strictly prevent mathematical ZeroDivisionError failures for assets bought on the current day.3. Execution Pipeline (main)Reads the raw local asset sheet.Compiles a unique array of filtered tickers and fetches live pricing.Evaluates current market values dynamicallApplies the CAGR equation to every internal ledger lot.Flattens the nested dictionaries back into a structural DataFrame using pd.concat().Saves a clean, re-sorted spreadsheet (.csv) containing ready-to-analyze performance metrics, bypassing any generic row index artifacts.
