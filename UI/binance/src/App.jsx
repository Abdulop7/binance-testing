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

  <div className="w-full min-h-[95vh] bg-[#050505] text-white flex items-center justify-center px-4 py-16">

    {/* Price Card */}
    <div className="
      bg-black/60 
      backdrop-blur-xl 
      border border-green-700 
      rounded-3xl 
      shadow-[0_0_25px_rgba(0,255,0,0.15)] 
      px-10 py-12 
      text-center 
      w-full 
      max-w-md
    ">

      {/* Pair Name */}
      <h1 className="text-4xl font-bold text-green-500 tracking-widest mb-6">
        SOLUSDT
      </h1>

      {/* Live Price */}
      <h2
        className="
          text-5xl 
          font-extrabold 
          text-green-300 
          tracking-wide 
          drop-shadow-[0_0_8px_rgba(0,255,0,0.6)]
          animate-pulse
        "
      >
        {currPrice ? `${currPrice}$` : "Loading..."}
      </h2>

      {/* Sub Label */}
      <p className="text-green-800 text-sm mt-5 tracking-wide">
        Live Market Price
      </p>
    </div>
  </div>
</>

  )
}

export default App
