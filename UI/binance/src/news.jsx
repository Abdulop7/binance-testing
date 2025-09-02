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
             <div className="news-container">
      <h1 className="news-head">📢 Set News Times</h1>

      <form className="news-form" onSubmit={submitNews}>
        <div className="form-group">
          <label>News Type</label>
          <select
            required
            value={newsType}
            onChange={(e) => setNewsType(e.target.value)}
          >
            <option value="">Select</option>
            <option value="FOMC">FOMC</option>
            <option value="CPI">CPI</option>
            <option value="NFP">NFP</option>
            <option value="FED_SPEAK">FED Speaks</option>
          </select>
        </div>

        <div className="form-group">
          <label>News Time</label>
          <input
            value={newsTime}
            onChange={(e) => setNewsTime(e.target.value)}
            required
            type="time"
          />
        </div>

        <div className="form-group">
          <label>Day of Week</label>
          <select
            required
            value={newsDay}
            onChange={(e) => setNewsDay(e.target.value)}
          >
            <option value="">Select</option>
            {weekdays.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="submit-btn">
          Set Time
        </button>
      </form>

      <div className="news-log">
        <h2>📝 Pending News</h2>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>News Time</th>
                <th>Stop At</th>
                <th>Resume At</th>
              </tr>
            </thead>
            <tbody>
              {newsList.map((news, idx) => (
                <tr key={idx}>
                  <td>{news.type}</td>
                  <td>{formatPKT(news.date)}</td>
                  <td>{formatPKT(news.stopTime)}</td>
                  <td>{formatPKT(news.resumeTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
        </>
    )
}
