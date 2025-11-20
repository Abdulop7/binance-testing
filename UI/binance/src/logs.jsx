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
      const atrFilter = (t) => t.atr >= 0.65 && t.atr <= 1.1
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
              if (filtered.length >= 10 && wr >= 70) {
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



      // Calculate total profit
      const total = (testing ? eliteWeekend : restrades).reduce((sum, trade) => sum + (trade.profit || 0), 0);
      setTprofit(total.toFixed(2));

    }
    fetchTrades();
  }, [])


  return (
    <>
      <Header />
      <div className='main bg-white'>
        <div className="logs">
          <div className="log-head">

            <h1>All Trades</h1>

            <h2 style={{ color: tProfit >= 0 ? '#81c784' : '#e57373' }}>
              Total Profit: {tProfit}$
            </h2>

          </div>
          <div className="log-data">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>TIME</th>
                  <th>TYPE</th>
                  <th>ENTRY PRICE</th>
                  <th>POSITION SIZE (USD)</th>
                  <th>POSITION SIZE</th>
                  <th>SLOPE</th>
                  <th>LEVERAGE</th>
                  <th>PROFIT</th>
                </tr>
              </thead>
              <tbody>
                {
                  trades.length > 0
                    ?
                    trades.map((v) => {

                      return (

                        <tr key={v.tradeNumber}>
                          <td>{v.tradeNumber}</td>
                          <td>
                            {new Date(v.time).toLocaleString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true,
                              timeZone: 'Asia/Karachi'
                            })}
                          </td>
                          <td className={v.type}>{v.type}</td>
                          <td>{v.entryPrice}</td>
                          <td>{v.positionSizeUSD}</td>
                          <td>{v.positionSize}</td>
                          <td>{v.slope}</td>
                          <td>{v.leverage}</td>
                          <td className={v.profit >= 0 ? "positive" : "negative"}>{v.profit}$</td>
                        </tr>

                      )

                    })
                    :
                    <tr>
                      <td colSpan={9}>
                        No Data
                      </td>
                    </tr>
                }
              </tbody>
            </table>

          </div>
        </div>
      </div>
    </>
  )
}
