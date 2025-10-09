import { useState } from 'react'
import './App.css'
import axios from "axios";
import { useEffect } from 'react';
import './index.css'
import Header from './common/header';



function App() {


  useEffect(() => {
    getPrice();

  }, [])


  let [currPrice, setCurrPrice] = useState()

  function getPrice() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;


    axios
      .get(`${backendUrl}/bot/view`,
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            }) // WebUrl here 
      .then(res => {
        setCurrPrice(res.data.Fprice);
      })
      .catch(err => console.error(err));
  }


  return (
    <>
      <Header />
      <div className="main">
        <div className="view-price">
          <h1>SOLUSDT</h1>
          <h2>{currPrice ? currPrice : "Loading..."}$</h2>
        </div>
      </div>
    </>
  )
}

export default App
