/**
 * DarkbookClient — typed Anchor wrapper for all DarkBook on-chain instructions.
 *
 * Base-layer instructions (initializeMarket, deposit, withdraw, placeOrder,
 * cancelOrder, claimFill, markPosition, liquidatePosition, closePosition)
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
  SYSVAR_INSTRUCTIONS_PUBKEY,
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
import { generateOrderPayload, lotsToBand } from "./encryption.js";
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
        cranker: this.wallet.publicKey,
        market,
        orderBook,
      })
      .rpc();
  }

  /** Trigger a manual commit of the OrderBook state from ER to mainnet. */
  async commitBook(market: PublicKey): Promise<TransactionSignature> {
    const [orderBook] = bookPda(this.programId, market);
    const MAGIC_CONTEXT = new PublicKey("MagicContext111111111111111111111111111111");
    const MAGIC_PROGRAM = new PublicKey("MagicProgram1111111111111111111111111111111");
    return this.em
      .commitBook()
      .accounts({
        payer: this.wallet.publicKey,
        market,
        orderBook,
        magicContext: MAGIC_CONTEXT,
        magicProgram: MAGIC_PROGRAM,
      })
      .rpc();
  }

  /** Commit OrderBook state and return PDA ownership to mainnet. */
  async commitAndUndelegateBook(market: PublicKey): Promise<TransactionSignature> {
    const [orderBook] = bookPda(this.programId, market);
    const MAGIC_CONTEXT = new PublicKey("MagicContext111111111111111111111111111111");
    const MAGIC_PROGRAM = new PublicKey("MagicProgram1111111111111111111111111111111");
    return this.em
      .commitAndUndelegateBook()
      .accounts({
        payer: this.wallet.publicKey,
        market,
        orderBook,
        magicContext: MAGIC_CONTEXT,
        magicProgram: MAGIC_PROGRAM,
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
    oracleUpdate: Uint8Array,
  ): Promise<TransactionSignature> {
    const [orderBook] = bookPda(this.programId, market);
    const [takerUserAccount] = userPda(this.programId, market, taker);
    const [makerUserAccount] = userPda(this.programId, market, maker);
    const [takerPosition] = positionPda(this.programId, market, taker, takerPosIdx);
    const [makerPosition] = positionPda(this.programId, market, maker, makerPosIdx);

    return this.m
      .claimFill(
        new BN(fillId.toString()),
        Array.from(takerPayload.salt),
        new BN(takerPayload.sizeLots.toString()),
        takerPayload.leverageBps,
        Array.from(makerPayload.salt),
        new BN(makerPayload.sizeLots.toString()),
        makerPayload.leverageBps,
        Buffer.from(oracleUpdate),
      )
      .accounts({
        settler: this.wallet.publicKey,
        market,
        orderBook,
        takerUserAccount,
        makerUserAccount,
        takerPosition,
        makerPosition,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
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
    oracleUpdate: Uint8Array,
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
      .markPosition(Buffer.from(oracleUpdate))
      .accounts({
        caller: this.wallet.publicKey,
        market: marketKey,
        position: positionPdaKey,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .rpc()
      .catch(() => {
        // best-effort; caller can re-check if needed
      });

    return { unrealizedPnl, markPrice };
  }

  async liquidatePosition(
    positionPdaKey: PublicKey,
    oracleUpdate: Uint8Array,
    mint: PublicKey,
  ): Promise<TransactionSignature> {
    const pos = await this.acct["position"].fetch(positionPdaKey);
    const marketKey: PublicKey = pos.market;
    const posOwner: PublicKey = pos.trader;
    const [userAccount] = userPda(this.programId, marketKey, posOwner);
    const [vault] = vaultPda(this.programId, marketKey);
    const vaultTokenAccount = getAssociatedTokenAddressSync(mint, vault, true);
    const liquidatorTokenAccount = getAssociatedTokenAddressSync(
      mint, this.wallet.publicKey,
    );

    return this.m
      .liquidatePosition(Buffer.from(oracleUpdate))
      .accounts({
        liquidator: this.wallet.publicKey,
        market: marketKey,
        position: positionPdaKey,
        userAccount,
        vault,
        vaultTokenAccount,
        liquidatorTokenAccount,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async closePosition(
    positionPdaKey: PublicKey,
    oracleUpdate: Uint8Array,
    mint: PublicKey,
  ): Promise<TransactionSignature> {
    const pos = await this.acct["position"].fetch(positionPdaKey);
    const marketKey: PublicKey = pos.market;
    const [userAccount] = userPda(this.programId, marketKey, this.wallet.publicKey);
    const [vault] = vaultPda(this.programId, marketKey);
    const vaultTokenAccount = getAssociatedTokenAddressSync(mint, vault, true);
    const traderTokenAccount = getAssociatedTokenAddressSync(mint, this.wallet.publicKey);

    return this.m
      .closePosition(Buffer.from(oracleUpdate))
      .accounts({
        trader: this.wallet.publicKey,
        market: marketKey,
        position: positionPdaKey,
        userAccount,
        vault,
        vaultTokenAccount,
        traderTokenAccount,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
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
          trader: raw.trader as PublicKey,
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
    oracleUpdate: Uint8Array,
  ): Promise<TransactionSignature> {
    return this.m
      .updateFunding(Buffer.from(oracleUpdate))
      .accounts({
        cranker: this.wallet.publicKey,
        market,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
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
      .accrueFunding()
      .accounts({
        cranker: this.wallet.publicKey,
        market,
        position: positionPdaKey,
        userAccount,
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
