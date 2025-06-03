import { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";

const BotControllerContext = createContext();

export function BotControllerProvider({ children }) {
  const [active, setActive] = useState(false);
  const [signalD, setSignalD] = useState("");


  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await axios.get("http://localhost:100/bot/status");
        setActive(res.data.isActive);
        setSignalD(res.data.lastSignal);
        
      } catch (error) {
        toast.error("Failed to fetch bot status");
      }
    }

    
    fetchStatus();
  }, []);

  async function startBot(e) {
    e.preventDefault();
    setActive(true);
    // const qty = e.target.qty.value;

    await axios.post("http://localhost:100/bot/start-bot")
    .then(()=> toast.success("Bot Started"))

  }

  async function stopBot() {

      const res = await axios.post("http://localhost:100/bot/stop-bot");
      toast.success(res.data.message);
      setActive(false);
      setSignalD("");


  }

  return (
    <BotControllerContext.Provider value={{ active, signalD, startBot, stopBot }}>
      {children}
    </BotControllerContext.Provider>
  );
}

export const useBotController = () => useContext(BotControllerContext);
