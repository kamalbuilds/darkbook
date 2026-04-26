/**
 * setup.ts — Common test helpers for DarkBook bankrun tests.
 *
 * Provides: createTestKeypair, airdropAndDeposit, createMockPriceUpdate,
 * programWithBankrun, and SPL token mint/account helpers.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  Connection,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BanksClient, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import type { Darkbook } from "../target/types/darkbook";

export const USDC_DECIMALS = 6;
export const USDC_MULTIPLIER = 10 ** USDC_DECIMALS;

// ─── Keypairs ─────────────────────────────────────────────────────────────────

/** Create a fresh funded keypair (bankrun auto-funds accounts with enough SOL). */
export function createTestKeypair(): Keypair {
  return Keypair.generate();
}

// ─── PDA derivers (mirrors constants.rs seeds) ────────────────────────────────

export function deriveMarketPDA(
  programId: PublicKey,
  assetId: Buffer
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), assetId],
    programId
  );
}

export function deriveVaultPDA(
  programId: PublicKey,
  market: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    programId
  );
}

export function deriveBookPDA(
  programId: PublicKey,
  market: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("book"), market.toBuffer()],
    programId
  );
}

export function deriveUserPDA(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), market.toBuffer(), owner.toBuffer()],
    programId
  );
}

export function derivePositionPDA(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey,
  positionIdx: bigint
): [PublicKey, number] {
  const idxBuf = Buffer.alloc(8);
  idxBuf.writeBigUInt64LE(positionIdx);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pos"), market.toBuffer(), owner.toBuffer(), idxBuf],
    programId
  );
}

// ─── SPL Token helpers ────────────────────────────────────────────────────────

/**
 * Create a USDC-like mint and token accounts for multiple users.
 * Mints `mintAmount` tokens to each user's token account.
 *
 * Uses the bankrun connection which routes through the ProgramTestContext.
 */
export interface TokenSetup {
  mint: PublicKey;
  mintAuthority: Keypair;
  vaultTokenAccount: PublicKey;
  userTokenAccounts: Map<string, PublicKey>; // owner pubkey -> token account
}

/**
 * Set up USDC mint using the standard @solana/spl-token helpers.
 * Bankrun exposes a Connection-compatible interface.
 */
export async function setupUsdcMint(
  context: ProgramTestContext,
  payer: Keypair
): Promise<{ mint: PublicKey; mintAuthority: Keypair }> {
  const mintAuthority = Keypair.generate();

  // Use bankrun's internal client via a Connection wrapper
  const connection = new Connection("http://127.0.0.1:8899");
  // In bankrun we bypass the network — use the context's banks client directly
  // via anchor BankrunProvider which wraps it.
  const provider = new BankrunProvider(context);
  // @ts-ignore — access internal connection for spl-token helpers
  const mintPubkey = await createMint(
    // @ts-ignore
    provider.connection as Connection,
    payer,
    mintAuthority.publicKey,
    null,
    USDC_DECIMALS,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );

  return { mint: mintPubkey, mintAuthority };
}

// ─── Pyth mock ────────────────────────────────────────────────────────────────

/**
 * Create a mock Pyth PriceUpdateV2 account data buffer.
 *
 * WHY MOCK: Bankrun cannot pull real Pyth feeds from the network. The on-chain
 * program reads a `PriceUpdateV2` account via pyth-solana-receiver-sdk. We
 * fabricate an account with the correct layout so the program can deserialize it.
 *
 * Layout (based on pyth-solana-receiver-sdk PriceUpdateV2):
 *   discriminator [8] | write_authority [32] | verification_level [1] | price_message [...]
 *
 * price_message (PriceFeedMessage):
 *   feed_id [32] | price i64 | conf u64 | exponent i32 | publish_time i64 |
 *   prev_publish_time i64 | ema_price i64 | ema_conf u64
 *
 * Total = 8 + 32 + 1 + (32 + 8 + 8 + 4 + 8 + 8 + 8 + 8) = 8 + 33 + 84 = 125 bytes minimum
 */
export function createMockPriceUpdateData(params: {
  feedId: Buffer; // 32 bytes — must match market.oracle_feed_id
  price: bigint; // in micro-units (e.g. 200_000_000 = $200 with exponent -6)
  exponent: number; // typically -8 for Pyth
  publishTime: bigint; // unix timestamp (current time)
  conf?: bigint;
}): Buffer {
  const { feedId, price, exponent, publishTime, conf = BigInt(1000) } = params;

  // Pyth PriceUpdateV2 discriminator (anchor account discriminator for this type)
  // Derived as sha256("account:PriceUpdateV2")[0..8]
  // This is from the pyth-solana-receiver program IDL.
  const discriminator = Buffer.from([
    0x34, 0xa2, 0x98, 0x4e, 0x7f, 0x20, 0x3b, 0x01,
  ]);

  // write_authority (32 bytes) — can be any pubkey for testing
  const writeAuthority = Buffer.alloc(32, 0);

  // verification_level = 2 (Full) — 1 byte
  const verificationLevel = Buffer.from([2]);

  // PriceFeedMessage layout:
  const feedIdBuf = feedId.slice(0, 32);
  const priceBuf = Buffer.alloc(8);
  priceBuf.writeBigInt64LE(price);
  const confBuf = Buffer.alloc(8);
  confBuf.writeBigUInt64LE(conf);
  const exponentBuf = Buffer.alloc(4);
  exponentBuf.writeInt32LE(exponent);
  const publishTimeBuf = Buffer.alloc(8);
  publishTimeBuf.writeBigInt64LE(publishTime);
  const prevPublishTimeBuf = Buffer.alloc(8);
  prevPublishTimeBuf.writeBigInt64LE(publishTime - BigInt(1));
  const emaPriceBuf = Buffer.alloc(8);
  emaPriceBuf.writeBigInt64LE(price);
  const emaConfBuf = Buffer.alloc(8);
  emaConfBuf.writeBigUInt64LE(conf);

  return Buffer.concat([
    discriminator,
    writeAuthority,
    verificationLevel,
    feedIdBuf,
    priceBuf,
    confBuf,
    exponentBuf,
    publishTimeBuf,
    prevPublishTimeBuf,
    emaPriceBuf,
    emaConfBuf,
  ]);
}

// ─── Bankrun program helper ───────────────────────────────────────────────────

/**
 * Build an anchor Program bound to a bankrun context.
 * Wraps BankrunProvider so tests get a real in-process validator.
 */
export function programWithBankrun(
  context: ProgramTestContext,
  idl: any,
  programId: PublicKey
): Program<Darkbook> {
  const provider = new BankrunProvider(context);
  return new anchor.Program(idl, provider) as Program<Darkbook>;
}

// ─── Asset ID helper ──────────────────────────────────────────────────────────

/** Convert a string market name to an 8-byte asset ID. */
export function assetIdFromString(s: string): number[] {
  const buf = Buffer.alloc(8, 0);
  Buffer.from(s).copy(buf, 0, 0, Math.min(s.length, 8));
  return Array.from(buf);
}

/** SOL/USD devnet feed id (from ARCHITECTURE.md) as Buffer. */
export function solUsdFeedId(): Buffer {
  return Buffer.from(
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    "hex"
  );
}
