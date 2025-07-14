import axios from 'axios';
import Header from './common/header'
import React, { useEffect, useState } from 'react';

export default function Logs() {

  let [trades, setTrades] = useState([])
  let [tProfit, setTprofit] = useState("")

  useEffect(() => {

    async function fetchTrades() {

      let res = await axios.get("https://binance-backend-try.onrender.com/bot/all-trades",
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            }) // WebUrl Here
      let restrades = res.data

      // Sort trades by `tradeNumber` descending (latest first)
      restrades.sort((a, b) => a.tradeNumber - b.tradeNumber);

      setTrades(restrades)

      // Calculate total profit
      const total = restrades.reduce((sum, trade) => sum + (trade.profit || 0), 0);
      setTprofit(total.toFixed(2));

    }
    fetchTrades();
  }, [])


  return (
    <>
      <Header />
      <div className='main'>
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
                  <th>LEVERAGE</th>
                  <th>PROFIT</th>
                </tr>
              </thead>
              <tbody>
                {
                  trades.length > 0
                    ?
                    trades.map((v, i) => {

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
                          <td>{v.leverage}</td>
                          <td className={v.profit >= 0 ? "positive" : "negative"}>{v.profit}$</td>
                        </tr>

                      )

                    })
                    :
                    <tr>
                      <td colSpan={8}>
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
