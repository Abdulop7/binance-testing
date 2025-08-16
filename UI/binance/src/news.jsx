import React, { useEffect } from 'react'
import Header from './common/header'
import axios from 'axios'
import { useState } from 'react';
import { toast } from 'react-toastify';

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function News() {

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

        await axios.post('https://binance-backend-6n65.onrender.com/bot/add-news', {
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
                const res = await axios.get('https://binance-backend-6n65.onrender.com/bot/show-news',
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
            <div className='main'>
                <h1 className='news-head'>Set News Times</h1>
                <form className="news" action="" onSubmit={submitNews}>
                    <div className="news-box">
                        <h1>Set News Type :</h1>
                        <select required value={newsType} onChange={e => setNewsType(e.target.value)} name="news" id="">
                            <option value="">Select</option>
                            <option value="FOMC">FOMC</option>
                            <option value="CPI">CPI</option>
                            <option value="NFP">NFP</option>
                            <option value="FED_SPEAK">FED Speaks</option>
                        </select>
                    </div>
                    <div className="news-box">
                        <h1>Set news Time :</h1>
                        <input value={newsTime} onChange={e => setNewsTime(e.target.value)} required type="time" />
                    </div>
                    <div className="news-box">
                        <h1>Select Day of Week:</h1>
                        <select required value={newsDay} onChange={e => setNewsDay(e.target.value)}>
                            <option value="">Select</option>
                            {weekdays.map(day => (
                                <option key={day} value={day}>{day}</option>
                            ))}
                        </select>
                    </div>
                    <div className="news-box">
                        <button style={{ cursor: "pointer" }}>Set Time</button>
                    </div>

                </form>
                <div className="news-log">
                    <h1>Pending News</h1>
                    <table>
                        <thead>
                            <tr>
                                <th>
                                    <h1>Type</h1>
                                </th>
                                <th>
                                    <h1>News Time</h1>
                                </th>
                                <th>
                                    <h1>Stop At</h1>
                                </th>
                                <th>
                                    <h1>Resume At</h1>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {newsList.map((news, idx) => (
                                <tr key={idx}>
                                    <td><h2>{news.type}</h2></td>
                                    <td><h2>{formatPKT(news.date)}</h2></td>
                                    <td><h2>{formatPKT(news.stopTime)}</h2></td>
                                    <td><h2>{formatPKT(news.resumeTime)}</h2></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    )
}
