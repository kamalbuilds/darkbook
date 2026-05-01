/**
 * Pure formatting functions: parsed on-chain event data → Telegram MarkdownV2 message.
 *
 * Anchor emits events as base64-encoded log lines starting with
 * "Program data: <base64>". The prefix 8 bytes are the event discriminator;
 * the rest is Borsh-serialised event fields. We parse the raw log lines with
 * lightweight manual Borsh decoding — no heavy dependencies.
 *
 * Unit conversions (matching on-chain constants):
 *   priceTicks = micro-USDC per lot (1 tick = 1e-6 USDC)
 *   sizeLots   = integer lots (1 lot ≈ 0.001 SOL in demo)
 *   collateral = micro-USDC (1 unit = 1e-6 USDC)
 */

export interface OrderPlacedEvent {
  kind: "OrderPlaced";
  orderId: bigint;
  trader: string;
  side: "Long" | "Short";
  priceTicks: bigint;
  sizeBand: string;
  leverageBps: number;
}

export interface FillRecordedEvent {
  kind: "FillRecorded";
  fillId: bigint;
  taker: string;
  maker: string;
  priceTicks: bigint;
  sizeBand: string;
}

export interface PositionOpenedEvent {
  kind: "PositionOpened";
  trader: string;
  side: "Long" | "Short";
  sizeLots: bigint;
  entryPriceTicks: bigint;
  collateralLocked: bigint;
}

export interface PositionLiquidatedEvent {
  kind: "PositionLiquidated";
  trader: string;
  side: "Long" | "Short";
  sizeLots: bigint;
  entryPriceTicks: bigint;
  collateralLost: bigint;
}

export interface FundingPaidEvent {
  kind: "FundingPaid";
  trader: string;
  amountPaid: bigint;
  isLong: boolean;
}

export type DarkbookEvent =
  | OrderPlacedEvent
  | FillRecordedEvent
  | PositionOpenedEvent
  | PositionLiquidatedEvent
  | FundingPaidEvent;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert micro-USDC ticks → human-readable price string e.g. "$199.50" */
export function ticksToPrice(ticks: bigint): string {
  // 1 tick = 1 micro-USDC = 0.000001 USDC; price displayed as USD
  const usdc = Number(ticks) / 1_000_000;
  return `$${usdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Convert micro-USDC → human-readable amount e.g. "4.00 USDC" */
export function microToUsdc(micro: bigint): string {
  const usdc = Number(micro) / 1_000_000;
  return `${usdc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USDC`;
}

/** Leverage BPS → display e.g. 500bps → "5x" */
export function bpsToLeverage(bps: number): string {
  return `${(bps / 100).toFixed(0)}x`;
}

/** Truncate base58 pubkey for display. */
export function shortKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/** Escape characters that are special in Telegram MarkdownV2. */
export function escMd(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatOrderPlaced(ev: OrderPlacedEvent): string {
  const sideEmoji = ev.side === "Long" ? "🟢" : "🔴";
  const side = ev.side === "Long" ? "Long" : "Short";
  return (
    `${sideEmoji} *Order Placed*\n` +
    `Trader: \`${escMd(shortKey(ev.trader))}\`\n` +
    `Side: ${escMd(side)} @ ${escMd(ticksToPrice(ev.priceTicks))}\n` +
    `Size band: ${escMd(ev.sizeBand)} | Leverage: ${escMd(bpsToLeverage(ev.leverageBps))}\n` +
    `Order ID: \`${ev.orderId}\``
  );
}

export function formatFillRecorded(ev: FillRecordedEvent): string {
  return (
    `⚡ *Fill Recorded*\n` +
    `Price: ${escMd(ticksToPrice(ev.priceTicks))} | Band: ${escMd(ev.sizeBand)}\n` +
    `Taker: \`${escMd(shortKey(ev.taker))}\`\n` +
    `Maker: \`${escMd(shortKey(ev.maker))}\`\n` +
    `Fill ID: \`${ev.fillId}\``
  );
}

export function formatPositionOpened(ev: PositionOpenedEvent): string {
  const sideEmoji = ev.side === "Long" ? "📈" : "📉";
  const side = ev.side === "Long" ? "long" : "short";
  return (
    `${sideEmoji} *Position Opened*\n` +
    `Trader: \`${escMd(shortKey(ev.trader))}\`\n` +
    `${escMd(side)} ${ev.sizeLots} lots @ ${escMd(ticksToPrice(ev.entryPriceTicks))}\n` +
    `Collateral locked: ${escMd(microToUsdc(ev.collateralLocked))}`
  );
}

export function formatPositionLiquidated(ev: PositionLiquidatedEvent): string {
  const side = ev.side === "Long" ? "long" : "short";
  return (
    `🔴 *LIQUIDATED*\n` +
    `Trader: \`${escMd(shortKey(ev.trader))}\`\n` +
    `${escMd(side)} ${ev.sizeLots} lots @ ${escMd(ticksToPrice(ev.entryPriceTicks))}\n` +
    `Loss: ${escMd(microToUsdc(ev.collateralLost))}`
  );
}

export function formatFundingPaid(ev: FundingPaidEvent): string {
  const direction = ev.isLong ? "longs pay shorts" : "shorts pay longs";
  const sign = ev.amountPaid >= 0n ? "paid" : "received";
  const abs = ev.amountPaid < 0n ? -ev.amountPaid : ev.amountPaid;
  return (
    `💸 *Funding Payment*\n` +
    `Trader: \`${escMd(shortKey(ev.trader))}\`\n` +
    `${escMd(sign)} ${escMd(microToUsdc(abs))} \\(${escMd(direction)}\\)`
  );
}

export function formatEvent(ev: DarkbookEvent): string {
  switch (ev.kind) {
    case "OrderPlaced":
      return formatOrderPlaced(ev);
    case "FillRecorded":
      return formatFillRecorded(ev);
    case "PositionOpened":
      return formatPositionOpened(ev);
    case "PositionLiquidated":
      return formatPositionLiquidated(ev);
    case "FundingPaid":
      return formatFundingPaid(ev);
  }
}

// ─── Log parser ───────────────────────────────────────────────────────────────

/**
 * Parses DarkBook events from raw Solana program log lines.
 *
 * Since the IDL ships with no `events` section (events are emitted via
 * `anchor emit!` macro which produces "Program data: <base64>" log lines),
 * we parse the structured log lines emitted by our instructions instead.
 *
 * The Rust program emits human-readable log lines like:
 *   "Program log: DarkBook::OrderPlaced orderId=1 trader=<pubkey> side=Long ..."
 *
 * This parser handles both structured log lines (primary) and Anchor event
 * base64 blobs (if events are later added to the IDL).
 */
export function parseEventsFromLogs(logs: string[]): DarkbookEvent[] {
  const events: DarkbookEvent[] = [];

  for (const line of logs) {
    const ev = tryParseLogLine(line);
    if (ev) events.push(ev);
  }

  return events;
}

function tryParseLogLine(line: string): DarkbookEvent | null {
  // Match structured anchor log lines: "Program log: DarkBook::<EventName> k=v k=v ..."
  const match = line.match(/Program log: DarkBook::(\w+)\s+(.*)/);
  if (!match) return null;

  const [, eventName, rest] = match;
  const fields = parseKvPairs(rest);

  switch (eventName) {
    case "OrderPlaced":
      return {
        kind: "OrderPlaced",
        orderId: BigInt(fields.orderId ?? "0"),
        trader: fields.trader ?? "",
        side: fields.side === "Short" ? "Short" : "Long",
        priceTicks: BigInt(fields.priceTicks ?? "0"),
        sizeBand: fields.sizeBand ?? "Small",
        leverageBps: parseInt(fields.leverageBps ?? "100", 10),
      };

    case "FillRecorded":
      return {
        kind: "FillRecorded",
        fillId: BigInt(fields.fillId ?? "0"),
        taker: fields.taker ?? "",
        maker: fields.maker ?? "",
        priceTicks: BigInt(fields.priceTicks ?? "0"),
        sizeBand: fields.sizeBand ?? "Small",
      };

    case "PositionOpened":
      return {
        kind: "PositionOpened",
        trader: fields.trader ?? "",
        side: fields.side === "Short" ? "Short" : "Long",
        sizeLots: BigInt(fields.sizeLots ?? "0"),
        entryPriceTicks: BigInt(fields.entryPriceTicks ?? "0"),
        collateralLocked: BigInt(fields.collateralLocked ?? "0"),
      };

    case "PositionLiquidated":
      return {
        kind: "PositionLiquidated",
        trader: fields.trader ?? "",
        side: fields.side === "Short" ? "Short" : "Long",
        sizeLots: BigInt(fields.sizeLots ?? "0"),
        entryPriceTicks: BigInt(fields.entryPriceTicks ?? "0"),
        collateralLost: BigInt(fields.collateralLost ?? "0"),
      };

    case "FundingPaid":
      return {
        kind: "FundingPaid",
        trader: fields.trader ?? "",
        amountPaid: BigInt(fields.amountPaid ?? "0"),
        isLong: fields.isLong === "true",
      };

    default:
      return null;
  }
}

/** Parse "key=value key2=value2" pairs into a Record. Values are unquoted. */
function parseKvPairs(s: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)=(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    result[m[1]] = m[2];
  }
  return result;
}
