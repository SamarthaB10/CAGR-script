import csv
import pandas as pd
from datetime import datetime
import yfinance as yf
import math
from typing import Dict

def currentCost(priceStr: str) -> Dict[str, float]:
    df_curr_Price = yf.download(priceStr, period="1D")
    currPrices = df_curr_Price["Close"].iloc[-1].to_dict()
    clean_prices = {}
    for ticker, price in currPrices.items():
        if (
            isinstance(price, float)
            and not math.isnan(price)
            and len(ticker) <= 5
            and ticker.isalpha()
        ):
            clean_prices[ticker] = round(price, 2)
    return clean_prices

def parseCsv(csv_path: str) -> Dict[str, pd.DataFrame]: 
    ALL_df = pd.read_csv(csv_path)
    
    ALL_df = ALL_df[ALL_df["Ticker"].notna()]
    ALL_df = ALL_df[ALL_df["Ticker"].str.len() <= 5]
    
    for col in ["Total Cost", "Quantity"]:
        if col in ALL_df.columns:
            if ALL_df[col].dtype == 'object':
                ALL_df[col] = ALL_df[col].astype(str).str.replace(r'[$,\s]', '', regex=True)
            ALL_df[col] = pd.to_numeric(ALL_df[col], errors='coerce')

    tickers = ALL_df["Ticker"].unique()
    tickerdfs = {} 
    
    for ticker in tickers: 
        specificDf = ALL_df[ALL_df["Ticker"] == ticker].copy()
        specificDf["Cagr"] = 0.0
        specificDf["Purchased"] = pd.to_datetime(specificDf["Purchased"])
        specificDf = specificDf.sort_values(by="Purchased", ascending=True)
        
        specificDf = specificDf.set_index("Purchased")
        
        now = datetime.now()
        time_difference = now - specificDf.index
        specificDf['Years_Held'] =(time_difference.days / 365.25).round(2)
        
        tickerdfs[ticker] = specificDf
    return tickerdfs

def cagr(beginning_value, ending_value, years):
    return round(((ending_value / beginning_value) ** (1 / years.clip(lower=0.001)) - 1)*100, 2)

def main(csvF): 
    csvFile = csvF
    tickerDfs = parseCsv(csvFile)

    tickers = list(tickerDfs.keys())

    tickersStr = " ".join(tickers)
    current_prices = currentCost(tickersStr)
    processed_dfs = []
    for ticker, df in tickerDfs.items(): 

        if ticker in current_prices:
         
            live_price = current_prices[ticker]
            marketValue = df["Quantity"] * live_price
            years = df["Years_Held"].round(2)
            
            df["Cagr"] = cagr(df["Total Cost"], marketValue, years) 
            processed_dfs.append(df.reset_index())
    
    final_df = pd.concat(processed_dfs,ignore_index= True)
    final_df = final_df.sort_values(by=["Ticker", "Purchased"], ascending=[True, True])
    output_file = f"{csvF}"
    final_df.to_csv(output_file, index=False)
    print(f"Process done to {output_file}")
    
    

main("fileName")