// src/Backtest.jsx
import React, { useState } from "react";
import Header from "./common/header";
import axios from "axios";
import { EMA } from "technicalindicators";

/**
 * Clean, minimal backtest component (only essentials you confirmed)
 *
 * - EMAs: 5,13,34,89
 * - Entry: close of signal candle
 * - TP: 0.85% (fixed)
 * - Hard SL: 0.65% (fixed)
 * - SL by EMA89 crossing any faster EMA in opposite direction (exit at close)
 * - Filters: ATR (using slope placeholder), slope on/off, New York session filter
 * - Prevent overlapping trades (skip signals while trade open)
 * - Outputs: trades list (with reason), winrate, profit, final capital, drawdown
 *
 * UI: minimal, matches your dark theme + green accents.
 */

// ---------- Helpers ----------
function calculateEMAs(candles, periods = [5, 13, 34, 89]) {
  const closes = candles.map((c) => c.close);
  const emaValues = {};
  periods.forEach((period) => {
    emaValues[period] = EMA.calculate({ period, values: closes });
  });
  return emaValues;
}

function alignEMAtoCandles(candles, emaValues, period) {
  const aligned = new Array(candles.length).fill(null);
  const arr = emaValues[period] || [];
  const offset = period - 1;
  for (let i = 0; i < arr.length; i++) {
    aligned[i + offset] = arr[i];
  }
  return aligned;
}

function generateSignals(candles, alignedEmas) {
  const signals = [];
  const candleSignalLog = [];

  for (let i = 0; i < candles.length; i++) {
    const e5 = alignedEmas[5][i];
    const e13 = alignedEmas[13][i];
    const e34 = alignedEmas[34][i];
    const e89 = alignedEmas[89][i];

    const candleTime = new Date(candles[i].closeTime).toLocaleString();

    let signal = "WAIT";

    if (e5 && e13 && e34 && e89) {
      if (e5 > e13 && e13 > e34 && e34 > e89) signal = "BUY";
      if (e5 < e13 && e13 < e34 && e34 < e89) signal = "SELL";
    }

    // ATR = |slope|
    const slope = e5 && e13 ? e5 - e13 : 0;
    const atrPlaceholder = Math.abs(slope);

    // 🔥 FULL SIGNAL LOG (EVERY CANDLE)
    candleSignalLog.push({
      index: i,
      time: candleTime,
      signal,
      open: candles[i].open,
      high: candles[i].high,
      low: candles[i].low,
      close: candles[i].close,
      ema5: e5,
      ema13: e13,
      ema34: e34,
      ema89: e89,
      slope,
      atr: atrPlaceholder,
    });

    // Push only actionable signals (BUY/SELL/WAIT filtering later)
    if (e5 == null || e13 == null || e34 == null || e89 == null) continue;

    signals.push({
      signal,
      index: i,
      time: candles[i].closeTime,
      slope,
      atr: atrPlaceholder,
    });
  }

  return { signals, candleSignalLog };
}


// EMA89 opposite-cross detection for SL (at a given index)
function ema89CrossOpposite(type, alignedEmas, idx) {
  const e5 = alignedEmas[5][idx];
  const e13 = alignedEmas[13][idx];
  const e34 = alignedEmas[34][idx];
  const e89 = alignedEmas[89][idx];
  if (e5 == null || e13 == null || e34 == null || e89 == null) return false;

  // For BUY: if any faster EMA becomes ABOVE ema89 => opposite (bearish) -> SL
  if (type === "BUY") {
    if (e5 > e89 || e13 > e89 || e34 > e89) return true;
  } else {
    // For SELL: if any faster EMA becomes BELOW ema89 => opposite (bullish) -> SL
    if (e5 < e89 || e13 < e89 || e34 < e89) return true;
  }
  return false;
}

// NY session check (PKT conversion +5)
function isNewYorkSession(time) {
  const date = new Date(time);
  const pkDate = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  const hour = pkDate.getHours();
  return hour >= 20 || hour < 3; // 8 PM - 3 AM PKT
}

// ---------- Backtest engine ----------
function runBacktest(candles, alignedEmas, signals, initialCapital = 1000, positionSizeUSD = 100) {

  const fullLog = [];

  const TP_PCT = 0.0085; // 0.85%
  const HARD_SL_PCT = 0.0065; // 0.65% hard SL
  const FEE = 0.45; // flat-ish fee subtracted from profit

  let balance = initialCapital;
  let peak = initialCapital;
  let maxDD = 0;
  const trades = [];

  // Prevent overlapping trades: when open, skip signals until exitIndex
  let nextAvailableIndex = -1;

  for (let s = 0; s < signals.length; s++) {
    const sig = signals[s];
    const i = sig.index;

    if (i <= nextAvailableIndex) continue; // skip signals that occur while a trade is open
    if (sig.signal === "WAIT") continue;

    // Entry at close of the signal candle
    const entryPrice = candles[i].close;
    const type = sig.signal;

    // TP and hard SL levels
    const tpPrice = type === "BUY" ? entryPrice * (1 + TP_PCT) : entryPrice * (1 - TP_PCT);
    const hardSLPrice = type === "BUY" ? entryPrice * (1 - HARD_SL_PCT) : entryPrice * (1 + HARD_SL_PCT);

    let exited = false;
    let exitPrice = null;
    let exitIndex = null;
    let exitReason = null;

    // Scan subsequent candles for exits
    for (let j = i + 1; j < candles.length; j++) {
      const candle = candles[j];

      let status = "WAIT";

      // Entry candle
      if (j === i + 1) {
        status = type === "BUY" ? "BUY ENTRY" : "SELL ENTRY";
      }

      // Exit candle
      if (j === exitIndex) {
        status = `EXIT (${exitReason})`;
      }

      // Default-running candle (trade active)
      if (j > i + 1 && j < exitIndex) {
        status = "IN TRADE";
      }


      // --- NEW: log every candle in exact running order ---
      fullLog.push({
        sequence: fullLog.length + 1,
        candleIndex: j,
        status,             // <-- NEW 
        time: new Date(candle.closeTime).toLocaleString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        ema5: alignedEmas[5][j],
        ema13: alignedEmas[13][j],
        ema34: alignedEmas[34][j],
        ema89: alignedEmas[89][j],
      });

      // -----------------------------------------------------

      // 1) EMA89 opposite-cross SL check (exit at close of that candle)
      if (ema89CrossOpposite(type, alignedEmas, j)) {
        exitPrice = candle.close;
        exitIndex = j;
        exitReason = "EMA89_OPPOSITE_CROSS";
        exited = true;
        break;
      }

      // 2) TP / hard SL intrabar detection using high/low
      if (type === "BUY") {
        // TP hit?
        if (candle.high >= tpPrice) {
          exitPrice = tpPrice; // assume executed at TP level
          exitIndex = j;
          exitReason = "TP";
          exited = true;
          break;
        }
        // Hard SL hit?
        if (candle.low <= hardSLPrice) {
          exitPrice = hardSLPrice;
          exitIndex = j;
          exitReason = "HARD_SL";
          exited = true;
          break;
        }
      } else {
        // SELL
        if (candle.low <= tpPrice) {
          exitPrice = tpPrice;
          exitIndex = j;
          exitReason = "TP";
          exited = true;
          break;
        }
        if (candle.high >= hardSLPrice) {
          exitPrice = hardSLPrice;
          exitIndex = j;
          exitReason = "HARD_SL";
          exited = true;
          break;
        }
      }
      // continue scanning
    }

    // If we reached the end without exit -> mark exit at last candle close (no TP/SL)
    if (!exited) {
      const last = candles[candles.length - 1];
      exitPrice = last.close;
      exitIndex = candles.length - 1;
      exitReason = "END";
    }

    // Profit percent and dollars (using provided positionSizeUSD)
    const profitPercent = type === "BUY"
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;

    const profitUSD = profitPercent * positionSizeUSD - FEE;

    // Update accounting
    balance += profitUSD;
    peak = Math.max(peak, balance);
    maxDD = Math.max(maxDD, peak - balance);

    trades.push({
      type,
      entryPrice: Number(entryPrice.toFixed(8)),
      entryTime: new Date(candles[i].closeTime).toLocaleString(),
      exitPrice: Number(exitPrice.toFixed(8)),
      exitTime: new Date(candles[exitIndex].closeTime).toLocaleString(),
      result: Number(profitUSD.toFixed(2)),
      reason: exitReason,
      slope: sig.slope,
      atr: sig.atr,

      // 🔥 NEW FIELDS
      entryIndex: i,           // candle index used as entry
      exitIndex: exitIndex,    // candle index used as exit
      entryCandleTime: new Date(candles[i].openTime).toLocaleString(),
      exitCandleTime: new Date(candles[exitIndex].openTime).toLocaleString(),
    });

    nextAvailableIndex = exitIndex; // skip signals until nextAvailableIndex
  }

  const wins = trades.filter((t) => t.result > 0).length;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;
  const totalProfit = (balance - initialCapital).toFixed(2);

  return {
    trades,
    winRate: winRate.toFixed(2),
    totalProfit,
    finalCapital: balance.toFixed(2),
    maxDrawdown: maxDD.toFixed(2),
    fullLog, // NEW
  };

}

// ---------- Component ----------
export default function Backtest() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  const [wr, setWR] = useState("N/A");
  const [profit, setProfit] = useState("N/A");
  const [tradesCount, setTradesCount] = useState("N/A");
  const [log, setLog] = useState([]);
  const [initialBalance, setInitialBalance] = useState("N/A");
  const [fcapital, setFcapital] = useState("N/A");
  const [drawdown, setDrawdown] = useState("N/A");
  const [loader, setLoader] = useState(false);
  const [candleLog, setCandleLog] = useState([]);
  const [fullLog, setFullLog] = useState([]);



  const [input, setInput] = useState({
    tf: "3",
    interval: "",
    capital: "1000",
    position: "100",
    symbol: "BTCUSDT",
    atrMin: 0.7,
    atrMax: 1.1,
    slopeOn: true,
    nyFilter: true,
  });

  function changeVal(evt) {
    const { name, value, type, checked } = evt.target;
    setInput((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  }

  async function getResult(evt) {
    evt?.preventDefault?.();
    setLoader(true);

    try {
      const res = await axios.get(
        `${backendUrl}/bot/more-fetch?qty=${input.interval}&symbol=${input.symbol}&tf=${input.tf}`,
        { headers: { Authorization: `Bearer A.saboor786` } }
      );

      const candles = res.data.candles;
      if (!Array.isArray(candles) || candles.length === 0) throw new Error("No candles returned");

      setInitialBalance(parseFloat(input.capital || 0) + " $");

      // 1) compute EMAs and align them
      const rawEmaValues = calculateEMAs(candles, [5, 13, 34, 89]);
      const alignedEmas = {
        5: alignEMAtoCandles(candles, rawEmaValues, 5),
        13: alignEMAtoCandles(candles, rawEmaValues, 13),
        34: alignEMAtoCandles(candles, rawEmaValues, 34),
        89: alignEMAtoCandles(candles, rawEmaValues, 89),
      };

      // 2) generate signals + per‑candle log (NO status yet)
      const { signals: rawSignals, candleSignalLog } = generateSignals(candles, alignedEmas);

      // ❌ REMOVE this line (it has no status)
      // setCandleLog(candleSignalLog);

      let signals = rawSignals;

      // 3) apply filters
      signals = signals.filter((t) => {
        const atrCheck = t.atr >= parseFloat(input.atrMin) && t.atr <= parseFloat(input.atrMax);
        const slopeCheck = input.slopeOn ? t.slope !== 0 : true;
        const nyCheck = input.nyFilter ? isNewYorkSession(t.time) : true;
        return atrCheck && slopeCheck && nyCheck;
      });

      // 4) run backtest (this builds fullLog WITH status)
      const result = runBacktest(
        candles,
        alignedEmas,
        signals,
        parseFloat(input.capital || 1000),
        parseFloat(input.position || 100)
      );

      // 🔗 MERGE status from fullLog into candleSignalLog by candle index
      const mergedCandleLog = candleSignalLog.map((c) => {
        const statusRow = result.fullLog.find((f) => f.candleIndex === c.index);
        return {
          ...c,
          status: statusRow?.status || "WAIT", // default if no active trade on that candle
        };
      });

      // Now this log has: signal + status + EMAs etc.
      setCandleLog(mergedCandleLog);
      setFullLog(result.fullLog);

      // Stats
      setWR(result.winRate + "%");
      setProfit(result.totalProfit + " $");
      setTradesCount(result.trades.length);
      setFcapital(result.finalCapital + " $");
      setDrawdown(result.maxDrawdown + " $");
      setLog(result.trades);

      console.log("FULL CANDLE-BY-CANDLE LOG:", result.fullLog);
    } catch (err) {
      console.error("Backtest error:", err);
      alert("Backtest failed — check console for details.");
    }

    setLoader(false);
  }

  return (
    <>
      <Header />
      <div className="w-full min-h-screen bg-[#0a0a0a] text-white px-6 py-10 flex flex-col gap-10">
        <div className="flex flex-col lg:flex-row gap-8 max-w-6xl mx-auto">
          {/* Input Form */}
          <div className="flex-1 bg-[#111] border border-green-600 rounded-2xl p-6 shadow-lg">
            <h1 className="text-2xl font-semibold mb-4">Backtesting Module</h1>

            <form className="flex flex-col gap-3" onSubmit={getResult}>
              <select name="symbol" value={input.symbol} onChange={changeVal} className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="BTCUSDT">BTCUSDT</option>
                <option value="ETHUSDT">ETHUSDT</option>
                <option value="SOLUSDT">SOLUSDT</option>
                <option value="XRPUSDT">XRPUSDT</option>
              </select>

              <input name="tf" value={input.tf} onChange={changeVal} placeholder="Timeframe (M)" type="number" min={1} className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2" />
              <input name="interval" value={input.interval} onChange={changeVal} placeholder="Candles Amount" type="number" min={10} className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2" />

              <input name="capital" value={input.capital} onChange={changeVal} placeholder="Capital ($)" type="number" min={1} className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2" />
              <input name="position" value={input.position} onChange={changeVal} placeholder="Position Size ($)" type="number" min={1} className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2" />

              {/* Filters */}
              <div className="flex gap-2">
                <input type="number" step="0.01" name="atrMin" value={input.atrMin} onChange={changeVal} placeholder="ATR Min" className="flex-1 bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2" />
                <input type="number" step="0.01" name="atrMax" value={input.atrMax} onChange={changeVal} placeholder="ATR Max" className="flex-1 bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2" />
              </div>

              <div className="flex gap-4 items-center mt-2">
                <label className="flex items-center gap-2"><input type="checkbox" name="slopeOn" checked={input.slopeOn} onChange={changeVal} /> Slope On</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="nyFilter" checked={input.nyFilter} onChange={changeVal} /> NY Filter</label>
              </div>

              <button type="submit" disabled={loader} className={`bg-green-600 hover:bg-green-500 rounded-lg py-2 font-semibold mt-2 ${loader ? "opacity-50 cursor-not-allowed" : ""}`}>
                {loader ? "Running..." : "Start"}
              </button>
            </form>
          </div>

          {/* Results */}
          <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              ["Starting Balance", initialBalance],
              ["Total Trades", tradesCount],
              ["Win Rate", wr],
              ["Profit", profit],
              ["Max Drawdown", drawdown],
              ["Final Capital", fcapital],
            ].map(([title, value], idx) => (
              <div key={idx} className="bg-[#111] border border-green-600 rounded-2xl p-4 flex flex-col items-center shadow-lg">
                <h2 className="text-gray-400 text-sm">{title}</h2>
                <p className="text-lg font-semibold mt-1">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Trades Table */}
        <div className="max-w-6xl mx-auto bg-[#111] border border-green-600 rounded-2xl p-6 shadow-lg overflow-x-auto">
          <h1 className="text-2xl font-semibold mb-4">Backtest Trades</h1>
          <table className="w-full text-sm md:text-base border-collapse">
            <thead>
              <tr className="border-b border-green-600">
                <th className="px-4 py-2 text-left text-gray-400">#</th>
                <th className="px-4 py-2 text-left text-gray-400">Entry Time</th>
                <th className="px-4 py-2 text-left text-gray-400">Signal</th>
                <th className="px-4 py-2 text-left text-gray-400">Entry</th>
                <th className="px-4 py-2 text-left text-gray-400">Exit</th>
                <th className="px-4 py-2 text-left text-gray-400">Result ($)</th>
                <th className="px-4 py-2 text-left text-gray-400">Reason</th>
              </tr>
            </thead>
            <tbody>
              {log.length > 0 ? (
                log.map((v, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-[#1a1a1a]">
                    <td className="px-4 py-2">{i + 1}</td>
                    <td className="px-4 py-2">{v.entryTime}</td>
                    <td className={`px-4 py-2 font-semibold ${v.type === "BUY" ? "text-green-400" : "text-red-400"}`}>{v.type}</td>
                    <td className="px-4 py-2">{v.entryPrice}</td>
                    <td className="px-4 py-2">{v.exitPrice}</td>
                    <td className={`px-4 py-2 font-semibold ${v.result >= 0 ? "text-green-400" : "text-red-400"}`}>{v.result}</td>
                    <td className="px-4 py-2 text-gray-400">{v.reason}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-500">
                    No Data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Candle-by-Candle EMA Signal Log */}
        <div className="max-w-6xl mx-auto bg-[#111] border border-green-600 rounded-2xl p-6 shadow-lg overflow-x-auto mt-10">
          <h1 className="text-2xl font-semibold mb-4">Candle-by-Candle Signal Log</h1>

          <table className="w-full text-sm md:text-base border-collapse">
            <thead>
              <tr className="border-b border-green-600">
                <th className="px-4 py-2 text-gray-400 text-left">#</th>
                <th className="px-4 py-2 text-gray-400 text-left">Time</th>
                <th className="px-4 py-2 text-gray-400 text-left">Signal</th>
                <th className="px-4 py-2 text-gray-400 text-left">Status</th>
                <th className="px-4 py-2 text-gray-400 text-left">Close</th>
                <th className="px-4 py-2 text-gray-400 text-left">EMA 5</th>
                <th className="px-4 py-2 text-gray-400 text-left">EMA 13</th>
                <th className="px-4 py-2 text-gray-400 text-left">EMA 34</th>
                <th className="px-4 py-2 text-gray-400 text-left">EMA 89</th>
                <th className="px-4 py-2 text-gray-400 text-left">Slope</th>
                <th className="px-4 py-2 text-gray-400 text-left">ATR</th>
              </tr>
            </thead>

            <tbody>
              {candleLog.map((c, i) => (
                <tr key={i} className="border-b border-gray-800 hover:bg-[#1a1a1a]">
                  <td className="px-4 py-2">{i + 1}</td>
                  <td className="px-4 py-2">{c.time}</td>

                  {/* SIGNAL */}
                  <td
                    className={`px-4 py-2 font-semibold ${c.signal === "BUY"
                      ? "text-green-400"
                      : c.signal === "SELL"
                        ? "text-red-400"
                        : "text-gray-400"
                      }`}
                  >
                    {c.signal}
                  </td>

                  {/* STATUS (FIXED) */}
                  <td
                    className={`px-4 py-2 font-bold ${c.status?.includes("ENTRY")
                        ? "text-green-400"
                        : c.status?.includes("EXIT")
                          ? "text-red-400"
                          : c.status === "IN TRADE"
                            ? "text-yellow-400"
                            : "text-gray-500"
                      }`}
                  >
                    {c.status}
                  </td>

                  {/* PRICE + INDICATORS */}
                  <td className="px-4 py-2">{c.close?.toFixed(2)}</td>
                  <td className="px-4 py-2">{c.ema5?.toFixed(4)}</td>
                  <td className="px-4 py-2">{c.ema13?.toFixed(4)}</td>
                  <td className="px-4 py-2">{c.ema34?.toFixed(4)}</td>
                  <td className="px-4 py-2">{c.ema89?.toFixed(4)}</td>
                  <td className="px-4 py-2">{c.slope?.toFixed(5)}</td>
                  <td className="px-4 py-2">{c.atr?.toFixed(5)}</td>
                </tr>
              ))}
            </tbody>
          </table>


        </div>

      </div>
    </>
  );
}
