import React, { useState } from 'react'
import Header from './common/header'
import axios from "axios";
import { useEffect } from 'react';
import loaderImg from './assets/loader.gif'

export default function Backtest() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  let [wr, setWR] = useState("N/A")
  let [profit, setProfit] = useState("N/A")
  let [trades, setTrades] = useState("N/A")
  let [log, setLog] = useState([])
  let [initialBalance, setInitialBalance] = useState("N/A")
  let [fcapital, setFcapital] = useState("N/A")
  let [drawdown, setDrawdown] = useState("N/A")
  let [loader, setLoader] = useState(false)

  let [input, setInput] = useState({
    tf: "3",
    interval: "",
    capital: "",
    position: "",
    symbol: "",
    ema: null
  })

  function changeVal(evt) {

    let oldData = { ...input }

    let inpName = evt.target.name;
    let inpValue = evt.target.value

    oldData[inpName] = inpValue

    setInput(oldData)

  }

  async function getResult(evt) {

    setLoader(true)
    evt.preventDefault();
    
    let res = await axios.get(`${backendUrl}/bot/more-fetch?qty=${input.interval}&symbol=${input.symbol}&tf=${input.tf}`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      }) // WebUrl Here 
    let result = res.data
    console.log(result);
    

    // setWR(result.winRate)
    // setProfit(result.totalProfit)
    // setTrades(result.totalTrades)
    // setLog(result.trades)
    // setInitialBalance(input.capital + " USD")
    // setFcapital(result.finalCapital)
    // setDrawdown(result.maxDrawdownDollar)
    setLoader(false)
  }




  return (
   <>
  <Header />

  <div className="w-full min-h-screen bg-[#0a0a0a] text-white px-4 py-10 flex flex-col gap-10">

    {/* TOP SECTION: Inputs + Results */}
    <div className="flex flex-col lg:flex-row gap-8 max-w-6xl mx-auto">

      {/* Input Form */}
      <div className="flex-1 bg-[#111] border border-green-600 rounded-2xl p-6 shadow-lg">
        <h1 className="text-2xl font-semibold mb-6">Backtesting Module</h1>
        <form className="flex flex-col gap-4" onSubmit={getResult}>

          <select
            name="ema"
            required
            onChange={changeVal}
            className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">Choose Strategy</option>
            <option value="5,13,34,89">Fast EMA (5,13,34,89)</option>
          </select>

          <select
            name="symbol"
            required
            onChange={changeVal}
            className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            <option value="">Select Symbol</option>
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

          <input
            type="number"
            name="tf"
            min={1}
            max={60}
            placeholder="Timeframe (M)"
            required
            value={input.tf}
            onChange={changeVal}
            className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          />

          <input
            type="number"
            name="capital"
            min={1}
            required
            max={99999999}
            placeholder="Capital ($)"
            value={input.capital}
            onChange={changeVal}
            className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          />

          <input
            type="number"
            name="position"
            min={1}
            required
            max={99999999}
            placeholder="Position Size ($)"
            value={input.position}
            onChange={changeVal}
            className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          />

          <input
            type="number"
            name="interval"
            min={1}
            required
            max={99999999}
            placeholder="Candles Amount"
            value={input.interval}
            onChange={changeVal}
            className="bg-[#0a0a0a] border border-green-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
          />

          <button
            type="submit"
            className="bg-green-600 hover:bg-green-500 transition-colors rounded-lg py-2 font-semibold mt-2"
          >
            Start
          </button>
        </form>
      </div>

      {/* Results */}
      <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          ["Starting Balance", initialBalance],
          ["Total Trades", trades],
          ["Win Rate", wr],
          ["Profit", profit],
          ["Max Drawdown", drawdown],
          ["Final Capital", fcapital],
        ].map(([title, value], idx) => (
          <div
            key={idx}
            className="bg-[#111] border border-green-600 rounded-2xl p-4 flex flex-col items-center shadow-lg"
          >
            <h2 className="text-gray-400 text-sm">{title}</h2>
            <p className="text-lg font-semibold mt-1">{value}</p>
          </div>
        ))}
      </div>

    </div>

    {/* BOTTOM SECTION: Backtest Trades */}
    <div className="max-w-6xl mx-auto bg-[#111] border border-green-600 rounded-2xl p-6 shadow-lg overflow-x-auto">
      <h1 className="text-2xl font-semibold mb-4">Backtest Trades</h1>
      <table className="w-full text-sm md:text-base border-collapse">
        <thead>
          <tr className="border-b border-green-600">
            <th className="px-4 py-2 text-left text-gray-400">ID</th>
            <th className="px-4 py-2 text-left text-gray-400">Entry Time</th>
            <th className="px-4 py-2 text-left text-gray-400">Signal</th>
            <th className="px-4 py-2 text-left text-gray-400">Entry Price</th>
            <th className="px-4 py-2 text-left text-gray-400">Exit Price</th>
            <th className="px-4 py-2 text-left text-gray-400">Result</th>
          </tr>
        </thead>
        <tbody>
          {log.length > 0 ? (
            log.map((v, i) => (
              <tr
                key={i}
                className="border-b border-gray-800 hover:bg-[#1a1a1a] transition-colors"
              >
                <td className="px-4 py-2">{i + 1}</td>
                <td className="px-4 py-2">{v.entryTime || "N/A"}</td>
                <td
                  className={`px-4 py-2 font-semibold ${
                    v.type === "BUY"
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {v.type}
                </td>
                <td className="px-4 py-2">{v.entryPrice}</td>
                <td className="px-4 py-2">{v.exitPrice}</td>
                <td
                  className={`px-4 py-2 font-semibold ${
                    v.result >= 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {v.result}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="text-center py-10 text-gray-500">
                No Data
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
</>

  )
}





