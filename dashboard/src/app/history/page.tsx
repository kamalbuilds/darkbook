"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { NavBar } from "@/components/nav-bar";
import { fmtUsdc, fmtPrice, shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClosedPositionRecord } from "@/lib/darkbook-types";

export default function HistoryPage() {
  const { publicKey } = useWallet();
  const [records, setRecords] = useState<ClosedPositionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!publicKey) {
        setRecords([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        // Import the client to fetch closed positions
        const { fetchClosedPositions, deriveMarketPda, PROGRAM_ID, getConnection } = await import("@/lib/darkbook-client");

        // For now, use a placeholder market (would be selected by user in full app)
        // When integrated, this would come from market selector or URL param
        if (PROGRAM_ID.toString() === "11111111111111111111111111111111") {
          // Program not yet deployed, show empty state
          setRecords([]);
          setLoading(false);
          return;
        }

        // Query closed positions for this owner
        const conn = getConnection();
        const positions = await fetchClosedPositions(deriveMarketPda("SOL"), publicKey);

        // Transform positions to ClosedPositionRecord for display
        // For now, positions returns empty until program is deployed
        const closedRecords: ClosedPositionRecord[] = positions.map((pos) => ({
          pubkey: `pos-${pos.pubkey}`,
          owner: pos.owner,
          side: pos.side,
          size_lots: pos.size_lots,
          entry_price_ticks: pos.entry_price_ticks,
          exit_price_ticks: pos.entry_price_ticks, // Placeholder: would come from PositionClosed event
          realized_pnl: 0, // Placeholder: would calculate from entry/exit prices
          funding_paid: 0, // Placeholder: would sum FundingPaid events
          opened_ts: pos.opened_ts,
          closed_ts: pos.opened_ts, // Placeholder: would come from PositionClosed event
          status: pos.status,
        }));

        setRecords(closedRecords.sort((a: ClosedPositionRecord, b: ClosedPositionRecord) => b.closed_ts - a.closed_ts));
      } catch (error) {
        console.error("[history] load error:", error);
        setRecords([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [publicKey]);

  const totalRealizedPnl = records.reduce((sum, r) => sum + r.realized_pnl, 0);
  const totalFundingPaid = records.reduce((sum, r) => sum + r.funding_paid, 0);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
      <NavBar />

      <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
        {/* Header stats */}
        <div className="flex items-center gap-8">
          <h1 className="text-sm font-mono font-semibold text-zinc-200 uppercase tracking-wider">
            Trade History
          </h1>
          <div className="flex gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-mono">
                Realized PnL
              </span>
              <span
                className={cn(
                  "font-mono text-sm font-semibold",
                  totalRealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                )}
              >
                {records.length > 0 ? fmtUsdc(totalRealizedPnl) : "—"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-mono">
                Funding Paid
              </span>
              <span className="font-mono text-sm text-zinc-400">
                {records.length > 0 ? fmtUsdc(totalFundingPaid) : "—"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-mono">
                Total Trades
              </span>
              <span className="font-mono text-sm text-zinc-400">{records.length}</span>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 min-h-0 bg-zinc-900/40 border border-zinc-800 rounded-sm overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-zinc-900 z-10">
              <tr className="border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-wider">
                <th className="px-3 py-2 font-normal">Side</th>
                <th className="px-3 py-2 font-normal">Size</th>
                <th className="px-3 py-2 font-normal">Entry</th>
                <th className="px-3 py-2 font-normal">Exit</th>
                <th className="px-3 py-2 font-normal">Realized PnL</th>
                <th className="px-3 py-2 font-normal">Funding Paid</th>
                <th className="px-3 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-zinc-700 font-mono">
                    Loading from chain…
                  </td>
                </tr>
              ) : !publicKey ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-zinc-700 font-mono">
                    Connect wallet to view history
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-zinc-700 font-mono">
                    No trade history
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr
                    key={record.pubkey}
                    className="border-b border-zinc-900 hover:bg-zinc-900/30 text-xs font-mono"
                  >
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          "font-semibold",
                          record.side === "Long" ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {record.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-zinc-300 tabular-nums">{record.size_lots}</td>
                    <td className="px-3 py-1.5 text-zinc-300 tabular-nums">
                      {fmtPrice(record.entry_price_ticks)}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-300 tabular-nums">
                      {fmtPrice(record.exit_price_ticks)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          "tabular-nums",
                          record.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {record.realized_pnl >= 0 ? "+" : ""}
                        {fmtUsdc(record.realized_pnl)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-zinc-400 tabular-nums">
                      {fmtUsdc(record.funding_paid)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wider",
                          record.status === "Closed"
                            ? "bg-zinc-800 text-zinc-400"
                            : "bg-rose-500/10 text-rose-400"
                        )}
                      >
                        {record.status}
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
