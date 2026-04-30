"use client";

import { useDarkbookStore } from "@/store/darkbook-store";
import { fmtUsdc, fmtPct } from "@/lib/format";
import { ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MARKETS = [
  { id: "SOL", label: "SOL-PERP" },
  { id: "BTC", label: "BTC-PERP" },
  { id: "ETH", label: "ETH-PERP" },
];

export function MarketHeader() {
  const { selectedMarket, markPrice, change24h, setSelectedMarket } = useDarkbookStore();

  const isPositive = change24h != null && change24h >= 0;

  return (
    <div className="flex items-center gap-6 h-full px-4">
      {/* Market selector */}
      <Select value={selectedMarket} onValueChange={(v) => v && setSelectedMarket(v)}>
        <SelectTrigger className="w-36 h-8 bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-zinc-900 border-zinc-800">
          {MARKETS.map((m) => (
            <SelectItem
              key={m.id}
              value={m.id}
              className="font-mono text-sm text-zinc-200 focus:bg-zinc-800"
            >
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Mark price */}
      <div className="flex flex-col">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Mark</span>
        <span className="font-mono text-base font-semibold text-zinc-100 leading-tight">
          {markPrice != null ? fmtUsdc(markPrice, 4) : <span className="text-zinc-600 text-sm">Loading from chain…</span>}
        </span>
      </div>

      {/* 24h change */}
      <div className="flex flex-col">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">24h</span>
        <span
          className={cn(
            "font-mono text-sm font-medium leading-tight",
            change24h == null ? "text-zinc-600" : isPositive ? "text-emerald-400" : "text-rose-400"
          )}
        >
          {change24h != null ? fmtPct(change24h) : "—"}
        </span>
      </div>

      {/* Funding rate placeholder */}
      <div className="flex flex-col">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Funding</span>
        <span className="font-mono text-sm text-zinc-500 leading-tight">—</span>
      </div>

      {/* OI */}
      <div className="flex flex-col">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Open Interest</span>
        <span className="font-mono text-sm text-zinc-500 leading-tight">—</span>
      </div>
    </div>
  );
}
