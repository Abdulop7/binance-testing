import React from 'react'
import Header from './common/header'
import axios from 'axios'
import { zonedTimeToUtc } from 'date-fns-tz';
import { useState } from 'react';

export default function News() {

    const [newsType, setNewsType] = useState("");
    const [newsTime, setNewsTime] = useState(""); // Time in HH:mm

    async function submitNews(evt) {

        evt.preventDefault();

        if (!newsTime) {
            alert("Please enter a valid time.");
            return;
        }

        // Convert NY time to full UTC datetime
        const [hours, minutes] = newsTime.split(':');
        const nyDate = new Date();
        nyDate.setHours(hours);
        nyDate.setMinutes(minutes);
        nyDate.setSeconds(0);
        nyDate.setMilliseconds(0);

        // Convert to UTC from America/New_York
        const utcDate = zonedTimeToUtc(nyDate, 'America/New_York');

        // ⏰ Format for DB storage (ISO)
        const newsTimeUTC = utcDate.toISOString();


        await axios.post('https://binance-backend-6n65.onrender.com/bot/set-news', {
            type: newsType,
            newsTimeUTC,
        });

        setNewsTime("");
        setNewsType("");

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
                        <button style={{ cursor: "pointer" }}>Set Time</button>
                    </div>

                </form>
            </div>
        </>
    )
}
