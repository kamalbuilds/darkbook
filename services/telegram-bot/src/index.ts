/**
 * DarkBook Telegram Notification Bot
 *
 * Subscribes to on-chain program logs via connection.onLogs() and pushes
 * formatted alerts to Telegram subscribers in real time.
 *
 * Commands:
 *   /start                         - welcome message
 *   /subscribe <wallet> <events>   - register wallet+event filter
 *   /unsubscribe                   - remove registration
 *   /list                          - show current subscriptions
 *   /markets                       - show all DarkBook markets
 *   /positions <wallet>            - show open positions for a wallet
 *   /help                          - show all commands
 */

import pino from "pino";
import { Bot, GrammyError, HttpError } from "grammy";
import { Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, type IdlAccounts } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { createRequire } from "node:module";

import { SubscriberStore, ALL_EVENT_TYPES, type EventType } from "./storage.js";
import { parseEventsFromLogs, formatEvent, type DarkbookEvent } from "./formatter.js";
import { marketPda, positionPda, Side, PositionStatus, type Position } from "@darkbook/sdk";

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DarkbookIdl: any = _require("../../../sdk/src/idl/darkbook.json");

// ─── Logger ──────────────────────────────────────────────────────────────────

const log = pino({ name: "telegram-bot", level: process.env.LOG_LEVEL ?? "info" });

// ─── Config ───────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ?? "9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS",
);
const DB_PATH = process.env.DB_PATH ?? "bot.db";

/** Minimum ms between messages to the same chat (Telegram rate limit). */
const RATE_LIMIT_MS = 5_000;

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const lastSent = new Map<number, number>();

function canSend(chatId: number): boolean {
  const now = Date.now();
  const last = lastSent.get(chatId) ?? 0;
  if (now - last < RATE_LIMIT_MS) return false;
  lastSent.set(chatId, now);
  return true;
}

// ─── Anchor read-only client (no signing key required) ───────────────────────

function buildReadonlyProgram(conn: Connection): Program {
  const dummyKeypair = Keypair.generate();
  const dummyWallet: Wallet = {
    publicKey: dummyKeypair.publicKey,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
    payer: dummyKeypair,
  };
  const provider = new AnchorProvider(conn, dummyWallet, { commitment: "confirmed" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(DarkbookIdl as any, provider);
}

// ─── Markets helper ───────────────────────────────────────────────────────────

interface MarketRow {
  publicKey: PublicKey;
  account: {
    totalLongSize: { toString(): string };
    totalShortSize: { toString(): string };
    paused: boolean;
    takerFeeBps: number;
    maxLeverageBps: number;
  };
}

async function fetchAllMarkets(program: Program): Promise<string> {
  try {
    const markets = await program.account["market"].all() as MarketRow[];
    if (markets.length === 0) return "No markets found on-chain.";

    const lines = markets.map((m, i) => {
      const longSize = BigInt(m.account.totalLongSize.toString());
      const shortSize = BigInt(m.account.totalShortSize.toString());
      const statusStr = m.account.paused ? "⏸ Paused" : "🟢 Active";
      return (
        `*Market ${i + 1}*: \`${m.publicKey.toBase58().slice(0, 8)}\\.\\.\\.\`\n` +
        `  Status: ${statusStr}\n` +
        `  Long OI: ${longSize} lots | Short OI: ${shortSize} lots\n` +
        `  Max leverage: ${m.account.maxLeverageBps / 100}x | Taker fee: ${m.account.takerFeeBps / 100}bps`
      );
    });

    return `*DarkBook Markets*\n\n${lines.join("\n\n")}`;
  } catch (err) {
    log.error({ err }, "fetchAllMarkets failed");
    return "Failed to fetch markets. Check RPC connection.";
  }
}

// ─── Positions helper ─────────────────────────────────────────────────────────

async function fetchPositions(program: Program, walletStr: string): Promise<string> {
  let owner: PublicKey;
  try {
    owner = new PublicKey(walletStr);
  } catch {
    return "Invalid wallet address.";
  }

  try {
    const allPositions = await program.account["position"].all() as Array<{
      publicKey: PublicKey;
      account: {
        trader: PublicKey;
        market: PublicKey;
        side: Record<string, unknown>;
        sizeLots: { toString(): string };
        entryPriceTicks: { toString(): string };
        collateralLocked: { toString(): string };
        status: Record<string, unknown>;
        positionIdx: number;
      };
    }>();

    const ownerStr = owner.toBase58();
    const open = allPositions.filter(
      (p) => p.account.trader.toBase58() === ownerStr && "open" in p.account.status,
    );

    if (open.length === 0) return `No open positions found for \`${walletStr.slice(0, 8)}\\.\\.\\.\``;

    const lines = open.map((p, i) => {
      const side = "long" in p.account.side ? "Long 📈" : "Short 📉";
      const sizeLots = BigInt(p.account.sizeLots.toString());
      const entryTicks = BigInt(p.account.entryPriceTicks.toString());
      const collateral = BigInt(p.account.collateralLocked.toString());
      const entryUsd = (Number(entryTicks) / 1_000_000).toFixed(2);
      const collUsd = (Number(collateral) / 1_000_000).toFixed(4);
      return (
        `*Position ${i + 1}* \\(idx: ${p.account.positionIdx}\\)\n` +
        `  Side: ${side}\n` +
        `  Size: ${sizeLots} lots @ \\$${entryUsd}\n` +
        `  Collateral: ${collUsd} USDC`
      );
    });

    return `*Open Positions for* \`${walletStr.slice(0, 8)}\\.\\.\\.\`\n\n${lines.join("\n\n")}`;
  } catch (err) {
    log.error({ err }, "fetchPositions failed");
    return "Failed to fetch positions. Check RPC connection.";
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const store = new SubscriberStore(DB_PATH);
  const conn = new Connection(RPC_URL, { commitment: "confirmed" });
  const program = buildReadonlyProgram(conn);

  log.info({ rpc: RPC_URL, programId: PROGRAM_ID.toBase58() }, "DarkBook Telegram bot starting");

  // ─── Telegram bot ──────────────────────────────────────────────────────────

  let bot: Bot | null = null;

  if (!BOT_TOKEN) {
    log.warn(
      "TELEGRAM_BOT_TOKEN not set — running in log-only mode (events consumed but not forwarded)",
    );
  } else {
    bot = new Bot(BOT_TOKEN);

    /** Safe send helper: respects rate limit, logs failures. */
    async function safeSend(chatId: number, text: string): Promise<void> {
      if (!bot) return;
      if (!canSend(chatId)) {
        log.debug({ chatId }, "Rate limited, skipping message");
        return;
      }
      try {
        await bot.api.sendMessage(chatId, text, { parse_mode: "MarkdownV2" });
      } catch (err) {
        log.warn({ err, chatId }, "Failed to send Telegram message");
      }
    }

    // ── /start ──────────────────────────────────────────────────────────────
    bot.command("start", async (ctx) => {
      await ctx.reply(
        "*Welcome to DarkBook Alerts\\!* 🌑\n\n" +
          "Real\\-time notifications for DarkBook dark\\-pool perpetuals on Solana\\.\n\n" +
          "Use /subscribe to register your wallet for alerts\\.\n" +
          "Use /help to see all commands\\.",
        { parse_mode: "MarkdownV2" },
      );
    });

    // ── /help ───────────────────────────────────────────────────────────────
    bot.command("help", async (ctx) => {
      await ctx.reply(
        "*DarkBook Bot Commands*\n\n" +
          "`/subscribe <wallet> <events>` — register for alerts\n" +
          "  events: comma\\-separated from:\n" +
          "  OrderPlaced, FillRecorded, PositionOpened, PositionLiquidated, FundingPaid\n" +
          "  Use `all` for all events\n\n" +
          "`/unsubscribe` — remove all your subscriptions\n" +
          "`/list` — show your current subscriptions\n" +
          "`/markets` — show all DarkBook markets\n" +
          "`/positions <wallet>` — show open positions for a wallet\n" +
          "`/help` — show this message",
        { parse_mode: "MarkdownV2" },
      );
    });

    // ── /subscribe <wallet> <events> ────────────────────────────────────────
    bot.command("subscribe", async (ctx) => {
      const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
      if (args.length < 2) {
        await ctx.reply(
          "Usage: `/subscribe <wallet> <events>`\n" +
            "Example: `/subscribe <base58> OrderPlaced,FillRecorded`\n" +
            "Use `all` for all event types.",
          { parse_mode: "MarkdownV2" },
        );
        return;
      }

      const [wallet, eventsArg] = args;

      // Validate wallet
      try {
        new PublicKey(wallet);
      } catch {
        await ctx.reply("Invalid wallet address.");
        return;
      }

      // Parse event types
      let alerts: EventType[];
      if (eventsArg.toLowerCase() === "all") {
        alerts = [...ALL_EVENT_TYPES];
      } else {
        const requested = eventsArg.split(",").map((s) => s.trim());
        const invalid = requested.filter((e) => !(ALL_EVENT_TYPES as string[]).includes(e));
        if (invalid.length > 0) {
          await ctx.reply(`Unknown event types: ${invalid.join(", ")}\nValid: ${ALL_EVENT_TYPES.join(", ")}`);
          return;
        }
        alerts = requested as EventType[];
      }

      const chatId = ctx.chat.id;
      store.upsert(wallet, chatId, alerts);

      log.info({ wallet, chatId, alerts }, "Subscriber registered");
      await ctx.reply(
        `✅ Subscribed\\!\nWallet: \`${wallet.slice(0, 8)}\\.\\.\\.\`\nAlerts: ${alerts.join(", ")}`,
        { parse_mode: "MarkdownV2" },
      );
    });

    // ── /unsubscribe ─────────────────────────────────────────────────────────
    bot.command("unsubscribe", async (ctx) => {
      const chatId = ctx.chat.id;
      const existing = store.findByChatId(chatId);
      if (!existing) {
        await ctx.reply("You have no active subscriptions.");
        return;
      }
      store.remove(chatId);
      log.info({ chatId }, "Subscriber removed");
      await ctx.reply("✅ Unsubscribed. You will no longer receive alerts.");
    });

    // ── /list ────────────────────────────────────────────────────────────────
    bot.command("list", async (ctx) => {
      const chatId = ctx.chat.id;
      const sub = store.findByChatId(chatId);
      if (!sub) {
        await ctx.reply("No active subscription. Use /subscribe to register.");
        return;
      }
      await ctx.reply(
        `*Your Subscription*\nWallet: \`${sub.wallet.slice(0, 8)}\\.\\.\\.\`\nAlerts: ${sub.alerts.join(", ")}`,
        { parse_mode: "MarkdownV2" },
      );
    });

    // ── /markets ─────────────────────────────────────────────────────────────
    bot.command("markets", async (ctx) => {
      const text = await fetchAllMarkets(program);
      await ctx.reply(text, { parse_mode: "MarkdownV2" });
    });

    // ── /positions <wallet> ──────────────────────────────────────────────────
    bot.command("positions", async (ctx) => {
      const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
      if (args.length === 0) {
        await ctx.reply("Usage: `/positions <wallet>`", { parse_mode: "MarkdownV2" });
        return;
      }
      const text = await fetchPositions(program, args[0]);
      await ctx.reply(text, { parse_mode: "MarkdownV2" });
    });

    // ── Error handler ─────────────────────────────────────────────────────────
    bot.catch((err) => {
      const ctx = err.ctx;
      log.error({ update: ctx.update.update_id }, "Bot error");
      if (err.error instanceof GrammyError) {
        log.error({ err: err.error.message }, "GrammyError");
      } else if (err.error instanceof HttpError) {
        log.error({ err: err.error.message }, "HttpError");
      } else {
        log.error({ err: err.error }, "Unknown bot error");
      }
    });
  }

  // ─── On-chain log subscription ────────────────────────────────────────────

  /**
   * Dispatch a parsed event to all matching subscribers.
   * Respects per-chat rate limit (max 1 msg / 5 sec).
   */
  async function dispatchEvent(ev: DarkbookEvent): Promise<void> {
    log.info({ kind: ev.kind }, "DarkBook event received");

    if (!bot) return; // log-only mode

    const subscribers = store.findByEventType(ev.kind as EventType);
    const text = formatEvent(ev);

    for (const sub of subscribers) {
      await bot.api.sendMessage(sub.chatId, text, { parse_mode: "MarkdownV2" }).catch((err: unknown) => {
        log.warn({ err, chatId: sub.chatId }, "Failed to push event notification");
      });
      // Respect rate limit by recording send time
      lastSent.set(sub.chatId, Date.now());
    }
  }

  // Subscribe to all program log lines — real on-chain subscription.
  const logSubId = conn.onLogs(
    PROGRAM_ID,
    (logResult) => {
      if (logResult.err) {
        // Transaction failed; skip
        return;
      }
      const events = parseEventsFromLogs(logResult.logs);
      for (const ev of events) {
        void dispatchEvent(ev).catch((e: unknown) =>
          log.error({ err: e }, "dispatchEvent error"),
        );
      }
    },
    "confirmed",
  );

  log.info({ subscriptionId: logSubId }, "Subscribed to program logs");

  // ─── Start bot polling ────────────────────────────────────────────────────

  if (bot) {
    // Start grammy long-polling in the background (non-blocking).
    void bot.start({
      onStart: (info) => {
        log.info({ username: info.username }, "Telegram bot started");
      },
    });
  }

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  const shutdown = async (): Promise<void> => {
    log.info("Shutdown signal received, cleaning up…");
    try {
      await conn.removeOnLogsListener(logSubId);
      log.info("On-chain log subscription removed");
    } catch (err) {
      log.warn({ err }, "Failed to remove log subscription");
    }
    if (bot) {
      await bot.stop();
      log.info("Telegram bot stopped");
    }
    store.close();
    log.info("SQLite store closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  log.info("Bot is running. Listening for on-chain events…");
}

main().catch((err: unknown) => {
  log.error({ err }, "Fatal error");
  process.exit(1);
});
