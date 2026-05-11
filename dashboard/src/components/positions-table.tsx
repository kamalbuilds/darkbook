"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useDarkbookStore } from "@/store/darkbook-store";
import { fetchPositions, deriveMarketPda, buildClosePositionTx } from "@/lib/darkbook-client";
import { fmtUsdc, fmtPrice, shortenAddress, fmtPct } from "@/lib/format";
import { resolveSnsNameCached } from "@/lib/sns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Position } from "@/lib/darkbook-types";

const PYTH_PRICE_UPDATE_PUBKEY =
  process.env.NEXT_PUBLIC_PYTH_PRICE_UPDATE_PUBKEY
    ? new PublicKey(process.env.NEXT_PUBLIC_PYTH_PRICE_UPDATE_PUBKEY)
    : PublicKey.default;

function PnlCell({ pnl }: { pnl: number | undefined }) {
  if (pnl == null) return <span className="text-zinc-600">—</span>;
  return (
    <span className={cn("font-mono tabular-nums", pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
      {pnl >= 0 ? "+" : ""}{fmtUsdc(pnl, 2)}
    </span>
  );
}

function PositionRow({ position, connection, selectedMarket, signTransaction }: { 
  position: Position; 
  connection: any; 
  selectedMarket: string;
  signTransaction: ((tx: Transaction) => Promise<Transaction>) | undefined;
}) {
  const { snsCache, setSnsCache } = useDarkbookStore();
  const [snsName, setSnsName] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!connection) return;

    const pubkeyStr = position.owner;
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
  }, [position.owner, connection, snsCache, setSnsCache]);

  async function handleClose() {
    if (!signTransaction) {
      toast.error("Wallet does not support signing");
      return;
    }
    setClosing(true);
    try {
      const marketPda = deriveMarketPda(selectedMarket);
      const positionPda = new PublicKey(position.pubkey);

      const { tx, blockhash } = await buildClosePositionTx({
        connection,
        owner: new PublicKey(position.owner),
        market: marketPda,
        positionPda,
        priceUpdateAccount: PYTH_PRICE_UPDATE_PUBKEY,
      });

      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(
        { signature: sig, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
        "confirmed",
      );

      toast.success("Position closed", {
        description: `${position.side} position · sig ${sig.slice(0, 8)}…`,
        duration: 6000,
      });
    } catch (err: any) {
      toast.error("Close failed", { description: err?.message ?? "Unknown error" });
    } finally {
      setClosing(false);
    }
  }

  const displayName = snsName || shortenAddress(position.owner);

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
      <td className="px-3 py-1.5 text-[10px] text-zinc-500" title={position.owner}>
        {snsName ? <span className="text-emerald-400">{displayName}</span> : shortenAddress(position.owner)}
      </td>
      <td className="px-3 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          disabled={closing}
          onClick={handleClose}
          className="h-5 px-2 text-[10px] text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
        >
          {closing ? "…" : "Close"}
        </Button>
      </td>
    </tr>
  );
}

export function PositionsTable({ showEmpty = true }: { showEmpty?: boolean }) {
  const { publicKey, signTransaction } = useWallet();
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
                <PositionRow key={pos.pubkey} position={pos} connection={connection} selectedMarket={selectedMarket} signTransaction={signTransaction} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
