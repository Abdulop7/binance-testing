import React from 'react'
import './header.css'
import { Link } from 'react-router-dom'
import { useBotController } from '../botState';
import "../index.css"

export default function Header() {
  const { active} = useBotController();
  return (
    <div className='header'>
        <h1 className={`head-status  ${active ? "active" : ""}`}>{ active ? "Active" : "Inactive"}</h1>
        <h1><Link to={"/"}>Home</Link> </h1>
        <h1><Link to={"/terminal"}>Terminal</Link> </h1>
        <h1><Link to={"/view"}>View </Link> </h1>
        <h1><Link to={"/bots"}>Bots</Link> </h1>
        <h1><Link to={"/backtest"}>Backtest</Link> </h1>
        <h1><Link to={"/logs"}>Logs</Link></h1>
        <h1><Link to={"/news"}>News</Link></h1>
    </div>
  )
}
