import React, { useEffect } from 'react'
import Header from './common/header'
import axios from 'axios'
import { isAfter, setHours, setMinutes, setSeconds, nextDay } from "date-fns";
import { useState } from 'react';
import { toast } from 'react-toastify';

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function News() {

    const [newsType, setNewsType] = useState("");
    const [newsDay, setNewsDay] = useState("");
    const [newsTime, setNewsTime] = useState(""); // Time in HH:mm
    const [newsList, setNewsList] = useState([]);

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

        // Get current NY time
        const nowNY = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));

        let nyDate = new Date(nowNY); // Clone for manipulation
        nyDate.setSeconds(0);
        nyDate.setMilliseconds(0);

        if (nowNY.getDay() === targetDay) {
            nyDate.setHours(hour);
            nyDate.setMinutes(minute);

            if (nyDate <= nowNY) {
                // If selected time already passed today, go to next week
                nyDate = new Date(nowNY);
                nyDate.setDate(nyDate.getDate() + 7);
                nyDate.setDate(nyDate.getDate() + ((targetDay + 7 - nyDate.getDay()) % 7));
                nyDate.setHours(hour);
                nyDate.setMinutes(minute);
            }
        } else {
            // Move to next occurrence of that day
            const daysAhead = (targetDay + 7 - nowNY.getDay()) % 7 || 7;
            nyDate.setDate(nyDate.getDate() + daysAhead);
            nyDate.setHours(hour);
            nyDate.setMinutes(minute);
        }

        // Now nyDate is in NY local time; convert to PKT
        const utc = new Date(nyDate.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const pkt = new Date(utc.toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
        const pktTimeISO = pkt.toISOString();

        console.log({ type: newsType, pktTimeISO });

        await axios.post('https://binance-backend-6n65.onrender.com/bot/add-news', {
            type: newsType,
            date: pktTimeISO
        });

        toast.success("News Stored");
        setNewsTime("");
        setNewsType("");
        setNewsDay("");
    }



    useEffect(() => {

    }, [])


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
                                    <h1>Date</h1>
                                </th>
                                <th>
                                    <h1>Stop At</h1>
                                </th>
                                <th>
                                    <h1>Resume At</h1>
                                </th>
                            </tr>
                        </thead>
                    </table>
                </div>
            </div>
        </>
    )
}
