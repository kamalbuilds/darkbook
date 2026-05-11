"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  clearBirdeyeProofLog,
  downloadBirdeyeProofFile,
  exportBirdeyeProofJson,
  getBirdeyeProofCount,
  getBirdeyeProofLog,
  summarizeBirdeyeProofByPath,
  type BirdeyeProofEntry,
} from "@/lib/birdeye-proof-log";
import { runBirdeyeQualificationBatch } from "@/lib/birdeye";

export default function BirdeyeProofPage() {
  const [rows, setRows] = useState<BirdeyeProofEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [lastBatch, setLastBatch] = useState<{ added: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setRows(getBirdeyeProofLog().slice(-80));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const count = getBirdeyeProofCount();

  const runBatch = async () => {
    setError(null);
    setRunning(true);
    setLastBatch(null);
    try {
      const result = await runBirdeyeQualificationBatch({ targetCalls: 66, delayMs: 400 });
      setLastBatch(result);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const byPath = summarizeBirdeyeProofByPath();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 px-4 py-8 max-w-4xl mx-auto font-mono text-sm">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-lg font-bold text-zinc-100 tracking-tight">Birdeye API proof log</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-xl">
            Every HTTP call to <span className="text-zinc-400">public-api.birdeye.so</span> from this
            browser session is recorded (path, status, timing). Use for sponsor qualification and
            attach the JSON export when you contact the Birdeye team.
          </p>
        </div>
        <Link
          href="/trade"
          className="text-xs text-emerald-500/90 hover:text-emerald-400 shrink-0 border border-zinc-800 rounded px-3 py-1.5"
        >
          Back to Trade
        </Link>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-zinc-400">
            Total calls this session: <span className="text-zinc-100 tabular-nums">{count}</span>
          </span>
          {lastBatch && (
            <span className="text-zinc-500 text-xs">
              Last batch: +{lastBatch.added} (session total {lastBatch.total})
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={running}
            onClick={runBatch}
            className="rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-zinc-950 text-xs font-semibold px-4 py-2"
          >
            {running ? "Running batch…" : "Run ~66 API calls (batch)"}
          </button>
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-zinc-700 text-xs px-3 py-2 text-zinc-300 hover:bg-zinc-800"
          >
            Refresh table
          </button>
          <button
            type="button"
            onClick={() => {
              downloadBirdeyeProofFile(`birdeye-proof-${new Date().toISOString().slice(0, 10)}.json`);
            }}
            className="rounded border border-zinc-700 text-xs px-3 py-2 text-zinc-300 hover:bg-zinc-800"
          >
            Download JSON
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                void navigator.clipboard.writeText(exportBirdeyeProofJson());
              }
            }}
            className="rounded border border-zinc-700 text-xs px-3 py-2 text-zinc-300 hover:bg-zinc-800"
          >
            Copy JSON
          </button>
          <button
            type="button"
            onClick={() => {
              clearBirdeyeProofLog();
              setRows([]);
              setLastBatch(null);
            }}
            className="rounded border border-rose-900/50 text-xs px-3 py-2 text-rose-300 hover:bg-rose-950/40"
          >
            Clear log
          </button>
        </div>
        <p className="text-[11px] text-zinc-600 leading-relaxed">
          Set <code className="text-zinc-400">NEXT_PUBLIC_BIRDEYE_API_KEY</code> in{" "}
          <code className="text-zinc-400">.env.local</code> before running the batch. Optional{" "}
          <code className="text-zinc-400">NEXT_PUBLIC_BIRDEYE_PROOF_MODE=1</code> shortens chart and
          overview cache on the Trade page so browsing also racks up calls faster.
        </p>
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3 mb-4">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">By endpoint</div>
        <ul className="text-xs text-zinc-400 space-y-1">
          {Object.entries(byPath).map(([path, n]) => (
            <li key={path}>
              <span className="text-zinc-300">{path}</span> <span className="text-zinc-600">×</span>{" "}
              {n}
            </li>
          ))}
          {Object.keys(byPath).length === 0 && <li className="text-zinc-600">No calls yet.</li>}
        </ul>
      </div>

      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-[2.5rem_1fr_4rem_4rem_1fr] gap-2 px-3 py-2 bg-zinc-900 text-[10px] uppercase text-zinc-500 border-b border-zinc-800">
          <span>#</span>
          <span>Time</span>
          <span>HTTP</span>
          <span>ms</span>
          <span>Path</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto divide-y divide-zinc-800/80">
          {[...rows].reverse().map((e) => (
            <div
              key={e.seq}
              className="grid grid-cols-[2.5rem_1fr_4rem_4rem_1fr] gap-2 px-3 py-1.5 text-[11px] text-zinc-400 items-start"
            >
              <span className="text-zinc-600">{e.seq}</span>
              <span className="truncate text-zinc-500">{e.iso}</span>
              <span className={e.httpStatus >= 400 ? "text-rose-400" : "text-emerald-400/90"}>
                {e.httpStatus}
              </span>
              <span>{e.durationMs}</span>
              <span className="truncate text-zinc-300" title={e.queryPreview}>
                {e.path}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
