"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Droplets, Loader2 } from "lucide-react";

const FAUCET_URL =
  process.env.NEXT_PUBLIC_FAUCET_URL ?? "http://localhost:8083";

// Only show on devnet — hidden in prod where NEXT_PUBLIC_IS_DEVNET is not "true"
const IS_DEVNET = process.env.NEXT_PUBLIC_IS_DEVNET === "true";

export function FaucetButton() {
  const { publicKey } = useWallet();
  const [loading, setLoading] = useState(false);

  // Hidden in production builds
  if (!IS_DEVNET) return null;

  async function handleFaucet() {
    if (!publicKey) {
      toast.error("Connect your wallet first");
      return;
    }

    setLoading(true);
    const toastId = toast.loading("Requesting devnet funds…");

    try {
      const res = await fetch(`${FAUCET_URL}/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        retryAfterSeconds?: number;
        message?: string;
      };

      if (res.status === 429) {
        const wait = data.retryAfterSeconds ?? 300;
        const mins = Math.ceil(wait / 60);
        toast.warning(`Rate limited. Try again in ${mins} min.`, { id: toastId });
        return;
      }

      if (!res.ok || !data.success) {
        toast.error(data.error ?? "Faucet request failed", { id: toastId });
        return;
      }

      toast.success("1000 USDC + 1 SOL airdropped — refresh in a few seconds", {
        id: toastId,
        duration: 6000,
      });
    } catch (err) {
      toast.error("Could not reach faucet service. Is it running?", { id: toastId });
      console.error("Faucet error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleFaucet}
      disabled={loading || !publicKey}
      className="font-mono text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 h-7 px-2.5"
      title="Get 1000 test USDC + 1 SOL (devnet)"
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
      ) : (
        <Droplets className="h-3 w-3 mr-1.5" />
      )}
      {loading ? "Sending…" : "Get test USDC"}
    </Button>
  );
}
