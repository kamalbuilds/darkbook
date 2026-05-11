/**
 * Formatting utilities for DarkBook trading dashboard.
 * All monetary and numeric formatting lives here.
 */

export function fmtUsdc(amount: number | null | undefined, decimals = 2): string {
  if (amount == null) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function fmtPct(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Compact USD for large stats (e.g. Birdeye 24h volume). */
export function fmtUsdCompact(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  return fmtUsdc(usd, 0);
}

export function fmtSol(lamports: number | null | undefined): string {
  if (lamports == null) return "-";
  const sol = lamports / 1e9;
  return `${sol.toFixed(4)} SOL`;
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function fmtPrice(priceTicks: bigint | number | null | undefined): string {
  if (priceTicks == null) return "-";
  // price_ticks is in micro-USDC per lot, 1 tick = $0.000001
  const price = Number(priceTicks) / 1_000_000;
  return fmtUsdc(price, 4);
}

export function fmtSize(sizeLots: number | null | undefined): string {
  if (sizeLots == null) return "-";
  return sizeLots.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtTimestamp(slot: number | null | undefined): string {
  if (slot == null) return "-";
  // rough: 400ms per slot on Solana
  return new Date(slot * 400).toLocaleTimeString();
}

export function sizeBandGlyph(band: "Small" | "Medium" | "Large" | "Whale" | string): string {
  switch (band) {
    case "Small":
      return "·";
    case "Medium":
      return "◆";
    case "Large":
      return "◆◆";
    case "Whale":
      return "🐋";
    default:
      return "·";
  }
}
