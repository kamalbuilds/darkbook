"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useDarkbookStore } from "@/store/darkbook-store";
import { fetchPositions, deriveMarketPda, buildClosePositionTx, fetchOrderBook } from "@/lib/darkbook-client";
import { fmtUsdc, fmtPrice, shortenAddress, fmtPct, sizeBandGlyph } from "@/lib/format";
import { resolveSnsNameCached } from "@/lib/sns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Position, OrderBookLevel } from "@/lib/darkbook-types";

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
  const [_shieldWithUmbra, setShieldWithUmbra] = useState(false);

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

      // Optional: shield payout with Umbra
      if (_shieldWithUmbra) {
        try {
          const { getUmbraClient } = await import("@/lib/umbra-client");
          const umbra = getUmbraClient();
          if (umbra) {
            const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT ?? "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr";
            // Shield the full unlocked amount (approximate from position data)
            const payoutAmount = BigInt(Math.floor((position.collateral_locked + (position.unrealized_pnl ?? 0)) * 1e6));
            if (payoutAmount > BigInt(0)) {
              const shieldResult = await (await import("@/lib/umbra-client")).shieldUsdcPayout(
                umbra, usdcMint, payoutAmount,
              );
              if (shieldResult) {
                toast.success("Shielded with Umbra", {
                  description: `Payout routed to encrypted balance · ${shieldResult.queueSignature.slice(0, 8)}…`,
                  duration: 8000,
                });
              }
            }
          }
        } catch (umbraErr: any) {
          console.warn("[umbra] shield failed (non-fatal):", umbraErr?.message);
        }
      }

      toast.success("Position closed", {
        description: `${position.side} position${_shieldWithUmbra ? " + Umbra shield" : ""} · sig ${sig.slice(0, 8)}…`,
        duration: 6000,
      });
    } catch (err: any) {
      toast.error("Close failed", { description: err?.message ?? "Unknown error" });
    } finally {
      setClosing(false);
      setShieldWithUmbra(false);
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
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-0.5 cursor-pointer" title="Shield payout with Umbra after close">
            <input
              type="checkbox"
              checked={_shieldWithUmbra}
              onChange={(e) => setShieldWithUmbra(e.target.checked)}
              className="w-3 h-3 rounded border-zinc-700 bg-zinc-900 accent-violet-500"
            />
            <span className="text-[9px] text-zinc-600 font-mono">Umbra</span>
          </label>
          <Button
            variant="ghost"
            size="sm"
            disabled={closing}
            onClick={handleClose}
            className="h-5 px-2 text-[10px] text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
          >
            {closing ? "…" : "Close"}
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function PositionsTable({ showEmpty = true }: { showEmpty?: boolean }) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { positions, selectedMarket, setPositions, bids, asks } = useDarkbookStore();
  const [tab, setTab] = useState<"positions" | "orders">("orders");

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

  const allOrders = [...bids, ...asks];

  return (
    <div className="w-full h-full flex flex-col">
      <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center gap-3">
        <button onClick={() => setTab("orders")} className={cn("text-[10px] uppercase tracking-wider transition-colors", tab === "orders" ? "text-emerald-400" : "text-zinc-500 hover:text-zinc-300")}>Open Orders ({allOrders.length})</button>
        <button onClick={() => setTab("positions")} className={cn("text-[10px] uppercase tracking-wider transition-colors", tab === "positions" ? "text-emerald-400" : "text-zinc-500 hover:text-zinc-300")}>Positions ({positions.length})</button>
      </div>

      {tab === "orders" ? (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-wider">
                <th className="px-3 py-1.5 font-normal">Side</th>
                <th className="px-3 py-1.5 font-normal">Price</th>
                <th className="px-3 py-1.5 font-normal">Size Band</th>
                <th className="px-3 py-1.5 font-normal">Orders</th>
              </tr>
            </thead>
            <tbody>
              {allOrders.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-4 text-center text-xs text-zinc-700 font-mono">No open orders</td></tr>
              ) : (
                allOrders.map((o, i) => (
                  <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-900/50">
                    <td className={cn("px-3 py-1.5 text-xs font-mono", o.side === "Long" ? "text-emerald-400" : "text-rose-400")}>{o.side === "Long" ? "BID" : "ASK"}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-zinc-200 tabular-nums">{fmtPrice(o.price_ticks)}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-zinc-400">{o.size_band}</td>
                    <td className="px-3 py-1.5 text-xs font-mono text-zinc-500">{o.order_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
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
      )}
    </div>
  );
}
