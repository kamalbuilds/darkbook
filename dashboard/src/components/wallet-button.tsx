"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useConnection } from "@solana/wallet-adapter-react";
import { shortenAddress } from "@/lib/format";
import { resolveSnsNameCached } from "@/lib/sns";
import { useDarkbookStore } from "@/store/darkbook-store";
import { Button } from "@/components/ui/button";
import { Wallet, LogOut } from "lucide-react";

export function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const { snsCache, setSnsCache } = useDarkbookStore();
  const [snsName, setSnsName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!publicKey || !connection) {
      setSnsName(null);
      return;
    }

    const pubkeyStr = publicKey.toBase58();

    // Check cache first
    const cached = snsCache.get(pubkeyStr);
    if (cached && Date.now() < cached.expiresAt) {
      setSnsName(cached.name);
      return;
    }

    // Resolve SNS name
    setResolving(true);
    resolveSnsNameCached(connection, publicKey)
      .then((name) => {
        setSnsName(name);
        setSnsCache(pubkeyStr, name, Date.now() + 5 * 60 * 1000); // 5 min TTL
      })
      .catch(() => {
        setSnsName(null);
      })
      .finally(() => setResolving(false));
  }, [publicKey, connection, snsCache, setSnsCache]);

  if (connecting) {
    return (
      <Button variant="outline" size="sm" disabled className="font-mono text-xs">
        Connecting…
      </Button>
    );
  }

  if (publicKey) {
    const displayName = snsName || shortenAddress(publicKey.toBase58());
    const displayClass = snsName ? "text-emerald-400" : "text-zinc-400";

    return (
      <div className="flex items-center gap-2">
        <span className={`font-mono text-xs ${displayClass} ${resolving ? "opacity-60" : ""}`}>
          {resolving && !snsName ? "Resolving…" : displayName}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => disconnect()}
          className="text-zinc-500 hover:text-rose-400 h-7 px-2"
        >
          <LogOut className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      onClick={() => setVisible(true)}
      className="font-mono text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
    >
      <Wallet className="h-3 w-3 mr-1.5" />
      Connect Wallet
    </Button>
  );
}
