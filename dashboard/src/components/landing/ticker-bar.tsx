"use client";

import { useEffect, useState, useCallback } from "react";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

interface TickerData {
  solPrice: string;
  volume24h: string;
  openInterest: string;
  erBlockHeight: string;
  priceChange: number | null;
}

export function TickerBar() {
  const [data, setData] = useState<TickerData>({
    solPrice: "—",
    volume24h: "—",
    openInterest: "—",
    erBlockHeight: "—",
    priceChange: null,
  });
  const [connected, setConnected] = useState(false);

  const fetchPythPrice = useCallback(async () => {
    const wsUrl = process.env.NEXT_PUBLIC_PYTH_LAZER_WS;

    if (wsUrl) {
      // Real Pyth Lazer WebSocket connection
      try {
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => setConnected(true);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg?.price) {
              setData((prev) => ({
                ...prev,
                solPrice: `$${parseFloat(msg.price).toFixed(2)}`,
                priceChange: msg.priceChange ?? null,
              }));
            }
          } catch {
            // parse error — keep current state
          }
        };
        ws.onerror = () => setConnected(false);
        ws.onclose = () => setConnected(false);
        return () => ws.close();
      } catch {
        setConnected(false);
      }
    }

    // No Pyth Lazer token — try Pyth REST Hermes for devnet SOL/USD
    try {
      const SOL_USD_FEED = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
      const res = await fetch(
        `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${SOL_USD_FEED}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const json = await res.json();
        const entry = json?.parsed?.[0]?.price;
        if (entry) {
          const price = parseFloat(entry.price) * Math.pow(10, entry.expo);
          setData((prev) => ({
            ...prev,
            solPrice: `$${price.toFixed(2)}`,
            priceChange: null,
          }));
          setConnected(true);
        }
      }
    } catch {
      // No network — show dash
    }
  }, []);

  useEffect(() => {
    fetchPythPrice();
    const interval = setInterval(fetchPythPrice, 10000);
    return () => clearInterval(interval);
  }, [fetchPythPrice]);

  const fields = [
    {
      label: "SOL/USDC MARK",
      value: data.solPrice,
      icon: data.priceChange !== null
        ? data.priceChange >= 0
          ? <TrendingUp className="w-3 h-3 text-emerald-400" />
          : <TrendingDown className="w-3 h-3 text-red-400" />
        : <Activity className="w-3 h-3 text-zinc-500" />,
      valueClass: data.priceChange !== null
        ? data.priceChange >= 0 ? "text-emerald-400" : "text-red-400"
        : "text-zinc-100",
    },
    { label: "24H VOLUME", value: data.volume24h, icon: null, valueClass: "text-zinc-100" },
    { label: "OPEN INTEREST", value: data.openInterest, icon: null, valueClass: "text-zinc-100" },
    { label: "ER BLOCK", value: data.erBlockHeight, icon: null, valueClass: "text-violet-300 font-mono" },
  ];

  return (
    <div className="relative z-20 border-y border-zinc-800/80 bg-zinc-950/90 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-0 overflow-x-auto scrollbar-none">
          {/* Status pill */}
          <div className="flex items-center gap-1.5 pr-4 mr-4 border-r border-zinc-800 py-3 shrink-0">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`}
            />
            <span className="text-xs font-mono text-zinc-500">
              {connected ? "LIVE" : "OFFLINE"}
            </span>
          </div>

          {fields.map((f, i) => (
            <div
              key={f.label}
              className={`flex items-center gap-3 py-3 px-4 shrink-0 ${i < fields.length - 1 ? "border-r border-zinc-800/60" : ""}`}
            >
              <span className="text-[10px] font-mono text-zinc-600 tracking-widest whitespace-nowrap">
                {f.label}
              </span>
              <div className="flex items-center gap-1">
                {f.icon}
                <span className={`font-mono text-sm font-semibold tabular-nums ${f.valueClass}`}>
                  {f.value}
                </span>
              </div>
            </div>
          ))}

          <div className="ml-auto pl-4 py-3 shrink-0">
            <span className="text-[10px] font-mono text-zinc-600">
              Powered by Pyth Lazer
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
