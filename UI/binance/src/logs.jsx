import axios from 'axios';
import Header from './common/header'
import React, { useEffect, useState } from 'react';

export default function Logs() {

  let [trades, setTrades] = useState([])


  useEffect(() => {
    console.log("Page Opened");

    async function fetchTrades() {

      let res = await axios.get("http://localhost:10000/bot/all-trades")
      let restrades = res.data
      setTrades(restrades)
      console.log(restrades);


    }
    fetchTrades();
  }, [])


  return (
    <>
      <Header />
      <div className='main'>
        <div className="logs">
          <h1>All Trades</h1>
          <div className="log-data">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
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

                        <tr>
                          <td>{v.tradeNumber}</td>
                          <td>{v.type}</td>
                          <td>{v.entryPrice}</td>
                          <td>{v.positionSizeUSD}</td>
                          <td>{v.positionSize}</td>
                          <td>{v.leverage}</td>
                          <td>{v.profit}</td>
                        </tr>

                      )

                    })
                    :
                    <tr>
                      <td colSpan={7}>
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
