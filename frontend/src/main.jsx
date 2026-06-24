import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  BarChart3,
  Download,
  FileUp,
  LineChart,
  Loader2,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";

const API_BASE = getApiBase();

function getApiBase() {
  const configured = import.meta.env.VITE_API_BASE?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return isLocalhost ? "http://localhost:8000" : "/api";
}

function getAnalyzeUrl() {
  const isNetlifyFunction = API_BASE.includes("/.netlify/functions");
  const isApiRoot = API_BASE.endsWith("/api");
  if (isNetlifyFunction || isApiRoot) return `${API_BASE}/analyze`;
  return `${API_BASE}/api/analyze`;
}

function formatCurrency(value) {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value) {
  if (value === null || value === undefined) return "N/A";
  return `${Number(value).toFixed(2)}%`;
}

function App() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function analyzeFile(event) {
    event.preventDefault();
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await submitAnalysis(file);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "Analysis failed.");
      }
      setResult(payload);
    } catch (err) {
      const message =
        err instanceof TypeError
          ? `Could not reach the analyzer API at ${API_BASE}. Make sure the backend or Netlify function is deployed.`
          : err.message;
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function submitAnalysis(uploadedFile) {
    const body = new FormData();
    body.append("file", uploadedFile);
    return fetch(getAnalyzeUrl(), {
      method: "POST",
      body,
    });
  }

  function downloadCsv() {
    if (!result?.csv) return;
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "portfolio-cagr-results.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const allocationData = useMemo(() => {
    return result?.tickers?.map((item) => ({
      name: item.ticker,
      value: item.market_value,
    })) ?? [];
  }, [result]);

  const cagrData = useMemo(() => {
    return result?.tickers?.map((item) => ({
      ticker: item.ticker,
      cagr: item.weighted_cagr_percent ?? 0,
      gain: item.gain_loss_percent,
    })) ?? [];
  }, [result]);

  const cagrTicks = useMemo(() => {
    if (!cagrData.length) return [0, 300];
    const values = cagrData.map((item) => item.cagr);
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(300, ...values);
    const start = Math.floor(minValue / 300) * 300;
    const end = Math.ceil(maxValue / 300) * 300;
    const ticks = [];
    for (let value = start; value <= end; value += 300) {
      ticks.push(value);
    }
    return ticks;
  }, [cagrData]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Recent market prices • In-memory upload processing</p>
          <h1>Portfolio CAGR Analyzer</h1>
          <p className="hero-copy">
            Upload a brokerage holdings CSV and turn raw lots into clean CAGR,
            market value, gain/loss, and ticker-level performance insights.
          </p>
        </div>
        <form className="upload-panel" onSubmit={analyzeFile}>
          <label className="file-drop">
            <FileUp size={28} aria-hidden="true" />
            <span>{file ? file.name : "Choose holdings CSV"}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button className="primary-button" disabled={loading} type="submit">
            {loading ? <Loader2 className="spin" size={18} /> : <TrendingUp size={18} />}
            Analyze Portfolio
          </button>
          <div className="privacy-note">
            <ShieldCheck size={16} aria-hidden="true" />
            Files are processed by the backend and not intentionally stored.
          </div>
        </form>
      </section>

      {error && (
        <div className="alert error">
          <AlertCircle size={18} aria-hidden="true" />
          {error}
        </div>
      )}

      {result && (
        <>
          <section className="metric-grid" aria-label="Portfolio summary">
            <Metric label="Current Value" value={formatCurrency(result.summary.market_value)} />
            <Metric label="Cost Basis" value={formatCurrency(result.summary.total_cost)} />
            <Metric
              label="Unrealized Gain/Loss"
              value={formatCurrency(result.summary.gain_loss)}
              tone={result.summary.gain_loss >= 0 ? "positive" : "negative"}
            />
            <Metric
              label="Weighted CAGR"
              value={formatPercent(result.summary.weighted_cagr_percent)}
              tone={(result.summary.weighted_cagr_percent ?? 0) >= 0 ? "positive" : "negative"}
            />
          </section>

          <section className="insight-row">
            <div className="chart-panel">
              <div className="panel-heading">
                <BarChart3 size={20} aria-hidden="true" />
                <h2>Allocation by Market Value</h2>
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <PieChart>
                  <Pie data={allocationData} dataKey="value" nameKey="name" outerRadius={140} label>
                    {allocationData.map((entry, index) => (
                      <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-panel">
              <div className="panel-heading">
                <LineChart size={20} aria-hidden="true" />
                <h2>Weighted CAGR by Ticker</h2>
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <BarChart data={cagrData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="ticker" />
                  <YAxis ticks={cagrTicks} tickFormatter={(value) => `${value}%`} />
                  <Tooltip formatter={(value) => formatPercent(value)} />
                  <Bar dataKey="cagr" radius={[6, 6, 0, 0]}>
                    {cagrData.map((entry) => (
                      <Cell key={entry.ticker} fill={entry.cagr >= 0 ? "#2563eb" : "#dc2626"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="table-section">
            <div className="table-toolbar">
              <div>
                <h2>Lot-Level Results</h2>
                <p>
                  {result.summary.priced_lots} priced lots, {result.summary.skipped_lots} skipped.
                </p>
              </div>
              <button className="secondary-button" onClick={downloadCsv} type="button">
                <Download size={18} />
                Download Full CSV
              </button>
            </div>

            {result.warnings.length > 0 && (
              <div className="warning-list">
                {result.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Purchased</th>
                    <th>Qty</th>
                    <th>Cost</th>
                    <th>Price</th>
                    <th>Value</th>
                    <th>Gain/Loss</th>
                    <th>Years</th>
                    <th>CAGR</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lots.map((lot, index) => (
                    <tr key={`${lot.ticker}-${lot.purchased}-${index}`}>
                      <td className="ticker-cell">{lot.ticker}</td>
                      <td>{lot.purchased}</td>
                      <td>{lot.quantity}</td>
                      <td>{formatCurrency(lot.total_cost)}</td>
                      <td>{formatCurrency(lot.current_price)}</td>
                      <td>{formatCurrency(lot.market_value)}</td>
                      <td className={(lot.gain_loss ?? 0) >= 0 ? "positive" : "negative"}>
                        {formatCurrency(lot.gain_loss)}
                      </td>
                      <td>{lot.years_held}</td>
                      <td className={(lot.cagr_percent ?? 0) >= 0 ? "positive" : "negative"}>
                        {formatPercent(lot.cagr_percent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, tone = "" }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

const COLORS = ["#2563eb", "#0ea5e9", "#1d4ed8", "#38bdf8", "#4338ca", "#60a5fa", "#64748b"];

createRoot(document.getElementById("root")).render(<App />);
