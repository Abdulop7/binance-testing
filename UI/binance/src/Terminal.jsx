import React from 'react'
import Header from './common/header'
import { useState } from 'react';
import axios from 'axios';
import { toast, ToastContainer } from 'react-toastify';
import { useRef } from 'react';
import { useEffect } from 'react';
import { useBotController } from './botState';


export default function Terminal() {
    const { active} = useBotController();

    async function startBot(e){

        e.preventDefault();

        axios.post('https://binance-backend-try.onrender.com/bot/start-bot',
            {},
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            })
        .then(()=>{
            toast.success("Bot Started")
        })

    }

    function stopBot(){

        axios.post('https://binance-backend-try.onrender.com/bot/stop-bot',
            {},
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            })
        .then(()=>{
            toast.success("Bot Stopped")
        })

    }


    return (
        <>
            <Header />
            <ToastContainer />
            <div className='main'>
                
                <div className="term-page">
                    <h1>Terminal</h1>
                    <div className="term-opt">
                        <form id='term-form' onSubmit={startBot} action="">
                            <h1>BTCUSDT</h1>
                            <div className="opt">
                                <input type="number" required placeholder='Position Size' name='qty' />
                                <button type='submit'>Start</button>
                                <h2 className='stop' onClick={stopBot}>Stop</h2>
                            </div>
                        </form>
                    </div>
                    <div id='status-box' className="term-opt">
                        <div className="status">
                            <h1 className={`status-text ${active ? "active" : ""} `}>{active ? "Active" : "Inactive"}</h1>
                            <h1>BTCUSDT</h1>
                        </div>
                        <div className="stats">
                            <h1>Total Trades</h1>
                            <h1>{"N/A"}</h1>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}
