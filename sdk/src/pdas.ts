import { PublicKey } from "@solana/web3.js";
import {
  SEED_BOOK,
  SEED_MARKET,
  SEED_POS,
  SEED_USER,
  SEED_VAULT,
} from "./constants.js";

/**
 * Derives the Market PDA.
 * Seeds: [b"market", asset_id(32 bytes)]
 */
export function marketPda(
  programId: PublicKey,
  assetId: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_MARKET, assetId],
    programId,
  );
}

/**
 * Derives the CollateralVault PDA.
 * Seeds: [b"vault", market_pubkey]
 */
export function vaultPda(
  programId: PublicKey,
  market: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_VAULT, market.toBytes()],
    programId,
  );
}

/**
 * Derives the UserAccount PDA.
 * Seeds: [b"user", market_pubkey, owner_pubkey]
 */
export function userPda(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_USER, market.toBytes(), owner.toBytes()],
    programId,
  );
}

/**
 * Derives the OrderBook PDA (delegated to ER during trading).
 * Seeds: [b"book", market_pubkey]
 */
export function bookPda(
  programId: PublicKey,
  market: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_BOOK, market.toBytes()],
    programId,
  );
}

/**
 * Derives a Position PDA.
 * Seeds: [b"pos", market_pubkey, owner_pubkey, idx_le4]
 *
 * @param idx - position index (u32, starts at 0 per owner per market)
 */
export function positionPda(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey,
  idx: number,
): [PublicKey, number] {
  const idxBuf = Buffer.allocUnsafe(4);
  idxBuf.writeUInt32LE(idx, 0);
  return PublicKey.findProgramAddressSync(
    [SEED_POS, market.toBytes(), owner.toBytes(), idxBuf],
    programId,
  );
}
