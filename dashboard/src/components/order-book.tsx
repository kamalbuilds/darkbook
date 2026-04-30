"use client";

import { useEffect } from "react";
import { useDarkbookStore } from "@/store/darkbook-store";
import { fmtPrice, sizeBandGlyph } from "@/lib/format";
import { fetchOrderBook } from "@/lib/darkbook-client";
import { deriveMarketPda } from "@/lib/darkbook-client";
import { PublicKey } from "@solana/web3.js";
import type { OrderBookLevel } from "@/lib/darkbook-types";
import { cn } from "@/lib/utils";

function OrderBookRow({ level }: { level: OrderBookLevel }) {
  const isAsk = level.side === "Short";
  return (
    <div className="flex items-center justify-between px-2 py-0.5 hover:bg-zinc-800/40 font-mono text-xs">
      <span className={cn("tabular-nums w-28", isAsk ? "text-rose-400" : "text-emerald-400")}>
        {fmtPrice(level.price_ticks)}
      </span>
      <span className="text-zinc-400 text-center w-8">
        {sizeBandGlyph(level.size_band)}
      </span>
      <span className="text-zinc-500 text-right">{level.order_count}</span>
    </div>
  );
}

export function OrderBook() {
  const { selectedMarket, bids, asks, setOrderBook } = useDarkbookStore();

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        let marketPda: PublicKey;
        try {
          marketPda = deriveMarketPda(selectedMarket);
        } catch {
          return;
        }
        const levels = await fetchOrderBook(marketPda);
        if (!cancelled) {
          const bidsOut = levels.filter((l) => l.side === "Long").slice(0, 15);
          const asksOut = levels.filter((l) => l.side === "Short").slice(0, 15);
          setOrderBook(bidsOut, asksOut);
        }
      } catch {
        // RPC error — silently retry
      }
      if (!cancelled) {
        setTimeout(poll, 1000);
      }
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [selectedMarket, setOrderBook]);

  const spreadTicks =
    asks.length > 0 && bids.length > 0
      ? asks[0].price_ticks - bids[0].price_ticks
      : null;

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      <div className="px-2 py-1.5 border-b border-zinc-800">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Order Book</span>
      </div>

      {/* Column headers */}
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-zinc-600 uppercase tracking-wider">
        <span className="w-28">Price</span>
        <span className="w-8 text-center">Size</span>
        <span className="text-right">Orders</span>
      </div>

      {/* Asks (top, reversed so best ask is closest to spread) */}
      <div className="flex-1 overflow-hidden flex flex-col-reverse">
        {asks.length === 0 ? (
          <div className="px-2 py-1 text-xs text-zinc-700 font-mono">Loading from chain…</div>
        ) : (
          asks
            .slice()
            .reverse()
            .map((level, i) => <OrderBookRow key={`ask-${i}`} level={level} />)
        )}
      </div>

      {/* Spread */}
      <div className="px-2 py-1 border-y border-zinc-800 text-center font-mono text-[10px] text-zinc-500">
        {spreadTicks != null ? (
          <span>Spread: {fmtPrice(spreadTicks)}</span>
        ) : (
          <span>—</span>
        )}
      </div>

      {/* Bids */}
      <div className="flex-1 overflow-hidden">
        {bids.length === 0 ? (
          <div className="px-2 py-1 text-xs text-zinc-700 font-mono">Loading from chain…</div>
        ) : (
          bids.map((level, i) => <OrderBookRow key={`bid-${i}`} level={level} />)
        )}
      </div>
    </div>
  );
}
