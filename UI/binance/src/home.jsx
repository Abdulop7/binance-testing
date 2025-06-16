import React, { useEffect, useState } from 'react'
import Header from './common/header'
import axios from 'axios'

export default function Home() {

  let [inTrade,setInTrade] = useState(false)
  let [type,setType] = useState('')
  let [entryPrice,setEntryPrice] = useState('')
  let [positionSize,setPositionSize] = useState("")
  let [positionSizeUsd,setPositionSizeUsd] = useState("")
  let [leverage,setLeverage] = useState("")
  
  async function fetchStatus(){

    let res = await axios.get("https://binance-backend-6n65.onrender.com/bot/get-trade")
    let fres = res.data
    

    if(res){
      setInTrade(true)
      setEntryPrice(fres.entryPrice)
      setType(fres.type)
      setPositionSize(fres.positionSize)
      setPositionSizeUsd(fres.positionSizeUSD)
      setLeverage(fres.leverage)
    }

  }

useEffect(()=>{
  fetchStatus()
},[])

  return (
    <>
    <Header/>
    <div className='main'>
      <div className="home-div">
        <h1>Bot Status</h1>
        <div className="home-status">
          <div className="home-secs">
            <h1>In Trade :</h1>
            <h1 className={`inTrade ${ inTrade ? 'active' : ''}`} >{ inTrade ? "True" : "False"}</h1>
          </div>
          <div className="home-secs">
            <h1>Type :</h1>
            <h1 className={`type ${ type == 'BUY' ? 'active' : ''}`} >{ type == 'BUY' ? 'BUY' : 'SELL'}</h1>
          </div>
          <div className="home-secs">
            <h1>Entry Price :</h1>
            <h1  >{ inTrade  ? entryPrice : 'No Trade Found'}</h1>
          </div>
          <div className="home-secs">
            <h1>Position Size :</h1>
            <h1  >{ inTrade  ? positionSize : 'No Trade Found'}</h1>
          </div>
          <div className="home-secs">
            <h1>Position Size (USD) :</h1>
            <h1  >{ inTrade  ? positionSizeUsd : 'No Trade Found'}</h1>
          </div>
          <div className="home-secs">
            <h1>Leverage :</h1>
            <h1  >{ inTrade  ? leverage : 'No Trade Found'}</h1>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
