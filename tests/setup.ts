import { createHash } from "node:crypto";

import "./bankrun-partial-sign-fix";

/**
 * setup.ts — Common test helpers for DarkBook bankrun tests.
 *
 * Provides: createTestKeypair, airdropAndDeposit, createMockPriceUpdate,
 * programWithBankrun, and SPL token mint/account helpers.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import type {
  Commitment,
  Connection,
  RpcResponseAndContext,
  SendOptions,
  SignatureResult,
  Signer,
  TransactionSignature,
} from "@solana/web3.js";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
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
import { ORDERBOOK_IS_DELEGATED_ACCOUNT_OFFSET } from "./utils";

export const USDC_DECIMALS = 6;
export const USDC_MULTIPLIER = 10 ** USDC_DECIMALS;

// ─── Bankrun + @solana/spl-token bridge ─────────────────────────────────────

/**
 * `BankrunProvider.connection` lacks `sendTransaction` / `confirmTransaction` that
 * `@solana/spl-token` helpers expect. This proxy forwards sends to `provider.sendAndConfirm`
 * and treats confirmation as immediate success (bankrun applies the tx in-process).
 */
export function splTokenConnectionFromBankrun(context: ProgramTestContext): Connection {
  const provider = new BankrunProvider(context);
  const inner = provider.connection as object;

  return new Proxy(inner as Connection, {
    get(_target, prop, receiver) {
      if (prop === "sendTransaction") {
        return async (
          transaction: Transaction,
          signers: Signer[],
          options?: SendOptions
        ): Promise<TransactionSignature> => {
          return (await provider.sendAndConfirm(
            transaction,
            signers,
            options
          )) as TransactionSignature;
        };
      }
      if (prop === "confirmTransaction") {
        return async (
          _strategy:
            | string
            | {
                signature: string;
                blockhash: string;
                lastValidBlockHeight: number;
                abortSignal?: AbortSignal;
              }
            | {
                signature: string;
                minContextSlot: number;
                nonceAccountPubkey: PublicKey;
                nonceValue: string;
                abortSignal?: AbortSignal;
              },
          _commitment?: Commitment
        ): Promise<RpcResponseAndContext<SignatureResult>> => {
          return {
            context: { slot: Number(await context.banksClient.getSlot()) },
            value: { err: null },
          };
        };
      }
      const value = Reflect.get(inner, prop, receiver);
      if (typeof value === "function") {
        return (value as (...args: unknown[]) => unknown).bind(inner);
      }
      return value;
    },
  });
}

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
  const connection = splTokenConnectionFromBankrun(context);
  const mintPubkey = await createMint(
    connection,
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
  // Must match `programs/darkbook/src/pyth.rs` PRICE_UPDATE_V2_DISCRIMINATOR
  const discriminator = Buffer.from([196, 23, 216, 5, 242, 233, 122, 184]);

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

/** Deterministic 8-byte market asset_id from an arbitrary label (full string hashed). */
export function assetIdFromString(s: string): number[] {
  const digest = createHash("sha256").update(s, "utf8").digest();
  return Array.from(digest.subarray(0, 8));
}

/** SOL/USD devnet feed id (from ARCHITECTURE.md) as Buffer. */
export function solUsdFeedId(): Buffer {
  return Buffer.from(
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    "hex"
  );
}

/**
 * Bankrun cannot run MagicBlock `delegate_book` CPI. `match_orders` still
 * requires `OrderBook::is_delegated == 1`. Patch the account in-process so
 * matching tests mirror post-delegation ER state.
 */
export async function bankrunMarkOrderBookDelegated(
  context: ProgramTestContext,
  programId: PublicKey,
  bookPda: PublicKey
): Promise<void> {
  const acct = await context.banksClient.getAccount(bookPda);
  if (!acct) {
    throw new Error(`bankrunMarkOrderBookDelegated: no account ${bookPda.toBase58()}`);
  }
  const data = Buffer.from(acct.data);
  data[ORDERBOOK_IS_DELEGATED_ACCOUNT_OFFSET] = 1;
  context.setAccount(bookPda, {
    lamports: acct.lamports,
    data,
    owner: programId,
    executable: acct.executable,
  });
}
