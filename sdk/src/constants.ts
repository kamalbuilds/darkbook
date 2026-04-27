import { PublicKey } from "@solana/web3.js";

export const MAGICBLOCK_DEVNET_RPC_US = "https://devnet-us.magicblock.app/";
export const MAGICBLOCK_DEVNET_WS_US = "wss://devnet-us.magicblock.app/";

export const ER_VALIDATOR_DEVNET = new PublicKey(
  "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
);
export const ER_VALIDATOR_LOCALNET = new PublicKey(
  "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);

export const SOL_USD_FEED_ID_HEX =
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export const PYTH_LAZER_WS = "wss://pyth-lazer.dourolabs.app/v1/stream";

/** PDA seed bytes — kept in sync with programs/darkbook/src/constants.rs */
export const SEED_MARKET = Buffer.from("market");
export const SEED_VAULT = Buffer.from("vault");
export const SEED_USER = Buffer.from("user");
export const SEED_BOOK = Buffer.from("book");
export const SEED_POS = Buffer.from("pos");

/** Size-band lot thresholds (upper inclusive boundary in lots). */
export const SIZE_BAND_SMALL_MAX = 10n;
export const SIZE_BAND_MEDIUM_MAX = 100n;
export const SIZE_BAND_LARGE_MAX = 1000n;
