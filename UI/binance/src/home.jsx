import React, { useEffect, useState } from 'react'
import Header from './common/header'
import axios from 'axios'

export default function Home() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  let [inTrade, setInTrade] = useState(false)
  let [type, setType] = useState('')
  let [balance, setBlance] = useState('')
  let [entryPrice, setEntryPrice] = useState('')
  let [positionSize, setPositionSize] = useState("")
  let [positionSizeUsd, setPositionSizeUsd] = useState("")
  let [leverage, setLeverage] = useState("")

  async function fetchStatus() {
    try {

      let res = await axios.get(`${backendUrl}/bot/get-trade`,
        {
          headers: {
            Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
          }
        })
      let fres = res.data

      if (res) {
        setInTrade(true)
        setEntryPrice(fres.entryPrice)
        setType(fres.type)
        setPositionSize(fres.positionSize)
        setPositionSizeUsd(fres.positionSizeUSD)
        setLeverage(fres.leverage)
      }
    }
    catch (err) {
      console.log(err);

    }


  }

  useEffect(() => {
    fetchStatus()
  }, [])

  async function getBalance() {

    const balanceRes = await axios.get(`${backendUrl}/bot/get-balance`,
      {
        headers: {
          Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
        }
      }); // ✅ correct endpoint
    const usdtBalance = balanceRes.data.Balance.find(asset => asset.asset === "USDT")?.availableBalance;

    setBlance(parseFloat(usdtBalance).toFixed(2));

  }

  async function subscribeToPush() {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      const reg = await navigator.serviceWorker.register("../public/sw.js");

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: "BFjH-9XOnxRxzLw1pNFiUJY9Qd805_LlycZ7yIQdlOZOAflX6Tsd68Jt-4mJPaaoDlGSu0WC62Dco5PtQIJ3RAE" // from .env
      });


      await axios.post(`${backendUrl}/bot/subscribe`, subscription,
        {
          headers: {
            Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
          }
        })


      alert("✅ Notifications enabled!");
    } else {
      alert("Push notifications not supported on this browser.");
    }
  }


  return (
    <>
      <Header />
      <div className='main'>
        <div className="home-div">
          <button onClick={subscribeToPush}>Enable Notification</button>
          <button onClick={getBalance}>Get Balance</button>
          <div className="balance-card">
            <div className="balance-stat">
              <h1>Current Balance : </h1>
            </div>
            <div className="balance-stat">
              <h1> {balance}$</h1>
            </div>
          </div>
          <h1>Bot Status</h1>
          <div className="home-status">
            {
              inTrade
                ?
                <>
                  <div className="home-secs">
                    <h1>In Trade :</h1>
                    <h1 className={`inTrade ${inTrade ? 'active' : ''}`} >{inTrade ? "True" : "False"}</h1>
                  </div>
                  <div className="home-secs">
                    <h1>Type :</h1>
                    <h1 className={`type ${type == 'BUY' ? 'active' : ''}`} >{type == 'BUY' ? 'BUY' : 'SELL'}</h1>
                  </div>
                  <div className="home-secs">
                    <h1>Entry Price :</h1>
                    <h1  >{inTrade ? entryPrice : 'No Trade Found'}</h1>
                  </div>
                  <div className="home-secs">
                    <h1>Position Size :</h1>
                    <h1  >{inTrade ? positionSize : 'No Trade Found'}</h1>
                  </div>
                  <div className="home-secs">
                    <h1>Position Size (USD) :</h1>
                    <h1  >{inTrade ? positionSizeUsd : 'No Trade Found'}</h1>
                  </div>
                  <div className="home-secs">
                    <h1>Leverage :</h1>
                    <h1  >{inTrade ? leverage : 'No Trade Found'}</h1>
                  </div>
                </>
                :

                <h1>No Active Trade</h1>


            }
          </div>
        </div>
      </div>
    </>
  )
}
