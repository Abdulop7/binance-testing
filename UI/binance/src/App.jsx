import { useState } from 'react'
import './App.css'
import axios from "axios";
import { useEffect } from 'react';
import './index.css'
import Header from './common/header';



function App() {
  useEffect(()=>{

  getPrice();

  const intervalId = setInterval(getPrice, 1000); // Fetch every second

  return () => clearInterval(intervalId);
},[])


  let [currPrice,setCurrPrice] =useState()

  function getPrice(){

  axios
    .get("http://localhost:100/bot/view")
    .then(res => {
      setCurrPrice(res.data);
    })
    .catch(err => console.error(err));
}
  

  return (
    <>
    <Header/>
    <div className="main">
      <div className="view-price">
        <h1>BTCUSDT</h1>
        <h2>{ currPrice ? currPrice : "Loading..."}$</h2>
      </div>
    </div>
    </>
  )
}

export default App
