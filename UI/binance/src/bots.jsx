import React, { useEffect, useState } from 'react'
import Header from './common/header'
import axios from "axios";

export default function Bots() {

  let [signal,setSignal] = useState("")

  async function getSignal(){

    let res = await axios.get("https://binance-backend-try.onrender.com/bot/ema",
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            }); // WebURl here
    let data = res.data
    let signal = res.data.msg.signal;
    setSignal(signal)
  }

  useEffect(()=>{

    getSignal();

  },[])


  return (
    <>
    <Header/>
    <div className='main'>
      <div className="bot-page">

      <div className="bot">
        <h1>4 EMA Bot</h1><br />
      <h1 className={`signal-text ${signal === "SELL" ? "sell" : "buy" } `}>{signal ? signal : "Loading..."}</h1>
      </div>



      </div>
    </div>
    </>
  )
}
