"use client";

import { motion } from "framer-motion";

const sponsors = [
  {
    name: "MagicBlock",
    tag: "Privacy Track",
    prize: "$5,000",
    color: "text-purple-400",
    border: "border-purple-500/20",
    bg: "bg-purple-500/5",
    logo: "MB",
  },
  {
    name: "Encrypt × Ika",
    tag: "Encrypted Markets",
    prize: "$15,000",
    color: "text-cyan-400",
    border: "border-cyan-500/20",
    bg: "bg-cyan-500/5",
    logo: "EI",
  },
  {
    name: "Cloak",
    tag: "Privacy Payments",
    prize: "$5,010",
    color: "text-emerald-400",
    border: "border-emerald-500/20",
    bg: "bg-emerald-500/5",
    logo: "CL",
  },
  {
    name: "Umbra",
    tag: "Privacy Infra",
    prize: "$10,000",
    color: "text-violet-400",
    border: "border-violet-500/20",
    bg: "bg-violet-500/5",
    logo: "UM",
  },
  {
    name: "Eitherway",
    tag: "DeFi Infra",
    prize: "$20,000",
    color: "text-amber-400",
    border: "border-amber-500/20",
    bg: "bg-amber-500/5",
    logo: "EW",
  },
];

export function Sponsors() {
  return (
    <section className="py-20 px-6 bg-zinc-950/80 border-t border-zinc-800/40 relative overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700/50 bg-zinc-900/60 px-4 py-1.5 text-xs font-mono text-zinc-400 mb-5">
            FRONTIER 2026 SIDETRACKS
          </div>
          <h2 className="font-mono font-bold text-2xl text-zinc-300 tracking-tight mb-2">
            Competing across 5 sponsor tracks
          </h2>
          <p className="text-zinc-600 text-sm font-mono">
            Total available: $55,010 USDC + Main Prize
          </p>
        </motion.div>

        <div className="flex flex-wrap items-center justify-center gap-4">
          {sponsors.map((sponsor, i) => (
            <motion.div
              key={sponsor.name}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className={`flex items-center gap-3 rounded-xl border ${sponsor.border} ${sponsor.bg} px-5 py-3`}
            >
              <div className={`font-mono font-black text-lg ${sponsor.color}`}>{sponsor.logo}</div>
              <div>
                <div className={`font-mono font-bold text-sm ${sponsor.color}`}>{sponsor.name}</div>
                <div className="text-zinc-600 text-[11px] font-mono">{sponsor.tag} — {sponsor.prize}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Total */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-10 text-center"
        >
          <div className="inline-flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-6 py-3">
            <span className="font-mono text-xs text-zinc-500">POTENTIAL TOTAL</span>
            <span className="font-mono font-bold text-2xl text-emerald-400">$85,010+</span>
            <span className="font-mono text-xs text-zinc-500">if Grand Prize included</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
