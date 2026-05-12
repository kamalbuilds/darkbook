"use client";

import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { deriveMarketPda, PROGRAM_ID } from "@/lib/darkbook-client";

/** Ika dWallet program ID (Solana devnet pre-alpha). */
const IKA_PROGRAM_ID = new PublicKey("Fg6PaFpoGXkYsidMpWTxq8cQqU5cPqQkz6xcKozxZxHz");

/** DarkBook program ID. */
const DARKBOOK_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "3F99U2rZ2fob5NBgVTqQYqMq8whF4WUqiZXgeaYPE7yf"
);

/** CPI authority PDA for DarkBook → Ika. */
function cpiAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("__ika_cpi_authority")],
    DARKBOOK_PROGRAM_ID,
  );
}

/** DWalletConfig PDA for user + market. */
function dwalletConfigPda(market: PublicKey, owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ika-dwallet"), market.toBuffer(), owner.toBuffer()],
    DARKBOOK_PROGRAM_ID,
  );
}

export function IkaDWalletPanel() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [dwalletAddress, setDwalletAddress] = useState("");
  const [marketId, setMarketId] = useState("SOL");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [result, setResult] = useState<string | null>(null);

  async function handleRegisterDWallet() {
    if (!publicKey || !signTransaction) {
      toast.error("Connect wallet first");
      return;
    }
    if (!dwalletAddress) {
      toast.error("Enter a dWallet address");
      return;
    }
    setStatus("loading");
    try {
      const { getConnection, deriveMarketPda } = await import("@/lib/darkbook-client");
      const conn = getConnection();

      const market = deriveMarketPda(marketId);
      const dwallet = new PublicKey(dwalletAddress);
      const [config] = dwalletConfigPda(market, publicKey);

      // Build register_dwallet instruction via the SDK.
      const { DarkbookClient } = await import("@darkbook/sdk");
      const wallet = {
        publicKey,
        signTransaction: async (tx: any) => {
          const signed = await signTransaction(tx);
          return signed;
        },
        signAllTransactions: async (txs: any[]) => Promise.all(txs.map((t) => signTransaction!(t))),
      };
      const client = new DarkbookClient({
        connection: conn,
        erConnection: conn,
        wallet: wallet as any,
        programId: DARKBOOK_PROGRAM_ID,
      });

      const sig = await client.registerDWallet(dwallet, market);

      setResult(JSON.stringify({
        signature: sig,
        dWallet: dwalletAddress,
        config: config.toBase58(),
        cpiAuthority: cpiAuthorityPda()[0].toBase58(),
      }, null, 2));

      toast.success("dWallet registered", {
        description: `Authority transferred to DarkBook · sig ${sig.slice(0, 8)}…`,
        duration: 8000,
      });
      setStatus("ready");
    } catch (err: any) {
      toast.error("Registration failed", { description: err?.message ?? "Unknown error" });
      setStatus("error");
    }
  }

  const [cpiAuth] = cpiAuthorityPda();
  const configPda = publicKey && dwalletAddress
    ? dwalletConfigPda(
        deriveMarketPda(marketId),
        publicKey
      )[0]
    : null;

  return (
    <div className="flex flex-col gap-4 p-4 bg-zinc-950 min-h-full">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-violet-500/20 flex items-center justify-center">
          <span className="text-violet-400 text-sm font-bold">I</span>
        </div>
        <div>
          <h2 className="text-sm font-mono font-semibold text-zinc-200">Ika dWallet</h2>
          <p className="text-[10px] text-zinc-500">Solana Pre-Alpha — 2PC-MPC signing for cross-chain settlement</p>
        </div>
      </div>

      <div className="bg-zinc-900/40 border border-zinc-800 rounded-sm p-3 space-y-3">
        <h3 className="text-[10px] text-zinc-500 uppercase tracking-wider">
          Register dWallet with DarkBook
        </h3>
        <p className="text-[10px] text-zinc-600">
          First, create a dWallet via the Ika program (CLI or Ika dashboard).
          Then register it here to transfer authority to DarkBook&apos;s CPI authority PDA.
          DarkBook can then approve withdrawal messages signed by the Ika 2PC-MPC network.
        </p>

        <div className="flex flex-col gap-2">
          <Label className="text-[10px] text-zinc-500">Market</Label>
          <div className="flex gap-1">
            {["SOL", "BTC", "ETH"].map((m) => (
              <button
                key={m}
                onClick={() => setMarketId(m)}
                className={cn(
                  "flex-1 py-1.5 text-[10px] font-mono uppercase rounded-sm transition-colors",
                  marketId === m
                    ? "bg-zinc-800 text-zinc-200 border border-zinc-700"
                    : "text-zinc-600 hover:text-zinc-400"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-[10px] text-zinc-500">dWallet Address</Label>
          <Input
            type="text"
            placeholder="Paste Ika dWallet account address..."
            value={dwalletAddress}
            onChange={(e) => setDwalletAddress(e.target.value)}
            className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-xs h-8 placeholder:text-zinc-700"
          />
        </div>

        <Button
          onClick={handleRegisterDWallet}
          disabled={status === "loading" || !connected || !dwalletAddress}
          className="w-full font-mono text-xs h-8 rounded-sm bg-violet-600 hover:bg-violet-500"
        >
          {!connected ? "Connect Wallet" : status === "loading" ? "Registering…" : "Register dWallet"}
        </Button>
      </div>

      {connected && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-3 text-[10px] font-mono space-y-1.5">
          <div className="text-zinc-500 uppercase tracking-wider mb-2">On-Chain Addresses</div>
          <div className="flex justify-between">
            <span className="text-zinc-600">DarkBook CPI Authority</span>
            <span className="text-violet-400">{cpiAuth.toBase58().slice(0, 12)}…</span>
          </div>
          {configPda && (
            <div className="flex justify-between">
              <span className="text-zinc-600">DWalletConfig PDA</span>
              <span className="text-zinc-400">{configPda.toBase58().slice(0, 12)}…</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-zinc-600">Ika Program</span>
            <span className="text-zinc-500">{IKA_PROGRAM_ID.toBase58().slice(0, 12)}…</span>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-sm p-3">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Result</div>
          <pre className="text-[11px] text-zinc-300 font-mono whitespace-pre-wrap break-all">{result}</pre>
        </div>
      )}

      <div className="mt-auto pt-4 border-t border-zinc-800 space-y-2">
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Ika dWallets run on Solana devnet (pre-alpha). Create a dWallet via the{" "}
          <a href="https://solana-pre-alpha.ika.xyz/" target="_blank" rel="noreferrer"
            className="text-violet-400 hover:underline">Ika CLI</a>, then register it here.
          Once registered, DarkBook&apos;s CPI authority controls the dWallet.
        </p>
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          On position close, DarkBook can optionally call <code className="text-zinc-500">approve_dwallet_withdrawal</code> to
          authorize a cross-chain payout. The Ika network detects the MessageApproval PDA and
          produces a 2PC-MPC signature for settlement on Bitcoin, Ethereum, or any supported chain.
        </p>
        <p className="text-[10px] text-amber-500/80 leading-relaxed">
          Pre-alpha: Signing uses a mock signer. Real MPC security will be available at mainnet.
          dWallet Labs (Ika + Encrypt) — same team.
        </p>
      </div>
    </div>
  );
}
