"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface OrderRow {
  id: number;
  price: string;
  band: "SMALL" | "MED" | "LARGE" | "WHALE";
  leverage: string;
  side: "bid" | "ask";
  depth: number;
}

/** Deterministic PRNG so SSR and first client paint match (avoids hydration mismatch). */
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bandFromRoll(r: number): OrderRow["band"] {
  if (r < 0.5) return "SMALL";
  if (r < 0.8) return "MED";
  if (r < 0.95) return "LARGE";
  return "WHALE";
}

function generateRows(basePrice: number, seed: number): OrderRow[] {
  const rng = mulberry32(seed);
  const asks: OrderRow[] = [];
  const bids: OrderRow[] = [];
  const levs = ["2x", "5x", "10x", "20x"] as const;

  for (let i = 0; i < 6; i++) {
    asks.push({
      id: 100 + i,
      price: (basePrice + 0.5 + i * 0.25).toFixed(2),
      band: bandFromRoll(rng()),
      leverage: levs[Math.floor(rng() * 4)]!,
      side: "ask",
      depth: rng() * 0.9 + 0.05,
    });
    bids.push({
      id: 200 + i,
      price: (basePrice - i * 0.25).toFixed(2),
      band: bandFromRoll(rng()),
      leverage: levs[Math.floor(rng() * 4)]!,
      side: "bid",
      depth: rng() * 0.9 + 0.05,
    });
  }

  return [...asks.reverse(), ...bids];
}

const BAND_COLORS: Record<string, string> = {
  SMALL: "text-zinc-400",
  MED: "text-cyan-400",
  LARGE: "text-violet-400",
  WHALE: "text-amber-400",
};

export function OrderBookTeaser() {
  const [rows, setRows] = useState<OrderRow[]>(() => generateRows(175.0, 42_424_242));
  const [basePrice, setBasePrice] = useState(175.0);

  useEffect(() => {
    const interval = setInterval(() => {
      setBasePrice((p) => {
        const newP = p + (Math.random() - 0.5) * 0.5;
        const clamped = Math.max(170, Math.min(180, newP));
        const tickSeed = Math.floor(Date.now() / 1800) ^ 0x9e3779b9;
        setRows(generateRows(clamped, tickSeed));
        return clamped;
      });
    }, 1800);

    return () => clearInterval(interval);
  }, []);

  const asks = rows.filter((r) => r.side === "ask").slice(0, 6);
  const bids = rows.filter((r) => r.side === "bid").slice(0, 6);
  const spread = (parseFloat(asks[asks.length - 1]?.price ?? "0") - parseFloat(bids[0]?.price ?? "0")).toFixed(2);

  return (
    <section id="demo" className="py-24 px-6 bg-zinc-950 relative scroll-mt-24">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700/50 bg-zinc-900/60 px-4 py-1.5 text-xs font-mono text-zinc-400 mb-6">
            ORDER BOOK
          </div>
          <h2 className="font-mono font-bold text-4xl md:text-5xl text-zinc-100 tracking-tight mb-4">
            Private orders.{" "}
            <span className="text-zinc-500">Hidden sizes.</span>
          </h2>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            Order sizes are encrypted — only the size band is visible. MEV bots see nothing actionable.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="max-w-2xl mx-auto"
        >
          {/* Demo label */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-mono text-amber-400">
                <span className="w-1 h-1 rounded-full bg-amber-400" />
                SIMULATED PREVIEW
              </span>
              <span className="text-[10px] font-mono text-zinc-600">Live network: connect wallet to see real book</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-600 tabular-nums">
              SOL-PERP
            </span>
          </div>

          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-4 gap-4 px-4 py-2 border-b border-zinc-800/60 bg-zinc-900">
              {["PRICE (USDC)", "SIZE BAND", "LEV", "DEPTH"].map((h) => (
                <div key={h} className="text-[10px] font-mono text-zinc-600 text-right first:text-left">
                  {h}
                </div>
              ))}
            </div>

            {/* Asks */}
            <div className="divide-y divide-zinc-800/30">
              <AnimatePresence mode="popLayout">
                {asks.map((row) => (
                  <motion.div
                    key={row.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="relative grid grid-cols-4 gap-4 px-4 py-2 hover:bg-red-500/5 transition-colors"
                  >
                    <div
                      className="absolute inset-y-0 right-0 bg-red-500/8"
                      style={{ width: `${row.depth * 100}%` }}
                    />
                    <div className="relative font-mono text-sm text-red-400 tabular-nums font-medium">
                      {row.price}
                    </div>
                    <div className={`relative font-mono text-xs text-right ${BAND_COLORS[row.band]}`}>
                      {row.band}
                    </div>
                    <div className="relative font-mono text-xs text-zinc-500 text-right">{row.leverage}</div>
                    <div className="relative">
                      <div
                        className="h-1.5 rounded-full bg-red-500/30 ml-auto"
                        style={{ width: `${row.depth * 100}%` }}
                      />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Spread */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800/30 border-y border-zinc-800/60">
              <span className="text-[10px] font-mono text-zinc-500">SPREAD</span>
              <span className="font-mono text-sm font-bold text-zinc-100 tabular-nums">${spread}</span>
              <span className="text-[10px] font-mono text-zinc-500">MARK: ${basePrice.toFixed(2)}</span>
            </div>

            {/* Bids */}
            <div className="divide-y divide-zinc-800/30">
              <AnimatePresence mode="popLayout">
                {bids.map((row) => (
                  <motion.div
                    key={row.id}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="relative grid grid-cols-4 gap-4 px-4 py-2 hover:bg-emerald-500/5 transition-colors"
                  >
                    <div
                      className="absolute inset-y-0 right-0 bg-emerald-500/8"
                      style={{ width: `${row.depth * 100}%` }}
                    />
                    <div className="relative font-mono text-sm text-emerald-400 tabular-nums font-medium">
                      {row.price}
                    </div>
                    <div className={`relative font-mono text-xs text-right ${BAND_COLORS[row.band]}`}>
                      {row.band}
                    </div>
                    <div className="relative font-mono text-xs text-zinc-500 text-right">{row.leverage}</div>
                    <div className="relative">
                      <div
                        className="h-1.5 rounded-full bg-emerald-500/30 ml-auto"
                        style={{ width: `${row.depth * 100}%` }}
                      />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap items-center gap-4 justify-center">
            {(Object.entries(BAND_COLORS) as [string, string][]).map(([band, color]) => (
              <div key={band} className="flex items-center gap-1.5">
                <span className={`text-xs font-mono font-semibold ${color}`}>{band}</span>
                <span className="text-xs text-zinc-600">
                  {band === "SMALL" ? "≤10 lots" : band === "MED" ? "≤100 lots" : band === "LARGE" ? "≤1000 lots" : ">1000 lots"}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
