/**
 * Birdeye Chart Data Integration
 * Real OHLCV candle data from Birdeye public API
 *
 * Endpoint: https://public-api.birdeye.so/defi/ohlcv/pair
 * No authentication required for public tier
 */

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Fetch historical OHLCV candles from Birdeye
 * Calls real Birdeye public API for SOL/USDC pair
 *
 * @param pairAddress The token pair address (e.g., JUP address for SOL/USDC)
 * @param interval Candle interval: "1m", "15m", "1h"
 * @param limit Number of candles to fetch (default 100, max 1000)
 * @returns Array of OHLCV candles sorted by time ascending
 */
export async function fetchHistoricalPrice(
  pairAddress: string,
  interval: "1m" | "15m" | "1h" = "1m",
  limit: number = 100,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    address: pairAddress,
    type: interval,
    limit: Math.min(limit, 1000).toString(),
  });

  const apiKey = typeof window !== "undefined" ? process.env.NEXT_PUBLIC_BIRDEYE_API_KEY : undefined;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (apiKey) {
    headers["X-API-KEY"] = apiKey;
  }

  const url = `https://public-api.birdeye.so/defi/ohlcv/pair?${params}`;

  try {
    console.log("[birdeye] fetching candles", { pairAddress, interval, limit });

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn("[birdeye] pair not found", { pairAddress });
        return [];
      }
      throw new Error(`Birdeye API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      success: boolean;
      data?: {
        items: Array<{
          time: number;
          o: number;
          h: number;
          l: number;
          c: number;
          v?: number;
        }>;
      };
    };

    if (!data.success || !data.data?.items) {
      console.warn("[birdeye] empty response", { pairAddress });
      return [];
    }

    // Transform Birdeye format (o, h, l, c, v) to our Candle format
    const candles: Candle[] = data.data.items.map((item) => ({
      time: item.time,
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.v,
    }));

    console.log("[birdeye] received candles", { count: candles.length, latest: candles[candles.length - 1]?.close });

    return candles;
  } catch (error) {
    console.error("[birdeye] fetch failed", { pairAddress, error });
    // Return empty array on error instead of throwing
    // Caller should fall back to alternative data source (e.g., Pyth)
    return [];
  }
}

/**
 * Helper: Get latest price from Birdeye candles
 * Returns the close price of the most recent candle
 */
export function getLatestPrice(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  return candles[candles.length - 1].close;
}

/**
 * Helper: Calculate simple moving average from candles
 */
export function calculateSMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const sum = candles.slice(-period).reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}
