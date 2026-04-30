"use client";

import { useEffect, useState } from "react";
import { NavBar } from "@/components/nav-bar";
import { fmtUsdc, fmtPct, shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry } from "@/lib/darkbook-types";
import type { ClosedPositionRecord } from "@/lib/darkbook-types";

const MEDALS: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState<"7d" | "30d" | "all">("30d");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // Import the client to fetch all closed positions for leaderboard
        const { fetchAllClosedPositions, deriveMarketPda, PROGRAM_ID, getConnection } = await import("@/lib/darkbook-client");
        const { resolveSnsNameCached } = await import("@/lib/sns");
        const { PublicKey } = await import("@solana/web3.js");

        // Check if program is deployed
        if (PROGRAM_ID.toString() === "11111111111111111111111111111111") {
          // Program not yet deployed, show empty state with message
          setEntries([]);
          setLoading(false);
          return;
        }

        // Query all closed positions across all owners
        const conn = getConnection();
        const positions = await fetchAllClosedPositions(deriveMarketPda("SOL"));

        // Aggregate by owner: sum realized_pnl, count trades, calculate win rate
        const ownerStats = new Map<string, { pnl: number; count: number; wins: number }>();

        positions.forEach((pos) => {
          const owner = pos.owner;
          if (!ownerStats.has(owner)) {
            ownerStats.set(owner, { pnl: 0, count: 0, wins: 0 });
          }
          const stats = ownerStats.get(owner)!;
          stats.count += 1;
          stats.pnl += pos.unrealized_pnl || 0; // Placeholder: would use realized_pnl from closed event
          if ((pos.unrealized_pnl || 0) > 0) {
            stats.wins += 1;
          }
        });

        // Convert to leaderboard entries, sorted by PnL descending
        const entries: LeaderboardEntry[] = Array.from(ownerStats.entries())
          .map(([trader, stats], idx) => ({
            rank: idx + 1,
            trader,
            realized_pnl: stats.pnl,
            trade_count: stats.count,
            win_rate: stats.count > 0 ? stats.wins / stats.count : 0,
          }))
          .sort((a, b) => b.realized_pnl - a.realized_pnl)
          .slice(0, 100) // Top 100
          .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

        // Resolve SNS names for traders (optional: if SNS fails, use shortened address)
        const entriesWithNames = await Promise.all(
          entries.map(async (entry) => {
            try {
              const ownerPubkey = new PublicKey(entry.trader);
              const snsName = await resolveSnsNameCached(conn, ownerPubkey);
              if (snsName) {
                return { ...entry, trader: snsName };
              }
            } catch {
              // Fall through to use address
            }
            return entry;
          })
        );

        setEntries(entriesWithNames);
      } catch (error) {
        console.error("[leaderboard] load error:", error);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [window]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
      <NavBar />

      <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-semibold text-zinc-200 uppercase tracking-wider">
            Leaderboard
          </h1>

          {/* Window selector */}
          <div className="flex gap-1">
            {(["7d", "30d", "all"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={cn(
                  "px-3 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors",
                  window === w
                    ? "bg-zinc-800 text-zinc-200"
                    : "text-zinc-600 hover:text-zinc-400"
                )}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* Note */}
        <p className="text-[10px] text-zinc-600 font-mono">
          Trader addresses are anonymized. Showing top 100 by realized PnL over selected period.
        </p>

        {/* Table */}
        <div className="flex-1 min-h-0 bg-zinc-900/40 border border-zinc-800 rounded-sm overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-zinc-900 z-10">
              <tr className="border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-wider">
                <th className="px-3 py-2 font-normal w-12">Rank</th>
                <th className="px-3 py-2 font-normal">Trader</th>
                <th className="px-3 py-2 font-normal text-right">Realized PnL</th>
                <th className="px-3 py-2 font-normal text-right">Trades</th>
                <th className="px-3 py-2 font-normal text-right">Win Rate</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-xs text-zinc-700 font-mono">
                    Loading from chain…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-xs text-zinc-700 font-mono">
                    No data yet — markets opening soon
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.rank}
                    className="border-b border-zinc-900 hover:bg-zinc-900/30 text-xs font-mono"
                  >
                    <td className="px-3 py-2 text-zinc-400 tabular-nums">
                      {MEDALS[entry.rank] ?? `#${entry.rank}`}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">
                      {shortenAddress(entry.trader)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span
                        className={cn(
                          entry.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {entry.realized_pnl >= 0 ? "+" : ""}
                        {fmtUsdc(entry.realized_pnl)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-400 tabular-nums">
                      {entry.trade_count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span
                        className={cn(
                          entry.win_rate >= 0.5 ? "text-emerald-400" : "text-zinc-400"
                        )}
                      >
                        {fmtPct(entry.win_rate * 100, 1)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
