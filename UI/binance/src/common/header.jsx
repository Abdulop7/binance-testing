import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useState } from "react";
import { Menu, X } from "lucide-react";

export default function Header() {
  const botStatus = useSelector((state) => state);
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="w-full bg-[#000000] md:bg-black/90 backdrop-blur-md border-b border-green-600 shadow-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">

          {/* Status Badge */}
          <span
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold border 
              ${botStatus
                ? "border-green-500 bg-green-600/20 text-green-500"
                : "border-red-500 bg-red-600/20 text-red-500"
              }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${botStatus ? "bg-green-500 animate-pulse" : "bg-red-500"}`}></span>
            {botStatus ? "Active" : "Inactive"}
          </span>

          {/* Desktop Nav */}
          <nav className="hidden md:flex gap-8 text-white font-medium text-lg">
            {[["Home", "/"], ["Terminal", "/terminal"], ["View", "/view"], ["Bots", "/bots"], ["Backtest", "/backtest"], ["Logs", "/logs"], ["News", "/news"]].map(([label, path]) => (
              <Link key={path} className="relative group" to={path}>
                <span className="group-hover:text-green-400 transition">{label}</span>
                <span className="absolute bottom-0 left-0 w-0 h-[2px] bg-green-500 group-hover:w-full transition-all duration-300"></span>
              </Link>
            ))}
          </nav>

          {/* Mobile Menu Button */}
          <button className="md:hidden text-white" onClick={() => setOpen(true)}>
            <Menu size={30} />
          </button>
        </div>
      </header>

      {/* Dark Overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm"
        ></div>
      )}

      {/* Mobile Sidebar */}
      <div
        className={`md:hidden fixed top-0 right-0 h-full w-72 
          bg-[#050505] border-l border-green-600 
          shadow-[0_0_25px_rgba(0,255,0,0.3)]
          transform transition-transform duration-300 z-[9999]
          ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex justify-between items-center px-5 py-4 border-b border-green-600/40">
          <h2 className="text-green-500 text-xl font-semibold">Menu</h2>
          <button className="text-white" onClick={() => setOpen(false)}>
            <X size={28} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-6">
          {[["Home", "/"], ["Terminal", "/terminal"], ["View", "/view"], ["Bots", "/bots"], ["Backtest", "/backtest"], ["Logs", "/logs"], ["News", "/news"]].map(([label, path]) => (
            <Link
              key={path}
              onClick={() => setOpen(false)}
              className="text-white text-xl font-medium hover:text-green-400 transition"
              to={path}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

