"use client";

import { motion } from "framer-motion";

const techItems = [
  {
    name: "MagicBlock",
    desc: "Ephemeral Rollups for sub-50ms matching",
    color: "from-purple-400/20 to-purple-600/10",
    border: "border-purple-500/20",
    textColor: "text-purple-300",
    logo: "MB",
  },
  {
    name: "Pyth Network",
    desc: "Lazer oracle — sub-1ms price feeds",
    color: "from-cyan-400/20 to-cyan-600/10",
    border: "border-cyan-500/20",
    textColor: "text-cyan-300",
    logo: "PY",
  },
  {
    name: "Anchor",
    desc: "Rust framework — settlement program",
    color: "from-orange-400/20 to-orange-600/10",
    border: "border-orange-500/20",
    textColor: "text-orange-300",
    logo: "AN",
  },
  {
    name: "Solana",
    desc: "L1 — immutable settlement layer",
    color: "from-emerald-400/20 to-emerald-600/10",
    border: "border-emerald-500/20",
    textColor: "text-emerald-300",
    logo: "SOL",
  },
  {
    name: "Phantom",
    desc: "Wallet — Solana native, hardware support",
    color: "from-violet-400/20 to-violet-600/10",
    border: "border-violet-500/20",
    textColor: "text-violet-300",
    logo: "PH",
  },
];

export function TechStack() {
  return (
    <section className="py-24 px-6 bg-zinc-950 relative overflow-hidden">
      {/* Radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full bg-emerald-400/4 blur-[80px] pointer-events-none" />

      <div className="max-w-7xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700/50 bg-zinc-900/60 px-4 py-1.5 text-xs font-mono text-zinc-400 mb-6">
            TECH STACK
          </div>
          <h2 className="font-mono font-bold text-4xl md:text-5xl text-zinc-100 tracking-tight mb-4">
            Built on best-in-class infrastructure
          </h2>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            Every layer is production-grade. No compromises.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {techItems.map((item, i) => (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className={`group relative rounded-xl border ${item.border} bg-gradient-to-br ${item.color} p-5 text-center cursor-default`}
            >
              {/* Logo mark */}
              <div className={`font-mono font-black text-2xl ${item.textColor} mb-3 tracking-tight`}>
                {item.logo}
              </div>
              <div className="font-mono font-semibold text-zinc-200 text-sm mb-1.5">
                {item.name}
              </div>
              <div className="text-zinc-500 text-[11px] leading-relaxed">
                {item.desc}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Stack details */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="mt-12 rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-6"
        >
          <div className="font-mono text-xs text-zinc-600 mb-4 uppercase tracking-wider">Dependency Versions</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["anchor-lang", "0.32.1"],
              ["ephemeral-rollups-sdk", "0.11.1"],
              ["@coral-xyz/anchor", "0.32.1"],
              ["@magicblock-labs/er-sdk", "latest"],
              ["next.js", "16.x"],
              ["tailwindcss", "4.x"],
              ["framer-motion", "12.x"],
              ["@solana/web3.js", "1.98.x"],
            ].map(([dep, ver]) => (
              <div key={dep} className="flex items-center gap-2">
                <span className="font-mono text-xs text-zinc-500">{dep}</span>
                <span className="font-mono text-xs text-emerald-400/70 ml-auto">{ver}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
