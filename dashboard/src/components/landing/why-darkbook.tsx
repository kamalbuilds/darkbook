"use client";

import { motion } from "framer-motion";
import { Shield, Zap, Landmark } from "lucide-react";

const pillars = [
  {
    icon: Shield,
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-400/10 border-emerald-400/20",
    title: "Privacy-First Order Book",
    description:
      "Order size and identity are encrypted off-chain with ECIES. Only a 32-byte commitment hash is stored on-chain. Your position size stays hidden until settlement — invisible to MEV bots and whale trackers.",
    tags: ["ECIES Encryption", "Commitment Scheme", "MEV Resistant"],
  },
  {
    icon: Zap,
    iconColor: "text-violet-400",
    iconBg: "bg-violet-400/10 border-violet-400/20",
    title: "Sub-50ms Matching Engine",
    description:
      "Orders are matched on MagicBlock Ephemeral Rollups with dedicated validator throughput. The OrderBook PDA is delegated to the ER; matching happens in isolated fast state with 100ms finality windows.",
    tags: ["MagicBlock ER", "100ms Finality", "CLOB Engine"],
  },
  {
    icon: Landmark,
    iconColor: "text-cyan-400",
    iconBg: "bg-cyan-400/10 border-cyan-400/20",
    title: "Immutable Settlement",
    description:
      "Settlement is atomic on Solana mainnet via Anchor. Admin keys are burned (Anatoly Percolator pattern). No upgradeable risk engine. No centralized liquidation oracle. Permissionless cranking.",
    tags: ["Burned Admin Keys", "Permissionless", "Percolator Pattern"],
  },
];

export function WhyDarkBook() {
  return (
    <section className="py-24 px-6 bg-zinc-950 relative overflow-hidden">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage:
            "linear-gradient(#34d399 1px, transparent 1px), linear-gradient(90deg, #34d399 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <div className="max-w-7xl mx-auto relative">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700/50 bg-zinc-900/60 px-4 py-1.5 text-xs font-mono text-zinc-400 mb-6">
            WHY DARKBOOK
          </div>
          <h2 className="font-mono font-bold text-4xl md:text-5xl text-zinc-100 tracking-tight mb-4">
            Institutional-grade perps.{" "}
            <br />
            <span className="bg-gradient-to-r from-emerald-400 to-violet-400 bg-clip-text text-transparent">
              Decentralized by design.
            </span>
          </h2>
          <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
            Three properties that make DarkBook the only perps venue worth trading on Solana.
          </p>
        </motion.div>

        {/* Three columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {pillars.map((pillar, i) => {
            const Icon = pillar.icon;
            return (
              <motion.div
                key={pillar.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.12 }}
                className="group relative rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-6 hover:border-zinc-700/80 transition-all duration-300 hover:bg-zinc-900/70"
              >
                {/* Hover glow */}
                <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-emerald-400/3 to-violet-400/3" />

                <div className="relative">
                  <div className={`inline-flex items-center justify-center w-11 h-11 rounded-lg border ${pillar.iconBg} mb-5`}>
                    <Icon className={`w-5 h-5 ${pillar.iconColor}`} />
                  </div>

                  <h3 className="font-mono font-bold text-zinc-100 text-lg mb-3 leading-tight">
                    {pillar.title}
                  </h3>

                  <p className="text-zinc-400 text-sm leading-relaxed mb-5">
                    {pillar.description}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {pillar.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-md border border-zinc-700/50 bg-zinc-800/50 px-2.5 py-1 text-[11px] font-mono text-zinc-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Bottom quote */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-16 text-center border-t border-zinc-800/60 pt-10"
        >
          <blockquote className="font-mono text-zinc-400 text-sm italic max-w-2xl mx-auto">
            "Anatoly published Percolator — an immutable risk engine. DarkBook extends it to private order-book context.
            Same operational-safety philosophy. Immutable, permissionless, decentralized risk."
          </blockquote>
          <p className="text-zinc-600 text-xs font-mono mt-3">— Built for Frontier 2026, Solana hackathon</p>
        </motion.div>
      </div>
    </section>
  );
}
