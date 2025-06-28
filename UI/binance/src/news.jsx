import React from 'react'
import Header from './common/header'
import axios from 'axios'

import { nextDay, setHours, setMinutes, setSeconds } from "date-fns";
import { useState } from 'react';

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function News() {

    const [newsType, setNewsType] = useState("");
    const [newsDay, setNewsDay] = useState("");
    const [newsTime, setNewsTime] = useState(""); // Time in HH:mm

    async function submitNews(evt) {
        evt.preventDefault();

        if (!newsTime || !newsDay || !newsType) {
            alert("Please complete all fields.");
            return;
        }

        // Convert day string to number (0 = Sunday, 1 = Monday, ...)
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

        // Parse hours and minutes from input time (NY Time)
        const [hour, minute] = newsTime.split(':').map(Number);

        // Step 1: Find the next target day
        const today = new Date();
        let nyDate = nextDay(today, targetDay);
        nyDate = setHours(nyDate, hour);
        nyDate = setMinutes(nyDate, minute);
        nyDate = setSeconds(nyDate, 0);

        // Step 2: Convert NY time (UTC-4) to PKT (UTC+5)
        const nyTimeMs = nyDate.getTime();
        const offsetMs = 9 * 60 * 60 * 1000; // 9 hours difference between NY and PKT
        const pktDate = new Date(nyTimeMs + offsetMs);
        const pktTimeISO = pktDate.toISOString();

        console.log({
            type: newsType,
            pktTimeISO
        });

        // await axios.post('https://binance-backend-6n65.onrender.com/bot/set-news', {
        //     type: newsType,
        //     newsTime: pktTimeISO
        // });

        setNewsTime("");
        setNewsType("");
        setNewsDay("");
    }


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
            </div>
        </>
    )
}
