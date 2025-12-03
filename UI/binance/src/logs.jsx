import axios from 'axios';
import Header from './common/header'
import { useEffect, useState } from 'react';

let testing = false;

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

      let res = await axios.get(`${backendUrl}/bot/all-trades`,
        {
          headers: {
            Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
          }
        }) // WebUrl Here
      let restrades = res.data

      // Sort trades by `tradeNumber` descending (latest first)
      restrades.sort((a, b) => a.tradeNumber - b.tradeNumber);


      if (!testing) {
        setTrades(restrades)

      }

      // Filters
      const atrFilter = (t) => t.atr >= 0.7 && t.atr <= 1.1
      const nyFilter = (t) => isNewYorkSession(t.time)
      const nonZeroSlope = (t) => t.slope !== 0

      function calculateWinrate(list) {
        const wins = list.filter(t => t.profit > 0).length
        const total = list.length
        return total > 0 ? (wins / total * 100).toFixed(2) : 0
      }


      // ATR + NY + slope ≠ 0
      const eliteTrades = restrades.filter(t =>
        atrFilter(t) &&
        nyFilter(t) &&
        nonZeroSlope(t)
      );

      console.log(eliteTrades);
      const eliteWR = calculateWinrate(eliteTrades)


      // ---- Extra Filters on Elite Trades ----

      // Skip weekends (Sat=6, Sun=0)
      const weekendFilter = (t) => {
        const d = new Date(t.time).getUTCDay();
        return d !== 0 && d !== 6;
      };


      // Apply combos on elite trades
      const eliteWeekend = eliteTrades.filter(weekendFilter)

      if (testing) {
        setTrades(eliteWeekend)

      }


      // Log winrates
      console.table({
        eliteWR: eliteWR + "%",
        eliteTrades: eliteTrades.length,

        elite_Weekend_WR: calculateWinrate(eliteWeekend) + "%",
        weekendTrades: eliteWeekend.length,
      });

      // --- Parameter Ranges to Test ---
      const atrRanges = [
        [0.4, 1.0],
        [0.4, 1.1],
        [0.4, 1.2],
        [0.4, 1.3],
        [0.4, 1.4],
        [0.4, 1.5],

        [0.45, 1.0],
        [0.45, 1.1],
        [0.45, 1.2],
        [0.45, 1.3],
        [0.45, 1.4],

        [0.5, 1.0],
        [0.5, 1.1],
        [0.5, 1.2],
        [0.5, 1.3],
        [0.5, 1.4],

        [0.55, 1.0],
        [0.55, 1.1],
        [0.55, 1.15],
        [0.55, 1.2],
        [0.55, 1.3],

        [0.6, 1.0],
        [0.6, 1.1],
        [0.6, 1.2],
        [0.6, 1.3],

        [0.65, 1.0],
        [0.65, 1.1],
        [0.65, 1.15],
        [0.65, 1.2],
        [0.65, 1.25],

        [0.7, 1.0],
        [0.7, 1.1],
        [0.7, 1.2],
        [0.7, 1.25],
        [0.7, 1.3],

        [0.75, 1.2],
        [0.8, 1.25],
        [0.85, 1.3],
        [0.9, 1.35],
        [0.95, 1.4],
        [1.0, 1.5]
      ];



      const useNYOptions = [true, false];
      const useWeekendOptions = [true, false];
      const useSlopeOptions = [true, false];


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

              // Only include combos with WR >= 70%
              if (filtered.length >= 10 && wr >= 69) {
                highWRCombos.push({
                  ATR: `${minATR}-${maxATR}`,
                  NY: useNY,
                  Weekend: useWeekend,
                  Slope: useSlope,
                  Winrate: wr.toFixed(2) + "%",
                  Trades: filtered.length,
                  Profit: totalProfit.toFixed(2)
                });
              }
            }
          }
        }
      }

      // Sort by winrate (high → low)
      highWRCombos.sort((a, b) => parseFloat(b.Winrate) - parseFloat(a.Winrate));

      console.log("==== HIGH WR COMBOS (70%+) ====");
      console.table(highWRCombos);

      // ================================
      // 🔥 HOUR × ATR × SLOPE COMBOS
      // ================================

      // const hourRanges = [];

      // for (let start = 0; start < 24; start++) {
      //   for (let end = start; end < 24; end++) {
      //     hourRanges.push([start, end]);
      //   }
      // }

      // let bestHourAtrSlopeCombos = [];

      // for (let [minATR, maxATR] of atrRanges) {
      //   for (let [startH, endH] of hourRanges) {
      //     for (let useNY of useNYOptions) {
      //       for (let useWeekend of useWeekendOptions) {
      //         for (let useSlope of useSlopeOptions) {

      //           // Base filter: ATR
      //           let filtered = restrades.filter(t =>
      //             t.atr >= minATR && t.atr <= maxATR
      //           );

      //           // Hour range filter
      //           filtered = filtered.filter(t => {
      //             const h = new Date(t.time).getUTCHours();
      //             return h >= startH && h <= endH;
      //           });

      //           if (useNY) filtered = filtered.filter(nyFilter);
      //           if (useWeekend) filtered = filtered.filter(weekendFilter);
      //           if (useSlope) filtered = filtered.filter(nonZeroSlope);

      //           const wr = parseFloat(calculateWinrate(filtered));
      //           const totalProfit = filtered.reduce((s, t) => s + (t.profit || 0), 0);

      //           // Keep only strong setups
      //           if (filtered.length >= 12 && wr >= 70) {
      //             bestHourAtrSlopeCombos.push({
      //               HourRange: `${startH}:00 - ${endH}:59`,
      //               ATR: `${minATR}-${maxATR}`,
      //               NY: useNY,
      //               Weekend: useWeekend,
      //               Slope: useSlope,
      //               Trades: filtered.length,
      //               Winrate: wr.toFixed(2) + "%",
      //               Profit: totalProfit.toFixed(2),
      //             });
      //           }
      //         }
      //       }
      //     }
      //   }
      // }

      // // Sort by winrate → profit → trades
      // bestHourAtrSlopeCombos.sort((a, b) => {
      //   // 1️⃣ Sort by Profit (High → Low)
      //   const profit = b.Profit - a.Profit;
      //   if (profit !== 0) return profit;

      //   // 2️⃣ Then by Winrate (High → Low)
      //   const wr = parseFloat(b.Winrate) - parseFloat(a.Winrate);
      //   if (wr !== 0) return wr;

      //   // 3️⃣ Then by number of trades (High → Low)
      //   return b.Trades - a.Trades;
      // });


      // console.log("==== BEST HOUR × ATR × SLOPE COMBOS ====");
      // console.table(bestHourAtrSlopeCombos);




      // Calculate total profit
      const total = (testing ? eliteWeekend : restrades).reduce((sum, trade) => sum + (trade.profit || 0), 0);
      setTprofit(total.toFixed(2));

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
          className={`text-lg md:text-xl font-semibold ${
            tProfit >= 0
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
                    className={`px-4 py-3 font-semibold ${
                      v.type === "BUY" ? "text-green-400" : "text-red-400"
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
                    className={`px-4 py-3 font-semibold ${
                      v.profit >= 0
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
              {/* Top Row */}
              <div className="flex justify-between mb-3">
                <span className="text-gray-400 text-sm">#{v.tradeNumber}</span>
                <span
                  className={`text-sm font-semibold ${
                    v.type === "BUY" ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {v.type}
                </span>
              </div>

              {/* Info Grid */}
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

              {/* PROFIT */}
              <div className="mt-3 flex justify-end">
                <p
                  className={`text-base font-semibold ${
                    v.profit >= 0
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
