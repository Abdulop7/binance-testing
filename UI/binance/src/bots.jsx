import React, { useEffect, useState } from 'react'
import Header from './common/header'
import axios from "axios";

export default function Bots() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  let [signal,setSignal] = useState("")

  async function getSignal(){

    let res = await axios.get(`${backendUrl}/bot/ema`,
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            }); // WebURl here
    let signal = res.data.msg.signal;
    setSignal(signal)
  }

  useEffect(()=>{

    getSignal();

  },[])


  return (
<>
  <Header />

  <div className="w-full min-h-screen bg-[#0a0a0a] text-white flex justify-center px-4 py-10">
    <div className="w-full max-w-xl">

      {/* Page Title */}
      <h1 className="text-3xl font-bold tracking-wide mb-8 text-center">
        Real-Time Bot Signal
      </h1>

      {/* BOT CARD */}
      <div className="bg-[#111] border border-gray-800 rounded-2xl p-8 shadow-xl backdrop-blur-md">

        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-wide text-gray-300">
            4-EMA Trading Bot
          </h2>

          {/* Small Live Dot */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Live</span>
            <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]"></span>
          </div>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-gray-800 my-6"></div>

        {/* SIGNAL DISPLAY */}
        <div className="w-full text-center">
          <p className="text-2xl font-medium text-gray-400">Current Signal</p>

          <h1
            className={`mt-4 text-6xl font-extrabold tracking-wider 
              ${signal === "SELL"
                ? "text-red-500 drop-shadow-[0_0_12px_#ef4444]"
                : "text-green-400 drop-shadow-[0_0_12px_#4ade80]"
              }`}
          >
            {signal ? signal : "Loading..."}
          </h1>
        </div>



      </div>
    </div>
  </div>
</>

  )
}
