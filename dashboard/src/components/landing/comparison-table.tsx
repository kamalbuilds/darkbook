"use client";

import { motion } from "framer-motion";
import { Check, X, Minus } from "lucide-react";

type CellValue = "yes" | "no" | "partial" | string;

interface Protocol {
  name: string;
  highlight?: boolean;
  privacy: CellValue;
  latency: string;
  decentralization: CellValue;
  maxLeverage: string;
  settlement: string;
  mevResistant: CellValue;
}

const protocols: Protocol[] = [
  {
    name: "DarkBook",
    highlight: true,
    privacy: "yes",
    latency: "<50ms",
    decentralization: "yes",
    maxLeverage: "20x",
    settlement: "Solana Mainnet",
    mevResistant: "yes",
  },
  {
    name: "Hyperliquid",
    privacy: "no",
    latency: "~100ms",
    decentralization: "no",
    maxLeverage: "50x",
    settlement: "HyperEVM",
    mevResistant: "partial",
  },
  {
    name: "Drift Protocol",
    privacy: "no",
    latency: "400ms+",
    decentralization: "partial",
    maxLeverage: "20x",
    settlement: "Solana",
    mevResistant: "no",
  },
  {
    name: "Dexlab",
    privacy: "no",
    latency: "500ms+",
    decentralization: "partial",
    maxLeverage: "10x",
    settlement: "Solana",
    mevResistant: "no",
  },
];

function Cell({ value }: { value: CellValue }) {
  if (value === "yes") {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-400/10 border border-emerald-400/30">
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      </span>
    );
  }
  if (value === "no") {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-500/10 border border-red-500/20">
        <X className="w-3.5 h-3.5 text-red-400" />
      </span>
    );
  }
  if (value === "partial") {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/20">
        <Minus className="w-3.5 h-3.5 text-amber-400" />
      </span>
    );
  }
  return <span className="font-mono text-sm text-zinc-300 tabular-nums">{value}</span>;
}

const columns = [
  { key: "privacy", label: "Privacy" },
  { key: "latency", label: "Latency" },
  { key: "decentralization", label: "Decentralized" },
  { key: "maxLeverage", label: "Max Leverage" },
  { key: "settlement", label: "Settlement" },
  { key: "mevResistant", label: "MEV Resistant" },
];

export function ComparisonTable() {
  return (
    <section className="py-24 px-6 bg-zinc-950/60 relative overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700/50 bg-zinc-900/60 px-4 py-1.5 text-xs font-mono text-zinc-400 mb-6">
            COMPETITIVE ANALYSIS
          </div>
          <h2 className="font-mono font-bold text-4xl md:text-5xl text-zinc-100 tracking-tight mb-4">
            DarkBook vs The Field
          </h2>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            The only institutional perps venue with privacy, speed, and full decentralization.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 overflow-hidden"
        >
          {/* Desktop table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800/60 bg-zinc-900/60">
                  <th className="text-left px-6 py-4 text-xs font-mono text-zinc-500 uppercase tracking-wider min-w-[140px]">
                    Protocol
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="text-center px-4 py-4 text-xs font-mono text-zinc-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/30">
                {protocols.map((protocol, i) => (
                  <motion.tr
                    key={protocol.name}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: i * 0.08 }}
                    className={`
                      relative group transition-colors
                      ${protocol.highlight
                        ? "bg-emerald-400/3 hover:bg-emerald-400/5"
                        : "hover:bg-zinc-800/20"
                      }
                    `}
                  >
                    {protocol.highlight && (
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <div>
                            <div className="font-mono font-bold text-emerald-400 text-sm">
                              {protocol.name}
                            </div>
                            <div className="text-[10px] font-mono text-emerald-400/50 mt-0.5">
                              This protocol
                            </div>
                          </div>
                        </div>
                      </td>
                    )}
                    {!protocol.highlight && (
                      <td className="px-6 py-5">
                        <span className="font-mono text-sm text-zinc-400">{protocol.name}</span>
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-5 text-center">
                        <Cell value={(protocol as unknown as Record<string, CellValue>)[col.key]} />
                      </td>
                    ))}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        <p className="text-center text-xs font-mono text-zinc-600 mt-4">
          * Latency measured as order submission to match confirmation. Decentralization based on validator set / admin key control.
        </p>
      </div>
    </section>
  );
}
