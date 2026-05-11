"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useDarkbookStore } from "@/store/darkbook-store";
import { fetchTokenOverview, type TokenOverviewStats } from "@/lib/birdeye";
import { spotBaseMintForMarket } from "@/lib/market-assets";
import { fmtPct, fmtUsdCompact, fmtUsdc } from "@/lib/format";
import { cn } from "@/lib/utils";

function flowBarWidth(buy: number, sell: number): { buyPct: number; sellPct: number } {
  const t = buy + sell;
  if (t <= 0) return { buyPct: 50, sellPct: 50 };
  return { buyPct: (buy / t) * 100, sellPct: (sell / t) * 100 };
}

export function BirdeyeMarketIntel() {
  const { selectedMarket, markPrice, setChange24h } = useDarkbookStore();
  const baseMint = useMemo(() => spotBaseMintForMarket(selectedMarket), [selectedMarket]);
  const [overview, setOverview] = useState<TokenOverviewStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOverview(null);
    setError(null);

    (async () => {
      const o = await fetchTokenOverview(baseMint);
      if (cancelled) return;
      if (!o) {
        setError("Birdeye overview unavailable (set NEXT_PUBLIC_BIRDEYE_API_KEY for full Data API access)");
        return;
      }
      setOverview(o);
      if (o.priceChange24hPercent != null) {
        setChange24h(o.priceChange24hPercent);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseMint, selectedMarket, setChange24h]);

  const flow = useMemo(() => {
    if (!overview?.buyVolume24hUsd || !overview?.sellVolume24hUsd) return null;
    return flowBarWidth(overview.buyVolume24hUsd, overview.sellVolume24hUsd);
  }, [overview]);

  const basisPct =
    markPrice != null && overview?.price != null && overview.price > 0
      ? ((markPrice - overview.price) / overview.price) * 100
      : null;

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/80 shrink-0">
      <div className="flex items-center gap-6 px-4 py-2 min-h-10">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Birdeye</span>
          <span className="text-xs font-mono text-zinc-400">
            {overview?.symbol ?? selectedMarket} spot
          </span>
        </div>

        <AnimatePresence mode="wait">
          {overview ? (
            <motion.div
              key={baseMint}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-1 flex-wrap items-center gap-x-8 gap-y-1 text-xs"
            >
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Spot</span>
                <span className="font-mono text-zinc-200 tabular-nums">
                  {overview.price != null ? fmtUsdc(overview.price, 4) : "—"}
                </span>
              </div>

              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">24h</span>
                <span
                  className={cn(
                    "font-mono tabular-nums",
                    overview.priceChange24hPercent == null
                      ? "text-zinc-600"
                      : overview.priceChange24hPercent >= 0
                        ? "text-emerald-400"
                        : "text-rose-400",
                  )}
                >
                  {overview.priceChange24hPercent != null
                    ? fmtPct(overview.priceChange24hPercent)
                    : "—"}
                </span>
              </div>

              <div className="flex flex-col min-w-[4.5rem]">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Vol 24h</span>
                <span className="font-mono text-zinc-300 tabular-nums">
                  {fmtUsdCompact(overview.volume24hUsd)}
                  {overview.volume24hChangePercent != null && (
                    <span
                      className={cn(
                        "ml-1.5 text-[10px]",
                        overview.volume24hChangePercent >= 0 ? "text-emerald-500" : "text-rose-500",
                      )}
                    >
                      {fmtPct(overview.volume24hChangePercent, 1)}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex flex-col min-w-[4.5rem]">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Liq</span>
                <span className="font-mono text-zinc-300 tabular-nums">
                  {fmtUsdCompact(overview.liquidityUsd)}
                </span>
              </div>

              <div className="flex flex-col min-w-[5rem]">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Wallets 24h</span>
                <span className="font-mono text-zinc-300 tabular-nums">
                  {overview.uniqueWallets24h != null
                    ? overview.uniqueWallets24h.toLocaleString("en-US")
                    : "—"}
                </span>
              </div>

              {flow && (
                <div className="flex flex-col min-w-[140px] max-w-[200px] flex-1">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    24h buy / sell (USD)
                  </span>
                  <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-sm bg-zinc-800">
                    <div
                      className="h-full bg-emerald-500/90"
                      style={{ width: `${flow.buyPct}%` }}
                      title="Buy volume"
                    />
                    <div
                      className="h-full bg-rose-500/90"
                      style={{ width: `${flow.sellPct}%` }}
                      title="Sell volume"
                    />
                  </div>
                </div>
              )}

              {basisPct != null && Number.isFinite(basisPct) && (
                <div className="flex flex-col">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    Perp vs spot
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      basisPct >= 0 ? "text-amber-400/90" : "text-sky-400/90",
                    )}
                  >
                    {basisPct >= 0 ? "+" : ""}
                    {basisPct.toFixed(3)}%
                  </span>
                </div>
              )}
            </motion.div>
          ) : (
            <span className="text-xs font-mono text-zinc-600">
              {error ?? "Loading Birdeye market data…"}
            </span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
