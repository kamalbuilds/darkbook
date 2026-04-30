"use client";

import { Lock } from "lucide-react";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-zinc-800/60 bg-zinc-950 py-12 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center">
              <Lock className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="font-mono font-bold text-zinc-100">DarkBook</div>
              <div className="font-mono text-[11px] text-zinc-600">Private orders. Public PnL. Sub-50ms matching.</div>
            </div>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors text-sm font-mono"
            >
              <GithubIcon className="w-4 h-4" />
              GitHub
            </a>
            <a
              href="https://twitter.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors text-sm font-mono"
            >
              <TwitterIcon className="w-4 h-4" />
              Twitter
            </a>
            <a
              href="/trade"
              className="flex items-center gap-2 text-zinc-500 hover:text-emerald-400 transition-colors text-sm font-mono"
            >
              Trade Terminal
            </a>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-3">
            <span className="rounded border border-zinc-700/50 bg-zinc-900 px-3 py-1 text-[11px] font-mono text-zinc-500">
              Built for Frontier 2026
            </span>
            <span className="rounded border border-zinc-700/50 bg-zinc-900 px-3 py-1 text-[11px] font-mono text-zinc-500">
              MIT License
            </span>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t border-zinc-800/40 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[11px] font-mono text-zinc-700 text-center">
            DarkBook is experimental software deployed on Solana Devnet. Not audited. Use at your own risk.
          </p>
          <div className="flex items-center gap-4">
            {[
              { name: "MagicBlock ER", color: "text-purple-400" },
              { name: "Pyth Lazer", color: "text-cyan-400" },
              { name: "Solana", color: "text-emerald-400" },
            ].map((tech) => (
              <span key={tech.name} className={`text-[11px] font-mono ${tech.color}`}>
                {tech.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
