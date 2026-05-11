"use client";

import { motion } from "framer-motion";
import { AnimatedGradientMesh } from "./animated-gradient";
import { ArrowRight, Play } from "lucide-react";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

export function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      <AnimatedGradientMesh />

      {/* Nav bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center font-mono text-[10px] font-semibold text-emerald-400">
            DB
          </div>
          <span className="font-mono font-bold text-zinc-100 tracking-tight">DarkBook</span>
          <span className="text-zinc-600 text-xs font-mono ml-1">v0.1-devnet</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="/trade" className="text-xs font-mono text-zinc-400 hover:text-emerald-400 transition-colors">Trade</a>
          <a href="/positions" className="text-xs font-mono text-zinc-400 hover:text-emerald-400 transition-colors">Positions</a>
          <a href="/leaderboard" className="text-xs font-mono text-zinc-400 hover:text-emerald-400 transition-colors">Leaderboard</a>
          <a
            href="https://github.com/aarav1656/darkbook"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-zinc-400 hover:text-emerald-400 transition-colors flex items-center gap-1"
          >
            <GithubIcon className="w-3 h-3" />
            GitHub
          </a>
        </div>
      </div>

      {/* Hero content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-5xl mx-auto pt-20">
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-4 py-1.5 text-xs font-mono text-emerald-400"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live on Solana Devnet — MagicBlock ER Active
        </motion.div>

        {/* Main headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="font-mono font-bold text-5xl md:text-7xl leading-[1.05] tracking-tight text-zinc-100 mb-6"
        >
          Private orders.{" "}
          <br />
          <span className="text-emerald-400/95">Public PnL.</span>
          <br />
          Sub-50ms matching.
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="text-zinc-400 text-lg md:text-xl max-w-2xl leading-relaxed mb-10 font-sans"
        >
          Institutional perps on Solana, hidden from MEV.{" "}
          <span className="text-zinc-300">Powered by MagicBlock Ephemeral Rollups.</span>
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <a
            href="/trade"
            className="inline-flex items-center gap-2.5 rounded-lg bg-emerald-400 px-6 py-3 text-sm font-mono font-semibold text-zinc-950 hover:bg-emerald-300 transition-colors shadow-[0_0_24px_rgba(52,211,153,0.3)]"
          >
            Open Trade Terminal
            <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="https://github.com/aarav1656/darkbook"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-6 py-3 text-sm font-mono text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors backdrop-blur-sm"
          >
            <GithubIcon className="w-4 h-4" />
            View on GitHub
          </a>
          <a
            href="/#demo"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/50 px-6 py-3 text-sm font-mono text-zinc-300 hover:border-emerald-500/30 hover:text-emerald-200/90 transition-colors"
          >
            <Play className="w-4 h-4 fill-current" />
            Watch Demo
          </a>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.7 }}
          className="mt-16 grid grid-cols-3 gap-8 border-t border-zinc-800/60 pt-8 w-full max-w-2xl"
        >
          {[
            { label: "Matching Latency", value: "<50ms", accent: "text-emerald-400" },
            { label: "Settlement", value: "On-chain", accent: "text-emerald-400/80" },
            { label: "Privacy Model", value: "ECIES", accent: "text-zinc-300" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className={`font-mono text-2xl font-bold ${stat.accent}`}>{stat.value}</div>
              <div className="text-xs font-mono text-zinc-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.5 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10"
      >
        <span className="text-zinc-600 text-xs font-mono">scroll to explore</span>
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
          className="w-px h-8 bg-gradient-to-b from-zinc-600 to-transparent"
        />
      </motion.div>

      {/* Bottom vignette */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-zinc-950 to-transparent z-10" />
    </section>
  );
}
