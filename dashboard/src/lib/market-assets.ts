/**
 * Spot token mints on Solana used as Birdeye "reference" markets for perp UI.
 * USDC is the common quote for SOL/BTC/ETH spot aggregates.
 */

export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Wrapped SOL */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Wrapped BTC (Portal / Wormhole) on Solana mainnet */
export const WBTC_MINT = "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh";

/** WETH (Wormhole) on Solana mainnet */
export const WETH_MINT = "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs";

/** Maps dashboard market id (SOL | BTC | ETH) to base mint for Birdeye token + OHLCV base/quote. */
export const SPOT_BASE_MINT_BY_MARKET: Record<string, string> = {
  SOL: WSOL_MINT,
  BTC: WBTC_MINT,
  ETH: WETH_MINT,
};

export function spotBaseMintForMarket(marketId: string): string {
  return SPOT_BASE_MINT_BY_MARKET[marketId] ?? WSOL_MINT;
}

/**
 * Pyth Hermes / Lazer price feed IDs (hex, no 0x prefix). Mainnet crypto USD feeds.
 * @see https://docs.pyth.network/price-feeds/price-feed-ids
 */
export const PYTH_FEED_ID_SOL_USD =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
export const PYTH_FEED_ID_BTC_USD =
  "f9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b";
export const PYTH_FEED_ID_ETH_USD =
  "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

export function pythUsdFeedIdForMarket(marketId: string): string {
  switch (marketId) {
    case "BTC":
      return PYTH_FEED_ID_BTC_USD;
    case "ETH":
      return PYTH_FEED_ID_ETH_USD;
    default:
      return PYTH_FEED_ID_SOL_USD;
  }
}
