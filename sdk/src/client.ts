/**
 * DarkbookClient — typed Anchor wrapper for all DarkBook on-chain instructions.
 *
 * Base-layer instructions (initializeMarket, deposit, withdraw, placeOrder,
 * cancelOrder, claimFill, markPosition, liquidatePosition, closePosition,
 * closePositionAndWithdraw, updateFunding, accrueFundingPosition)
 * are sent via `connection`.
 *
 * ER instructions (matchOrders, commitBook, commitAndUndelegateBook) are
 * sent via `erConnection` after the OrderBook PDA is delegated.
 */

import {
  AccountMeta,
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionSignature,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  DarkbookClientOptions,
  Fill,
  MarkResult,
  Order,
  OrderBookSnapshot,
  OrderPayload,
  Position,
  PositionStatus,
  Side,
  SizeBand,
} from "./types.js";
import { bookPda, marketPda, positionPda, userPda, vaultPda } from "./pdas.js";
import { computeCommitment, generateOrderPayload, lotsToBand } from "./encryption.js";
import { encryptOrderBlob, type EncryptedOrderBlob, type EncryptFheConfig } from "./encrypt.js";
import { fetchPythPrice, SOL_USD_FEED_ID } from "./pyth.js";
import { ER_VALIDATOR_DEVNET } from "./constants.js";

// IDL wrapper — avoids JSON import assertion issues across CJS/ESM targets.
// Swap for generated types after `anchor build`.
import { DARKBOOK_IDL as DarkbookIdl } from "./idl/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProgram = Program<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAccountNS = Record<string, any>;

export { DarkbookClientOptions };

export class DarkbookClient {
  readonly connection: Connection;
  readonly erConnection: Connection;
  readonly wallet: Wallet;
  readonly programId: PublicKey;

  private readonly program: AnyProgram;
  private readonly erProgram: AnyProgram;

  /** Cast to any to avoid TypeScript's excessive depth error on Anchor's generic method chain. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get m(): any { return (this.program as any).methods; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get em(): any { return (this.erProgram as any).methods; }
  /** Account namespace shorthand with any cast. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get acct(): any { return (this.program as any).account; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get eracct(): any { return (this.erProgram as any).account; }

  constructor(opts: DarkbookClientOptions) {
    this.connection = opts.connection;
    this.erConnection = opts.erConnection;
    this.wallet = opts.wallet;
    this.programId = opts.programId;

    const provider = new AnchorProvider(opts.connection, opts.wallet, {
      commitment: "confirmed",
      skipPreflight: false,
    });
    const erProvider = new AnchorProvider(opts.erConnection, opts.wallet, {
      commitment: "confirmed",
      skipPreflight: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.program = new Program(DarkbookIdl as any, provider);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.erProgram = new Program(DarkbookIdl as any, erProvider);
  }

  // ─── PDA convenience accessors ─────────────────────────────────────────────

  getMarketPda(assetId: Uint8Array): [PublicKey, number] {
    return marketPda(this.programId, assetId);
  }
  getVaultPda(market: PublicKey): [PublicKey, number] {
    return vaultPda(this.programId, market);
  }
  getUserPda(market: PublicKey, owner: PublicKey): [PublicKey, number] {
    return userPda(this.programId, market, owner);
  }
  getBookPda(market: PublicKey): [PublicKey, number] {
    return bookPda(this.programId, market);
  }
  getPositionPda(market: PublicKey, owner: PublicKey, idx: number): [PublicKey, number] {
    return positionPda(this.programId, market, owner, idx);
  }

  // ─── Admin instructions ────────────────────────────────────────────────────

  async initializeMarket(
    assetId: Uint8Array,
    oracleFeedId: Uint8Array,
    maxLeverageBps: number,
    takerFeeBps: number,
    makerRebateBps: number,
    fundingIntervalSecs: bigint,
    mint: PublicKey,
  ): Promise<TransactionSignature> {
    const [market] = marketPda(this.programId, assetId);
    const [vault] = vaultPda(this.programId, market);
    const vaultTokenAccount = getAssociatedTokenAddressSync(mint, vault, true);

    return this.m
      .initializeMarket(
        Array.from(assetId),
        Array.from(oracleFeedId),
        maxLeverageBps,
        takerFeeBps,
        makerRebateBps,
        new BN(fundingIntervalSecs.toString()),
      )
      .accounts({
        admin: this.wallet.publicKey,
        market,
        vault,
        vaultTokenAccount,
        mint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: new PublicKey("SysvarRent111111111111111111111111111111111"),
      })
      .rpc();
  }

  // ─── User management ───────────────────────────────────────────────────────

  async initializeUser(market: PublicKey): Promise<TransactionSignature> {
    const [userAccount] = userPda(this.programId, market, this.wallet.publicKey);
    return this.m
      .initializeUser()
      .accounts({
        owner: this.wallet.publicKey,
        market,
        userAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // ─── Collateral ────────────────────────────────────────────────────────────

  async depositCollateral(
    market: PublicKey,
    amountLamports: bigint,
    mint: PublicKey,
  ): Promise<TransactionSignature> {
    const [userAccount] = userPda(this.programId, market, this.wallet.publicKey);
    const [vault] = vaultPda(this.programId, market);
    const vaultTokenAccount = getAssociatedTokenAddressSync(mint, vault, true);
    const ownerTokenAccount = getAssociatedTokenAddressSync(mint, this.wallet.publicKey);

    return this.m
      .depositCollateral(new BN(amountLamports.toString()))
      .accounts({
        owner: this.wallet.publicKey,
        market,
        userAccount,
        vault,
        vaultTokenAccount,
        ownerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async withdrawCollateral(
    market: PublicKey,
    amountLamports: bigint,
    mint: PublicKey,
  ): Promise<TransactionSignature> {
    const [userAccount] = userPda(this.programId, market, this.wallet.publicKey);
    const [vault] = vaultPda(this.programId, market);
    const vaultTokenAccount = getAssociatedTokenAddressSync(mint, vault, true);
    const ownerTokenAccount = getAssociatedTokenAddressSync(mint, this.wallet.publicKey);

    return this.m
      .withdrawCollateral(new BN(amountLamports.toString()))
      .accounts({
        owner: this.wallet.publicKey,
        market,
        userAccount,
        vault,
        vaultTokenAccount,
        ownerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // ─── Delegation ────────────────────────────────────────────────────────────

  /**
   * Delegates the OrderBook PDA to the MagicBlock ER.
   * Remaining accounts include the ER validator pubkey.
   */
  async delegateBook(market: PublicKey): Promise<TransactionSignature> {
    const [orderBook] = bookPda(this.programId, market);

    // Delegation program IDs from MagicBlock SDK.
    const DELEGATION_PROGRAM_ID = new PublicKey(
      "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
    );
    const [buffer] = PublicKey.findProgramAddressSync(
      [Buffer.from("buffer"), orderBook.toBytes()],
      DELEGATION_PROGRAM_ID,
    );
    const [delegationRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegation"), orderBook.toBytes()],
      DELEGATION_PROGRAM_ID,
    );
    const [delegationMetadata] = PublicKey.findProgramAddressSync(
      [Buffer.from("delegation-metadata"), orderBook.toBytes()],
      DELEGATION_PROGRAM_ID,
    );

    const validatorAccount: AccountMeta = {
      pubkey: ER_VALIDATOR_DEVNET,
      isSigner: false,
      isWritable: false,
    };

    return this.m
      .delegateBook()
      .accounts({
        payer: this.wallet.publicKey,
        market,
        orderBook,
        ownerProgram: this.programId,
        buffer,
        delegationRecord,
        delegationMetadata,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([validatorAccount])
      .rpc();
  }

  // ─── Orders ────────────────────────────────────────────────────────────────

  /**
   * Places a dark order. Generates a random salt, computes the on-chain
   * commitment, and returns both the tx signature and the plaintext payload
   * (which the trader must store and later reveal at claim_fill time).
   */
  async placeOrder(
    market: PublicKey,
    side: Side,
    priceTicks: bigint,
    sizeBand: SizeBand,
    leverageBps: number,
    sizeLots: bigint,
  ): Promise<{ sig: TransactionSignature; orderId: bigint; payload: OrderPayload }> {
    const [userAccount] = userPda(this.programId, market, this.wallet.publicKey);
    const [orderBook] = bookPda(this.programId, market);
    const { payload, commitment } = generateOrderPayload(
      sizeLots,
      leverageBps,
      this.wallet.publicKey,
    );

    // Map Side/SizeBand enums to Anchor-compatible variant objects.
    const sideArg = side === Side.Long ? { long: {} } : { short: {} };
    const bandArg = (() => {
      switch (sizeBand) {
        case SizeBand.Small: return { small: {} };
        case SizeBand.Medium: return { medium: {} };
        case SizeBand.Large: return { large: {} };
        case SizeBand.Whale: return { whale: {} };
      }
    })();

    const sig = await this.m
      .placeOrder(
        sideArg,
        new BN(priceTicks.toString()),
        bandArg,
        leverageBps,
        Array.from(commitment),
      )
      .accounts({
        trader: this.wallet.publicKey,
        market,
        userAccount,
        orderBook,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fetch the latest order book state to extract the assigned order ID.
    // On-chain, next_order_id is incremented after placement; the placed order
    // gets id = next_order_id - 1. We read it from the emitted event ideally;
    // for now we read the book directly.
    const book = await this.acct["orderBook"].fetch(orderBook);
    const orderId = BigInt(book.nextOrderId.toString()) - 1n;

    return { sig, orderId, payload };
  }

  /**
   * Places a dark order using the Stage 1 Encrypt FHE-compatible encryption layer.
   *
   * Instead of sha256(salt‖size‖leverage‖trader), the on-chain commitment is
   * sha256(encrypted_blob) — the encrypted blob itself is stored off-chain.
   * The settler decrypts with the ephemeral private key at claim_fill time.
   *
   * This is compatible with future Encrypt.xyz FHE threshold decryption:
   * when Encrypt mainnet launches, the ephemeral key is replaced by a
   * threshold decryption request via Encrypt CPI.
   *
   * @param settlerPublicKey - x25519 public key of the settler (32 bytes)
   * @returns signature, orderId, and the encrypted blob (store for later reveal)
   */
  async placeEncryptedOrder(
    market: PublicKey,
    side: Side,
    priceTicks: bigint,
    sizeBand: SizeBand,
    leverageBps: number,
    sizeLots: bigint,
    settlerPublicKey: Uint8Array,
  ): Promise<{ sig: TransactionSignature; orderId: bigint; encryptedBlob: EncryptedOrderBlob }> {
    const [userAccount] = userPda(this.programId, market, this.wallet.publicKey);
    const [orderBook] = bookPda(this.programId, market);

    // Generate salt for compatibility with cancel_order (salt still needed as plaintext proof)
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(32));

    // Encrypt the full order using Stage 1 encrypt layer
    const encryptedBlob = await encryptOrderBlob(
      salt,
      sizeLots,
      leverageBps,
      side,
      priceTicks,
      settlerPublicKey,
    );

    // On-chain commitment = sha256(encrypted blob), not sha256(plaintext)
    const commitment = encryptedBlob.commitment;

    const sideArg = side === Side.Long ? { long: {} } : { short: {} };
    const bandArg = (() => {
      switch (sizeBand) {
        case SizeBand.Small: return { small: {} };
        case SizeBand.Medium: return { medium: {} };
        case SizeBand.Large: return { large: {} };
        case SizeBand.Whale: return { whale: {} };
      }
    })();

    const sig = await this.m
      .placeOrder(
        sideArg,
        new BN(priceTicks.toString()),
        bandArg,
        leverageBps,
        Array.from(commitment),
      )
      .accounts({
        trader: this.wallet.publicKey,
        market,
        userAccount,
        orderBook,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const book = await this.acct["orderBook"].fetch(orderBook);
    const orderId = BigInt(book.nextOrderId.toString()) - 1n;

    return { sig, orderId, encryptedBlob };
  }

  async cancelOrder(
    market: PublicKey,
    orderId: bigint,
    payload: OrderPayload,
  ): Promise<TransactionSignature> {
    const [userAccount] = userPda(this.programId, market, this.wallet.publicKey);
    const [orderBook] = bookPda(this.programId, market);

    return this.m
      .cancelOrder(
        new BN(orderId.toString()),
        Array.from(payload.salt),
        new BN(payload.sizeLots.toString()),
        payload.leverageBps,
      )
      .accounts({
        trader: this.wallet.publicKey,
        market,
        userAccount,
        orderBook,
      })
      .rpc();
  }

  // ─── ER instructions (sent to erConnection) ────────────────────────────────

  /** Permissionless crank: match up to 32 bid/ask pairs in the ER order book. */
  async matchOrders(market: PublicKey): Promise<TransactionSignature> {
    const [orderBook] = bookPda(this.programId, market);
    return this.em
      .matchOrders()
      .accounts({
        market,
        orderBook,
      })
      .rpc();
  }

  /** Trigger a manual commit of the OrderBook state from ER to mainnet. */
  async commitBook(market: PublicKey): Promise<TransactionSignature> {
    const [orderBook] = bookPda(this.programId, market);
    const m = await this.acct["market"].fetch(market);
    const admin = m.admin as PublicKey;
    const magicContext = new PublicKey("MagicContext1111111111111111111111111111111");
    const magicProgram = new PublicKey("Magic11111111111111111111111111111111111111");
    return this.em
      .commitBook()
      .accounts({
        payer: this.wallet.publicKey,
        orderBook,
        market,
        admin,
        magicContext,
        magicProgram,
      })
      .rpc();
  }

  /** Commit OrderBook state and return PDA ownership to mainnet. */
  async commitAndUndelegateBook(market: PublicKey): Promise<TransactionSignature> {
    const [orderBook] = bookPda(this.programId, market);
    const m = await this.acct["market"].fetch(market);
    const admin = m.admin as PublicKey;
    const magicContext = new PublicKey("MagicContext1111111111111111111111111111111");
    const magicProgram = new PublicKey("Magic11111111111111111111111111111111111111");
    return this.em
      .commitAndUndelegateBook()
      .accounts({
        payer: this.wallet.publicKey,
        orderBook,
        market,
        admin,
        magicContext,
        magicProgram,
      })
      .rpc();
  }

  // ─── Settlement ────────────────────────────────────────────────────────────

  /**
   * Settle a matched fill: verifies both commitments on-chain, creates
   * Position accounts for taker and maker, adjusts collateral.
   *
   * @param takerPosIdx - position index slot to use for the taker (caller must track)
   * @param makerPosIdx - position index slot to use for the maker
   */
  async claimFill(
    market: PublicKey,
    fillId: bigint,
    taker: PublicKey,
    takerPayload: OrderPayload,
    takerPosIdx: number,
    maker: PublicKey,
    makerPayload: OrderPayload,
    makerPosIdx: number,
  ): Promise<TransactionSignature> {
    const [orderBook] = bookPda(this.programId, market);
    const [takerUserAccount] = userPda(this.programId, market, taker);
    const [makerUserAccount] = userPda(this.programId, market, maker);
    const [takerPosition] = positionPda(this.programId, market, taker, takerPosIdx);
    const [makerPosition] = positionPda(this.programId, market, maker, makerPosIdx);

    const takerCommitment = Array.from(
      computeCommitment(takerPayload.salt, takerPayload.sizeLots, takerPayload.leverageBps, taker),
    );
    const makerCommitment = Array.from(
      computeCommitment(makerPayload.salt, makerPayload.sizeLots, makerPayload.leverageBps, maker),
    );

    return this.m
      .claimFill(
        new BN(fillId.toString()),
        Array.from(takerPayload.salt),
        new BN(takerPayload.sizeLots.toString()),
        takerPayload.leverageBps,
        takerCommitment,
        Array.from(makerPayload.salt),
        new BN(makerPayload.sizeLots.toString()),
        makerPayload.leverageBps,
        makerCommitment,
      )
      .accounts({
        settler: this.wallet.publicKey,
        market,
        orderBook,
        takerUser: takerUserAccount,
        makerUser: makerUserAccount,
        takerPosition,
        makerPosition,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // ─── Positions ─────────────────────────────────────────────────────────────

  /**
   * Computes unrealized PnL and mark price off-chain from oracle data.
   * Calls mark_position on-chain for the side-effect of flagging liquidatable positions.
   */
  async markPosition(
    positionPdaKey: PublicKey,
    priceUpdateAccount: PublicKey,
  ): Promise<MarkResult> {
    // Fetch position and market to compute PnL.
    const pos = await this.acct["position"].fetch(positionPdaKey);
    const marketKey: PublicKey = pos.market;
    const market = await this.acct["market"].fetch(marketKey);

    // Parse oracle price from the updateData (first 8 bytes = price i64 BE, units of 10^expo).
    // For now we pull a fresh Hermes price since the raw bytes come from Hermes anyway.
    const pythPrice = await fetchPythPrice(SOL_USD_FEED_ID);
    // pythPrice.price is in 1e-6 USD; our priceTicks are "micro-USDC per lot".
    const markPrice = pythPrice.price;

    const entryPrice = BigInt(pos.entryPriceTicks.toString());
    const sizeLots = BigInt(pos.sizeLots.toString());
    const side: Side = Object.keys(pos.side)[0] === "long" ? Side.Long : Side.Short;

    const priceDelta = side === Side.Long
      ? markPrice - entryPrice
      : entryPrice - markPrice;
    const unrealizedPnl = priceDelta * sizeLots;

    // Submit on-chain mark (no state change unless liquidatable; non-blocking).
    void this.m
      .markPosition()
      .accounts({
        market: marketKey,
        position: positionPdaKey,
        priceUpdate: priceUpdateAccount,
      })
      .rpc()
      .catch(() => {
        // best-effort; caller can re-check if needed
      });

    return { unrealizedPnl, markPrice };
  }

  async liquidatePosition(
    positionPdaKey: PublicKey,
    priceUpdateAccount: PublicKey,
    mint: PublicKey,
  ): Promise<TransactionSignature> {
    const pos = await this.acct["position"].fetch(positionPdaKey);
    const marketKey: PublicKey = pos.market;
    const posOwner: PublicKey = pos.owner;
    const [userAccount] = userPda(this.programId, marketKey, posOwner);
    const [vault] = vaultPda(this.programId, marketKey);
    const vaultTokenAccount = getAssociatedTokenAddressSync(mint, vault, true);
    const liquidatorTokenAccount = getAssociatedTokenAddressSync(
      mint, this.wallet.publicKey,
    );

    return this.m
      .liquidatePosition()
      .accounts({
        market: marketKey,
        position: positionPdaKey,
        userAccount,
        priceUpdate: priceUpdateAccount,
        vault,
        vaultTokenAccount,
        liquidatorTokenAccount,
        liquidator: this.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async closePosition(
    positionPdaKey: PublicKey,
    priceUpdateAccount: PublicKey,
  ): Promise<TransactionSignature> {
    const pos = await this.acct["position"].fetch(positionPdaKey);
    const marketKey: PublicKey = pos.market;
    const owner: PublicKey = pos.owner;
    const [userAccount] = userPda(this.programId, marketKey, owner);

    return this.m
      .closePosition()
      .accounts({
        market: marketKey,
        position: positionPdaKey,
        userAccount,
        priceUpdate: priceUpdateAccount,
        owner,
      })
      .rpc();
  }

  /**
   * Close position and transfer up to `payoutAmount` USDC from the market vault to the owner's ATA.
   * Payout is capped on-chain by unlocked collateral after settlement.
   */
  async closePositionAndWithdraw(
    positionPdaKey: PublicKey,
    priceUpdateAccount: PublicKey,
    mint: PublicKey,
    payoutAmount: BN | bigint,
  ): Promise<TransactionSignature> {
    const pos = await this.acct["position"].fetch(positionPdaKey);
    const marketKey: PublicKey = pos.market;
    const owner: PublicKey = pos.owner;
    const [userAccount] = userPda(this.programId, marketKey, owner);
    const [vault] = vaultPda(this.programId, marketKey);
    const vaultTokenAccount = getAssociatedTokenAddressSync(mint, vault, true);
    const ownerTokenAccount = getAssociatedTokenAddressSync(mint, owner);

    const payoutBn = typeof payoutAmount === "bigint"
      ? new BN(payoutAmount.toString())
      : payoutAmount;

    return this.m
      .closePositionAndWithdraw(payoutBn)
      .accounts({
        market: marketKey,
        position: positionPdaKey,
        userAccount,
        priceUpdate: priceUpdateAccount,
        owner,
        vault,
        vaultTokenAccount,
        ownerTokenAccount,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  // ─── Read-only queries ─────────────────────────────────────────────────────

  /**
   * Fetches the order book snapshot from the ER (or mainnet if not delegated).
   * Returns bids sorted descending by price, asks ascending.
   */
  async fetchOrderBook(market: PublicKey): Promise<OrderBookSnapshot> {
    const [bookKey] = bookPda(this.programId, market);
    // Try ER first; fall back to mainnet if the book isn't delegated.
    let raw: Record<string, unknown>;
    try {
      raw = await this.eracct["orderBook"].fetch(bookKey);
    } catch {
      raw = await this.acct["orderBook"].fetch(bookKey);
    }

    // The on-chain OrderBook stores bids/asks as BTreeMap serialised by Anchor.
    // Anchor deserialises maps as arrays of [key, value] tuples in JS.
    const parseOrders = (entries: unknown): Order[] => {
      if (!Array.isArray(entries)) return [];
      const orders: Order[] = [];
      for (const [, orderVec] of entries as [unknown, unknown[]][]) {
        for (const o of orderVec as Record<string, unknown>[]) {
          orders.push({
            orderId: BigInt((o.orderId as { toString(): string }).toString()),
            trader: o.trader as PublicKey,
            side: "long" in (o.side as Record<string, unknown>) ? Side.Long : Side.Short,
            priceTicks: BigInt((o.priceTicks as { toString(): string }).toString()),
            sizeBand: parseSizeBand(o.sizeBand as Record<string, unknown>),
            leverageBps: o.leverageBps as number,
            commitment: new Uint8Array(o.commitment as number[]),
            placedSlot: BigInt((o.placedSlot as { toString(): string }).toString()),
          });
        }
      }
      return orders;
    };

    const parseFills = (vec: unknown): Fill[] => {
      if (!Array.isArray(vec)) return [];
      return (vec as Record<string, unknown>[]).map((f) => ({
        fillId: BigInt((f.fillId as { toString(): string }).toString()),
        takerOrderId: BigInt((f.takerOrderId as { toString(): string }).toString()),
        makerOrderId: BigInt((f.makerOrderId as { toString(): string }).toString()),
        taker: f.taker as PublicKey,
        maker: f.maker as PublicKey,
        priceTicks: BigInt((f.priceTicks as { toString(): string }).toString()),
        sizeBand: parseSizeBand(f.sizeBand as Record<string, unknown>),
        matchedSlot: BigInt((f.matchedSlot as { toString(): string }).toString()),
        claimed: f.claimed as boolean,
      }));
    };

    const bids = parseOrders(raw.bids);
    const asks = parseOrders(raw.asks);
    bids.sort((a, b) => (b.priceTicks > a.priceTicks ? 1 : -1)); // desc
    asks.sort((a, b) => (a.priceTicks > b.priceTicks ? 1 : -1)); // asc

    return { bids, asks, fills: parseFills(raw.fills) };
  }

  /**
   * Fetches all Position accounts for `owner` on the given market.
   * Scans indices 0..N until an account is not found.
   */
  async fetchUserPositions(market: PublicKey, owner: PublicKey): Promise<Position[]> {
    const positions: Position[] = [];
    let idx = 0;
    while (true) {
      const [pdaKey] = positionPda(this.programId, market, owner, idx);
      try {
        const raw = await this.acct["position"].fetch(pdaKey);
        const status = parsePositionStatus(raw.status as Record<string, unknown>);
        positions.push({
          owner: raw.owner as PublicKey,
          market: raw.market as PublicKey,
          side: "long" in (raw.side as Record<string, unknown>) ? Side.Long : Side.Short,
          sizeLots: BigInt((raw.sizeLots as { toString(): string }).toString()),
          entryPriceTicks: BigInt((raw.entryPriceTicks as { toString(): string }).toString()),
          collateralLocked: BigInt((raw.collateralLocked as { toString(): string }).toString()),
          openedTs: BigInt((raw.openedTs as { toString(): string }).toString()),
          lastFundingIndex: BigInt((raw.lastFundingIndex as { toString(): string }).toString()),
          status,
          positionIdx: idx,
        });
        idx++;
      } catch {
        break;
      }
    }
    return positions;
  }

  /**
   * Subscribes to on-chain account changes for the market's order book and
   * emits the current mark price on each update by fetching a fresh oracle price.
   *
   * Returns an unsubscribe function.
   */
  streamMarkPrice(market: PublicKey, cb: (price: bigint) => void): () => void {
    const [bookKey] = bookPda(this.programId, market);
    const id = this.connection.onAccountChange(bookKey, async () => {
      try {
        const p = await fetchPythPrice(SOL_USD_FEED_ID);
        cb(p.price);
      } catch {
        // non-fatal; next update will retry
      }
    });
    return () => { void this.connection.removeAccountChangeListener(id); };
  }

  // ─── Funding helpers ────────────────────────────────────────────────────────

  async updateFunding(
    market: PublicKey,
    priceUpdateAccount: PublicKey,
  ): Promise<TransactionSignature> {
    return this.m
      .updateFunding()
      .accounts({
        market,
        priceUpdate: priceUpdateAccount,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();
  }

  async accrueFunding(
    market: PublicKey,
    positionPdaKey: PublicKey,
    positionOwner: PublicKey,
  ): Promise<TransactionSignature> {
    const [userAccount] = userPda(this.programId, market, positionOwner);
    return this.m
      .accrueFundingPosition()
      .accounts({
        market,
        position: positionPdaKey,
        userAccount,
      })
      .rpc();
  }

  // ─── Ika dWallet Bridge ────────────────────────────────────────────────────

  /** Ika dWallet program ID (devnet pre-alpha). */
  static IKA_PROGRAM_ID = new PublicKey("Fg6PaFpoGXkYsidMpWTxq8cQqU5cPqQkz6xcKozxZxHz");

  /** CPI authority PDA for DarkBook → Ika. */
  static cpiAuthorityPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("__ika_cpi_authority")],
      new PublicKey("3F99U2rZ2fob5NBgVTqQYqMq8whF4WUqiZXgeaYPE7yf"),
    );
  }

  /** DWalletConfig PDA (one per user per market). */
  dwalletConfigPda(market: PublicKey, owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("ika-dwallet"), market.toBuffer(), owner.toBuffer()],
      this.programId,
    );
  }

  /**
   * Link an Ika dWallet to a DarkBook user account.
   * Transfers the dWallet's authority to DarkBook's CPI authority PDA.
   *
   * @param dwallet - The Ika dWallet account (created via Ika program)
   * @param market - The DarkBook market
   */
  async registerDWallet(
    dwallet: PublicKey,
    market: PublicKey,
  ): Promise<TransactionSignature> {
    const [config] = this.dwalletConfigPda(market, this.wallet.publicKey);
    const [userAccount] = userPda(this.programId, market, this.wallet.publicKey);
    const [cpiAuthority] = DarkbookClient.cpiAuthorityPda();

    return this.m
      .registerDwallet()
      .accounts({
        config,
        dwallet,
        market,
        userAccount,
        owner: this.wallet.publicKey,
        payer: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        dwalletProgram: DarkbookClient.IKA_PROGRAM_ID,
        cpiAuthority,
        darkbookProgram: this.programId,
      })
      .rpc();
  }

  /**
   * Approve a withdrawal message for Ika signing (cross-chain).
   * Called after close_position to authorize the Ika network to sign
   * a payout transaction on the target chain.
   *
   * @param dwallet - The dWallet linked to the position owner
   * @param coordinator - DWalletCoordinator PDA (Ika program)
   * @param messageDigest - 32-byte message digest to sign
   * @param userPubkey - User's public key for the target chain (32 bytes)
   * @param signatureScheme - Signature scheme (see Ika docs for values)
   */
  async approveDWalletWithdrawal(
    dwallet: PublicKey,
    coordinator: PublicKey,
    messageDigest: Uint8Array,
    userPubkey: Uint8Array,
    signatureScheme: number,
  ): Promise<TransactionSignature> {
    const [cpiAuthority] = DarkbookClient.cpiAuthorityPda();
    const msgSeed = Buffer.from("ika-msg");
    const [messageApproval] = PublicKey.findProgramAddressSync(
      [msgSeed, dwallet.toBuffer(), Buffer.from(messageDigest)],
      DarkbookClient.IKA_PROGRAM_ID,
    );

    return this.m
      .approveDwalletWithdrawal(
        Array.from(messageDigest),
        Array.from(userPubkey),
        signatureScheme,
      )
      .accounts({
        dwallet,
        coordinator,
        messageApproval,
        dwalletProgram: DarkbookClient.IKA_PROGRAM_ID,
        cpiAuthority,
        darkbookProgram: this.programId,
        payer: this.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function parseSizeBand(v: Record<string, unknown>): SizeBand {
  if ("small" in v) return SizeBand.Small;
  if ("medium" in v) return SizeBand.Medium;
  if ("large" in v) return SizeBand.Large;
  return SizeBand.Whale;
}

function parsePositionStatus(v: Record<string, unknown>): PositionStatus {
  if ("open" in v) return PositionStatus.Open;
  if ("liquidated" in v) return PositionStatus.Liquidated;
  return PositionStatus.Closed;
}
