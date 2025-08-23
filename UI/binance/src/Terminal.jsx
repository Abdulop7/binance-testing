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
                            <h1 className={`status-text ${botStatus ? "active" : ""} `}>{botStatus ? "Active" : "Inactive"}</h1>
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
