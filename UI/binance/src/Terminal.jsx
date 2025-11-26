import React from 'react'
import Header from './common/header'
import axios from 'axios';
import { toast, ToastContainer } from 'react-toastify';
import { useDispatch, useSelector } from 'react-redux';


export default function Terminal() {
    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    const dispatch = useDispatch()
    const botStatus = useSelector(state => state)
    
    
    async function startBot(e){
        
        e.preventDefault();

        axios.post(`${backendUrl}/bot/start-bot`,
            {},
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            })
        .then(()=>{
            toast.success("Bot Started")
        })
        
        dispatch({type : 'ENABLE'})
        
    }

    function stopBot(){

        axios.post(`${backendUrl}/bot/stop-bot`,
            {},
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            })
        .then(()=>{
            toast.success("Bot Stopped")
        })
        
        dispatch({type : 'DISABLE'})
    }


    return (
<>
  <Header />
  <ToastContainer />

  <div className="w-full min-h-screen bg-[#050505] text-white py-10 px-4">

    <div className="max-w-4xl mx-auto">

      {/* Page Title */}
      <h1 className="text-4xl font-bold text-green-500 mb-10 tracking-widest uppercase">
        Terminal
      </h1>

      {/* Terminal Card */}
      <div className="bg-black/60 border border-green-700 shadow-[0_0_20px_rgba(0,255,0,0.15)] rounded-2xl p-8 backdrop-blur-xl">

        {/* Pair Selector */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-green-400 tracking-wider">
            BTCUSDT
          </h2>

          <span
            className={`px-4 py-1 rounded-full text-sm font-semibold border
            ${
              botStatus
                ? "border-green-500 text-green-400 bg-green-600/10"
                : "border-red-500 text-red-400 bg-red-600/10"
            }`}
          >
            {botStatus ? "Active" : "Inactive"}
          </span>
        </div>

        <form id="term-form" onSubmit={startBot}>

          {/* Input + Buttons */}
          <div className="flex flex-col md:flex-row gap-4">

            <input
              type="number"
              required
              placeholder="Position Size"
              name="qty"
              className="w-full rounded-xl px-5 py-3 bg-black/60 border border-green-800 
                         focus:border-green-400 outline-none text-green-300 placeholder-green-700
                         shadow-inner"
            />

            <button
              type="submit"
              className="w-full md:w-40 py-3 rounded-xl bg-green-600 text-black font-bold
                         text-lg hover:bg-green-500 shadow-[0_0_10px_rgba(0,255,0,0.5)]
                         transition-all tracking-wide"
            >
              Start
            </button>

            <button
              type="button"
              onClick={stopBot}
              className="w-full md:w-40 py-3 rounded-xl bg-red-600 text-white font-bold
                         text-lg hover:bg-red-500 shadow-[0_0_10px_rgba(255,0,0,0.5)]
                         transition-all tracking-wide"
            >
              Stop
            </button>

          </div>

        </form>

      </div>


    </div>

  </div>
</>

    )
}
