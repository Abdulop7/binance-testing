import React, { useState } from 'react'
import Header from './common/header'
import axios from "axios";
import { useEffect } from 'react';
import loaderImg from './assets/loader.gif'

export default function Backtest() {

  let [wr, setWR] = useState("N/A")
  let [profit, setProfit] = useState("N/A")
  let [trades, setTrades] = useState("N/A")
  let [log, setLog] = useState([])
  let [initialBalance,setInitialBalance] = useState("N/A")
  let [fcapital,setFcapital] = useState("N/A")
  let [drawdown,setDrawdown] = useState("N/A")
  let [loader,setLoader] = useState(false)

  let [input, setInput] = useState({
    tf:"3",
    interval:"",
    capital: "",
    position: "",
    symbol:"",
    ema:null
  })

  function changeVal(evt) {

    let oldData = {...input}

    let inpName = evt.target.name;
    let inpValue = evt.target.value

    oldData[inpName] = inpValue

    setInput(oldData)
    
  }

  async function getResult(evt) {
    
    setLoader(true)
    evt.preventDefault();

    let res = await axios.get(`https://binance-backend-try.onrender.com/bot/backtest?pSize=${input.position}&capital=${input.capital}&qty=${input.interval}&symbol=${input.symbol}&ema=${input.ema}&tf=${input.tf}`,
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            }) // WebUrl Here 
    let result = res.data

    setWR(result.winRate)
    setProfit(result.totalProfit)
    setTrades(result.totalTrades)
    setLog(result.trades)
    setInitialBalance(input.capital + " USD")
    setFcapital(result.finalCapital)
    setDrawdown(result.maxDrawdownDollar)
    setLoader(false)
  }


  

  return (
    <>
      <Header />
      <div className="backtest-page">
        <div className="backtest-top">

          <div className="val-input">
            <h1>Backtesting Module</h1>
            <form action="" onSubmit={getResult}>
              <div className="inp-box" id='strategy-box'>
                <select name="ema" id="" required onChange={changeVal}>
                  <option value="">Choose</option>
                  <option value="5,13,34,89">Fast EMA (5,13,34,89)</option>
                </select>
              </div>
              <div className="inp-box">
                <label htmlFor='capital'>Select Symbol : </label>
                <select  name="symbol" id="" required onChange={changeVal}>
                  <option value="">Choose</option>
                  <option value="BTCUSDT">BTC</option>
                  <option value="ETHUSDT">ETH</option>
                  <option value="XRPUSDT">XRP</option>
                  <option value="SOLUSDT">SOL</option>
                  <option value="BNBUSDT">BNB</option>
                  <option value="DOGEUSDT">DOGE</option>
                  <option value="TRXUSDT">TRX</option>
                  <option value="SUIUSDT">SUI</option>
                  <option value="LINKUSDT">LINK</option>
                  <option value="AVAXUSDT">AVAX</option>
                  <option value="LTCUSDT">LTC</option>
                </select>
              </div>
              <div className="inp-box">
                <label htmlFor='capital'>Enter the Timeframe (M) : </label>
                <input name='tf' type="number" min={1} max={60} placeholder='3' required value={input.tf} onChange={changeVal} />
              </div>
              <div className="inp-box">
                <label htmlFor='capital' >Enter Capital ($) : </label>
                <input name='capital' type="number" min={1} required max={99999999} value={input.capital} onChange={changeVal}/>
              </div>
              <div className="inp-box">
                <label htmlFor='position'>Position Size ($) : </label>
                <input name='position' type="number" min={1} required max={99999999} value={input.position} onChange={changeVal}/>
              </div>
              <div className="inp-box">
                <label htmlFor='interval'>Candles Amount  : </label>
                <input name='interval' type="number" min={1} required max={99999999} value={input.interval} onChange={changeVal}/>
              </div>
              <div className="btn-box" id='btn' >
                <button type='submit'>Start</button>
              </div>
            </form>
          </div>
          <div className="result">
              <img className={`loaderImg ${ loader ? "active" : ""}`} src={loaderImg} alt="" />
              <div className={`${ loader ? "load-box" : ""}`}>

              </div>
            <div className="res-box">
              <h1>Starting Balance</h1>
              <h2>{initialBalance}</h2>
            </div>
            <div className="res-box">
              <h1>Total Trades</h1>
              <h2>{trades}</h2>
            </div>

            <div className={`res-box`}>
              <h1>Win Rate</h1>
              <h2>{wr}</h2>
            </div>

            <div className="res-box">
              <h1>Profit</h1>
              <h2>{profit}</h2>
            </div>

            <div className="res-box">
              <h1>Max Drawdown</h1>
              <h2>{drawdown}</h2>
            </div>

            <div className="res-box">
              <h1>Final Capital</h1>
              <h2>{fcapital}</h2>
            </div>

          </div>
        </div>
        <div className="backtest-bottom">

          <div className="backtest-log">

            <h1>Backtest Trades</h1>

            <table>

              <thead>
                <tr>

                  <th>ID</th>
                  <th>Entry Time</th>
                  <th>Signal</th>
                  <th>Entry Price</th>
                  <th>Exit Price</th>
                  <th>Result</th>
                </tr>
              </thead>

              <tbody>
                {
                  log != 0
                    ?
                    log.map((v, i) => {
                      return (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>1-10-2016</td>
                          <td>{v.type}</td>
                          <td>{v.entryPrice}</td>
                          <td>{v.exitPrice}</td>
                          <td>{v.result}</td>
                        </tr>

                      )
                    })
                    :
                    <tr>
                      <td colSpan={6}>
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





