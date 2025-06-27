import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Header from './common/header.jsx'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Logs from './logs.jsx'
import Home from './home.jsx'
import Bots from './bots.jsx'
import Backtest from './backtest.jsx'
import Terminal from './Terminal.jsx'
import { ToastContainer, toast } from 'react-toastify';
import { BotControllerProvider } from './botState.jsx'
import News from './news.jsx'


let allRoutes = createBrowserRouter([
  {
    path: "/",
    element: <Home />
  },
  {
    path: "/view",
    element: <App />
  },
  {
    path: "/logs",
    element: <Logs />
  },
  {
    path: "/bots",
    element: <Bots />
  },
  {
    path: "/backtest",
    element: <Backtest />
  },
  {
    path: "/terminal",
    element: <Terminal />
  },
  {
    path: "/news",
    element: <News />
  },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BotControllerProvider>
      <ToastContainer />
      
      <RouterProvider router={allRoutes} />
    </BotControllerProvider>
  </StrictMode>,
)
