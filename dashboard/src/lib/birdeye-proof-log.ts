/**
 * Append-only log of real Birdeye HTTP calls (for hackathon / sponsor qualification proof).
 * Does not store API keys or full response bodies.
 */

export type BirdeyeProofEntry = {
  seq: number;
  iso: string;
  path: string;
  httpStatus: number;
  durationMs: number;
  /** Truncated query string for identification */
  queryPreview: string;
};

let seq = 0;
const entries: BirdeyeProofEntry[] = [];
const MAX_ENTRIES = 500;

export function appendBirdeyeHttpProof(input: {
  path: string;
  httpStatus: number;
  durationMs: number;
  queryPreview: string;
}): void {
  if (typeof window === "undefined") return;
  seq += 1;
  entries.push({
    seq,
    iso: new Date().toISOString(),
    path: input.path,
    httpStatus: input.httpStatus,
    durationMs: input.durationMs,
    queryPreview: input.queryPreview,
  });
  while (entries.length > MAX_ENTRIES) entries.shift();
}

export function getBirdeyeProofLog(): BirdeyeProofEntry[] {
  return [...entries];
}

export function getBirdeyeProofCount(): number {
  return entries.length;
}

export function clearBirdeyeProofLog(): void {
  entries.length = 0;
  seq = 0;
}

export function summarizeBirdeyeProofByPath(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    out[e.path] = (out[e.path] ?? 0) + 1;
  }
  return out;
}

/** JSON you can attach when emailing Birdeye (no secrets). */
export function exportBirdeyeProofJson(): string {
  return JSON.stringify(
    {
      project: "darkbook-dashboard",
      generatedAt: new Date().toISOString(),
      totalHttpCalls: entries.length,
      byPath: summarizeBirdeyeProofByPath(),
      entries,
    },
    null,
    2,
  );
}

export function downloadBirdeyeProofFile(filename = "birdeye-api-proof.json"): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([exportBirdeyeProofJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
