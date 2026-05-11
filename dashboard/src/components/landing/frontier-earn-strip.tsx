"use client";

import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";

const EITHERWAY_LISTING =
  "https://superteam.fun/earn/listing/build-a-live-dapp-with-solflare-kamino-dflow-or-quicknode-with-eitherway-app/";
const TETHER_LISTING = "https://superteam.fun/earn/listing/tether-frontier-hackathon-track";
const UMBRA_LISTING = "https://superteam.fun/earn/listing/umbra-side-track";
const ENCRYPT_IKA_LISTING = "https://superteam.fun/earn/listing/encrypt-ika-frontier-april-2026";
const FRONTIER_HUB = "https://superteam.fun/earn/hackathon/frontier";

const shippedIntegrations = [
  {
    name: "Solflare",
    detail: "Wallet adapter in the trade terminal alongside Phantom.",
  },
  {
    name: "Birdeye",
    detail: "OHLCV and market intel on the trade route when an API key is set.",
  },
  {
    name: "RPC tier",
    detail: "Helius or Quicknode URLs supported via NEXT_PUBLIC_HELIUS_RPC or NEXT_PUBLIC_QUICKNODE_RPC.",
  },
  {
    name: "MagicBlock ER",
    detail: "Matching and commit path documented in the program and SDK.",
  },
];

export function FrontierEarnStrip() {
  return (
    <section className="py-20 px-6 bg-zinc-950 border-t border-zinc-800/40">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <p className="text-xs font-mono uppercase tracking-widest text-zinc-500 mb-3">
            Superteam Earn, Frontier
          </p>
          <h2 className="font-mono font-semibold text-2xl md:text-3xl text-zinc-100 tracking-tight mb-3">
            Frontier Earn: shipped stack plus filing targets
          </h2>
          <p className="text-zinc-500 text-sm max-w-2xl mx-auto leading-relaxed">
            Devnet terminal with wallet connect, oracle-driven marks, and optional RPC and market data. Eitherway
            and Tether listings match what is live today. Umbra and Encrypt Ika are linked for completeness; see{" "}
            <span className="font-mono text-zinc-500">submission-progress/superteam/SIDETRACK.md</span> for what is
            integrated versus roadmap-only.
          </p>
        </motion.div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-12">
          {shippedIntegrations.map((row, i) => (
            <motion.div
              key={row.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] hover:border-white/[0.1] hover:-translate-y-0.5 transition"
            >
              <div className="font-mono text-sm font-semibold text-emerald-400/90 mb-2">{row.name}</div>
              <p className="text-zinc-500 text-xs leading-relaxed">{row.detail}</p>
            </motion.div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap items-stretch justify-center gap-4">
          <a
            href={EITHERWAY_LISTING}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-6 py-4 text-sm font-mono text-emerald-200 hover:bg-emerald-500/15 transition"
          >
            Eitherway listing
            <ExternalLink className="w-4 h-4 opacity-70" />
          </a>
          <a
            href={TETHER_LISTING}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-6 py-4 text-sm font-mono text-zinc-200 hover:bg-white/[0.06] transition"
          >
            Tether Frontier track
            <ExternalLink className="w-4 h-4 opacity-70" />
          </a>
          <a
            href={UMBRA_LISTING}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-6 py-4 text-sm font-mono text-zinc-200 hover:bg-white/[0.06] transition"
          >
            Umbra side track
            <ExternalLink className="w-4 h-4 opacity-70" />
          </a>
          <a
            href={ENCRYPT_IKA_LISTING}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-6 py-4 text-sm font-mono text-zinc-200 hover:bg-white/[0.06] transition"
          >
            Encrypt and Ika track
            <ExternalLink className="w-4 h-4 opacity-70" />
          </a>
          <a
            href={FRONTIER_HUB}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-6 py-4 text-sm font-mono text-zinc-200 hover:bg-white/[0.06] transition"
          >
            Frontier hub
            <ExternalLink className="w-4 h-4 opacity-70" />
          </a>
        </div>

        <p className="mt-10 text-center text-xs text-zinc-600 max-w-2xl mx-auto leading-relaxed">
          Stablecoin track narrative: margin and settlement are USD-stablecoin native on devnet (USDC today; same
          SPL token program patterns as USDT). See{" "}
          <span className="font-mono text-zinc-500">submission-progress/superteam/TRACKER.md</span> for bounty rows,
          filing status, and payload checklist.
        </p>
      </div>
    </section>
  );
}
