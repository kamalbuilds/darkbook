"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useDarkbookStore } from "@/store/darkbook-store";
import { fetchPositions, deriveMarketPda } from "@/lib/darkbook-client";
import { fmtUsdc, fmtPrice, shortenAddress, fmtPct } from "@/lib/format";
import { resolveSnsNameCached } from "@/lib/sns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Position } from "@/lib/darkbook-types";

function PnlCell({ pnl }: { pnl: number | undefined }) {
  if (pnl == null) return <span className="text-zinc-600">—</span>;
  return (
    <span className={cn("font-mono tabular-nums", pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
      {pnl >= 0 ? "+" : ""}{fmtUsdc(pnl, 2)}
    </span>
  );
}

function PositionRow({ position, connection }: { position: Position; connection: any }) {
  const { snsCache, setSnsCache } = useDarkbookStore();
  const [snsName, setSnsName] = useState<string | null>(null);

  useEffect(() => {
    if (!connection) return;

    const pubkeyStr = position.pubkey;
    const cached = snsCache.get(pubkeyStr);
    if (cached && Date.now() < cached.expiresAt) {
      setSnsName(cached.name);
      return;
    }

    const owner = new PublicKey(pubkeyStr);
    resolveSnsNameCached(connection, owner)
      .then((name) => {
        setSnsName(name);
        setSnsCache(pubkeyStr, name, Date.now() + 5 * 60 * 1000);
      })
      .catch(() => {
        setSnsName(null);
      });
  }, [position.pubkey, connection, snsCache, setSnsCache]);

  function handleClose() {
    const displayName = snsName || shortenAddress(position.pubkey);
    toast.info("Close position — program not yet deployed", {
      description: `Will call close_position on ${displayName}`,
    });
  }

  const displayName = snsName || shortenAddress(position.pubkey);

  return (
    <tr className="border-b border-zinc-900 hover:bg-zinc-900/30 text-xs font-mono">
      <td className="px-3 py-1.5">
        <span className={cn("font-semibold", position.side === "Long" ? "text-emerald-400" : "text-rose-400")}>
          {position.side.toUpperCase()}
        </span>
      </td>
      <td className="px-3 py-1.5 text-zinc-300 tabular-nums">{position.size_lots}</td>
      <td className="px-3 py-1.5 text-zinc-300 tabular-nums">{fmtPrice(position.entry_price_ticks)}</td>
      <td className="px-3 py-1.5 text-zinc-300 tabular-nums">
        {position.liq_price_ticks != null ? fmtPrice(position.liq_price_ticks) : "—"}
      </td>
      <td className="px-3 py-1.5 text-zinc-400 tabular-nums">{position.leverage}x</td>
      <td className="px-3 py-1.5">
        <PnlCell pnl={position.unrealized_pnl} />
      </td>
      <td className="px-3 py-1.5 text-[10px] text-zinc-500" title={position.pubkey}>
        {snsName ? <span className="text-emerald-400">{displayName}</span> : shortenAddress(position.pubkey)}
      </td>
      <td className="px-3 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="h-5 px-2 text-[10px] text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
        >
          Close
        </Button>
      </td>
    </tr>
  );
}

export function PositionsTable({ showEmpty = true }: { showEmpty?: boolean }) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { positions, selectedMarket, setPositions } = useDarkbookStore();

  useEffect(() => {
    if (!publicKey) {
      setPositions([]);
      return;
    }

    let cancelled = false;

    async function poll() {
      if (cancelled || !publicKey) return;
      try {
        const marketPda = deriveMarketPda(selectedMarket);
        const fetched = await fetchPositions(marketPda, publicKey);
        if (!cancelled) setPositions(fetched);
      } catch {
        // RPC error
      }
      if (!cancelled) setTimeout(poll, 5000);
    }

    poll();
    return () => { cancelled = true; };
  }, [publicKey, selectedMarket, setPositions]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="px-3 py-1.5 border-b border-zinc-800">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Open Positions</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-zinc-950 z-10">
            <tr className="border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-wider">
              <th className="px-3 py-1.5 font-normal">Side</th>
              <th className="px-3 py-1.5 font-normal">Size</th>
              <th className="px-3 py-1.5 font-normal">Entry</th>
              <th className="px-3 py-1.5 font-normal">Liq Price</th>
              <th className="px-3 py-1.5 font-normal">Lev</th>
              <th className="px-3 py-1.5 font-normal">Unrealized PnL</th>
              <th className="px-3 py-1.5 font-normal">Owner</th>
              <th className="px-3 py-1.5 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              showEmpty ? (
                <tr>
                  <td colSpan={8} className="px-3 py-4 text-center text-xs text-zinc-700 font-mono">
                    {publicKey ? "No open positions" : "Connect wallet to view positions"}
                  </td>
                </tr>
              ) : null
            ) : (
              positions.map((pos) => (
                <PositionRow key={pos.pubkey} position={pos} connection={connection} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
