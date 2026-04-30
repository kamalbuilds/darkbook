"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useDarkbookStore } from "@/store/darkbook-store";
import {
  generateCommitment,
  deriveMarketPda,
  PROGRAM_ID,
  buildPlaceOrderTx,
} from "@/lib/darkbook-client";
import { fmtUsdc } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Side } from "@/lib/darkbook-types";

const LEVERAGE_STEPS = [1, 2, 3, 5, 10, 15, 20];

export function OrderEntry() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const { markPrice, selectedMarket } = useDarkbookStore();

  const [side, setSide] = useState<Side>("Long");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [orderType, setOrderType] = useState<"Limit" | "Market">("Limit");
  const [submitting, setSubmitting] = useState(false);

  const priceNum = parseFloat(price) || (orderType === "Market" ? markPrice ?? 0 : 0);
  const sizeNum = parseFloat(size) || 0;
  const notional = priceNum * sizeNum;
  const requiredCollateral = notional / leverage;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!connected || !publicKey) {
      toast.error("Connect wallet first");
      return;
    }
    if (sizeNum <= 0) {
      toast.error("Enter a valid size");
      return;
    }
    if (orderType === "Limit" && priceNum <= 0) {
      toast.error("Enter a valid limit price");
      return;
    }

    setSubmitting(true);
    try {
      const sizeLots = Math.round(sizeNum);
      const leverageBps = leverage * 100;

      // Generate commitment for privacy
      const { commitment, salt } = await generateCommitment(sizeLots, leverageBps, publicKey);

      // Convert price to ticks (micro-USDC per lot: price * 1_000_000)
      const priceTicks = Math.round(priceNum * 1_000_000);

      // Determine size band
      const sizeBand =
        sizeLots <= 10 ? "Small" : sizeLots <= 100 ? "Medium" : sizeLots <= 1000 ? "Large" : "Whale";

      if (PROGRAM_ID.equals(PublicKey.default)) {
        throw new Error(
          "PROGRAM_ID env var not set. Run scripts/deploy-devnet.sh and set NEXT_PUBLIC_PROGRAM_ID before placing orders.",
        );
      }
      if (!signTransaction) {
        throw new Error("Wallet does not support signTransaction");
      }

      const market = deriveMarketPda(selectedMarket);
      const { tx, blockhash } = await buildPlaceOrderTx({
        connection,
        trader: publicKey,
        market,
        side,
        priceTicks: BigInt(priceTicks),
        sizeBand,
        leverageBps,
        commitment,
      });

      const signed = await signTransaction(tx as Transaction);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(
        { signature: sig, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
        "confirmed",
      );

      // Persist plaintext payload for later reveal at claim_fill / cancel_order time.
      // The salt cannot be recovered onchain — without it the order can never be cancelled
      // or settled. Store keyed by trader+commitment so multi-tab sessions don't collide.
      try {
        const key = `darkbook:order:${publicKey.toBase58()}:${Buffer.from(commitment).toString("hex")}`;
        const payload = {
          sizeLots,
          leverageBps,
          salt: Buffer.from(salt).toString("hex"),
          priceTicks: priceTicks.toString(),
          side,
          sizeBand,
          createdAt: Date.now(),
        };
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch {
        // localStorage may be disabled; log so trader knows to record salt manually
        console.warn("[darkbook] localStorage write failed — record salt manually:", Buffer.from(salt).toString("hex"));
      }

      toast.success("Order placed", {
        description: `${side} ${size} lots @ ${orderType === "Market" ? "market" : fmtUsdc(priceNum, 4)} · ${leverage}x · sig ${sig.slice(0, 8)}…`,
        duration: 6000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Order failed", { description: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 p-3 gap-3">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Order Entry</div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* Side toggle */}
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setSide("Long")}
            className={cn(
              "py-1.5 text-xs font-mono font-semibold rounded-sm transition-colors",
              side === "Long"
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
            )}
          >
            Long
          </button>
          <button
            type="button"
            onClick={() => setSide("Short")}
            className={cn(
              "py-1.5 text-xs font-mono font-semibold rounded-sm transition-colors",
              side === "Short"
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
            )}
          >
            Short
          </button>
        </div>

        {/* Order type */}
        <div className="grid grid-cols-2 gap-1">
          {(["Limit", "Market"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOrderType(t)}
              className={cn(
                "py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors",
                orderType === t
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-600 hover:text-zinc-400"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Price */}
        {orderType === "Limit" && (
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Price (USDC)
            </Label>
            <Input
              type="number"
              step="0.0001"
              min="0"
              placeholder={markPrice != null ? fmtUsdc(markPrice, 4) : "0.0000"}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-sm h-8 placeholder:text-zinc-700"
            />
          </div>
        )}

        {/* Size */}
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Size (lots)
          </Label>
          <Input
            type="number"
            step="1"
            min="1"
            placeholder="0"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-sm h-8 placeholder:text-zinc-700"
          />
        </div>

        {/* Leverage slider */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <Label className="text-[10px] text-zinc-500 uppercase tracking-wider">Leverage</Label>
            <span className="font-mono text-xs text-zinc-200">{leverage}x</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-emerald-400"
          />
          <div className="flex justify-between">
            {LEVERAGE_STEPS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLeverage(l)}
                className={cn(
                  "text-[9px] font-mono px-1 py-0.5 rounded-sm transition-colors",
                  leverage === l
                    ? "text-emerald-400 bg-emerald-500/10"
                    : "text-zinc-600 hover:text-zinc-400"
                )}
              >
                {l}x
              </button>
            ))}
          </div>
        </div>

        {/* Order summary */}
        {sizeNum > 0 && priceNum > 0 && (
          <div className="bg-zinc-900/50 rounded-sm px-2 py-2 flex flex-col gap-1">
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-zinc-500">Notional</span>
              <span className="text-zinc-300">{fmtUsdc(notional, 2)}</span>
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-zinc-500">Required Margin</span>
              <span className="text-zinc-300">{fmtUsdc(requiredCollateral, 2)}</span>
            </div>
          </div>
        )}

        {/* Submit */}
        <Button
          type="submit"
          disabled={submitting || !connected}
          className={cn(
            "w-full font-mono text-xs font-semibold h-9 rounded-sm mt-1",
            side === "Long"
              ? "bg-emerald-500 hover:bg-emerald-400 text-zinc-950"
              : "bg-rose-500 hover:bg-rose-400 text-zinc-950"
          )}
        >
          {!connected
            ? "Connect Wallet"
            : submitting
            ? "Submitting…"
            : `Place ${side} Order`}
        </Button>
      </form>
    </div>
  );
}
