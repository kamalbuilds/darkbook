/**
 * DarkBook ER Broadcaster
 *
 * 1. WebSocket server on :8082 — broadcasts book/mark events to dashboard.
 * 2. Subscribes to MagicBlock ER OrderBook via accountSubscribe.
 * 3. On each change, decodes via Anchor and broadcasts { type: 'book', bids, asks, fills }.
 * 4. Subscribes to Pyth Lazer (or polls Hermes), broadcasts { type: 'mark', price, ts }.
 */

import pino from "pino";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, BN, type Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

import {
  PythLazerStream,
  fetchPythPrice,
  bookPda,
  SOL_USD_FEED_ID,
  MAGICBLOCK_DEVNET_WS_US,
  MAGICBLOCK_DEVNET_RPC_US,
  type LazerPriceUpdate,
} from "@darkbook/sdk";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DarkbookIdl: any = require("../../../sdk/src/idl/darkbook.json");

// ─── Logger ──────────────────────────────────────────────────────────────────

const log = pino({ name: "er-broadcaster", level: process.env.LOG_LEVEL ?? "info" });

// ─── Config ───────────────────────────────────────────────────────────────────

const ER_WS_URL = process.env.ER_WS_URL ?? MAGICBLOCK_DEVNET_WS_US;
const ER_RPC_URL = process.env.ER_RPC_URL ?? MAGICBLOCK_DEVNET_RPC_US;
const PORT = Number(process.env.ER_BROADCASTER_PORT ?? 8082);
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS",
);
const PYTH_FEED_ID = process.env.SOL_USD_FEED_HEX ?? SOL_USD_FEED_ID;
const PYTH_LAZER_TOKEN = process.env.PYTH_LAZER_TOKEN ?? "";

// Ephemeral read-only keypair (broadcaster just reads state — no signing power needed)
const readerKeypair = Keypair.generate();

// ─── Anchor client (ER) ───────────────────────────────────────────────────────

const erConn = new Connection(ER_RPC_URL, "confirmed");
const anchorWallet: Wallet = {
  publicKey: readerKeypair.publicKey,
  signTransaction: async (tx) => tx,
  signAllTransactions: async (txs) => txs,
  payer: readerKeypair,
};
const provider = new AnchorProvider(erConn, anchorWallet, { commitment: "processed" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const program = new Program<any>(DarkbookIdl, provider);

// ─── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  log.info("Dashboard client connected");
  clients.add(ws);
  ws.on("close", () => {
    clients.delete(ws);
    log.info("Dashboard client disconnected");
  });
  ws.on("error", (err) => log.warn({ err }, "Client WS error"));
});

wss.on("listening", () => log.info({ port: PORT }, "Broadcaster WS server started"));

function broadcast(msg: object): void {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// ─── Order / Fill serialisation ───────────────────────────────────────────────

interface OrderRaw {
  orderId: BN;
  trader: PublicKey;
  side: { long?: Record<string, never>; short?: Record<string, never> };
  priceTicks: BN;
  sizeBand: { small?: unknown; medium?: unknown; large?: unknown; whale?: unknown };
  leverageBps: number;
  commitment: number[];
  placedSlot: BN;
}

interface FillRaw {
  fillId: BN;
  takerOrderId: BN;
  makerOrderId: BN;
  taker: PublicKey;
  maker: PublicKey;
  priceTicks: BN;
  sizeBand: { small?: unknown; medium?: unknown; large?: unknown; whale?: unknown };
  matchedSlot: BN;
  claimed: boolean;
}

function serialiseOrder(o: OrderRaw) {
  return {
    orderId: o.orderId.toString(),
    trader: o.trader.toBase58(),
    side: "long" in o.side ? "Long" : "Short",
    priceTicks: o.priceTicks.toString(),
    sizeBand: Object.keys(o.sizeBand)[0],
    leverageBps: o.leverageBps,
    placedSlot: o.placedSlot.toString(),
  };
}

function serialiseFill(f: FillRaw) {
  return {
    fillId: f.fillId.toString(),
    taker: f.taker.toBase58(),
    maker: f.maker.toBase58(),
    priceTicks: f.priceTicks.toString(),
    sizeBand: Object.keys(f.sizeBand)[0],
    matchedSlot: f.matchedSlot.toString(),
    claimed: f.claimed,
  };
}

// ─── ER book subscription ─────────────────────────────────────────────────────

interface BookAccount {
  market: PublicKey;
  nextOrderId: BN;
  lastMatchTs: BN;
  bump: number;
  // bids and asks not in IDL OrderBook struct directly — stored as raw account data
  fills: FillRaw[];
}

async function fetchAndBroadcastBook(market: PublicKey): Promise<void> {
  const [bookKey] = bookPda(PROGRAM_ID, market);
  try {
    const book = (await program.account.orderBook.fetch(bookKey)) as BookAccount;
    broadcast({
      type: "book",
      market: market.toBase58(),
      book: bookKey.toBase58(),
      nextOrderId: book.nextOrderId.toString(),
      lastMatchTs: book.lastMatchTs.toString(),
      fills: book.fills.map(serialiseFill),
    });
  } catch (err) {
    log.error({ err, market: market.toBase58() }, "Failed to fetch OrderBook for broadcast");
  }
}

function subscribeToErBook(market: PublicKey): void {
  const wsUrl = ER_WS_URL.startsWith("wss://") || ER_WS_URL.startsWith("ws://")
    ? ER_WS_URL
    : ER_WS_URL.replace(/^https?:\/\//, "wss://");

  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    const [bookKey] = bookPda(PROGRAM_ID, market);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "accountSubscribe",
        params: [bookKey.toBase58(), { encoding: "base64", commitment: "processed" }],
      }),
    );
    log.info({ book: bookKey.toBase58() }, "Subscribed to ER OrderBook (broadcaster)");
  });

  ws.on("message", (raw: RawData) => {
    try {
      const msg = JSON.parse(raw.toString()) as { method?: string };
      if (msg.method === "accountNotification") {
        void fetchAndBroadcastBook(market).catch((e: unknown) =>
          log.error({ err: e }, "fetchAndBroadcastBook error"),
        );
      }
    } catch {
      // ignore non-JSON
    }
  });

  ws.on("error", (err: Error) => log.error({ err }, "ER WS error"));
  ws.on("close", () => {
    log.warn("ER WS closed, reconnecting in 3s");
    setTimeout(() => subscribeToErBook(market), 3000);
  });
}

// ─── Pyth price broadcast ─────────────────────────────────────────────────────

function startPythPriceBroadcast(): void {
  if (PYTH_LAZER_TOKEN && PYTH_LAZER_TOKEN.trim() !== "") {
    log.info({ feedId: PYTH_FEED_ID }, "Starting Pyth Lazer sub-ms WebSocket stream");

    let stream: PythLazerStream | null = null;
    let lastPrice: {
      price: bigint;
      conf: bigint;
      ts: number;
    } | null = null;

    const startStream = (): void => {
      try {
        stream = new PythLazerStream({
          token: PYTH_LAZER_TOKEN,
          feedIds: [PYTH_FEED_ID],
        });

        stream.onPrice((feed, price, exponent, publishTime) => {
          // Scale price to 6 decimals (micro-USDC)
          let scaledPrice: bigint;
          let scaledConf = 0n; // Confidence not provided by simplified handler

          const scalePow = 6 + exponent;
          if (scalePow >= 0) {
            const scale = BigInt(10 ** scalePow);
            scaledPrice = price * scale;
          } else {
            const scale = BigInt(10 ** (-scalePow));
            scaledPrice = price / scale;
          }

          lastPrice = {
            price: scaledPrice,
            conf: scaledConf,
            ts: publishTime,
          };

          broadcast({
            type: "mark",
            price: scaledPrice.toString(),
            conf: scaledConf.toString(),
            ts: publishTime,
            source: "lazer",
          });

          log.debug(
            { feed, price: scaledPrice.toString(), ts: publishTime, exponent },
            "Lazer price update",
          );
        });

        stream.start().then(() => {
          log.info("Pyth Lazer stream connected successfully");
        });
      } catch (err) {
        log.error({ err }, "Failed to initialize Pyth Lazer stream");
        // Fall back to Hermes polling after 5s
        setTimeout(startHermesFallback, 5000);
      }
    };

    const startHermesFallback = (): void => {
      log.warn(
        "Falling back to Hermes REST polling (2s interval) due to Lazer unavailable",
      );
      const poll = async (): Promise<void> => {
        try {
          const px = await fetchPythPrice(PYTH_FEED_ID);
          broadcast({
            type: "mark",
            price: px.price.toString(),
            conf: px.conf.toString(),
            ts: px.publishTime,
            source: "hermes",
          });
          log.debug({ price: px.price.toString(), ts: px.publishTime }, "Hermes price update");
        } catch (err) {
          log.warn({ err }, "Hermes poll error");
        }
        setTimeout(() => void poll(), 2_000);
      };
      void poll();
    };

    startStream();
  } else {
    log.warn(
      "PYTH_LAZER_TOKEN not configured — using Hermes REST polling (2s interval). For sub-ms feeds, set PYTH_LAZER_TOKEN from https://tally.so/r/nP2lG5",
    );

    const poll = async (): Promise<void> => {
      try {
        const px = await fetchPythPrice(PYTH_FEED_ID);
        broadcast({
          type: "mark",
          price: px.price.toString(),
          conf: px.conf.toString(),
          ts: px.publishTime,
          source: "hermes",
        });
      } catch (err) {
        log.warn({ err }, "Hermes poll error");
      }
      setTimeout(() => void poll(), 2_000);
    };
    void poll();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const marketEnv = process.env.MARKET_PUBKEY;
  if (!marketEnv) {
    log.error("MARKET_PUBKEY env var not set");
    process.exit(1);
  }
  const market = new PublicKey(marketEnv);

  subscribeToErBook(market);
  startPythPriceBroadcast();

  const shutdown = (): void => {
    log.info("Shutdown signal received");
    wss.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err: unknown) => {
  log.error({ err }, "Fatal error");
  process.exit(1);
});
