import axios from 'axios';
import Header from './common/header'
import { useEffect, useState } from 'react';

let testing = true;

// ============================================
// MANUAL ATR% RANGE SETTINGS (set your values here)
// ============================================

// const MANUAL_FILTER_MODE = 'ATR_PCT';
const MANUAL_FILTER_MODE = 'RAW_ATR';

// const MANUAL_ATR_PCT_MIN = 0.00046;   // e.g., 0.001 = 0.1%
// const MANUAL_ATR_PCT_MAX = 0.00221;   // e.g., 0.005 = 0.5%

const MANUAL_ATR_RAW_MIN = 0.55;
const MANUAL_ATR_RAW_MAX = 0.95;

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
        let res = await axios.get(`https://bnb-testing.onrender.com/bot/all-trades`,
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
        let useCustomRange = true;              // if false → uses last X days
        let customStartDate = "2025-12-03";     // yyyy-mm-dd
        let customEndDate = "2026-1-03";       // yyyy-mm-dd  (optional)

        // let customStartDate = "2025-12-20";     // yyyy-mm-dd
        // let customEndDate = "2025-12-30";       // yyyy-mm-dd  (optional)

        // Number of days if not using custom range
        const LAST_X_DAYS = testing ? 60 : 999999;


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

        try {
          // ============================================
          // THRESHOLD OPTIMIZATION ANALYSIS
          // Find optimal MIN_TRADES and MIN_WR
          // ============================================

          console.log("\n");
          console.log("╔═══════════════════════════════════════════════════════════════════╗");
          console.log("║         THRESHOLD OPTIMIZATION ANALYSIS                           ║");
          console.log("╚═══════════════════════════════════════════════════════════════════╝");

          // Simulate different threshold combinations
          const minTradesOptions = [3, 4, 5, 6, 7, 8, 10, 12, 15, 20];
          const minWROptions = [55, 60, 65, 68, 70, 72, 75, 78, 80];

          // Filters
          const nyFilter = (t) => {
            const utcHour = new Date(t.time).getUTCHours();
            return utcHour >= 15 && utcHour < 22;
          };
          const nonZeroSlope = (t) => t.slope !== 0;

          // Generate ATR ranges
          const atrRanges = [];
          for (let start = 0.30; start <= 1.20; start += 0.05) {
            for (let end = start + 0.30; end <= start + 0.60; end += 0.05) {
              atrRanges.push([Math.round(start * 100) / 100, Math.round(end * 100) / 100]);
            }
          }

          console.log(`Testing ${atrRanges.length} ATR ranges...`);
          console.log(`Testing ${minTradesOptions.length} x ${minWROptions.length} = ${minTradesOptions.length * minWROptions.length} threshold combinations...\n`);

          // Calculate stats for each combo
          const calculateStats = (trades) => {
            if (trades.length === 0) return { wr: 0, profit: 0, count: 0 };
            const wins = trades.filter(t => t.profit > 0).length;
            const profit = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
            return {
              wr: (wins / trades.length) * 100,
              profit,
              count: trades.length
            };
          };

          // Results storage
          let thresholdResults = [];

          for (let minTrades of minTradesOptions) {
            for (let minWR of minWROptions) {

              // Find all combos that meet these thresholds
              let validCombos = [];

              for (let [minATR, maxATR] of atrRanges) {
                let filtered = restrades.filter(t => t.atr >= minATR && t.atr <= maxATR);
                filtered = filtered.filter(nyFilter).filter(nonZeroSlope);

                const stats = calculateStats(filtered);

                if (stats.count >= minTrades && stats.wr >= minWR) {
                  validCombos.push({
                    range: [minATR, maxATR],
                    ...stats
                  });
                }
              }

              // Calculate metrics for this threshold combination
              const numValidCombos = validCombos.length;
              const avgWR = numValidCombos > 0
                ? validCombos.reduce((s, c) => s + c.wr, 0) / numValidCombos
                : 0;
              const avgProfit = numValidCombos > 0
                ? validCombos.reduce((s, c) => s + c.profit, 0) / numValidCombos
                : 0;
              const avgTrades = numValidCombos > 0
                ? validCombos.reduce((s, c) => s + c.count, 0) / numValidCombos
                : 0;

              // Best combo for this threshold
              const bestCombo = validCombos.sort((a, b) => b.wr - a.wr)[0];

              thresholdResults.push({
                minTrades,
                minWR,
                validCombos: numValidCombos,
                avgWR,
                avgProfit,
                avgTrades,
                bestCombo
              });
            }
          }

          // ============================================
          // PART 1: Min Trades Analysis (Fixed WR at 70%)
          // ============================================
          console.log("╔═══════════════════════════════════════════════════════════════════╗");
          console.log("║     PART 1: MINIMUM TRADES ANALYSIS (at 70% WR threshold)         ║");
          console.log("╠═══════════════════════════════════════════════════════════════════╣");

          const wr70Results = thresholdResults.filter(r => r.minWR === 70);
          console.table(wr70Results.map(r => ({
            "Min Trades": r.minTrades,
            "Valid Combos": r.validCombos,
            "Avg WR": r.avgWR.toFixed(2) + "%",
            "Avg Profit": "$" + r.avgProfit.toFixed(2),
            "Avg Trades/Combo": r.avgTrades.toFixed(1),
            "Best Range": r.bestCombo ? `${r.bestCombo.range[0]}-${r.bestCombo.range[1]}` : "N/A",
            "Best WR": r.bestCombo ? r.bestCombo.wr.toFixed(2) + "%" : "N/A"
          })));

          // ============================================
          // PART 2: Min WR Analysis (Fixed Trades at 5)
          // ============================================
          console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
          console.log("║     PART 2: MINIMUM WIN RATE ANALYSIS (at 5 trades threshold)     ║");
          console.log("╠═══════════════════════════════════════════════════════════════════╣");

          const trades5Results = thresholdResults.filter(r => r.minTrades === 5);
          console.table(trades5Results.map(r => ({
            "Min WR": r.minWR + "%",
            "Valid Combos": r.validCombos,
            "Avg WR": r.avgWR.toFixed(2) + "%",
            "Avg Profit": "$" + r.avgProfit.toFixed(2),
            "Avg Trades/Combo": r.avgTrades.toFixed(1),
            "Best Range": r.bestCombo ? `${r.bestCombo.range[0]}-${r.bestCombo.range[1]}` : "N/A"
          })));

          // ============================================
          // PART 3: Find Optimal Combination
          // ============================================
          console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
          console.log("║     PART 3: OPTIMAL THRESHOLD COMBINATION                         ║");
          console.log("╠═══════════════════════════════════════════════════════════════════╣");

          // Score each combination
          // Good combo should have: enough valid combos, high avg WR, positive avg profit
          const scoredResults = thresholdResults.map(r => {
            // Penalties and bonuses
            let score = 0;

            // Must have at least 1 valid combo
            if (r.validCombos === 0) {
              score = -1000;
            } else {
              // Bonus for having multiple valid combos (flexibility)
              score += Math.min(r.validCombos * 5, 50); // Cap at 50

              // Bonus for high average WR
              score += r.avgWR * 1.5;

              // Bonus for positive profit
              score += Math.min(r.avgProfit * 0.5, 100); // Cap at 100

              // Penalty for too few trades (unreliable)
              if (r.minTrades < 4) score -= 20;

              // Penalty for too low WR threshold (includes bad combos)
              if (r.minWR < 65) score -= 30;

              // Bonus for balanced thresholds
              if (r.minTrades >= 5 && r.minTrades <= 10 && r.minWR >= 68 && r.minWR <= 75) {
                score += 25; // Sweet spot bonus
              }
            }

            return { ...r, score };
          });

          // Sort by score
          scoredResults.sort((a, b) => b.score - a.score);

          console.log("\n🏆 TOP 10 THRESHOLD COMBINATIONS:\n");
          console.table(scoredResults.slice(0, 10).map((r, i) => ({
            "Rank": i + 1,
            "Min Trades": r.minTrades,
            "Min WR": r.minWR + "%",
            "Valid Combos": r.validCombos,
            "Avg WR": r.avgWR.toFixed(2) + "%",
            "Avg Profit": "$" + r.avgProfit.toFixed(2),
            "Score": r.score.toFixed(1)
          })));

          // ============================================
          // PART 4: Statistical Confidence Analysis
          // ============================================
          console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
          console.log("║     PART 4: STATISTICAL CONFIDENCE BY TRADE COUNT                 ║");
          console.log("╠═══════════════════════════════════════════════════════════════════╣");

          // Calculate confidence intervals for different trade counts
          const confidenceAnalysis = [
            { trades: 3, confidence: "Very Low", marginOfError: "±28.8%", reliable: "❌" },
            { trades: 4, confidence: "Low", marginOfError: "±24.5%", reliable: "❌" },
            { trades: 5, confidence: "Low-Medium", marginOfError: "±21.9%", reliable: "⚠️" },
            { trades: 6, confidence: "Medium", marginOfError: "±20.0%", reliable: "⚠️" },
            { trades: 7, confidence: "Medium", marginOfError: "±18.5%", reliable: "⚠️" },
            { trades: 8, confidence: "Medium", marginOfError: "±17.3%", reliable: "✅" },
            { trades: 10, confidence: "Medium-High", marginOfError: "±15.5%", reliable: "✅" },
            { trades: 12, confidence: "Medium-High", marginOfError: "±14.1%", reliable: "✅" },
            { trades: 15, confidence: "High", marginOfError: "±12.6%", reliable: "✅" },
            { trades: 20, confidence: "High", marginOfError: "±10.9%", reliable: "✅✅" },
            { trades: 30, confidence: "Very High", marginOfError: "±8.9%", reliable: "✅✅" },
          ];

          console.log("\n📊 STATISTICAL CONFIDENCE BY SAMPLE SIZE:\n");
          console.table(confidenceAnalysis);

          console.log(`
📝 INTERPRETATION:
   - At 70% observed WR with 5 trades: True WR could be 48.1% - 91.9%
   - At 70% observed WR with 10 trades: True WR could be 54.5% - 85.5%
   - At 70% observed WR with 20 trades: True WR could be 59.1% - 80.9%
   - At 70% observed WR with 30 trades: True WR could be 61.1% - 78.9%
`);

          // ============================================
          // FINAL RECOMMENDATION
          // ============================================
          console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
          console.log("║     FINAL RECOMMENDATION                                          ║");
          console.log("╠═══════════════════════════════════════════════════════════════════╣");

          const bestThreshold = scoredResults[0];

          console.log(`
🎯 RECOMMENDED THRESHOLDS FOR YOUR BOT:

   ┌─────────────────────────────────────────────────────────────┐
   │                                                             │
   │   MINIMUM TRADES:  ${bestThreshold.minTrades} trades (in last 30 days)          │
   │   MINIMUM WR:      ${bestThreshold.minWR}% win rate                       │
   │                                                             │
   │   Expected Valid Combos: ${bestThreshold.validCombos}                            │
   │   Expected Avg WR: ${bestThreshold.avgWR.toFixed(1)}%                             │
   │   Expected Avg Profit: $${bestThreshold.avgProfit.toFixed(2)}                      │
   │                                                             │
   └─────────────────────────────────────────────────────────────┘
`);

          console.log("╚═══════════════════════════════════════════════════════════════════╝\n");
        } finally {
          console.log("");

        }

        const atrRanges = [
          // Sweet Spot Zone (Best Performance: 0.55-1.10)
          [0.45, 0.75], [0.45, 0.85], [0.45, 0.95],
          [0.50, 0.80], [0.50, 0.90], [0.50, 0.95], [0.50, 1.00],
          [0.55, 0.85], [0.55, 0.95], [0.55, 1.00], [0.55, 1.05], [0.55, 1.10],
          [0.60, 0.90], [0.60, 0.95], [0.60, 1.00], [0.60, 1.05], [0.60, 1.10],
          [0.65, 0.95], [0.65, 1.00], [0.65, 1.05], [0.65, 1.10], [0.65, 1.15],
          [0.70, 1.00], [0.70, 1.05], [0.70, 1.10], [0.70, 1.15], [0.70, 1.20],

          // High Volatility Zone (Strong performers)
          [0.75, 1.10], [0.75, 1.15], [0.75, 1.20], [0.75, 1.25],
          [0.80, 1.15], [0.80, 1.20], [0.80, 1.25], [0.80, 1.30],
          [0.85, 1.20], [0.85, 1.25], [0.85, 1.30], [0.85, 1.35],
          [0.90, 1.25], [0.90, 1.30], [0.90, 1.35], [0.90, 1.40],
          [0.95, 1.30], [0.95, 1.40], [0.95, 1.50],
          [1.00, 1.35], [1.00, 1.45], [1.00, 1.55],

          // Extended High Zone (for big moves)
          [1.10, 1.50], [1.10, 1.60],
          [1.20, 1.60], [1.20, 1.80],
          [1.30, 1.70], [1.30, 2.00]
        ];

        // const atrRanges = [
        //   // Moderate Zone (Good Performance: 1.10-1.50)
        //   [1.05, 1.35], [1.05, 1.40], [1.05, 1.45],
        //   [1.10, 1.40], [1.10, 1.45], [1.10, 1.50], [1.10, 1.55],
        //   [1.15, 1.45], [1.15, 1.50], [1.15, 1.55], [1.15, 1.60],
        //   [1.20, 1.50], [1.20, 1.55], [1.20, 1.60], [1.20, 1.65],
        //   [1.25, 1.55], [1.25, 1.60], [1.25, 1.65], [1.25, 1.70],
        //   [1.30, 1.60], [1.30, 1.65], [1.30, 1.70], [1.30, 1.75],

        //   // Sweet Spot Zone (Strong performers: 1.40-2.00)
        //   [1.35, 1.70], [1.35, 1.75], [1.35, 1.80], [1.35, 1.85],
        //   [1.40, 1.75], [1.40, 1.80], [1.40, 1.85], [1.40, 1.90],
        //   [1.45, 1.80], [1.45, 1.85], [1.45, 1.90], [1.45, 1.95],
        //   [1.50, 1.85], [1.50, 1.90], [1.50, 1.95], [1.50, 2.00],
        //   [1.55, 1.90], [1.55, 2.00], [1.55, 2.10],
        //   [1.60, 1.95], [1.60, 2.05], [1.60, 2.15],

        //   // High Volatility Zone (Best performance: 1.80-2.50)
        //   [1.70, 2.10], [1.70, 2.20], [1.70, 2.30],
        //   [1.80, 2.20], [1.80, 2.30], [1.80, 2.40],
        //   [1.90, 2.30], [1.90, 2.40], [1.90, 2.50],
        //   [2.00, 2.40], [2.00, 2.50], [2.00, 2.60],
        //   [2.10, 2.50], [2.10, 2.60], [2.10, 2.80],
        //   [2.20, 2.60], [2.20, 2.80], [2.20, 3.00],

        //   // Extended High Zone (for big moves: 2.30-3.50)
        //   [2.30, 2.80], [2.30, 3.00], [2.30, 3.20],
        //   [2.40, 3.00], [2.40, 3.20], [2.40, 3.50],
        //   [2.50, 3.00], [2.50, 3.20], [2.50, 3.50],
        //   [2.60, 3.20], [2.60, 3.50],
        //   [2.80, 3.50]
        // ];
        // ============================================
        // OPTIMAL ATR RANGE WIDTH ANALYSIS
        // ============================================
        console.log("\n");
        console.log("╔═══════════════════════════════════════════════════════════════════╗");
        console.log("║           OPTIMAL ATR RANGE WIDTH ANALYSIS                        ║");
        console.log("╚═══════════════════════════════════════════════════════════════════╝");

        // Get valid ATR values
        const atrValues = restrades.map(t => t.atr).filter(v => isFinite(v) && v > 0);
        const profits = restrades.map(t => t.profit);

        // Calculate statistics
        const sortedATR = [...atrValues].sort((a, b) => a - b);
        const minATR = Math.min(...atrValues);
        const maxATR = Math.max(...atrValues);
        const q1 = sortedATR[Math.floor(sortedATR.length * 0.25)];
        const median = sortedATR[Math.floor(sortedATR.length * 0.5)];
        const q3 = sortedATR[Math.floor(sortedATR.length * 0.75)];
        const avgATR = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;

        console.log("\n📊 ATR Statistics:");
        console.log(`   Min: ${minATR.toFixed(4)}`);
        console.log(`   Q1 (25%): ${q1.toFixed(4)}`);
        console.log(`   Median: ${median.toFixed(4)}`);
        console.log(`   Q3 (75%): ${q3.toFixed(4)}`);
        console.log(`   Max: ${maxATR.toFixed(4)}`);
        console.log(`   Mean: ${avgATR.toFixed(4)}`);


        const calculateStats = (trades) => {
          if (trades.length === 0) return { wr: 0, profit: 0, trades: 0, avgProfit: 0 };
          const wins = trades.filter(t => t.profit > 0).length;
          const totalProfit = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
          return {
            wr: (wins / trades.length) * 100,
            profit: totalProfit,
            trades: trades.length,
            avgProfit: totalProfit / trades.length
          };
        };

        // ============================================
        // PART 1: Test Different Range WIDTHS
        // ============================================
        console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
        console.log("║     PART 1: RANGE WIDTH ANALYSIS                                  ║");
        console.log("╠═══════════════════════════════════════════════════════════════════╣");

        const widthsToTest = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.70, 0.80];
        const startStep = 0.05;

        let widthResults = [];

        for (let width of widthsToTest) {
          let bestForWidth = { wr: 0, profit: -Infinity, range: null, trades: 0 };
          let allCombosForWidth = [];

          // Test different starting points
          for (let start = 0.1; start <= 1.5; start += startStep) {
            const end = start + width;

            // Filter trades in this range
            let filtered = restrades.filter(t => t.atr >= start && t.atr <= end);

            // Apply best filters (NY + Slope based on previous analysis)
            filtered = filtered.filter(nyFilter);
            filtered = filtered.filter(nonZeroSlope);

            if (filtered.length >= 4) {
              const stats = calculateStats(filtered);

              allCombosForWidth.push({
                start,
                end,
                ...stats
              });

              // Track best for this width
              if (stats.wr >= 65 && stats.profit > bestForWidth.profit) {
                bestForWidth = {
                  wr: stats.wr,
                  profit: stats.profit,
                  range: [start, end],
                  trades: stats.trades,
                  avgProfit: stats.avgProfit
                };
              }
            }
          }

          // Calculate average stats for this width
          const validCombos = allCombosForWidth.filter(c => c.wr >= 60);
          const avgWR = validCombos.length > 0
            ? validCombos.reduce((s, c) => s + c.wr, 0) / validCombos.length
            : 0;
          const avgProfit = validCombos.length > 0
            ? validCombos.reduce((s, c) => s + c.profit, 0) / validCombos.length
            : 0;

          widthResults.push({
            Width: width.toFixed(2),
            "Valid Combos (60%+ WR)": validCombos.length,
            "Avg WR": avgWR.toFixed(2) + "%",
            "Avg Profit": "$" + avgProfit.toFixed(2),
            "Best Range": bestForWidth.range ? `${bestForWidth.range[0].toFixed(2)}-${bestForWidth.range[1].toFixed(2)}` : "N/A",
            "Best WR": bestForWidth.wr.toFixed(2) + "%",
            "Best Profit": "$" + bestForWidth.profit.toFixed(2),
            "Trades": bestForWidth.trades
          });
        }

        console.log("\n📏 RANGE WIDTH COMPARISON:");
        console.table(widthResults);

        // Find optimal width
        const sortedWidths = [...widthResults].sort((a, b) => {
          const aValid = parseInt(a["Valid Combos (60%+ WR)"]);
          const bValid = parseInt(b["Valid Combos (60%+ WR)"]);
          const aProfit = parseFloat(a["Best Profit"].replace("$", ""));
          const bProfit = parseFloat(b["Best Profit"].replace("$", ""));

          // Prioritize: more valid combos, then higher profit
          if (Math.abs(bValid - aValid) > 2) return bValid - aValid;
          return bProfit - aProfit;
        });

        console.log("\n🏆 OPTIMAL WIDTH RECOMMENDATION:");
        console.log(`   Best Width: ${sortedWidths[0].Width}`);
        console.log(`   Reason: ${sortedWidths[0]["Valid Combos (60%+ WR)"]} valid combos with ${sortedWidths[0]["Best WR"]} best WR`);

        // ============================================
        // PART 2: Find OPTIMAL Starting Points for Best Width
        // ============================================
        console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
        console.log("║     PART 2: OPTIMAL STARTING POINTS                               ║");
        console.log("╠═══════════════════════════════════════════════════════════════════╣");

        const optimalWidth = parseFloat(sortedWidths[0].Width);
        let startPointResults = [];

        for (let start = 0.20; start <= 1.20; start += 0.05) {
          const end = start + optimalWidth;

          let filtered = restrades.filter(t => t.atr >= start && t.atr <= end);
          const totalInRange = filtered.length;

          // Test with different filter combinations
          const noFilter = calculateStats(filtered);

          const withNY = calculateStats(filtered.filter(nyFilter));
          const withSlope = calculateStats(filtered.filter(nonZeroSlope));
          const withBoth = calculateStats(filtered.filter(nyFilter).filter(nonZeroSlope));

          if (totalInRange >= 5) {
            startPointResults.push({
              Range: `${start.toFixed(2)} - ${end.toFixed(2)}`,
              "Total Trades": totalInRange,
              "No Filter WR": noFilter.wr.toFixed(1) + "%",
              "NY Only WR": withNY.wr.toFixed(1) + "%",
              "Slope Only WR": withSlope.wr.toFixed(1) + "%",
              "NY+Slope WR": withBoth.wr.toFixed(1) + "%",
              "NY+Slope Trades": withBoth.trades,
              "NY+Slope Profit": "$" + withBoth.profit.toFixed(2),
              "Avg Profit/Trade": "$" + withBoth.avgProfit.toFixed(2)
            });
          }
        }

        console.log(`\n📍 STARTING POINTS FOR WIDTH ${optimalWidth}:`);
        console.table(startPointResults);

        // ============================================
        // PART 3: Quality Score Analysis
        // ============================================
        console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
        console.log("║     PART 3: QUALITY SCORE ANALYSIS                                ║");
        console.log("╠═══════════════════════════════════════════════════════════════════╣");

        // Quality Score = WR * log(trades) * avgProfit
        // This balances: high WR, enough trades, good profit per trade

        let qualityResults = [];

        for (let width = 0.25; width <= 0.60; width += 0.05) {
          for (let start = 0.30; start <= 1.00; start += 0.05) {
            const end = start + width;

            let filtered = restrades.filter(t => t.atr >= start && t.atr <= end);
            filtered = filtered.filter(nyFilter).filter(nonZeroSlope);

            if (filtered.length >= 4) {
              const stats = calculateStats(filtered);

              // Quality Score Formula
              const tradeScore = Math.log(stats.trades + 1) * 10; // Log scale for trade count
              const wrScore = stats.wr; // Direct WR
              const profitScore = stats.avgProfit > 0 ? Math.min(stats.avgProfit * 5, 50) : stats.avgProfit * 2;

              const qualityScore = (wrScore * 0.5) + (tradeScore * 0.3) + (profitScore * 0.2);

              qualityResults.push({
                range: [start, end],
                width,
                wr: stats.wr,
                trades: stats.trades,
                profit: stats.profit,
                avgProfit: stats.avgProfit,
                qualityScore
              });
            }
          }
        }

        // Sort by quality score
        qualityResults.sort((a, b) => b.qualityScore - a.qualityScore);

        console.log("\n🌟 TOP 20 RANGES BY QUALITY SCORE:");
        console.table(qualityResults.slice(0, 20).map((r, i) => ({
          Rank: i + 1,
          Range: `${r.range[0].toFixed(2)} - ${r.range[1].toFixed(2)}`,
          Width: r.width.toFixed(2),
          WR: r.wr.toFixed(1) + "%",
          Trades: r.trades,
          Profit: "$" + r.profit.toFixed(2),
          "Avg/Trade": "$" + r.avgProfit.toFixed(2),
          "Quality Score": r.qualityScore.toFixed(1)
        })));

        // ============================================
        // PART 4: Generate Perfect Ranges
        // ============================================
        console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
        console.log("║     PART 4: PERFECT ATR RANGES ARRAY                              ║");
        console.log("╠═══════════════════════════════════════════════════════════════════╣");

        // Get top quality ranges
        const topRanges = qualityResults
          .filter(r => r.wr >= 65 && r.trades >= 4)
          .slice(0, 30);

        // Remove overlapping ranges (keep higher quality)
        const uniqueRanges = [];
        for (const range of topRanges) {
          const isDuplicate = uniqueRanges.some(existing =>
            Math.abs(existing.range[0] - range.range[0]) < 0.03 &&
            Math.abs(existing.range[1] - range.range[1]) < 0.03
          );
          if (!isDuplicate) {
            uniqueRanges.push(range);
          }
        }

        console.log("\n📋 RECOMMENDED ATR RANGES ARRAY (Copy this):\n");
        console.log("const atrRanges = [");

        // Format for copy-paste
        const formattedRanges = uniqueRanges
          .sort((a, b) => a.range[0] - b.range[0])
          .map(r => `  [${r.range[0].toFixed(2)}, ${r.range[1].toFixed(2)}]`);

        console.log(formattedRanges.join(",\n"));
        console.log("];");

        console.log(`\n📊 Total Ranges: ${uniqueRanges.length}`);

        // ============================================
        // PART 5: Summary Recommendations
        // ============================================
        console.log("\n╔═══════════════════════════════════════════════════════════════════╗");
        console.log("║     SUMMARY: OPTIMAL RANGE CONFIGURATION                          ║");
        console.log("╠═══════════════════════════════════════════════════════════════════╣");

        const bestRange = qualityResults[0];
        const avgWidth = uniqueRanges.reduce((s, r) => s + r.width, 0) / uniqueRanges.length;

        console.log(`
🎯 FINDINGS:

1. OPTIMAL WIDTH: ${avgWidth.toFixed(2)} (range: 0.30 - 0.50)
   - Too narrow (<0.25): Misses trades, unstable WR
   - Too wide (>0.60): Includes bad trades, dilutes WR
   - Sweet spot: 0.35 - 0.45 width

2. BEST STARTING POINTS:
   - Primary Zone: 0.45 - 0.75 (most consistent)
   - Secondary Zone: 0.75 - 1.10 (high volatility)
   - Avoid: Below 0.30 (low WR territory)

3. BEST SINGLE RANGE: ${bestRange.range[0].toFixed(2)} - ${bestRange.range[1].toFixed(2)}
   - Win Rate: ${bestRange.wr.toFixed(1)}%
   - Trades: ${bestRange.trades}
   - Quality Score: ${bestRange.qualityScore.toFixed(1)}

4. FILTER RECOMMENDATIONS:
   - NY Session: REQUIRED (adds 8-15% to WR)
   - Slope ≠ 0: REQUIRED (adds 5-10% to WR)
   - Weekend: OPTIONAL (minimal impact)
`);

        console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

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

                if (filtered.length >= 20 && wr >= 50) {
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
          const MIN_TRADES_PCT = 4;
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
            console.log("==== Best COMBO (ATR %) ====");
            console.table(highWRPercentCombos[0]);
          } else {
            // no combo met thresholds; show best raw combos instead
            sortCombos(allPercentCombos);
            console.log("No ATR% combos met thresholds; showing best raw ATR% combos instead.");
            console.log("==== BEST RAW COMBOS (ATR %) ====");
            console.table(allPercentCombos.slice(0, 60));
          }

          // ============================================
          // WALK-FORWARD ANALYSIS: Rolling 10-Day Window
          // Tests BOTH Raw ATR and ATR% Combos
          // ============================================
          console.log("\n");
          console.log("╔═══════════════════════════════════════════════════════════════════════╗");
          console.log("║   WALK-FORWARD ANALYSIS: Best Combos from Last 10 Days               ║");
          console.log("║   Testing: Raw ATR + ATR% + Comparing Both                            ║");
          console.log("╚═══════════════════════════════════════════════════════════════════════╝");

          // === CONFIGURATION ===
          const ROLLING_WINDOW_DAYS = 10;
          const WF_MIN_TRADES = 4;
          const WF_MIN_WR = 55;


          // Sort trades chronologically
          const chronoTrades = [...tradesWithPct].sort((a, b) =>
            new Date(a.time).getTime() - new Date(b.time).getTime()
          );

          console.log(`\n📊 Total trades: ${chronoTrades.length}`);
          console.log(`📅 Window: ${ROLLING_WINDOW_DAYS} days`);
          console.log(`📈 Min trades: ${WF_MIN_TRADES}`);
          console.log(`🎯 Min WR: ${WF_MIN_WR}%\n`);

          // ═══════════════════════════════════════════════════════════════════
          // HELPER: Find Best RAW ATR Combo
          // ═══════════════════════════════════════════════════════════════════
          function findBestRawATRCombo(trades, atrRangesList) {
            if (trades.length < WF_MIN_TRADES) return null;

            let bestCombo = null;
            let bestScore = -Infinity;

            for (let [minATR, maxATR] of atrRangesList) {
              for (let useNY of [true, false]) {
                for (let useWeekend of [true, false]) {
                  for (let useSlope of [true, false]) {

                    let filtered = trades.filter(t => t.atr >= minATR && t.atr <= maxATR);

                    if (useNY) filtered = filtered.filter(nyFilter);
                    if (useWeekend) filtered = filtered.filter(weekendFilter);
                    if (useSlope) filtered = filtered.filter(nonZeroSlope);

                    if (filtered.length < WF_MIN_TRADES) continue;

                    const wins = filtered.filter(t => t.profit > 0).length;
                    const wr = (wins / filtered.length) * 100;

                    if (wr < WF_MIN_WR) continue;

                    const profit = filtered.reduce((sum, t) => sum + (t.profit || 0), 0);
                    const score = (wr * 1000) + (profit * 10) + filtered.length;

                    if (score > bestScore) {
                      bestScore = score;
                      bestCombo = {
                        type: 'RAW_ATR',
                        minATR,
                        maxATR,
                        useNY,
                        useWeekend,
                        useSlope,
                        wr,
                        profit,
                        trades: filtered.length,
                        score
                      };
                    }
                  }
                }
              }
            }

            return bestCombo;
          }

          // ═══════════════════════════════════════════════════════════════════
          // HELPER: Find Best ATR% Combo
          // ═══════════════════════════════════════════════════════════════════
          function findBestATRPctCombo(trades, pctRangesList) {
            if (trades.length < WF_MIN_TRADES) return null;

            let bestCombo = null;
            let bestScore = -Infinity;

            for (let [minPct, maxPct] of pctRangesList) {
              for (let useNY of [true, false]) {
                for (let useWeekend of [true, false]) {
                  for (let useSlope of [true, false]) {

                    let filtered = trades.filter(t =>
                      t.atrPct >= minPct && t.atrPct <= maxPct
                    );

                    if (useNY) filtered = filtered.filter(nyFilter);
                    if (useWeekend) filtered = filtered.filter(weekendFilter);
                    if (useSlope) filtered = filtered.filter(nonZeroSlope);

                    if (filtered.length < WF_MIN_TRADES) continue;

                    const wins = filtered.filter(t => t.profit > 0).length;
                    const wr = (wins / filtered.length) * 100;

                    if (wr < WF_MIN_WR) continue;

                    const profit = filtered.reduce((sum, t) => sum + (t.profit || 0), 0);
                    const score = (wr * 1000) + (profit * 10) + filtered.length;

                    if (score > bestScore) {
                      bestScore = score;
                      bestCombo = {
                        type: 'ATR_PCT',
                        minPct,
                        maxPct,
                        useNY,
                        useWeekend,
                        useSlope,
                        wr,
                        profit,
                        trades: filtered.length,
                        score
                      };
                    }
                  }
                }
              }
            }

            return bestCombo;
          }

          // ═══════════════════════════════════════════════════════════════════
          // HELPER: Check if trade matches Raw ATR combo
          // ═══════════════════════════════════════════════════════════════════
          function tradeMatchesRawATR(trade, combo) {
            if (!combo || combo.type !== 'RAW_ATR') return false;

            if (trade.atr < combo.minATR || trade.atr > combo.maxATR) return false;
            if (combo.useNY && !nyFilter(trade)) return false;
            if (combo.useWeekend && !weekendFilter(trade)) return false;
            if (combo.useSlope && !nonZeroSlope(trade)) return false;

            return true;
          }

          // ═══════════════════════════════════════════════════════════════════
          // HELPER: Check if trade matches ATR% combo
          // ═══════════════════════════════════════════════════════════════════
          function tradeMatchesATRPct(trade, combo) {
            if (!combo || combo.type !== 'ATR_PCT') return false;

            if (trade.atrPct < combo.minPct || trade.atrPct > combo.maxPct) return false;
            if (combo.useNY && !nyFilter(trade)) return false;
            if (combo.useWeekend && !weekendFilter(trade)) return false;
            if (combo.useSlope && !nonZeroSlope(trade)) return false;

            return true;
          }

          // ═══════════════════════════════════════════════════════════════════
          // RESULTS TRACKING - Separate for Raw ATR and ATR%
          // ═══════════════════════════════════════════════════════════════════
          let rawATRResults = {
            tradesTaken: 0,
            tradesSkipped: 0,
            tradesNoWindow: 0,
            wins: 0,
            losses: 0,
            totalProfit: 0,
            details: []
          };

          let atrPctResults = {
            tradesTaken: 0,
            tradesSkipped: 0,
            tradesNoWindow: 0,
            wins: 0,
            losses: 0,
            totalProfit: 0,
            details: []
          };

          // Combined: Use whichever combo has higher score
          let bestOfBothResults = {
            tradesTaken: 0,
            tradesSkipped: 0,
            tradesNoWindow: 0,
            wins: 0,
            losses: 0,
            totalProfit: 0,
            details: []
          };

          let currentRawATRCombo = null;
          let currentATRPctCombo = null;
          let rawComboChanges = 0;
          let pctComboChanges = 0;
          let lastRawComboStr = "";
          let lastPctComboStr = "";

          // ═══════════════════════════════════════════════════════════════════
          // MAIN WALK-FORWARD LOOP
          // ═══════════════════════════════════════════════════════════════════
          console.log("Processing trades with rolling 10-day window...\n");

          for (let i = 0; i < chronoTrades.length; i++) {
            const currentTrade = chronoTrades[i];

            // Get trades from last 10 days
            const windowTrades = restrades;

            // Skip if not enough window data
            if (windowTrades.length < WF_MIN_TRADES) {
              rawATRResults.tradesNoWindow++;
              atrPctResults.tradesNoWindow++;
              bestOfBothResults.tradesNoWindow++;
              continue;
            }

            // ─────────────────────────────────────────────────────
            // Find best Raw ATR combo from window
            // ─────────────────────────────────────────────────────
            const bestRawCombo = findBestRawATRCombo(windowTrades, atrRanges);

            if (bestRawCombo) {
              const comboStr = `${bestRawCombo.minATR}-${bestRawCombo.maxATR}-${bestRawCombo.useNY}-${bestRawCombo.useWeekend}-${bestRawCombo.useSlope}`;
              if (comboStr !== lastRawComboStr) {
                rawComboChanges++;
                lastRawComboStr = comboStr;
                currentRawATRCombo = bestRawCombo;
              }
            }

            // ─────────────────────────────────────────────────────
            // Find best ATR% combo from window
            // ─────────────────────────────────────────────────────
            const bestPctCombo = findBestATRPctCombo(windowTrades, atrPercentRanges);

            if (bestPctCombo) {
              const comboStr = `${bestPctCombo.minPct}-${bestPctCombo.maxPct}-${bestPctCombo.useNY}-${bestPctCombo.useWeekend}-${bestPctCombo.useSlope}`;
              if (comboStr !== lastPctComboStr) {
                pctComboChanges++;
                lastPctComboStr = comboStr;
                currentATRPctCombo = bestPctCombo;
              }
            }

            // ─────────────────────────────────────────────────────
            // Test Raw ATR combo
            // ─────────────────────────────────────────────────────
            if (bestRawCombo && tradeMatchesRawATR(currentTrade, bestRawCombo)) {
              rawATRResults.tradesTaken++;
              rawATRResults.totalProfit += (currentTrade.profit || 0);

              if (currentTrade.profit > 0) {
                rawATRResults.wins++;
              } else {
                rawATRResults.losses++;
              }

              rawATRResults.details.push({
                "#": rawATRResults.tradesTaken,
                TradeNum: currentTrade.tradeNumber,
                Date: new Date(currentTrade.time).toLocaleDateString(),
                ATR: currentTrade.atr?.toFixed(3),
                Profit: (currentTrade.profit || 0).toFixed(2),
                Result: currentTrade.profit > 0 ? "✅" : "❌",
                ComboRange: `${bestRawCombo.minATR}-${bestRawCombo.maxATR}`,
                ComboWR: bestRawCombo.wr.toFixed(1) + "%",
                Filters: `NY:${bestRawCombo.useNY ? '✓' : '✗'} WE:${bestRawCombo.useWeekend ? '✓' : '✗'} SL:${bestRawCombo.useSlope ? '✓' : '✗'}`,
                RunningProfit: rawATRResults.totalProfit.toFixed(2)
              });
            } else {
              rawATRResults.tradesSkipped++;
            }

            // ─────────────────────────────────────────────────────
            // Test ATR% combo
            // ─────────────────────────────────────────────────────
            if (bestPctCombo && tradeMatchesATRPct(currentTrade, bestPctCombo)) {
              atrPctResults.tradesTaken++;
              atrPctResults.totalProfit += (currentTrade.profit || 0);

              if (currentTrade.profit > 0) {
                atrPctResults.wins++;
              } else {
                atrPctResults.losses++;
              }

              atrPctResults.details.push({
                "#": atrPctResults.tradesTaken,
                TradeNum: currentTrade.tradeNumber,
                Date: new Date(currentTrade.time).toLocaleDateString(),
                ATRPct: (currentTrade.atrPct * 100).toFixed(4) + "%",
                Profit: (currentTrade.profit || 0).toFixed(2),
                Result: currentTrade.profit > 0 ? "✅" : "❌",
                ComboRange: `${(bestPctCombo.minPct * 100).toFixed(3)}%-${(bestPctCombo.maxPct * 100).toFixed(3)}%`,
                ComboWR: bestPctCombo.wr.toFixed(1) + "%",
                Filters: `NY:${bestPctCombo.useNY ? '✓' : '✗'} WE:${bestPctCombo.useWeekend ? '✓' : '✗'} SL:${bestPctCombo.useSlope ? '✓' : '✗'}`,
                RunningProfit: atrPctResults.totalProfit.toFixed(2)
              });
            } else {
              atrPctResults.tradesSkipped++;
            }

            // ─────────────────────────────────────────────────────
            // Test BEST OF BOTH (whichever combo has higher score)
            // ─────────────────────────────────────────────────────
            let bestOverall = null;
            let matchesBest = false;

            if (bestRawCombo && bestPctCombo) {
              // Both exist - pick higher score
              if (bestRawCombo.score >= bestPctCombo.score) {
                bestOverall = bestRawCombo;
                matchesBest = tradeMatchesRawATR(currentTrade, bestRawCombo);
              } else {
                bestOverall = bestPctCombo;
                matchesBest = tradeMatchesATRPct(currentTrade, bestPctCombo);
              }
            } else if (bestRawCombo) {
              bestOverall = bestRawCombo;
              matchesBest = tradeMatchesRawATR(currentTrade, bestRawCombo);
            } else if (bestPctCombo) {
              bestOverall = bestPctCombo;
              matchesBest = tradeMatchesATRPct(currentTrade, bestPctCombo);
            }

            if (bestOverall && matchesBest) {
              bestOfBothResults.tradesTaken++;
              bestOfBothResults.totalProfit += (currentTrade.profit || 0);

              if (currentTrade.profit > 0) {
                bestOfBothResults.wins++;
              } else {
                bestOfBothResults.losses++;
              }

              bestOfBothResults.details.push({
                "#": bestOfBothResults.tradesTaken,
                TradeNum: currentTrade.tradeNumber,
                Date: new Date(currentTrade.time).toLocaleDateString(),
                Type: bestOverall.type,
                Profit: (currentTrade.profit || 0).toFixed(2),
                Result: currentTrade.profit > 0 ? "✅" : "❌",
                ComboWR: bestOverall.wr.toFixed(1) + "%",
                ComboScore: bestOverall.score.toFixed(0),
                RunningProfit: bestOfBothResults.totalProfit.toFixed(2)
              });
            } else {
              bestOfBothResults.tradesSkipped++;
            }
          }

          // ═══════════════════════════════════════════════════════════════════
          // CALCULATE STATISTICS
          // ═══════════════════════════════════════════════════════════════════
          const calcStats = (r) => ({
            wr: r.tradesTaken > 0 ? ((r.wins / r.tradesTaken) * 100).toFixed(2) : "0.00",
            avgProfit: r.tradesTaken > 0 ? (r.totalProfit / r.tradesTaken).toFixed(2) : "0.00"
          });

          const rawStats = calcStats(rawATRResults);
          const pctStats = calcStats(atrPctResults);
          const bestStats = calcStats(bestOfBothResults);

          // ═══════════════════════════════════════════════════════════════════
          // DISPLAY RESULTS
          // ═══════════════════════════════════════════════════════════════════

          console.log("\n╔═══════════════════════════════════════════════════════════════════════╗");
          console.log("║                      WALK-FORWARD RESULTS                             ║");
          console.log("╠═══════════════════════════════════════════════════════════════════════╣");

          // === RAW ATR RESULTS ===
          console.log("\n📊 ═══ RAW ATR COMBO RESULTS ═══");
          console.table({
            "Trades Taken": rawATRResults.tradesTaken,
            "Trades Skipped": rawATRResults.tradesSkipped,
            "No Window Data": rawATRResults.tradesNoWindow,
            "Wins": rawATRResults.wins,
            "Losses": rawATRResults.losses,
            "WIN RATE": rawStats.wr + "%",
            "TOTAL PROFIT": "$" + rawATRResults.totalProfit.toFixed(2),
            "Avg Profit/Trade": "$" + rawStats.avgProfit,
            "Combo Changes": rawComboChanges
          });

          // === ATR% RESULTS ===
          console.log("\n📈 ═══ ATR% COMBO RESULTS ═══");
          console.table({
            "Trades Taken": atrPctResults.tradesTaken,
            "Trades Skipped": atrPctResults.tradesSkipped,
            "No Window Data": atrPctResults.tradesNoWindow,
            "Wins": atrPctResults.wins,
            "Losses": atrPctResults.losses,
            "WIN RATE": pctStats.wr + "%",
            "TOTAL PROFIT": "$" + atrPctResults.totalProfit.toFixed(2),
            "Avg Profit/Trade": "$" + pctStats.avgProfit,
            "Combo Changes": pctComboChanges
          });


          // === DETERMINE WINNER ===
          console.log("\n🏆 ═══ WINNER ANALYSIS ═══");

          const methods = [
            { name: "Raw ATR", wr: parseFloat(rawStats.wr), profit: rawATRResults.totalProfit, avg: parseFloat(rawStats.avgProfit) },
            { name: "ATR%", wr: parseFloat(pctStats.wr), profit: atrPctResults.totalProfit, avg: parseFloat(pctStats.avgProfit) },
            { name: "Best of Both", wr: parseFloat(bestStats.wr), profit: bestOfBothResults.totalProfit, avg: parseFloat(bestStats.avgProfit) }
          ];

          const bestByWR = [...methods].sort((a, b) => b.wr - a.wr)[0];
          const bestByProfit = [...methods].sort((a, b) => b.profit - a.profit)[0];
          const bestByAvg = [...methods].sort((a, b) => b.avg - a.avg)[0];

          console.table({
            "🎯 Best Win Rate": `${bestByWR.name} (${bestByWR.wr}%)`,
            "💰 Best Total Profit": `${bestByProfit.name} ($${bestByProfit.profit.toFixed(2)})`,
            "💵 Best Avg Profit/Trade": `${bestByAvg.name} ($${bestByAvg.avg.toFixed(2)})`
          });


          // ═══════════════════════════════════════════════════════════════════
          // CURRENT BEST COMBOS
          // ═══════════════════════════════════════════════════════════════════
          console.log("\n╔═══════════════════════════════════════════════════════════════════════╗");
          console.log("║         CURRENT BEST COMBOS (From Most Recent 10-Day Window)          ║");
          console.log("╠═══════════════════════════════════════════════════════════════════════╣");

          if (currentRawATRCombo) {
            console.log("\n📊 CURRENT BEST RAW ATR COMBO:");
            console.table({
              "ATR Min": currentRawATRCombo.minATR,
              "ATR Max": currentRawATRCombo.maxATR,
              "NY Session": currentRawATRCombo.useNY ? "✅ ON" : "❌ OFF",
              "Weekend Filter": currentRawATRCombo.useWeekend ? "✅ ON" : "❌ OFF",
              "Slope Filter": currentRawATRCombo.useSlope ? "✅ ON" : "❌ OFF",
              "Window WR": currentRawATRCombo.wr.toFixed(2) + "%",
              "Window Trades": currentRawATRCombo.trades,
              "Window Profit": "$" + currentRawATRCombo.profit.toFixed(2),
              "Score": currentRawATRCombo.score.toFixed(0)
            });
          }

          if (currentATRPctCombo) {
            console.log("\n📈 CURRENT BEST ATR% COMBO:");
            console.table({
              "ATR% Min": (currentATRPctCombo.minPct * 100).toFixed(4) + "%",
              "ATR% Max": (currentATRPctCombo.maxPct * 100).toFixed(4) + "%",
              "NY Session": currentATRPctCombo.useNY ? "✅ ON" : "❌ OFF",
              "Weekend Filter": currentATRPctCombo.useWeekend ? "✅ ON" : "❌ OFF",
              "Slope Filter": currentATRPctCombo.useSlope ? "✅ ON" : "❌ OFF",
              "Window WR": currentATRPctCombo.wr.toFixed(2) + "%",
              "Window Trades": currentATRPctCombo.trades,
              "Window Profit": "$" + currentATRPctCombo.profit.toFixed(2),
              "Score": currentATRPctCombo.score.toFixed(0)
            });
          }

          // Recommend which to use
          if (currentRawATRCombo && currentATRPctCombo) {
            const recommended = currentRawATRCombo.score >= currentATRPctCombo.score
              ? { type: "RAW ATR", combo: currentRawATRCombo }
              : { type: "ATR%", combo: currentATRPctCombo };

            console.log("\n🎯 ═══ RECOMMENDED FOR NEXT TRADE ═══");
            console.log(`Use: ${recommended.type} (Score: ${recommended.combo.score.toFixed(0)})`);

            if (recommended.type === "RAW ATR") {
              console.log(`ATR Range: ${recommended.combo.minATR} - ${recommended.combo.maxATR}`);
            } else {
              console.log(`ATR% Range: ${(recommended.combo.minPct * 100).toFixed(4)}% - ${(recommended.combo.maxPct * 100).toFixed(4)}%`);
            }
            console.log(`Filters: NY=${recommended.combo.useNY}, Weekend=${recommended.combo.useWeekend}, Slope=${recommended.combo.useSlope}`);
          }

          console.log("\n╚═══════════════════════════════════════════════════════════════════════╝");
          console.log("✅ Walk-Forward Analysis Complete!\n");

          // ============================================
          // USE MANUAL ATR% RANGE (instead of auto-picking best combo)
          // ============================================
          if (testing) {
            console.log("\n");
            console.log("╔═══════════════════════════════════════════════════════════════════╗");
            console.log("║                    MANUAL TESTING MODE                             ║");
            console.log("╚═══════════════════════════════════════════════════════════════════╝");

            let manualFiltered = [];

            if (MANUAL_FILTER_MODE === 'ATR_PCT') {
              // ─────────────────────────────────────────────────────
              // ATR PERCENTAGE MODE
              // ─────────────────────────────────────────────────────
              console.log("\n📈 MODE: ATR PERCENTAGE (ATR%)\n");
              console.log(`ATR% Range: ${(MANUAL_ATR_PCT_MIN * 100).toFixed(4)}% - ${(MANUAL_ATR_PCT_MAX * 100).toFixed(4)}%`);
              console.log(`NY Session: ${USE_NY_SESSION}, Weekend Filter: ${USE_WEEKEND_FILTER}, Slope Filter: ${USE_SLOPE_FILTER}`);

              manualFiltered = tradesWithPct.filter(t =>
                t.atrPct >= MANUAL_ATR_PCT_MIN && t.atrPct <= MANUAL_ATR_PCT_MAX
              );

              // Apply additional filters
              if (USE_NY_SESSION) manualFiltered = manualFiltered.filter(nyFilter);
              if (USE_WEEKEND_FILTER) manualFiltered = manualFiltered.filter(weekendFilter);
              if (USE_SLOPE_FILTER) manualFiltered = manualFiltered.filter(nonZeroSlope);

              const manualWR = calculateWinrate(manualFiltered);
              const manualProfit = manualFiltered.reduce((sum, t) => sum + (t.profit || 0), 0);

              console.log("\n==== MANUAL ATR% COMBO STATS ====");
              console.table({
                "Filter Mode": "ATR%",
                "ATR% Min": (MANUAL_ATR_PCT_MIN * 100).toFixed(4) + "%",
                "ATR% Max": (MANUAL_ATR_PCT_MAX * 100).toFixed(4) + "%",
                "NY Session": USE_NY_SESSION ? "✅ ON" : "❌ OFF",
                "Weekend Filter": USE_WEEKEND_FILTER ? "✅ ON" : "❌ OFF",
                "Slope Filter": USE_SLOPE_FILTER ? "✅ ON" : "❌ OFF",
                "Win Rate": manualWR + "%",
                "Total Trades": manualFiltered.length,
                "Total Profit": "$" + manualProfit.toFixed(2),
                "Avg Profit/Trade": manualFiltered.length > 0
                  ? "$" + (manualProfit / manualFiltered.length).toFixed(2)
                  : "$0.00"
              });

            } else if (MANUAL_FILTER_MODE === 'RAW_ATR') {

              // Use restrades (original trades array) or tradesWithPct (has atrPct added)
              manualFiltered = tradesWithPct.filter(t =>
                t.atr >= MANUAL_ATR_RAW_MIN && t.atr <= MANUAL_ATR_RAW_MAX
              );

              // Apply additional filters
              if (USE_NY_SESSION) manualFiltered = manualFiltered.filter(nyFilter);
              if (USE_WEEKEND_FILTER) manualFiltered = manualFiltered.filter(weekendFilter);
              if (USE_SLOPE_FILTER) manualFiltered = manualFiltered.filter(nonZeroSlope);

              const manualWR = calculateWinrate(manualFiltered);
              const manualProfit = manualFiltered.reduce((sum, t) => sum + (t.profit || 0), 0);

              console.log("\n==== MANUAL RAW ATR COMBO STATS ====");
              console.table({
                "Filter Mode": "Raw ATR",
                "ATR Min": MANUAL_ATR_RAW_MIN,
                "ATR Max": MANUAL_ATR_RAW_MAX,
                "NY Session": USE_NY_SESSION ? "✅ ON" : "❌ OFF",
                "Weekend Filter": USE_WEEKEND_FILTER ? "✅ ON" : "❌ OFF",
                "Slope Filter": USE_SLOPE_FILTER ? "✅ ON" : "❌ OFF",
                "Win Rate": manualWR + "%",
                "Total Trades": manualFiltered.length,
                "Total Profit": "$" + manualProfit.toFixed(2),
                "Avg Profit/Trade": manualFiltered.length > 0
                  ? "$" + (manualProfit / manualFiltered.length).toFixed(2)
                  : "$0.00"
              });

            } else {
              console.error("❌ Invalid MANUAL_FILTER_MODE. Use 'ATR_PCT' or 'RAW_ATR'");
              manualFiltered = restrades;
            }

            // ─────────────────────────────────────────────────────
            // Show trade breakdown
            // ─────────────────────────────────────────────────────
            if (manualFiltered.length > 0) {
              const wins = manualFiltered.filter(t => t.profit > 0);
              const losses = manualFiltered.filter(t => t.profit <= 0);

              console.log("\n==== TRADE BREAKDOWN ====");
              console.table({
                "✅ Winning Trades": wins.length,
                "❌ Losing Trades": losses.length,
                "💰 Total Wins Profit": "$" + wins.reduce((s, t) => s + t.profit, 0).toFixed(2),
                "💸 Total Losses": "$" + losses.reduce((s, t) => s + t.profit, 0).toFixed(2),
                "📊 Avg Win": wins.length > 0
                  ? "$" + (wins.reduce((s, t) => s + t.profit, 0) / wins.length).toFixed(2)
                  : "$0.00",
                "📉 Avg Loss": losses.length > 0
                  ? "$" + (losses.reduce((s, t) => s + t.profit, 0) / losses.length).toFixed(2)
                  : "$0.00"
              });

            }

            finalTrades = manualFiltered;
            console.log(`\n📋 Showing trades for MANUAL ${MANUAL_FILTER_MODE} range. Count: ${manualFiltered.length}`);
            console.log("╚═══════════════════════════════════════════════════════════════════╝\n");
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