/**
 * Pyth price feed helpers for DarkBook services.
 *
 * fetchPythPrice    — REST pull via Hermes; returns updateData bytes for on-chain ix.
 * PythLazerStream   — WebSocket subscriber for real-time sub-ms Lazer prices.
 *
 * Pyth Lazer provides sub-millisecond signed oracle data via WebSocket.
 * Docs: https://docs.pyth.network/lazer/getting-started
 * SDK: https://www.npmjs.com/package/@pythnetwork/pyth-lazer-sdk
 */

import { EventEmitter } from "events";
import WebSocket from "ws";

export const HERMES_MAINNET = "https://hermes.pyth.network";
export const HERMES_DEVNET = "https://hermes.pyth.network"; // same endpoint, testnet feed IDs differ

// Pyth Lazer WebSocket endpoints (redundant for reliability)
export const PYTH_LAZER_WS_ENDPOINTS = [
  "wss://pyth-lazer-0.dourolabs.app/v1/stream",
  "wss://pyth-lazer-1.dourolabs.app/v1/stream",
  "wss://pyth-lazer-2.dourolabs.app/v1/stream",
];

// SOL/USD devnet feed ID (hex without 0x prefix)
export const SOL_USD_FEED_ID =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

// BTC/USD devnet feed ID
export const BTC_USD_FEED_ID =
  "f9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b";

export interface PythPrice {
  /** Price in micro-USDC (6 decimals). e.g. 200_000_000 = $200 */
  price: bigint;
  /** Confidence interval, same scale */
  conf: bigint;
  /** Unix timestamp (seconds) of this price */
  publishTime: number;
  /** Raw Hermes VAA bytes — pass directly as oracleUpdate to on-chain ix */
  updateData: Uint8Array;
}

/**
 * Fetches the latest Pyth price update for the given feed ID via Hermes REST.
 * Returns parsed price + raw updateData bytes suitable for on-chain submission.
 */
export async function fetchPythPrice(
  feedId: string = SOL_USD_FEED_ID,
  hermesUrl: string = HERMES_DEVNET,
): Promise<PythPrice> {
  const url = `${hermesUrl}/v2/updates/price/latest?ids[]=${feedId}&encoding=hex`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Hermes fetch failed: ${resp.status} ${resp.statusText}`);
  }
  const json = (await resp.json()) as {
    parsed: Array<{
      id: string;
      price: { price: string; conf: string; publish_time: number; expo: number };
    }>;
    binary: { encoding: string; data: string[] };
  };

  const parsed = json.parsed[0];
  if (!parsed) throw new Error("No price data returned from Hermes");

  // expo is negative (e.g. -8); convert to 6dp micro-USDC
  const rawPrice = BigInt(parsed.price.price);
  const rawConf = BigInt(parsed.price.conf);
  const expo = parsed.price.expo; // e.g. -8

  // Scale to 6dp: multiply by 10^6 / 10^(-expo) = 10^(6+expo)
  const scalePow = 6 + expo; // e.g. 6 + (-8) = -2
  let price: bigint;
  let conf: bigint;
  if (scalePow >= 0) {
    const scale = BigInt(10 ** scalePow);
    price = rawPrice * scale;
    conf = rawConf * scale;
  } else {
    const scale = BigInt(10 ** (-scalePow));
    price = rawPrice / scale;
    conf = rawConf / scale;
  }

  // Decode hex update data
  const hexData = json.binary.data[0];
  const updateData = hexToBytes(hexData);

  return {
    price,
    conf,
    publishTime: parsed.price.publish_time,
    updateData,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─── Pyth Lazer WS stream ──────────────────────────────────────────────────

export interface LazerPriceUpdate {
  feedId: string;
  price: bigint;
  conf: bigint;
  publishTime: number;
  rawPayload: Buffer;
}

export interface PythLazerStreamOptions {
  token: string;
  feedIds: string[];
  rateMs?: number;
  url?: string;
}

/**
 * Connects to Pyth Lazer WebSocket stream and delivers real-time price updates.
 * Pyth Lazer provides sub-millisecond signed oracle prices via WebSocket.
 *
 * Usage:
 *   const stream = new PythLazerStream({
 *     token: "BEARER_TOKEN_FROM_ENV",
 *     feedIds: ["0xef0d8b...", "0xf9c017..."],
 *   });
 *   stream.onPrice((feed, price, exponent, publishTime) => { ... });
 *   await stream.start();
 *   // later:
 *   stream.close();
 *
 * Authentication: Bearer token from https://tally.so/r/nP2lG5 (Pyth access form).
 * Token should be stored in PYTH_LAZER_TOKEN env var.
 */
export class PythLazerStream {
  private ws: WebSocket | null = null;
  private priceCallbacks: Array<
    (feed: string, price: bigint, exponent: number, publishTime: number) => void
  > = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private closed = false;
  private readonly token: string;
  private readonly feedIds: string[];
  private readonly endpointIndex: number;

  constructor(opts: { token: string; feedIds: string[] }) {
    if (!opts.token || opts.token.trim() === "") {
      throw new Error(
        "Pyth Lazer token is required. Get it from https://tally.so/r/nP2lG5 or set PYTH_LAZER_TOKEN env var.",
      );
    }
    this.token = opts.token;
    this.feedIds = opts.feedIds;
    // Round-robin between redundant endpoints
    this.endpointIndex = Math.floor(Math.random() * PYTH_LAZER_WS_ENDPOINTS.length);
  }

  /** Register a callback invoked on each price update. */
  onPrice(
    cb: (feed: string, price: bigint, exponent: number, publishTime: number) => void,
  ): void {
    this.priceCallbacks.push(cb);
  }

  /** Open the WebSocket connection and begin streaming. Resolves once connected. */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const endpoint = PYTH_LAZER_WS_ENDPOINTS[this.endpointIndex];

      const ws = new WebSocket(endpoint, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      this.ws = ws;

      ws.once("open", () => {
        // Send subscribe request per Pyth Lazer protocol spec.
        // Subscribe to specific price feeds with required properties.
        const sub = {
          type: "subscribe",
          subscriptionId: 1,
          priceFeedIds: this.feedIds,
          properties: ["price", "conf"],
          formats: ["solana"],
          channel: "fixed_rate@200ms",
          jsonBinaryEncoding: "hex",
        };
        ws.send(JSON.stringify(sub));
        this.reconnectAttempts = 0;
        resolve();
      });

      ws.once("error", (err) => {
        console.error(`[PythLazerStream] Connection error to ${endpoint}:`, err.message);
        reject(err);
      });

      ws.on("error", (err) => {
        // After initial connection, errors are non-fatal — try to reconnect.
        console.error(`[PythLazerStream] WS error (endpoint ${endpoint}):`, err.message);
      });

      ws.on("message", (data: Buffer | string) => {
        try {
          const buf = typeof data === "string" ? Buffer.from(data) : data;
          this.handleMessage(buf);
        } catch (err) {
          console.error("[PythLazerStream] Parse error:", err);
        }
      });

      ws.on("close", (code: number, reason: string) => {
        console.warn(`[PythLazerStream] WS closed (code=${code}, reason=${reason})`);
        if (!this.closed) this.scheduleReconnect();
      });
    });
  }

  private handleMessage(data: Buffer): void {
    // Text frames (JSON) are subscription acks / errors — log but don't parse.
    if (data[0] === 0x7b /* '{' */) {
      try {
        const json = JSON.parse(data.toString());
        // Subscription confirmation or error response
        if (json.type === "response" || json.type === "error") {
          console.debug("[PythLazerStream] Server message:", json);
        }
      } catch {
        // Ignore JSON parse errors for non-JSON frames
      }
      return;
    }

    // Pyth Lazer publishes JSON messages with hex-encoded Solana data.
    // Each message includes priceFeeds array with price, exponent, timestamp.
    // For now, we parse simple JSON price updates.
    // Real production code would decode the full solana field if needed.

    try {
      const json = JSON.parse(data.toString());

      if (json.priceFeeds && Array.isArray(json.priceFeeds)) {
        const timestampUs = json.timestampUs || Date.now() * 1000;
        const publishTime = Math.floor(timestampUs / 1_000_000); // Convert microseconds to seconds

        for (const feed of json.priceFeeds) {
          const feedId = feed.priceFeedId || feed.id;
          const priceObj = feed.price;

          if (feedId && priceObj) {
            // priceObj typically has { price, expo }
            const price = BigInt(priceObj.price || 0);
            const exponent = priceObj.expo !== undefined ? priceObj.expo : -8;

            for (const cb of this.priceCallbacks) {
              cb(feedId, price, exponent, publishTime);
            }
          }
        }
      }
    } catch (err) {
      // Non-JSON binary frame or parse error — log but continue.
      console.debug("[PythLazerStream] Non-JSON message, length:", data.length);
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(
        "[PythLazerStream] Max reconnect attempts reached. Giving up. Check PYTH_LAZER_TOKEN.",
      );
      return;
    }

    const backoffMs = Math.min(1000 + this.reconnectAttempts * 500, 5000);
    this.reconnectAttempts++;

    console.info(
      `[PythLazerStream] Reconnecting in ${backoffMs}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      if (!this.closed) {
        this.start().catch(() => this.scheduleReconnect());
      }
    }, backoffMs);
  }

  /** Close the WebSocket and stop reconnection attempts. */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
    }
  }
}

// ─── Legacy EventEmitter-based stream (DEPRECATED) ─────────────────────────

/**
 * @deprecated Prefer PythLazerStream with onPrice() callback.
 * This wrapper maintained for backward compatibility. Use new PythLazerStream interface.
 */
export class PythLazerEventStream extends EventEmitter {
  private inner: PythLazerStream | null = null;

  constructor(opts: { token: string; feedIds: string[] }) {
    super();
    // Initialize with new interface
    this.inner = new PythLazerStream({
      token: opts.token,
      feedIds: opts.feedIds,
    });
    this.inner.onPrice((feed, price, exponent, publishTime) => {
      const update: LazerPriceUpdate = {
        feedId: feed,
        price,
        conf: 0n,
        publishTime,
        rawPayload: Buffer.alloc(0),
      };
      this.emit("price", update);
    });
  }

  async connect(): Promise<void> {
    if (!this.inner) throw new Error("Stream not initialized");
    return this.inner.start();
  }

  close(): void {
    if (this.inner) {
      this.inner.close();
    }
    this.emit("close");
  }
}
