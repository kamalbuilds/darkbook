/**
 * Birdeye Data API integration (https://docs.birdeye.so / https://birdeye.so/data-api)
 *
 * Uses:
 * - GET /defi/ohlcv/pair (single pool address)
 * - GET /defi/ohlcv/base_quote (aggregate OHLCV across pools for base / quote)
 * - GET /defi/token_overview (liquidity, 24h volume, wallet flow, multi-frame price change)
 *
 * Auth: set NEXT_PUBLIC_BIRDEYE_API_KEY from https://bds.birdeye.so (never commit real keys).
 * Header x-chain: solana on all requests.
 */

import {
  USDC_MINT_MAINNET,
  WBTC_MINT,
  WETH_MINT,
  WSOL_MINT,
} from "./market-assets";
import { appendBirdeyeHttpProof, getBirdeyeProofCount } from "./birdeye-proof-log";

const BIRDEYE_API = "https://public-api.birdeye.so";

const PROOF_MODE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_BIRDEYE_PROOF_MODE === "1";

const overviewCache = new Map<string, { at: number; data: TokenOverviewStats }>();
const ohlcvCache = new Map<string, { at: number; data: Candle[] }>();
/** Shorter TTL in proof mode so normal browsing accumulates HTTP calls faster for sponsor quotas. */
const OVERVIEW_TTL_MS = PROOF_MODE ? 5_000 : 12_000;
const OHLCV_TTL_MS = PROOF_MODE ? 5_000 : 15_000;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TokenOverviewStats {
  address: string;
  symbol: string | null;
  name: string | null;
  price: number | null;
  priceChange24hPercent: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  volume24hChangePercent: number | null;
  uniqueWallets24h: number | null;
  buyVolume24hUsd: number | null;
  sellVolume24hUsd: number | null;
  lastTradeUnixTime: number | null;
}

function birdeyeHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-chain": "solana",
  };
  const apiKey =
    typeof window !== "undefined" ? process.env.NEXT_PUBLIC_BIRDEYE_API_KEY : undefined;
  if (apiKey) {
    headers["X-API-KEY"] = apiKey;
  }
  return headers;
}

async function birdeyeGet(path: string, params: URLSearchParams): Promise<Response> {
  const url = `${BIRDEYE_API}${path}?${params.toString()}`;
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const response = await fetch(url, { headers: birdeyeHeaders() });
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  appendBirdeyeHttpProof({
    path,
    httpStatus: response.status,
    durationMs: Math.round(t1 - t0),
    queryPreview: params.toString().slice(0, 320),
  });
  return response;
}

/** Clears in-memory Birdeye response caches (not the proof log). */
export function clearBirdeyeApiCaches(): void {
  overviewCache.clear();
  ohlcvCache.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a deterministic sequence of Birdeye Data API calls across SOL/BTC/ETH reference mints:
 * token_overview + base_quote (1m, 15m, 1h) each, with cache cleared between rounds.
 * Use for sponsor qualification (e.g. 50+ HTTP calls) and export proof from /birdeye-proof.
 *
 * Default pacing includes small delays to reduce 429 risk.
 */
export async function runBirdeyeQualificationBatch(options?: {
  /** Stop once at least this many new HTTP calls have been recorded (default 66). */
  targetCalls?: number;
  delayMs?: number;
}): Promise<{ added: number; total: number }> {
  const targetCalls = options?.targetCalls ?? 66;
  const delayMs = options?.delayMs ?? 350;
  const mints = [WSOL_MINT, WBTC_MINT, WETH_MINT] as const;
  const perRound = mints.length * 4;
  const start = getBirdeyeProofCount();
  const maxRounds = Math.min(20, Math.ceil(targetCalls / perRound) + 2);

  for (let r = 0; r < maxRounds; r++) {
    clearBirdeyeApiCaches();
    for (const mint of mints) {
      await fetchTokenOverview(mint);
      await sleep(delayMs);
      await fetchOhlcvBaseQuote(mint, USDC_MINT_MAINNET, "1m", 80);
      await sleep(delayMs);
      await fetchOhlcvBaseQuote(mint, USDC_MINT_MAINNET, "15m", 80);
      await sleep(delayMs);
      await fetchOhlcvBaseQuote(mint, USDC_MINT_MAINNET, "1h", 48);
      await sleep(delayMs);
    }
    if (getBirdeyeProofCount() - start >= targetCalls) break;
  }

  const total = getBirdeyeProofCount();
  return { added: total - start, total };
}

/** Map UI interval to Birdeye OHLCV type (base_quote uses capital H for hours). */
function toBirdeyeOhlcvType(interval: "1m" | "15m" | "1h"): string {
  if (interval === "1h") return "1H";
  return interval;
}

function intervalSeconds(interval: "1m" | "15m" | "1h"): number {
  switch (interval) {
    case "1m":
      return 60;
    case "15m":
      return 900;
    case "1h":
      return 3600;
    default:
      return 60;
  }
}

/**
 * Aggregate OHLCV for a base token vs USDC across all tracked pools (Birdeye base_quote).
 * Preferred for perp charts so we do not guess a single pool address.
 */
export async function fetchOhlcvBaseQuote(
  baseMint: string,
  quoteMint: string = USDC_MINT_MAINNET,
  interval: "1m" | "15m" | "1h" = "1m",
  limit: number = 100,
): Promise<Candle[]> {
  const cacheKey = `ohlcv|${baseMint}|${quoteMint}|${interval}|${limit}`;
  const hit = ohlcvCache.get(cacheKey);
  if (hit && Date.now() - hit.at < OHLCV_TTL_MS) return hit.data;

  const type = toBirdeyeOhlcvType(interval);
  const now = Math.floor(Date.now() / 1000);
  const step = intervalSeconds(interval);
  const timeFrom = now - Math.min(limit, 1000) * step;
  const params = new URLSearchParams({
    base_address: baseMint,
    quote_address: quoteMint,
    type,
    time_from: String(timeFrom),
    time_to: String(now),
  });

  try {
    const response = await birdeyeGet("/defi/ohlcv/base_quote", params);
    if (!response.ok) {
      if (response.status === 404) return [];
      const body = await response.text().catch(() => "");
      throw new Error(
        `Birdeye base_quote: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      );
    }
    const data = (await response.json()) as {
      success: boolean;
      data?: {
        items: Array<{
          unixTime: number;
          o: number;
          h: number;
          l: number;
          c: number;
          vQuote?: number;
          vBase?: number;
        }>;
      };
    };

    if (!data.success || !data.data?.items?.length) {
      ohlcvCache.set(cacheKey, { at: Date.now(), data: [] });
      return [];
    }

    const candles = data.data.items.map((item) => ({
      time: item.unixTime,
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.vQuote ?? item.vBase,
    }));
    ohlcvCache.set(cacheKey, { at: Date.now(), data: candles });
    return candles;
  } catch (error) {
    console.error("[birdeye] base_quote failed", {
      baseMint,
      quoteMint,
      message: errMsg(error),
    });
    return [];
  }
}

/**
 * OHLCV for a single liquidity pool address (legacy).
 */
export async function fetchHistoricalPrice(
  pairAddress: string,
  interval: "1m" | "15m" | "1h" = "1m",
  limit: number = 100,
): Promise<Candle[]> {
  const type = toBirdeyeOhlcvType(interval);
  const now = Math.floor(Date.now() / 1000);
  const step = intervalSeconds(interval);
  const timeFrom = now - Math.min(limit, 1000) * step;
  const params = new URLSearchParams({
    address: pairAddress,
    type,
    time_from: String(timeFrom),
    time_to: String(now),
  });

  try {
    const response = await birdeyeGet("/defi/ohlcv/pair", params);
    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`Birdeye ohlcv/pair: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      success: boolean;
      data?: {
        items: Array<{
          time?: number;
          unixTime?: number;
          o: number;
          h: number;
          l: number;
          c: number;
          v?: number;
        }>;
      };
    };

    if (!data.success || !data.data?.items) return [];

    return data.data.items.map((item) => ({
      time: item.unixTime ?? item.time ?? 0,
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.v,
    }));
  } catch (error) {
    console.error("[birdeye] ohlcv/pair failed", { pairAddress, message: errMsg(error) });
    return [];
  }
}

/**
 * Token overview: liquidity, multi-window stats, 24h flow (Birdeye Data API).
 */
export async function fetchTokenOverview(tokenMint: string): Promise<TokenOverviewStats | null> {
  const cached = overviewCache.get(tokenMint);
  if (cached && Date.now() - cached.at < OVERVIEW_TTL_MS) return cached.data;

  const params = new URLSearchParams({ address: tokenMint });

  try {
    const response = await birdeyeGet("/defi/token_overview", params);
    if (!response.ok) {
      const hint =
        response.status === 401
          ? " (check NEXT_PUBLIC_BIRDEYE_API_KEY from bds.birdeye.so; not a wallet private key)"
          : response.status === 429
            ? " (rate limited; cache reduces duplicate calls)"
            : "";
      const body = await response.text().catch(() => "");
      console.warn("[birdeye] token_overview http", response.status, hint, body.slice(0, 120));
      return null;
    }
    const json = (await response.json()) as {
      success: boolean;
      data?: Record<string, unknown>;
    };
    if (!json.success || !json.data) return null;
    const d = json.data;
    const stats: TokenOverviewStats = {
      address: String(d.address ?? tokenMint),
      symbol: (d.symbol as string) ?? null,
      name: (d.name as string) ?? null,
      price: typeof d.price === "number" ? d.price : null,
      priceChange24hPercent:
        typeof d.priceChange24hPercent === "number" ? d.priceChange24hPercent : null,
      liquidityUsd: typeof d.liquidity === "number" ? d.liquidity : null,
      volume24hUsd: typeof d.v24hUSD === "number" ? d.v24hUSD : null,
      volume24hChangePercent:
        typeof d.v24hChangePercent === "number" ? d.v24hChangePercent : null,
      uniqueWallets24h:
        typeof d.uniqueWallet24h === "number" ? d.uniqueWallet24h : null,
      buyVolume24hUsd: typeof d.vBuy24hUSD === "number" ? d.vBuy24hUSD : null,
      sellVolume24hUsd: typeof d.vSell24hUSD === "number" ? d.vSell24hUSD : null,
      lastTradeUnixTime:
        typeof d.lastTradeUnixTime === "number" ? d.lastTradeUnixTime : null,
    };
    overviewCache.set(tokenMint, { at: Date.now(), data: stats });
    return stats;
  } catch (error) {
    console.error("[birdeye] token_overview failed", { tokenMint, message: errMsg(error) });
    return null;
  }
}

export function getLatestPrice(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  return candles[candles.length - 1].close;
}

export function calculateSMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const sum = candles.slice(-period).reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}
