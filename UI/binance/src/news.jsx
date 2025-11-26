import React, { useEffect } from 'react'
import Header from './common/header'
import axios from 'axios'
import { useState } from 'react';
import { toast } from 'react-toastify';

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function News() {
    const backendUrl = import.meta.env.VITE_BACKEND_URL;

    const [newsType, setNewsType] = useState("");
    const [newsDay, setNewsDay] = useState("");
    const [newsTime, setNewsTime] = useState(""); // Time in HH:mm
    const [newsList, setNewsList] = useState([]);

    function formatPKT(dateStr) {
        const options = {
            timeZone: "Asia/Karachi",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true
        };
        return new Date(dateStr).toLocaleString("en-PK", options);
    }

    async function submitNews(evt) {
        evt.preventDefault();

        if (!newsTime || !newsDay || !newsType) {
            alert("Please complete all fields.");
            return;
        }

        const dayMap = {
            Sunday: 0,
            Monday: 1,
            Tuesday: 2,
            Wednesday: 3,
            Thursday: 4,
            Friday: 5,
            Saturday: 6
        };

        const targetDay = dayMap[newsDay];
        const [hour, minute] = newsTime.split(':').map(Number);
        const now = new Date();

        // Convert current time to NY time
        const nowInNY = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));

        let nyDate;

        if (nowInNY.getDay() === targetDay) {
            const enteredDate = new Date(nowInNY);
            enteredDate.setHours(hour, minute, 0, 0);

            if (enteredDate.getTime() >= nowInNY.getTime()) {
                nyDate = enteredDate; // ✅ valid time today
            } else {
                // ❌ time passed, shift to next week
                nyDate = new Date(enteredDate);
                nyDate.setDate(nyDate.getDate() + 7);
            }
        } else {
            // Shift to next occurrence of that day
            const dayDiff = (targetDay + 7 - nowInNY.getDay()) % 7;
            nyDate = new Date(nowInNY);
            nyDate.setDate(nyDate.getDate() + dayDiff);
            nyDate.setHours(hour, minute, 0, 0);
        }

        // Convert NY time to PKT
        const nyTimeMs = nyDate.getTime();
        const offsetMs = 9 * 60 * 60 * 1000; // 9 hours difference
        const pktDate = new Date(nyTimeMs + offsetMs);
        const pktTimeISO = pktDate.toISOString();

        console.log({
            type: newsType,
            pktDate
        });

        await axios.post(`${backendUrl}/bot/add-news`, {
            type: newsType,
            date: pktTimeISO
        },
            {
                headers: {
                    Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                }
            }
        );

        toast.success("News Stored");

        setNewsTime("");
        setNewsType("");
        setNewsDay("");
    }






    useEffect(() => {
        async function fetchNews() {
            try {
                const res = await axios.get(`${backendUrl}/bot/show-news`,
                    {
                        headers: {
                            Authorization: `Bearer A.saboor786` // or VITE_ACCESS_TOKEN in frontend
                        }
                    });
                setNewsList(res.data);
            } catch (err) {
                console.error("Failed to fetch news list", err);
            }
        }

        fetchNews();

    }, []);


    return (
<>
  <Header />

  <div className="w-full min-h-screen bg-[#0a0a0a] text-white px-4 py-10 flex justify-center">
    <div className="w-full max-w-5xl">

      {/* PAGE TITLE */}
      <h1 className="text-3xl font-semibold mb-8 tracking-wide flex items-center gap-2">
        <span className="text-green-400 drop-shadow-[0_0_10px_#22c55e]">●</span>
        Set News Times
      </h1>

      {/* FORM CARD */}
      <form
        onSubmit={submitNews}
        className="bg-[#0f0f0f] border border-gray-800 rounded-2xl p-6 shadow-xl backdrop-blur-md space-y-6"
      >
        {/* NEWS TYPE */}
        <div className="flex flex-col gap-2">
          <label className="text-gray-300 text-sm">News Type</label>
          <select
            required
            value={newsType}
            onChange={(e) => setNewsType(e.target.value)}
            className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
          >
            <option value="">Select</option>
            <option value="FOMC">FOMC</option>
            <option value="CPI">CPI</option>
            <option value="NFP">NFP</option>
            <option value="FED_SPEAK">FED Speaks</option>
          </select>
        </div>

        {/* TIME */}
        <div className="flex flex-col gap-2">
          <label className="text-gray-300 text-sm">News Time</label>
          <input
            required
            type="time"
            value={newsTime}
            onChange={(e) => setNewsTime(e.target.value)}
            className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
          />
        </div>

        {/* DAY */}
        <div className="flex flex-col gap-2">
          <label className="text-gray-300 text-sm">Day of Week</label>
          <select
            required
            value={newsDay}
            onChange={(e) => setNewsDay(e.target.value)}
            className="bg-black border border-gray-700 rounded-lg px-3 py-2 text-gray-200 focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
          >
            <option value="">Select</option>
            {weekdays.map((day) => (
              <option key={day} value={day}>{day}</option>
            ))}
          </select>
        </div>

        {/* BUTTON */}
        <button
          type="submit"
          className="w-full bg-green-600 hover:bg-green-500 text-black font-semibold py-3 rounded-xl shadow-[0_0_15px_#22c55e] transition"
        >
          Set Time
        </button>
      </form>

      {/* NEWS TABLE */}
      <div className="mt-12">
        <h2 className="text-2xl font-semibold mb-4 tracking-wide flex items-center gap-2">
          <span className="text-green-400 drop-shadow-[0_0_10px_#22c55e]">●</span>
          Pending News
        </h2>

        <div className="bg-[#0f0f0f] border border-gray-800 rounded-2xl shadow-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#161616] border-b border-gray-800">
              <tr>
                {["Type", "News Time", "Stop At", "Resume At"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-4 text-left font-medium text-gray-400 tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {newsList.length > 0 ? (
                newsList.map((news, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-gray-900 hover:bg-[#1a1a1a] transition"
                  >
                    <td className="px-4 py-3">{news.type}</td>
                    <td className="px-4 py-3 text-gray-300">{formatPKT(news.date)}</td>
                    <td className="px-4 py-3">{formatPKT(news.stopTime)}</td>
                    <td className="px-4 py-3">{formatPKT(news.resumeTime)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="4"
                    className="text-center py-10 text-gray-500 tracking-wide"
                  >
                    No News Scheduled
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  </div>
</>

    )
}
