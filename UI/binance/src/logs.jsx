import axios from 'axios';
import Header from './common/header'
import { useEffect, useState } from 'react';

let testing = true;

// ============================================
// MANUAL ATR% RANGE SETTINGS (set your values here)
// ============================================
const MANUAL_ATR_PCT_MIN = 0.00379;   // e.g., 0.001 = 0.1%
const MANUAL_ATR_PCT_MAX = 0.00469;   // e.g., 0.005 = 0.5%
const USE_NY_SESSION = false;        // true = only NY session trades
const USE_WEEKEND_FILTER = true;    // true = exclude weekends
const USE_SLOPE_FILTER = true;      // true = only non-zero slope trades
// ============================================

function isNewYorkSession(time) {
  const date = new Date(time)
  const utcHour = date.getUTCHours()
  return utcHour >= 15 && utcHour < 22 // 15:00–22:00 UTC = 8pm–3am PKT
}

export default function Logs() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  let [trades, setTrades] = useState([])
  let [tProfit, setTprofit] = useState("")

  useEffect(() => {

    async function fetchTrades() {
      try {
        // let res = await axios.get(`${backendUrl}/bot/all-trades`,
        let res = await axios.get(`https://binance-testing-jkbldg.fly.dev/bot/all-trades`,
          {
            headers: {
              Authorization: `Bearer A.saboor786`
            }
          })

        let restrades = res.data || [];

        // 1) Remove trades with invalid / missing time
        restrades = restrades.filter(t => {
          if (!t.time) return false;
          const ts = new Date(t.time).getTime();
          return !isNaN(ts);
        });

        // --- CONFIGURABLE DATE FILTERS ---

        // Set these from UI or manually:
        let useCustomRange = false;              // if false → uses last X days
        let customStartDate = "2025-10-30";     // yyyy-mm-dd
        let customEndDate = "2025-11-10";       // yyyy-mm-dd  (optional)

        // Number of days if not using custom range
        const LAST_X_DAYS = testing ? 10 : 999999;


        // --- DATE FILTER LOGIC ---

        const now = Date.now();
        const xDaysAgo = now - LAST_X_DAYS * 24 * 60 * 60 * 1000;

        let startTs, endTs;

        if (useCustomRange) {
          // Convert custom dates to timestamps
          startTs = new Date(customStartDate).getTime();
          endTs = customEndDate ? new Date(customEndDate).getTime() : now;
        } else {
          // Use "last X days" mode
          startTs = xDaysAgo;
          endTs = now;
        }

        console.log("Filtering trades between:");
        console.log("Start:", new Date(startTs).toLocaleString());
        console.log("End:", new Date(endTs).toLocaleString());

        // --- FILTERING TRADES ---
        restrades = restrades.filter(t => {
          const ts = new Date(t.time).getTime();
          return ts >= startTs && ts <= endTs;
        });

        console.log("Trades in selected range:", restrades.length);


        // Sort trades by `tradeNumber` ascending
        restrades.sort((a, b) => a.tradeNumber - b.tradeNumber);

        // quick defensive conversions if fields are strings
        restrades = restrades.map(t => ({
          ...t,
          atr: typeof t.atr === 'string' ? parseFloat(t.atr) : t.atr,
          entryPrice: typeof t.entryPrice === 'string' ? parseFloat(t.entryPrice) : t.entryPrice,
          profit: typeof t.profit === 'string' ? parseFloat(t.profit) : t.profit,
          slope: typeof t.slope === 'string' ? parseFloat(t.slope) : t.slope,
        }));

        console.log("Total trades loaded (after 30d filter):", restrades.length);

        // Filters
        const nyFilter = (t) => isNewYorkSession(t.time)
        const nonZeroSlope = (t) => t.slope !== 0

        function calculateWinrate(list) {
          const wins = list.filter(t => t.profit > 0).length
          const total = list.length
          return total > 0 ? (wins / total * 100).toFixed(2) : 0
        }

        // ---- baseline elite set (ATR value filter you used) ----
        const atrFilterBaseline = (t) => t.atr >= 0.7 && t.atr <= 1.1

        const eliteTrades = restrades.filter(t =>
          atrFilterBaseline(t) &&
          nyFilter(t) &&
          nonZeroSlope(t)
        );

        const weekendFilter = (t) => {
          const d = new Date(t.time).getUTCDay();
          return d !== 0 && d !== 6;
        };

        const eliteWeekend = eliteTrades.filter(weekendFilter)

        console.table({
          eliteWR: calculateWinrate(eliteTrades) + "%",
          eliteTrades: eliteTrades.length,
          elite_Weekend_WR: calculateWinrate(eliteWeekend) + "%",
          weekendTrades: eliteWeekend.length,
        });

        // --- Parameter Ranges to Test (ATR raw value) ---
        const atrRanges = [
          [0.4, 1.0], [0.4, 1.1], [0.4, 1.2], [0.4, 1.3], [0.4, 1.4], [0.4, 1.5],
          [0.45, 1.0], [0.45, 1.1], [0.45, 1.2], [0.45, 1.3], [0.45, 1.4],
          [0.5, 1.0], [0.5, 1.1], [0.5, 1.2], [0.5, 1.3], [0.5, 1.4],
          [0.55, 1.0], [0.55, 1.1], [0.55, 1.15], [0.55, 1.2], [0.55, 1.3],
          [0.6, 1.0], [0.6, 1.1], [0.6, 1.2], [0.6, 1.3],
          [0.65, 1.0], [0.65, 1.1], [0.65, 1.15], [0.65, 1.2], [0.65, 1.25],
          [0.7, 1.0], [0.7, 1.1], [0.7, 1.2], [0.7, 1.25], [0.7, 1.3],
          [0.75, 1.2], [0.8, 1.25], [0.85, 1.3], [0.9, 1.35], [0.95, 1.4], [1.0, 1.5]
        ];

        const useNYOptions = [true, false];
        const useWeekendOptions = [true, false];
        const useSlopeOptions = [true, false];

        // --- Evaluate ATR raw value combos ---
        let highWRCombos = [];

        for (let [minATR, maxATR] of atrRanges) {
          for (let useNY of useNYOptions) {
            for (let useWeekend of useWeekendOptions) {
              for (let useSlope of useSlopeOptions) {

                let filtered = restrades.filter(t => t.atr >= minATR && t.atr <= maxATR);

                if (useNY) filtered = filtered.filter(nyFilter);
                if (useWeekend) filtered = filtered.filter(weekendFilter);
                if (useSlope) filtered = filtered.filter(nonZeroSlope);

                const wr = parseFloat(calculateWinrate(filtered));
                const totalProfit = filtered.reduce((sum, t) => sum + (t.profit || 0), 0);

                if (filtered.length >= 10 && wr >= 69) {
                  highWRCombos.push({
                    ATR: `${minATR}-${maxATR}`,
                    NY: useNY,
                    Weekend: useWeekend,
                    Slope: useSlope,
                    Winrate: wr.toFixed(2),
                    Trades: filtered.length,
                    Profit: totalProfit
                  });
                }
              }
            }
          }
        }

        // Sort by winrate desc, then profit desc, then trades desc
        highWRCombos.sort((a, b) => {
          const wrDiff = parseFloat(b.Winrate) - parseFloat(a.Winrate);
          if (wrDiff !== 0) return wrDiff;
          const profitDiff = b.Profit - a.Profit;
          if (profitDiff !== 0) return profitDiff;
          return b.Trades - a.Trades;
        });

        console.log("==== HIGH WR COMBOS (ATR value) ====");
        console.table(highWRCombos.slice(0, 40));

        // --- ATR% based generation (dynamic according to data) ---
        const tradesWithPct = restrades.map(t => ({
          ...t,
          atrPct: t.entryPrice ? (t.atr / t.entryPrice) : 0
        }));

        // default: use all (last 30 days) trades
        let finalTrades = restrades;

        // gather valid atrPct values
        const pctValues = tradesWithPct
          .map(t => t.atrPct)
          .filter(v => isFinite(v) && v > 0);

        if (pctValues.length === 0) {
          console.warn("No atr% values found — skipping ATR% optimization.");
        } else {
          const minPct = Math.min(...pctValues);
          const maxPct = Math.max(...pctValues);
          console.log("Dynamic ATR% Range from data:", {
            min: (minPct * 100).toFixed(4) + "%",
            max: (maxPct * 100).toFixed(4) + "%"
          });

          // generate percent ranges with a reasonable step, cap total combos
          const step = Math.max((maxPct - minPct) / 60, 0.00025);
          const maxCombosCap = 3000;
          let atrPercentRanges = [];
          for (let start = minPct; start <= maxPct; start += step) {
            for (let end = start + step; end <= maxPct + 1e-12; end += step) {
              atrPercentRanges.push([start, end]);
              if (atrPercentRanges.length >= maxCombosCap) break;
            }
            if (atrPercentRanges.length >= maxCombosCap) break;
          }

          console.log(`Generated ${atrPercentRanges.length} ATR% ranges (capped at ${maxCombosCap}).`);

          // thresholds for ATR% combos (you can tune these)
          const MIN_TRADES_PCT = 5;
          const MIN_WR_PCT = 55;

          // evaluate ATR% combos
          let highWRPercentCombos = [];
          let allPercentCombos = [];

          for (let [minPctRange, maxPctRange] of atrPercentRanges) {
            for (let useNY of useNYOptions) {
              for (let useWeekend of useWeekendOptions) {
                for (let useSlope of useSlopeOptions) {

                  let filtered = tradesWithPct.filter(t =>
                    t.atrPct >= minPctRange && t.atrPct <= maxPctRange
                  );

                  if (useNY) filtered = filtered.filter(nyFilter);
                  if (useWeekend) filtered = filtered.filter(weekendFilter);
                  if (useSlope) filtered = filtered.filter(nonZeroSlope);

                  if (filtered.length === 0) continue;

                  const wr = parseFloat(calculateWinrate(filtered));
                  const totalProfit = filtered.reduce((sum, t) => sum + (t.profit || 0), 0);

                  const combo = {
                    ATR_Pct: `${(minPctRange * 100).toFixed(3)}% - ${(maxPctRange * 100).toFixed(3)}%`,
                    NY: useNY,
                    Weekend: useWeekend,
                    Slope: useSlope,
                    Winrate: wr.toFixed(2),
                    Trades: filtered.length,
                    Profit: totalProfit
                  };

                  // store every combo that has trades (for debugging / fallback)
                  allPercentCombos.push(combo);

                  // store only "high WR" combos in a separate list
                  if (filtered.length >= MIN_TRADES_PCT && wr >= MIN_WR_PCT) {
                    highWRPercentCombos.push(combo);
                  }
                }
              }
            }
          }

          console.log("ATR% combos with ANY trades:", allPercentCombos.length);
          console.log("ATR% combos meeting thresholds:", highWRPercentCombos.length);

          const sortCombos = (arr) => {
            arr.sort((a, b) => {
              // 1. First prioritize by Winrate (highest first)
              const wrDiff = parseFloat(b.Winrate) - parseFloat(a.Winrate);
              if (wrDiff !== 0) return wrDiff;
              // 2. Then by Profit (highest first)
              const profitDiff = b.Profit - a.Profit;
              if (profitDiff !== 0) return profitDiff;
              // 3. Then by number of Trades (highest first)
              return b.Trades - a.Trades;
            });
          };

          if (highWRPercentCombos.length > 0) {
            sortCombos(highWRPercentCombos);
            console.log("==== HIGH WR COMBOS (ATR %) ====");
            console.table(highWRPercentCombos.slice(0, 60));
          } else {
            // no combo met thresholds; show best raw combos instead
            sortCombos(allPercentCombos);
            console.log("No ATR% combos met thresholds; showing best raw ATR% combos instead.");
            console.log("==== BEST RAW COMBOS (ATR %) ====");
            console.table(allPercentCombos.slice(0, 60));
          }

          // ============================================
          // USE MANUAL ATR% RANGE (instead of auto-picking best combo)
          // ============================================
          if (testing) {
            console.log("==== USING MANUAL ATR% RANGE ====");
            console.log(`ATR% Range: ${(MANUAL_ATR_PCT_MIN * 100).toFixed(3)}% - ${(MANUAL_ATR_PCT_MAX * 100).toFixed(3)}%`);
            console.log(`NY Session: ${USE_NY_SESSION}, Weekend Filter: ${USE_WEEKEND_FILTER}, Slope Filter: ${USE_SLOPE_FILTER}`);

            let manualFiltered = tradesWithPct.filter(t =>
              t.atrPct >= MANUAL_ATR_PCT_MIN && t.atrPct <= MANUAL_ATR_PCT_MAX
            );

            if (USE_NY_SESSION) manualFiltered = manualFiltered.filter(nyFilter);
            if (USE_WEEKEND_FILTER) manualFiltered = manualFiltered.filter(weekendFilter);
            if (USE_SLOPE_FILTER) manualFiltered = manualFiltered.filter(nonZeroSlope);

            const manualWR = calculateWinrate(manualFiltered);
            const manualProfit = manualFiltered.reduce((sum, t) => sum + (t.profit || 0), 0);

            console.log("==== MANUAL COMBO STATS ====");
            console.table({
              ATR_Pct: `${(MANUAL_ATR_PCT_MIN * 100).toFixed(3)}% - ${(MANUAL_ATR_PCT_MAX * 100).toFixed(3)}%`,
              NY: USE_NY_SESSION,
              Weekend: USE_WEEKEND_FILTER,
              Slope: USE_SLOPE_FILTER,
              Winrate: manualWR + "%",
              Trades: manualFiltered.length,
              Profit: manualProfit.toFixed(2)
            });

            finalTrades = manualFiltered;
            console.log("Showing trades for MANUAL ATR% range. Count:", manualFiltered.length);
          }
        } // end atr% block

        // Decide which trades to show in UI
        const tradesForUI = testing ? finalTrades : restrades;
        setTrades(tradesForUI);

        // set total profit for UI based on the trades being shown
        const total = tradesForUI.reduce((sum, trade) => sum + (trade.profit || 0), 0);
        setTprofit(total.toFixed(2));

      } catch (err) {
        console.error("Error fetching trades:", err);
        setTrades([]);
        setTprofit("0.00");
      }
    }

    fetchTrades();
  }, [])

  return (
    <>
      <Header />

      <div className="w-full min-h-screen bg-[#0a0a0a] text-white px-4 py-10 flex justify-center">
        <div className="w-full max-w-6xl">

          {/* HEADER */}
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-wide">All Trades</h1>

            <h2
              className={`text-lg md:text-xl font-semibold ${tProfit >= 0
                ? "text-green-400 drop-shadow-[0_0_10px_#4ade80]"
                : "text-red-400 drop-shadow-[0_0_10px_#ef4444]"
                }`}
            >
              Total Profit: {tProfit}$
            </h2>
          </div>

          {/* DESKTOP TABLE */}
          <div className="hidden md:block bg-[#111] border border-gray-800 rounded-2xl shadow-xl overflow-hidden">

            <table className="w-full text-sm">
              <thead className="bg-[#161616] border-b border-gray-800">
                <tr>
                  {[
                    "ID", "TIME", "TYPE", "ENTRY PRICE", "POSITION SIZE (USD)",
                    "POSITION SIZE", "SLOPE", "LEVERAGE", "PROFIT",
                  ].map((title) => (
                    <th
                      key={title}
                      className="px-4 py-4 text-left font-medium text-gray-400 tracking-wide"
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {trades.length > 0 ? (
                  trades.map((v) => (
                    <tr
                      key={v.tradeNumber}
                      className="border-b border-gray-900 hover:bg-[#1a1a1a] transition-colors"
                    >
                      <td className="px-4 py-3">{v.tradeNumber}</td>

                      <td className="px-4 py-3 text-gray-300">
                        {new Date(v.time).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                          timeZone: "Asia/Karachi",
                        })}
                      </td>

                      <td
                        className={`px-4 py-3 font-semibold ${v.type === "BUY" ? "text-green-400" : "text-red-400"
                          }`}
                      >
                        {v.type}
                      </td>

                      <td className="px-4 py-3">{v.entryPrice}</td>
                      <td className="px-4 py-3">{v.positionSizeUSD}</td>
                      <td className="px-4 py-3">{v.positionSize}</td>
                      <td className="px-4 py-3">{v.slope}</td>
                      <td className="px-4 py-3">{v.leverage}</td>

                      <td
                        className={`px-4 py-3 font-semibold ${v.profit >= 0
                          ? "text-green-400 drop-shadow-[0_0_8px_#4ade80]"
                          : "text-red-400 drop-shadow-[0_0_8px_#ef4444]"
                          }`}
                      >
                        {v.profit}$
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="9" className="text-center py-10 text-gray-500 tracking-wide">
                      No Data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* MOBILE CARDS */}
          <div className="md:hidden space-y-4">
            {trades.length > 0 ? (
              trades.map((v) => (
                <div
                  key={v.tradeNumber}
                  className="bg-[#111] border border-gray-800 rounded-xl p-4 shadow-lg"
                >
                  <div className="flex justify-between mb-3">
                    <span className="text-gray-400 text-sm">#{v.tradeNumber}</span>
                    <span
                      className={`text-sm font-semibold ${v.type === "BUY" ? "text-green-400" : "text-red-400"
                        }`}
                    >
                      {v.type}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-gray-500 text-xs">Entry Price</p>
                      <p>{v.entryPrice}</p>
                    </div>

                    <div>
                      <p className="text-gray-500 text-xs">Time</p>
                      <p>
                        {new Date(v.time).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                          timeZone: 'Asia/Karachi'
                        })}
                      </p>
                    </div>

                    <div>
                      <p className="text-gray-500 text-xs">Size USD</p>
                      <p>{v.positionSizeUSD}</p>
                    </div>

                    <div>
                      <p className="text-gray-500 text-xs">Size</p>
                      <p>{v.positionSize}</p>
                    </div>

                    <div>
                      <p className="text-gray-500 text-xs">Slope</p>
                      <p>{v.slope}</p>
                    </div>

                    <div>
                      <p className="text-gray-500 text-xs">Leverage</p>
                      <p>{v.leverage}</p>
                    </div>

                  </div>

                  <div className="mt-3 flex justify-end">
                    <p
                      className={`text-base font-semibold ${v.profit >= 0
                        ? "text-green-400 drop-shadow-[0_0_6px_#4ade80]"
                        : "text-red-400 drop-shadow-[0_0_6px_#ef4444]"
                        }`}
                    >
                      {v.profit}$
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-center py-10">No Data</p>
            )}
          </div>

        </div>
      </div>
    </>
  )
}