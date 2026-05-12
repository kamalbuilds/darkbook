"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useDarkbookStore } from "@/store/darkbook-store";
import { fmtPrice, sizeBandGlyph, shortenAddress } from "@/lib/format";
import { resolveSnsNameCached } from "@/lib/sns";
import { cn } from "@/lib/utils";

function FillRow({ fillId, takerPubkey, price, band, slot, connection }: any) {
  const { snsCache, setSnsCache } = useDarkbookStore();
  const [snsName, setSnsName] = useState<string | null>(null);

  useEffect(() => {
    if (!connection || !takerPubkey) return;

    const cached = snsCache.get(takerPubkey);
    if (cached && Date.now() < cached.expiresAt) {
      setSnsName(cached.name);
      return;
    }

    const owner = new PublicKey(takerPubkey);
    resolveSnsNameCached(connection, owner)
      .then((name) => {
        setSnsName(name);
        setSnsCache(takerPubkey, name, Date.now() + 5 * 60 * 1000);
      })
      .catch(() => {
        setSnsName(null);
      });
  }, [takerPubkey, connection, snsCache, setSnsCache]);

  const displayName = snsName || shortenAddress(takerPubkey);

  return (
    <div
      key={fillId}
      className="flex items-center justify-between px-2 py-0.5 hover:bg-zinc-800/30 font-mono text-xs"
      title={takerPubkey}
    >
      <span className="w-24 tabular-nums text-emerald-400">
        {fmtPrice(price)}
      </span>
      <span className="w-8 text-center text-zinc-400">
        {sizeBandGlyph(band)}
      </span>
      <span className={snsName ? "text-emerald-400" : "text-zinc-600"}>
        {displayName}
      </span>
    </div>
  );
}

export function RecentFills() {
  const { fills, selectedMarket, setFills } = useDarkbookStore();
  const { connection } = useConnection();

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      try {
        const { fetchRecentFills, deriveMarketPda } = await import("@/lib/darkbook-client");
        const marketPda = deriveMarketPda(selectedMarket);
        const fetched = await fetchRecentFills(marketPda);
        if (!cancelled && fetched.length > 0) setFills(fetched);
      } catch {}
      if (!cancelled) setTimeout(poll, 3000);
    }
    poll();
    return () => { cancelled = true; };
  }, [selectedMarket, setFills]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 border-b border-zinc-800">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Recent Fills</span>
      </div>

      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-zinc-600 uppercase tracking-wider border-b border-zinc-900">
        <span className="w-24">Price</span>
        <span className="w-8 text-center">Band</span>
        <span>Taker</span>
      </div>

      {fills.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-zinc-700 text-xs font-mono">Loading from chain…</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {fills.map((fill) => (
            <FillRow
              key={fill.fill_id}
              fillId={fill.fill_id}
              takerPubkey={fill.taker}
              price={fill.price_ticks}
              band={fill.size_band}
              slot={fill.matched_slot}
              connection={connection}
            />
          ))}
        </div>
      )}
    </div>
  );
}
