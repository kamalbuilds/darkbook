"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fmtUsdc } from "@/lib/format";
import { toast } from "sonner";

import {
  quoteUsdcSwap,
  executeSwapToUsdc,
  type JupiterQuoteResponse,
} from "@/lib/jupiter";

const TOKEN_OPTIONS = [
  { label: "SOL", mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  { label: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
];

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

export function JupiterDeposit() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [fromToken, setFromToken] = useState(TOKEN_OPTIONS[0]);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<JupiterQuoteResponse | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [swapping, setSwapping] = useState(false);

  const fromMint = new PublicKey(fromToken.mint);
  const amountNum = parseFloat(amount) || 0;
  const amountLamports = Math.floor(amountNum * 10 ** fromToken.decimals);

  const fetchQuote = useCallback(async () => {
    if (amountLamports <= 0 || fromToken.label === "USDC") {
      setQuote(null);
      return;
    }
    setLoadingQuote(true);
    try {
      const q = await quoteUsdcSwap(connection, fromMint, USDC_MINT, amountLamports);
      setQuote(q);
    } catch {
      setQuote(null);
    } finally {
      setLoadingQuote(false);
    }
  }, [connection, fromMint, amountLamports, fromToken.label]);

  useEffect(() => {
    const t = setTimeout(fetchQuote, 400);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  const outAmount =
    quote && typeof quote.outAmount === "string"
      ? Number(quote.outAmount) / 1e6
      : quote && typeof quote.outputAmount === "string"
        ? Number(quote.outputAmount) / 1e6
        : null;

  async function handleSwap() {
    if (!publicKey || !signTransaction) {
      toast.error("Connect wallet first");
      return;
    }
    if (amountLamports <= 0) {
      toast.error("Enter an amount");
      return;
    }
    setSwapping(true);
    try {
      const sig = await executeSwapToUsdc(
        connection,
        { publicKey, signTransaction } as any,
        fromMint,
        USDC_MINT,
        amountLamports,
      );
      toast.success("Swap confirmed", {
        description: `${amount} ${fromToken.label} → USDC · ${sig.slice(0, 8)}…`,
        duration: 6000,
      });
      setAmount("");
      setQuote(null);
    } catch (err: any) {
      toast.error("Swap failed", { description: err?.message ?? "Unknown error" });
    } finally {
      setSwapping(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3 bg-zinc-950 border-b border-zinc-800">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
        Jupiter Deposit
      </div>

      {/* Token selector */}
      <div className="grid grid-cols-2 gap-1">
        {TOKEN_OPTIONS.map((t) => (
          <button
            key={t.mint}
            type="button"
            onClick={() => {
              setFromToken(t);
              setAmount("");
              setQuote(null);
            }}
            className={cn(
              "py-1 text-[10px] font-mono uppercase rounded-sm transition-colors",
              fromToken.mint === t.mint
                ? "bg-zinc-800 text-zinc-200 border border-zinc-700"
                : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-zinc-500 uppercase tracking-wider">
          Amount ({fromToken.label})
        </Label>
        <Input
          type="number"
          step="any"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-sm h-8 placeholder:text-zinc-700"
        />
      </div>

      {/* Quote display */}
      {fromToken.label !== "USDC" && amountNum > 0 && (
        <div className="bg-zinc-900/50 rounded-sm px-2 py-1.5 flex justify-between text-[10px] font-mono">
          <span className="text-zinc-500">
            {loadingQuote ? "Fetching quote…" : "You receive"}
          </span>
          <span className="text-zinc-300">
            {outAmount != null ? fmtUsdc(outAmount, 2) : "—"}
          </span>
        </div>
      )}

      {/* Swap button */}
      {fromToken.label !== "USDC" && (
        <Button
          type="button"
          disabled={swapping || !connected || amountLamports <= 0}
          onClick={handleSwap}
          className="w-full font-mono text-xs font-semibold h-8 rounded-sm bg-emerald-600 hover:bg-emerald-500 text-zinc-100"
        >
          {!connected
            ? "Connect Wallet"
            : swapping
              ? "Swapping…"
              : `Swap ${fromToken.label} → USDC`}
        </Button>
      )}

      {/* Direct USDC note */}
      {fromToken.label === "USDC" && (
        <p className="text-[10px] text-zinc-600 font-mono">
          USDC selected — use the Order Entry panel to deposit collateral via the on-chain deposit instruction.
        </p>
      )}
    </div>
  );
}
