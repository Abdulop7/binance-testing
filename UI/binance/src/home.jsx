import React, { useEffect, useState } from "react";
import Header from "./common/header";
import axios from "axios";

export default function Home() {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  let [inTrade, setInTrade] = useState(false);
  let [type, setType] = useState("");
  let [entryPrice, setEntryPrice] = useState("");
  let [positionSize, setPositionSize] = useState("");
  let [positionSizeUsd, setPositionSizeUsd] = useState("");
  let [leverage, setLeverage] = useState("");

  async function fetchStatus() {
    try {
      let res = await axios.get(`${backendUrl}/bot/get-trade`, {
        headers: {
          Authorization: `Bearer A.saboor786`,
        },
      });

      console.log(res.data);

      let fres = res.data;

      if (res) {
        setInTrade(true);
        setEntryPrice(fres.entryPrice);
        setType(fres.type);
        setPositionSize(fres.positionSize);
        setPositionSizeUsd(fres.positionSizeUSD);
        setLeverage(fres.leverage);
      }
    } catch (err) {
      console.log(err);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <>
      <Header />

      {/* Main Container */}
      <div className="min-h-screen bg-black text-white px-4 py-10 flex justify-center">
        <div className="w-full max-w-4xl">

          {/* Page Title */}
          <h1 className="text-3xl font-bold mb-6 text-green-400 tracking-wide">
            Bot Status Overview
          </h1>

          {/* Status Card */}
          <div className="bg-black/60 border border-green-600 p-6 rounded-2xl shadow-[0_0_20px_rgba(0,255,0,0.15)] backdrop-blur-lg">

            {/* If No Trade */}
            {!inTrade ? (
              <div className="text-center py-16 text-gray-300 text-xl">
                No Active Trade
              </div>
            ) : (
              <>
                {/* Trade Status */}
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold">Trade Status</h2>
                  <span
                    className={`px-4 py-1.5 text-sm rounded-full font-semibold ${
                      type === "BUY"
                        ? "bg-green-600/20 text-green-400 border border-green-500"
                        : "bg-red-600/20 text-red-400 border border-red-500"
                    }`}
                  >
                    {type === "BUY" ? "LONG / BUY" : "SHORT / SELL"}
                  </span>
                </div>

                <div className="grid sm:grid-cols-2 gap-4 mt-6">

                  {/* In Trade */}
                  <div className="p-4 bg-black/40 border border-green-700 rounded-xl">
                    <p className="text-gray-400 text-sm">In Trade</p>
                    <p className="text-xl font-semibold text-green-400">
                      {inTrade ? "True" : "False"}
                    </p>
                  </div>

                  {/* Entry Price */}
                  <div className="p-4 bg-black/40 border border-green-700 rounded-xl">
                    <p className="text-gray-400 text-sm">Entry Price</p>
                    <p className="text-xl font-semibold">{entryPrice}</p>
                  </div>

                  {/* Position Size */}
                  <div className="p-4 bg-black/40 border border-green-700 rounded-xl">
                    <p className="text-gray-400 text-sm">Position Size</p>
                    <p className="text-xl font-semibold">{positionSize}</p>
                  </div>

                  {/* Position Size USD */}
                  <div className="p-4 bg-black/40 border border-green-700 rounded-xl">
                    <p className="text-gray-400 text-sm">Position Size (USD)</p>
                    <p className="text-xl font-semibold">{positionSizeUsd}</p>
                  </div>

                  {/* Leverage */}
                  <div className="p-4 bg-black/40 border border-green-700 rounded-xl sm:col-span-2">
                    <p className="text-gray-400 text-sm">Leverage</p>
                    <p className="text-xl font-semibold">{leverage}x</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
