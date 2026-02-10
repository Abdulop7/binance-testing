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

const MANUAL_ATR_RAW_MIN = 0.2423;
const MANUAL_ATR_RAW_MAX = 0.2676;

const USE_NY_SESSION = false;        // true = only NY session trades
const USE_WEEKEND_FILTER = true;    // true = exclude weekends
const USE_SLOPE_FILTER = true;      // true = only non-zero slope trades
const min_trades = 20
// ============================================


function isNewYorkSession(time) {
  const date = new Date(time)
  const utcHour = date.getUTCHours()
  return utcHour >= 15 && utcHour < 22 // 15:00–22:00 UTC = 8pm–3am PKT
}

export default function Logs() {
  // const backendUrl = import.meta.env.VITE_BACKEND_URL;
  const backendUrl = "https://binance-testing.fly.dev";

  let [trades, setTrades] = useState([])
  let [tProfit, setTprofit] = useState("")

  useEffect(() => {

    async function fetchTrades() {
      try {
        // let res = await axios.get(`https://binance-testing.fly.dev/bot/all-trades`,
        let res = await axios.get(`${backendUrl}/bot/all-trades`,
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
        let customStartDate = "2026-1-10";     // yyyy-mm-dd
        let customEndDate = "2026-2-10";       // yyyy-mm-dd  (optional)

        // let customStartDate = "2026-1-15";     // yyyy-mm-dd
        // let customEndDate = "2026-2-4";       // yyyy-mm-dd  (optional)

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

        const useNYOptions = [true, false];
        const useWeekendOptions = [true, false];
        const useSlopeOptions = [true, false];

        let atrRanges = [];


        // ============================================
        // DYNAMIC ATR RANGE GENERATION
        // ============================================

        // Function to generate ATR ranges dynamically based on price-relative ATR%
        function generateDynamicATRRanges(tradesData) {
          // Calculate ATR% for each trade
          const tradesWithATRPct = tradesData
            .filter(t => t.atr && t.entryPrice && !isNaN(t.atr) && !isNaN(t.entryPrice) && t.entryPrice > 0)
            .map(t => ({
              ...t,
              atrPct: t.atr / t.entryPrice // ATR as percentage of price
            }));

          if (tradesWithATRPct.length === 0) {
            console.warn("No valid ATR/Price data found");
            return [];
          }

          const atrPctValues = tradesWithATRPct.map(t => t.atrPct);
          const minPct = Math.min(...atrPctValues);
          const maxPct = Math.max(...atrPctValues);

          console.log(`ATR% Range in data: ${(minPct * 100).toFixed(4)}% - ${(maxPct * 100).toFixed(4)}%`);

          // Create price brackets based on data distribution
          const priceBrackets = [
            { name: "Low Price", min: 0, max: 10, trades: [] },
            { name: "Medium Price", min: 10, max: 100, trades: [] },
            { name: "High Price", min: 100, max: 1000, trades: [] },
            { name: "Very High Price", min: 1000, max: Infinity, trades: [] }
          ];

          // Categorize trades by price brackets
          tradesWithATRPct.forEach(trade => {
            const bracket = priceBrackets.find(b => trade.entryPrice >= b.min && trade.entryPrice < b.max);
            if (bracket) bracket.trades.push(trade);
          });

          console.log("\n📊 Price Distribution:");
          priceBrackets.forEach(bracket => {
            console.log(`${bracket.name}: ${bracket.trades.length} trades (${bracket.min}-${bracket.max === Infinity ? '∞' : bracket.max})`);
          });

          // Generate ATR% ranges based on data distribution
          const sortedPctValues = [...atrPctValues].sort((a, b) => a - b);
          const getPercentile = (p) => {
            const index = Math.floor((p / 100) * sortedPctValues.length);
            return sortedPctValues[Math.min(index, sortedPctValues.length - 1)];
          };

          const p10 = getPercentile(10);
          const p25 = getPercentile(25);
          const p50 = getPercentile(50);
          const p75 = getPercentile(75);
          const p90 = getPercentile(90);

          console.log(`\nATR% Percentiles:`, {
            P10: (p10 * 100).toFixed(4) + '%',
            P25: (p25 * 100).toFixed(4) + '%',
            P50: (p50 * 100).toFixed(4) + '%',
            P75: (p75 * 100).toFixed(4) + '%',
            P90: (p90 * 100).toFixed(4) + '%'
          });

          // Generate ATR% ranges using multiple strategies
          const atrPctRanges = [];

          // Strategy 1: Fixed percentage ranges with finer steps for 4-decimal precision
          const fixedSteps = [0.0001, 0.00025, 0.0005, 0.001, 0.002, 0.003, 0.005]; // 0.01%, 0.025%, 0.05%, 0.1%, 0.2%, 0.3%, 0.5%
          fixedSteps.forEach(step => {
            for (let start = minPct; start <= maxPct; start += step) {
              const end = Math.min(start + step * 2, maxPct);
              atrPctRanges.push([start, end]);
            }
          });

          // Strategy 2: Percentile-based ranges
          const percentilePoints = [p10, p25, p50, p75, p90];
          for (let i = 0; i < percentilePoints.length; i++) {
            for (let j = i + 1; j < percentilePoints.length; j++) {
              atrPctRanges.push([percentilePoints[i], percentilePoints[j]]);
            }
          }

          // Strategy 3: Adaptive ranges based on density with finer granularity
          const adaptiveRanges = [];
          const numBuckets = 50; // Increased for finer granularity
          const bucketSize = (maxPct - minPct) / numBuckets;

          for (let i = 0; i < numBuckets; i++) {
            const start = minPct + (i * bucketSize);
            for (let j = i + 1; j < Math.min(i + 8, numBuckets); j++) { // Increased range combinations
              const end = minPct + (j * bucketSize);
              adaptiveRanges.push([start, end]);
            }
          }
          atrPctRanges.push(...adaptiveRanges);

          // Remove duplicates and filter valid ranges
          const uniquePctRanges = [...new Set(
            atrPctRanges
              .filter(([min, max]) => min < max && min >= 0)
              .map(r => JSON.stringify(r))
          )].map(r => JSON.parse(r));

          console.log(`Generated ${uniquePctRanges.length} ATR% ranges`);

          // Convert ATR% ranges to absolute ATR ranges for each price bracket
          const absoluteRanges = [];

          priceBrackets.forEach(bracket => {
            if (bracket.trades.length === 0) return;

            // Use median price of bracket for calculations
            const medianPrice = bracket.trades.length > 0
              ? bracket.trades.sort((a, b) => a.entryPrice - b.entryPrice)[Math.floor(bracket.trades.length / 2)].entryPrice
              : (bracket.min + bracket.max) / 2;

            console.log(`\nGenerating ranges for ${bracket.name} (median price: $${medianPrice.toFixed(4)}):`);

            uniquePctRanges.forEach(([minPct, maxPct]) => {
              const minATR = minPct * medianPrice;
              const maxATR = maxPct * medianPrice;

              // Only add ranges that make sense for this price level
              // Adjusted minimum for 4-decimal precision
              if (minATR >= 0.0001 && maxATR <= medianPrice * 0.1) { // Max 10% of price
                absoluteRanges.push({
                  priceRange: bracket.name,
                  priceMin: bracket.min,
                  priceMax: bracket.max,
                  atrMin: parseFloat(minATR.toFixed(4)), // Keep 4 decimal places
                  atrMax: parseFloat(maxATR.toFixed(4)), // Keep 4 decimal places
                  atrPctMin: minPct,
                  atrPctMax: maxPct
                });
              }
            });
          });

          // Group and sort ranges by price bracket
          const rangesByPriceBracket = {};
          absoluteRanges.forEach(range => {
            if (!rangesByPriceBracket[range.priceRange]) {
              rangesByPriceBracket[range.priceRange] = [];
            }
            rangesByPriceBracket[range.priceRange].push([range.atrMin, range.atrMax]);
          });

          // Show sample ranges for each price bracket with 4 decimal precision
          console.log("\n📈 Sample ATR Ranges by Price Bracket:");
          Object.entries(rangesByPriceBracket).forEach(([bracketName, ranges]) => {
            console.log(`\n${bracketName}:`);
            console.log(`Total ranges: ${ranges.length}`);
            console.log("Sample ranges:");
            ranges.slice(0, 5).forEach(([min, max]) => {
              const avgPrice = priceBrackets.find(b => b.name === bracketName).trades.length > 0
                ? priceBrackets.find(b => b.name === bracketName).trades.reduce((sum, t) => sum + t.entryPrice, 0) /
                priceBrackets.find(b => b.name === bracketName).trades.length
                : (priceBrackets.find(b => b.name === bracketName).min + priceBrackets.find(b => b.name === bracketName).max) / 2;

              const minPct = (min / avgPrice * 100).toFixed(4);
              const maxPct = (max / avgPrice * 100).toFixed(4);

              console.log(`  [${min.toFixed(4)} - ${max.toFixed(4)}] (${minPct}% - ${maxPct}%)`);
            });
          });

          // Flatten all ranges into a single array for compatibility
          const allRanges = Object.values(rangesByPriceBracket).flat();

          // Remove duplicates and sort while maintaining 4 decimal precision
          const finalRanges = [...new Set(
            allRanges
              .map(r => JSON.stringify(r))
          )].map(r => JSON.parse(r))
            .sort((a, b) => a[0] - b[0] || a[1] - b[1])
            .slice(0, 200); // Increased limit for more comprehensive ranges

          console.log(`\n✅ Generated ${finalRanges.length} total ATR ranges across all price brackets`);

          return finalRanges;
        }

        // Usage in your useEffect:
        // Generate dynamic ATR ranges based on price-relative data
        atrRanges = generateDynamicATRRanges(restrades);

        // Add manual range variations if needed
        if (MANUAL_ATR_RAW_MIN && MANUAL_ATR_RAW_MAX) {
          atrRanges.push(
            [MANUAL_ATR_RAW_MIN - 0.10, MANUAL_ATR_RAW_MAX + 0.10],
            [MANUAL_ATR_RAW_MIN, MANUAL_ATR_RAW_MAX]
          );
        }

        console.log("✅ Using price-adaptive ATR ranges with 4-decimal precision");
        console.log("Total ranges:", atrRanges.length);
        console.log("Sample ranges with 4 decimals:", atrRanges.slice(0, 10).map(r => [r[0].toFixed(4), r[1].toFixed(4)]));
        // const atrRanges = [
        //   // Sweet Spot Zone (Best Performance: 0.55-1.10)
        //   [0.45, 0.75], [0.45, 0.85], [0.45, 0.95],
        //   [0.50, 0.80], [0.50, 0.90], [0.50, 0.95], [0.50, 1.00],
        //   [0.55, 0.85], [0.55, 0.95], [0.55, 1.00], [0.55, 1.05], [0.55, 1.10],
        //   [0.60, 0.90], [0.60, 0.95], [0.60, 1.00], [0.60, 1.05], [0.60, 1.10],
        //   [0.65, 0.95], [0.65, 1.00], [0.65, 1.05], [0.65, 1.10], [0.65, 1.15],
        //   [0.70, 1.00], [0.70, 1.05], [0.70, 1.10], [0.70, 1.15], [0.70, 1.20],

        //   // High Volatility Zone (Strong performers)
        //   [0.75, 1.10], [0.75, 1.15], [0.75, 1.20], [0.75, 1.25],
        //   [0.80, 1.15], [0.80, 1.20], [0.80, 1.25], [0.80, 1.30],
        //   [0.85, 1.20], [0.85, 1.25], [0.85, 1.30], [0.85, 1.35],
        //   [0.90, 1.25], [0.90, 1.30], [0.90, 1.35], [0.90, 1.40],
        //   [0.95, 1.30], [0.95, 1.40], [0.95, 1.50],
        //   [1.00, 1.35], [1.00, 1.45], [1.00, 1.55],

        //   // Extended High Zone (for big moves)
        //   [1.10, 1.50], [1.10, 1.60],
        //   [1.20, 1.60], [1.20, 1.80],
        //   [1.30, 1.70], [1.30, 2.00]
        // ];

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

                if (filtered.length >= min_trades && wr >= 35) {
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
            console.log("==== Best COMBO (ATR %) ====");
            console.table(highWRPercentCombos[0]);
          } else {
            // no combo met thresholds; show best raw combos instead
            sortCombos(allPercentCombos);;
          }


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