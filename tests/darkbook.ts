/**
 * darkbook.ts — Comprehensive bankrun test suite for DarkBook.
 *
 * Tests use solana-bankrun (in-process validator) for fast execution.
 * MagicBlock ER delegation is NOT simulated — match_orders is called directly
 * in test mode (the delegation check is bypassed by constructing state manually).
 *
 * Pyth oracle is mocked via a fabricated PriceUpdateV2 account because
 * bankrun cannot pull live feeds from the network.
 *
 * Each describe block is fully independent: fresh keypairs, fresh market per test.
 */

import * as anchor from "@coral-xyz/anchor";
const { BN } = anchor;
import { assert, expect } from "chai";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { startAnchor, BanksClient, ProgramTestContext } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";

import {
  deriveMarketPDA,
  deriveVaultPDA,
  deriveBookPDA,
  deriveUserPDA,
  derivePositionPDA,
  assetIdFromString,
  solUsdFeedId,
  createMockPriceUpdateData,
  USDC_DECIMALS,
  USDC_MULTIPLIER,
} from "./setup";

import {
  computeCommitment,
  randomSalt,
  deserializeOrderBook,
  computeCollateral,
  computeCollateralEstimate,
  unrealizedPnl,
  expectError,
  usdcAmount,
  dollarsToPriceTicks,
} from "./utils";

// ─── Program ID (from Anchor.toml) ────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("9i4Gpnt8GgrwxqwXdEyjFBsfNChis8z9jmyAbMpFVLcS");

// ─── Market parameters used across tests ─────────────────────────────────────
const DEFAULT_MAX_LEVERAGE_BPS = 10000; // 100x
const DEFAULT_TAKER_FEE_BPS = 5; // 0.05%
const DEFAULT_MAKER_REBATE_BPS = 2; // 0.02%
const DEFAULT_FUNDING_INTERVAL_SECS = 8 * 3600; // 8h

// ─── Helper: build a bankrun context + program ────────────────────────────────

async function setupContext(): Promise<{
  context: ProgramTestContext;
  provider: BankrunProvider;
  program: anchor.Program;
  client: BanksClient;
}> {
  const context = await startAnchor(
    "/Users/kamal/Desktop/frontier/build/darkbook",
    [],
    []
  );
  const provider = new BankrunProvider(context);
  anchor.setProvider(provider);
  // Load IDL from workspace (built by anchor build)
  const idl = require("../target/idl/darkbook.json");
  const program = new anchor.Program(idl, provider);
  const client = context.banksClient;
  return { context, provider, program, client };
}

// ─── Helper: create USDC mint + fund users via bankrun ────────────────────────

interface MarketSetup {
  admin: Keypair;
  mint: PublicKey;
  mintAuthority: Keypair;
  marketPDA: PublicKey;
  vaultPDA: PublicKey;
  bookPDA: PublicKey;
  vaultTokenAccount: PublicKey;
  assetId: number[];
}

async function initializeMarket(
  context: ProgramTestContext,
  program: anchor.Program,
  assetName: string = "SOL-USDC"
): Promise<MarketSetup> {
  const provider = new BankrunProvider(context);
  // @ts-ignore
  const conn = provider.connection;

  const admin = Keypair.generate();
  const mintAuthority = Keypair.generate();
  // Airdrop SOL to admin for fees
  context.setAccount(admin.publicKey, {
    lamports: 10 * LAMPORTS_PER_SOL,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
  });

  const mint = await createMint(
    // @ts-ignore
    conn,
    admin,
    mintAuthority.publicKey,
    null,
    USDC_DECIMALS
  );

  const assetId = assetIdFromString(assetName);
  const assetIdBuf = Buffer.from(assetId);
  const [marketPDA] = deriveMarketPDA(PROGRAM_ID, assetIdBuf);
  const [vaultPDA] = deriveVaultPDA(PROGRAM_ID, marketPDA);
  const [bookPDA] = deriveBookPDA(PROGRAM_ID, marketPDA);

  // Create vault token account (owned by vaultPDA)
  const vaultTokenAccount = await createAccount(
    // @ts-ignore
    conn,
    admin,
    mint,
    vaultPDA
  );

  // Initialize oracle feed id (using SOL/USD devnet feed)
  const oracleFeedId = Array.from(solUsdFeedId());

  await program.methods
    .initializeMarket(
      assetId,
      oracleFeedId,
      DEFAULT_MAX_LEVERAGE_BPS,
      DEFAULT_TAKER_FEE_BPS,
      DEFAULT_MAKER_REBATE_BPS,
      new BN(DEFAULT_FUNDING_INTERVAL_SECS)
    )
    .accounts({
      market: marketPDA,
      vault: vaultPDA,
      mint,
      orderBook: bookPDA,
      admin: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([admin])
    .rpc();

  return {
    admin,
    mint,
    mintAuthority,
    marketPDA,
    vaultPDA,
    bookPDA,
    vaultTokenAccount,
    assetId,
  };
}

// ─── Helper: setup a user (init account + deposit) ────────────────────────────

interface UserSetup {
  keypair: Keypair;
  userPDA: PublicKey;
  tokenAccount: PublicKey;
}

async function setupUser(
  context: ProgramTestContext,
  program: anchor.Program,
  market: MarketSetup,
  depositUsdcHuman: number
): Promise<UserSetup> {
  const provider = new BankrunProvider(context);
  // @ts-ignore
  const conn = provider.connection;

  const user = Keypair.generate();
  context.setAccount(user.publicKey, {
    lamports: 5 * LAMPORTS_PER_SOL,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
  });

  const [userPDA] = deriveUserPDA(PROGRAM_ID, market.marketPDA, user.publicKey);

  // Create user token account
  const tokenAccount = await createAccount(
    // @ts-ignore
    conn,
    user,
    market.mint,
    user.publicKey
  );

  // Mint USDC to user
  const depositAmount = BigInt(depositUsdcHuman) * BigInt(USDC_MULTIPLIER);

  if (depositAmount > BigInt(0)) {
    await mintTo(
      // @ts-ignore
      conn,
      market.admin,
      market.mint,
      tokenAccount,
      market.mintAuthority,
      depositAmount
    );
  }

  // Initialize user account
  await program.methods
    .initializeUser()
    .accounts({
      userAccount: userPDA,
      market: market.marketPDA,
      owner: user.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();

  if (depositAmount > BigInt(0)) {
    // Deposit collateral
    await program.methods
      .depositCollateral(new BN(depositAmount.toString()))
      .accounts({
        userAccount: userPDA,
        market: market.marketPDA,
        vault: market.vaultPDA,
        vaultTokenAccount: market.vaultTokenAccount,
        userTokenAccount: tokenAccount,
        owner: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: market.mint,
      })
      .signers([user])
      .rpc();
  }

  return { keypair: user, userPDA, tokenAccount };
}

// ─── Helper: place an order ────────────────────────────────────────────────────

interface PlacedOrder {
  orderId: bigint;
  salt: Buffer;
  sizeLots: bigint;
  leverageBps: number;
  commitment: Buffer;
  priceTicks: bigint;
  side: "Long" | "Short";
}

async function placeOrder(
  context: ProgramTestContext,
  program: anchor.Program,
  market: MarketSetup,
  user: UserSetup,
  params: {
    side: "Long" | "Short";
    priceTicks: bigint;
    sizeLots: bigint;
    leverageBps: number;
  }
): Promise<PlacedOrder> {
  const { side, priceTicks, sizeLots, leverageBps } = params;

  const salt = randomSalt();
  const commitment = computeCommitment(
    salt,
    sizeLots,
    leverageBps,
    user.keypair.publicKey
  );

  // Determine size band from sizeLots
  let sizeBand: any;
  if (sizeLots <= BigInt(10)) {
    sizeBand = { small: {} };
  } else if (sizeLots <= BigInt(100)) {
    sizeBand = { medium: {} };
  } else if (sizeLots <= BigInt(1000)) {
    sizeBand = { large: {} };
  } else {
    sizeBand = { whale: {} };
  }

  const sideVariant = side === "Long" ? { long: {} } : { short: {} };

  await program.methods
    .placeOrder(
      sideVariant,
      new BN(priceTicks.toString()),
      sizeBand,
      leverageBps,
      Array.from(commitment)
    )
    .accounts({
      market: market.marketPDA,
      userAccount: user.userPDA,
      orderBook: market.bookPDA,
      trader: user.keypair.publicKey,
    })
    .signers([user.keypair])
    .rpc();

  // Read book to get order ID (next_order_id was incremented)
  const bookAccount = await program.provider.connection.getAccountInfo(
    market.bookPDA
  );
  const book = deserializeOrderBook(Buffer.from(bookAccount!.data));
  // The just-placed order has id = next_order_id - 1
  const orderId = book.nextOrderId - BigInt(1);

  return { orderId, salt, sizeLots, leverageBps, commitment, priceTicks, side };
}

// ─── Helper: create mock Pyth price account ────────────────────────────────────

async function setMockPythPrice(
  context: ProgramTestContext,
  market: MarketSetup,
  priceUsd: number
): Promise<Keypair> {
  /**
   * WHY MOCK: Bankrun has no network access to pull real Pyth price accounts.
   * We fabricate a PriceUpdateV2 account with the correct binary layout so
   * the on-chain program can deserialize it via pyth-solana-receiver-sdk.
   * The mock uses Pyth's standard exponent of -8.
   */
  const pyth = Keypair.generate();
  const priceInt = BigInt(Math.round(priceUsd * 1e8));
  const now = BigInt(Math.floor(Date.now() / 1000));

  const data = createMockPriceUpdateData({
    feedId: solUsdFeedId(),
    price: priceInt,
    exponent: -8,
    publishTime: now,
  });

  context.setAccount(pyth.publicKey, {
    lamports: LAMPORTS_PER_SOL,
    data,
    // Pyth receiver program owns PriceUpdateV2 accounts
    owner: new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"),
    executable: false,
  });

  return pyth;
}

// ─── Helper: full match+settle cycle ──────────────────────────────────────────

interface MatchedPositions {
  alice: UserSetup;
  bob: UserSetup;
  alicePos: PublicKey;
  bobPos: PublicKey;
  aliceOrder: PlacedOrder;
  bobOrder: PlacedOrder;
  sizeLots: bigint;
  priceTicks: bigint;
  leverageBps: number;
}

async function setupMatchedPositions(
  context: ProgramTestContext,
  program: anchor.Program,
  market: MarketSetup,
  params: {
    priceUsd: number;
    sizeLots: bigint;
    leverageBps: number;
    aliceUsdcDeposit?: number;
    bobUsdcDeposit?: number;
  }
): Promise<MatchedPositions> {
  const {
    priceUsd,
    sizeLots,
    leverageBps,
    aliceUsdcDeposit = 10000,
    bobUsdcDeposit = 10000,
  } = params;

  const alice = await setupUser(context, program, market, aliceUsdcDeposit);
  const bob = await setupUser(context, program, market, bobUsdcDeposit);
  const settler = Keypair.generate();
  context.setAccount(settler.publicKey, {
    lamports: 5 * LAMPORTS_PER_SOL,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
  });

  const priceTicks = dollarsToPriceTicks(priceUsd);

  const aliceOrder = await placeOrder(context, program, market, alice, {
    side: "Short",
    priceTicks,
    sizeLots,
    leverageBps,
  });

  const bobOrder = await placeOrder(context, program, market, bob, {
    side: "Long",
    priceTicks,
    sizeLots,
    leverageBps,
  });

  await program.methods
    .matchOrders()
    .accounts({ market: market.marketPDA, orderBook: market.bookPDA })
    .rpc();

  const bi = await program.provider.connection.getAccountInfo(market.bookPDA);
  const bk = deserializeOrderBook(Buffer.from(bi!.data));
  const fi = Number((bk.fillHead - bk.fillCount) % BigInt(256));
  const fll = bk.fills[fi];

  const tuAcct = await program.account.userAccount.fetch(bob.userPDA);
  const muAcct = await program.account.userAccount.fetch(alice.userPDA);

  const [bobPos] = derivePositionPDA(
    PROGRAM_ID,
    market.marketPDA,
    bob.keypair.publicKey,
    BigInt(tuAcct.nextPositionIdx.toString())
  );
  const [alicePos] = derivePositionPDA(
    PROGRAM_ID,
    market.marketPDA,
    alice.keypair.publicKey,
    BigInt(muAcct.nextPositionIdx.toString())
  );

  await program.methods
    .claimFill(
      new BN(fll.fillId.toString()),
      Array.from(bobOrder.salt),
      new BN(sizeLots.toString()),
      leverageBps,
      Array.from(bobOrder.commitment),
      Array.from(aliceOrder.salt),
      new BN(sizeLots.toString()),
      leverageBps,
      Array.from(aliceOrder.commitment)
    )
    .accounts({
      market: market.marketPDA,
      orderBook: market.bookPDA,
      takerUser: bob.userPDA,
      takerPosition: bobPos,
      makerUser: alice.userPDA,
      makerPosition: alicePos,
      settler: settler.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([settler])
    .rpc();

  return {
    alice,
    bob,
    alicePos,
    bobPos,
    aliceOrder,
    bobOrder,
    sizeLots,
    priceTicks,
    leverageBps,
  };
}

// =============================================================================
// ─── TEST SUITES ─────────────────────────────────────────────────────────────
// =============================================================================

describe("1. Market initialization", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
  });

  it("admin initializes SOL/USDC market with correct parameters", async () => {
    const market = await initializeMarket(ctx, program, "SOL-USD1a");
    const marketAcct = await program.account.market.fetch(market.marketPDA);

    assert.deepEqual(
      Array.from(marketAcct.assetId as any),
      market.assetId,
      "asset_id mismatch"
    );
    assert.equal(
      (marketAcct.maxLeverageBps as any).toNumber(),
      DEFAULT_MAX_LEVERAGE_BPS
    );
    assert.equal(
      (marketAcct.takerFeeBps as any).toNumber(),
      DEFAULT_TAKER_FEE_BPS
    );
    assert.equal(
      (marketAcct.makerRebateBps as any).toNumber(),
      DEFAULT_MAKER_REBATE_BPS
    );
    assert.equal(
      (marketAcct.fundingIntervalSecs as any).toNumber(),
      DEFAULT_FUNDING_INTERVAL_SECS
    );
    assert.equal(marketAcct.paused, false, "market should not be paused");
    assert.equal(
      marketAcct.admin.toBase58(),
      market.admin.publicKey.toBase58()
    );
  });

  it("OrderBook PDA initialized with zero orders and fills", async () => {
    const market = await initializeMarket(ctx, program, "SOL-USD1b");
    const bookInfo = await program.provider.connection.getAccountInfo(
      market.bookPDA
    );
    assert.ok(bookInfo, "book PDA should exist");
    const book = deserializeOrderBook(Buffer.from(bookInfo.data));
    assert.equal(book.bidCount, 0, "bid count should be 0");
    assert.equal(book.askCount, 0, "ask count should be 0");
    assert.equal(book.fillCount, 0, "fill count should be 0");
  });

  it("CollateralVault PDA has correct market + mint references", async () => {
    const market = await initializeMarket(ctx, program, "SOL-USD1c");
    const vault = await program.account.collateralVault.fetch(market.vaultPDA);
    assert.equal(vault.market.toBase58(), market.marketPDA.toBase58());
    assert.equal(vault.mint.toBase58(), market.mint.toBase58());
  });

  it("admin can pause and unpause market", async () => {
    const market = await initializeMarket(ctx, program, "SOL-USD1d");

    await program.methods
      .setMarketPaused(true)
      .accounts({ market: market.marketPDA, admin: market.admin.publicKey })
      .signers([market.admin])
      .rpc();
    let mkt = await program.account.market.fetch(market.marketPDA);
    assert.equal(mkt.paused, true);

    await program.methods
      .setMarketPaused(false)
      .accounts({ market: market.marketPDA, admin: market.admin.publicKey })
      .signers([market.admin])
      .rpc();
    mkt = await program.account.market.fetch(market.marketPDA);
    assert.equal(mkt.paused, false);
  });
});

// =============================================================================

describe("2. User onboarding (initialize_user + deposit + withdraw)", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD2a");
  });

  it("Alice initialize_user creates UserAccount PDA with zero balances", async () => {
    const provider = new BankrunProvider(ctx);
    const alice = Keypair.generate();
    ctx.setAccount(alice.publicKey, {
      lamports: 5 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const [aliceUserPDA] = deriveUserPDA(
      PROGRAM_ID,
      market.marketPDA,
      alice.publicKey
    );

    await program.methods
      .initializeUser()
      .accounts({
        userAccount: aliceUserPDA,
        market: market.marketPDA,
        owner: alice.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([alice])
      .rpc();

    const userAcct = await program.account.userAccount.fetch(aliceUserPDA);
    assert.equal(userAcct.owner.toBase58(), alice.publicKey.toBase58());
    assert.equal((userAcct.depositedAmount as BN).toNumber(), 0);
    assert.equal((userAcct.lockedAmount as BN).toNumber(), 0);
  });

  it("Alice deposits 100 USDC — deposited_amount reflects correctly", async () => {
    const provider = new BankrunProvider(ctx);
    // @ts-ignore
    const conn = provider.connection;

    const alice = await setupUser(ctx, program, market, 0);
    const depositAmt = usdcAmount(100);

    await mintTo(
      conn as any,
      market.admin,
      market.mint,
      alice.tokenAccount,
      market.mintAuthority,
      depositAmt
    );

    await program.methods
      .depositCollateral(new BN(depositAmt.toString()))
      .accounts({
        userAccount: alice.userPDA,
        market: market.marketPDA,
        vault: market.vaultPDA,
        vaultTokenAccount: market.vaultTokenAccount,
        userTokenAccount: alice.tokenAccount,
        owner: alice.keypair.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: market.mint,
      })
      .signers([alice.keypair])
      .rpc();

    const userAcct = await program.account.userAccount.fetch(alice.userPDA);
    assert.equal(
      (userAcct.depositedAmount as BN).toString(),
      depositAmt.toString()
    );
  });

  it("Alice withdraws 50 USDC from 100 USDC deposit — balance updates", async () => {
    const alice = await setupUser(ctx, program, market, 100);

    const withdrawAmt = usdcAmount(50);
    await program.methods
      .withdrawCollateral(new BN(withdrawAmt.toString()))
      .accounts({
        userAccount: alice.userPDA,
        market: market.marketPDA,
        vault: market.vaultPDA,
        vaultTokenAccount: market.vaultTokenAccount,
        userTokenAccount: alice.tokenAccount,
        owner: alice.keypair.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        mint: market.mint,
      })
      .signers([alice.keypair])
      .rpc();

    const userAcct = await program.account.userAccount.fetch(alice.userPDA);
    assert.equal(
      (userAcct.depositedAmount as BN).toString(),
      usdcAmount(50).toString()
    );
  });
});

// =============================================================================

describe("3. Order placement (commitment scheme)", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD3a");
  });

  it("Alice places short order — commitment stored, order appears in ask book", async () => {
    const alice = await setupUser(ctx, program, market, 5000);

    const priceTicks = dollarsToPriceTicks(200);
    const order = await placeOrder(ctx, program, market, alice, {
      side: "Short",
      priceTicks,
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    const bookInfo = await program.provider.connection.getAccountInfo(
      market.bookPDA
    );
    const book = deserializeOrderBook(Buffer.from(bookInfo!.data));

    assert.equal(book.askCount, 1, "should have 1 ask level");
    assert.equal(book.asks[0].count, 1, "ask bucket has 1 order");
    assert.deepEqual(
      Array.from(book.asks[0].orders[0].commitment),
      Array.from(order.commitment),
      "commitment stored on-chain should match locally computed commitment"
    );
    assert.equal(book.asks[0].orders[0].side, 1, "side should be Short(1)");
  });

  it("Bob places long order — both orders rest in book (non-crossing prices)", async () => {
    const alice = await setupUser(ctx, program, market, 5000);
    const bob = await setupUser(ctx, program, market, 5000);

    // Alice ask at $201, Bob bid at $199 — no cross, both rest
    await placeOrder(ctx, program, market, alice, {
      side: "Short",
      priceTicks: dollarsToPriceTicks(201),
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    await placeOrder(ctx, program, market, bob, {
      side: "Long",
      priceTicks: dollarsToPriceTicks(199),
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    const bookInfo = await program.provider.connection.getAccountInfo(
      market.bookPDA
    );
    const book = deserializeOrderBook(Buffer.from(bookInfo!.data));
    assert.ok(book.askCount >= 1, "should have at least 1 ask");
    assert.ok(book.bidCount >= 1, "should have at least 1 bid");
  });

  it("collateral is locked = size_band_ceiling × price / leverage", async () => {
    const alice = await setupUser(ctx, program, market, 5000);

    const priceTicks = dollarsToPriceTicks(200);
    const leverageBps = 1000; // 10x
    const sizeLots = BigInt(10); // Small band ceiling = 10

    const expectedLock = computeCollateralEstimate(
      "Small",
      priceTicks,
      leverageBps
    );

    const lockedBefore = (
      await program.account.userAccount.fetch(alice.userPDA)
    ).lockedAmount as BN;

    await placeOrder(ctx, program, market, alice, {
      side: "Short",
      priceTicks,
      sizeLots,
      leverageBps,
    });

    const userAcct = await program.account.userAccount.fetch(alice.userPDA);
    const lockedAfter = userAcct.lockedAmount as BN;
    const lockDelta = lockedAfter.sub(lockedBefore);

    assert.equal(
      lockDelta.toString(),
      expectedLock.toString(),
      "locked collateral delta should match estimated collateral"
    );
  });
});

// =============================================================================

describe("4. Order cancellation", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD4a");
  });

  it("Alice cancels order with correct plaintext — order removed from book", async () => {
    const alice = await setupUser(ctx, program, market, 5000);

    const order = await placeOrder(ctx, program, market, alice, {
      side: "Short",
      priceTicks: dollarsToPriceTicks(200),
      sizeLots: BigInt(5),
      leverageBps: 500,
    });

    await program.methods
      .cancelOrder(
        new BN(order.orderId.toString()),
        Array.from(order.salt),
        new BN(order.sizeLots.toString()),
        order.leverageBps
      )
      .accounts({
        market: market.marketPDA,
        userAccount: alice.userPDA,
        orderBook: market.bookPDA,
        trader: alice.keypair.publicKey,
      })
      .signers([alice.keypair])
      .rpc();

    const bookInfo = await program.provider.connection.getAccountInfo(
      market.bookPDA
    );
    const book = deserializeOrderBook(Buffer.from(bookInfo!.data));
    // Check order not in any ask bucket
    let found = false;
    for (let i = 0; i < book.askCount; i++) {
      for (let j = 0; j < book.asks[i].count; j++) {
        if (book.asks[i].orders[j].orderId === order.orderId) {
          found = true;
        }
      }
    }
    assert.equal(found, false, "cancelled order should not be in book");
  });

  it("Alice cancels with WRONG salt — fails with CommitmentMismatch", async () => {
    const alice = await setupUser(ctx, program, market, 5000);

    const order = await placeOrder(ctx, program, market, alice, {
      side: "Short",
      priceTicks: dollarsToPriceTicks(200),
      sizeLots: BigInt(5),
      leverageBps: 500,
    });

    await expectError(
      () =>
        program.methods
          .cancelOrder(
            new BN(order.orderId.toString()),
            Array.from(randomSalt()), // wrong salt
            new BN(order.sizeLots.toString()),
            order.leverageBps
          )
          .accounts({
            market: market.marketPDA,
            userAccount: alice.userPDA,
            orderBook: market.bookPDA,
            trader: alice.keypair.publicKey,
          })
          .signers([alice.keypair])
          .rpc(),
      "CommitmentMismatch"
    );
  });

  it("cancel non-existent order ID — fails with OrderNotFound", async () => {
    const alice = await setupUser(ctx, program, market, 5000);

    await expectError(
      () =>
        program.methods
          .cancelOrder(
            new BN(99999),
            Array.from(randomSalt()),
            new BN(10),
            500
          )
          .accounts({
            market: market.marketPDA,
            userAccount: alice.userPDA,
            orderBook: market.bookPDA,
            trader: alice.keypair.publicKey,
          })
          .signers([alice.keypair])
          .rpc(),
      "OrderNotFound"
    );
  });
});

// =============================================================================

describe("5. Matching (simulated ER — match_orders called directly)", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  /**
   * NOTE: In production, match_orders runs on MagicBlock ER after delegation.
   * Bankrun cannot simulate MagicBlock ER's delegation mechanism.
   * We call match_orders directly — the on-chain code uses AccountLoader
   * which works on non-delegated accounts in test/localnet context.
   * This is the correct test approach per the spec: "test mode skips
   * delegation check".
   */

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD5a");
  });

  it("bid >= ask triggers a match — 1 fill recorded, both orders consumed", async () => {
    const alice = await setupUser(ctx, program, market, 5000);
    const bob = await setupUser(ctx, program, market, 5000);

    await placeOrder(ctx, program, market, alice, {
      side: "Short",
      priceTicks: dollarsToPriceTicks(200),
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    await placeOrder(ctx, program, market, bob, {
      side: "Long",
      priceTicks: dollarsToPriceTicks(200), // bid = ask => match
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    await program.methods
      .matchOrders()
      .accounts({ market: market.marketPDA, orderBook: market.bookPDA })
      .rpc();

    const bookInfo = await program.provider.connection.getAccountInfo(
      market.bookPDA
    );
    const book = deserializeOrderBook(Buffer.from(bookInfo!.data));

    assert.equal(book.fillCount, 1, "should have 1 fill");
    assert.equal(book.bidCount, 0, "bid should be consumed");
    assert.equal(book.askCount, 0, "ask should be consumed");
  });

  it("fill record has correct taker(long/Bob) and maker(short/Alice)", async () => {
    const alice = await setupUser(ctx, program, market, 5000);
    const bob = await setupUser(ctx, program, market, 5000);

    await placeOrder(ctx, program, market, alice, {
      side: "Short",
      priceTicks: dollarsToPriceTicks(200),
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    await placeOrder(ctx, program, market, bob, {
      side: "Long",
      priceTicks: dollarsToPriceTicks(200),
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    await program.methods
      .matchOrders()
      .accounts({ market: market.marketPDA, orderBook: market.bookPDA })
      .rpc();

    const bookInfo = await program.provider.connection.getAccountInfo(
      market.bookPDA
    );
    const book = deserializeOrderBook(Buffer.from(bookInfo!.data));
    const fillIdx = Number((book.fillHead - book.fillCount) % BigInt(256));
    const fill = book.fills[fillIdx];

    // Taker = bid (long = Bob), Maker = ask (short = Alice)
    assert.equal(fill.taker.toBase58(), bob.keypair.publicKey.toBase58(), "taker = Bob");
    assert.equal(fill.maker.toBase58(), alice.keypair.publicKey.toBase58(), "maker = Alice");
    assert.equal(fill.priceTicks, dollarsToPriceTicks(200), "fill price = ask price");
    assert.equal(fill.claimed, false, "fill should be unclaimed");
  });

  it("non-crossing orders do NOT match (bid < ask)", async () => {
    const alice = await setupUser(ctx, program, market, 5000);
    const bob = await setupUser(ctx, program, market, 5000);

    await placeOrder(ctx, program, market, alice, {
      side: "Short",
      priceTicks: dollarsToPriceTicks(201),
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    await placeOrder(ctx, program, market, bob, {
      side: "Long",
      priceTicks: dollarsToPriceTicks(199),
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    const bookBefore = deserializeOrderBook(
      Buffer.from(
        (await program.provider.connection.getAccountInfo(market.bookPDA))!.data
      )
    );
    const fillCountBefore = bookBefore.fillCount;

    await program.methods
      .matchOrders()
      .accounts({ market: market.marketPDA, orderBook: market.bookPDA })
      .rpc();

    const bookAfter = deserializeOrderBook(
      Buffer.from(
        (await program.provider.connection.getAccountInfo(market.bookPDA))!.data
      )
    );
    assert.equal(bookAfter.fillCount, fillCountBefore, "no new fills");
    assert.ok(bookAfter.bidCount >= bookBefore.bidCount, "bid remains");
    assert.ok(bookAfter.askCount >= bookBefore.askCount, "ask remains");
  });
});

// =============================================================================

describe("6. Settlement (claim_fill)", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD6a");
  });

  it("claim_fill creates Position PDAs for both sides with correct fields", async () => {
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    // Verify Bob (taker/long) position
    const bobPos = await program.account.position.fetch(positions.bobPos);
    const isBobLong =
      JSON.stringify(bobPos.side) === JSON.stringify({ long: {} });
    assert.equal(isBobLong, true, "Bob should be long");
    assert.equal((bobPos.sizeLots as BN).toString(), "10");
    assert.equal(
      (bobPos.entryPriceTicks as BN).toString(),
      dollarsToPriceTicks(200).toString()
    );
    const expectedCollateral = computeCollateral(BigInt(10), dollarsToPriceTicks(200), 500);
    assert.equal(
      (bobPos.collateralLocked as BN).toString(),
      expectedCollateral.toString()
    );

    // Verify Alice (maker/short) position
    const alicePos = await program.account.position.fetch(positions.alicePos);
    const isAliceShort =
      JSON.stringify(alicePos.side) === JSON.stringify({ short: {} });
    assert.equal(isAliceShort, true, "Alice should be short");
    assert.equal((alicePos.sizeLots as BN).toString(), "10");
  });

  it("fill is marked claimed after settlement", async () => {
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    const bookInfo = await program.provider.connection.getAccountInfo(
      market.bookPDA
    );
    const book = deserializeOrderBook(Buffer.from(bookInfo!.data));
    // Find the fill that was just claimed (it was the last one appended before claim)
    const fillIdx = Number((book.fillHead - BigInt(1)) % BigInt(256));
    assert.equal(
      book.fills[fillIdx].claimed,
      true,
      "fill should be marked claimed"
    );
  });

  it("claim_fill with mismatched commitment fails with CommitmentMismatch", async () => {
    const alice = await setupUser(ctx, program, market, 10000);
    const bob = await setupUser(ctx, program, market, 10000);
    const settler = Keypair.generate();
    ctx.setAccount(settler.publicKey, {
      lamports: 5 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const priceTicks = dollarsToPriceTicks(200);
    const sizeLots = BigInt(10);
    const leverageBps = 500;

    const aliceOrder = await placeOrder(ctx, program, market, alice, {
      side: "Short", priceTicks, sizeLots, leverageBps,
    });
    const bobOrder = await placeOrder(ctx, program, market, bob, {
      side: "Long", priceTicks, sizeLots, leverageBps,
    });

    await program.methods
      .matchOrders()
      .accounts({ market: market.marketPDA, orderBook: market.bookPDA })
      .rpc();

    const bi = await program.provider.connection.getAccountInfo(market.bookPDA);
    const bk = deserializeOrderBook(Buffer.from(bi!.data));
    const fi = Number((bk.fillHead - bk.fillCount) % BigInt(256));
    const fll = bk.fills[fi];

    const tu = await program.account.userAccount.fetch(bob.userPDA);
    const mu = await program.account.userAccount.fetch(alice.userPDA);
    const [bPos] = derivePositionPDA(PROGRAM_ID, market.marketPDA, bob.keypair.publicKey, BigInt(tu.nextPositionIdx.toString()));
    const [aPos] = derivePositionPDA(PROGRAM_ID, market.marketPDA, alice.keypair.publicKey, BigInt(mu.nextPositionIdx.toString()));

    await expectError(
      () => program.methods
        .claimFill(
          new BN(fll.fillId.toString()),
          Array.from(bobOrder.salt),
          new BN(BigInt(99).toString()), // wrong size
          leverageBps,
          Array.from(bobOrder.commitment),
          Array.from(aliceOrder.salt),
          new BN(sizeLots.toString()),
          leverageBps,
          Array.from(aliceOrder.commitment)
        )
        .accounts({
          market: market.marketPDA, orderBook: market.bookPDA,
          takerUser: bob.userPDA, takerPosition: bPos,
          makerUser: alice.userPDA, makerPosition: aPos,
          settler: settler.publicKey, systemProgram: SystemProgram.programId,
        })
        .signers([settler])
        .rpc(),
      "CommitmentMismatch"
    );
  });
});

// =============================================================================

describe("7. Mark price update", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD7a");
  });

  it("Alice short 10 lots @ $200, mark at $205 → unrealized = -50 USDC; Bob long → +50 USDC", async () => {
    /**
     * Unrealized PnL computed off-chain to verify correctness of our utils:
     * Alice (short, 10 lots): (entry - mark) * size = (200 - 205) * 10 = -50 USDC
     * Bob (long, 10 lots): (mark - entry) * size = (205 - 200) * 10 = +50 USDC
     * price_ticks in micro-USDC: 1 dollar = 1_000_000 ticks
     */
    const entryTicks = dollarsToPriceTicks(200);
    const markTicks = dollarsToPriceTicks(205);
    const sizeLots = BigInt(10);

    const alicePnl = unrealizedPnl("Short", entryTicks, markTicks, sizeLots);
    const bobPnl = unrealizedPnl("Long", entryTicks, markTicks, sizeLots);

    assert.equal(alicePnl, BigInt(-50) * BigInt(1_000_000), "Alice PnL = -50 USDC");
    assert.equal(bobPnl, BigInt(50) * BigInt(1_000_000), "Bob PnL = +50 USDC");
    assert.equal(alicePnl, -bobPnl, "PnL should be symmetric");
  });

  it("mark_position instruction succeeds with fresh Pyth price", async () => {
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 1000,
    });

    const pythAcct = await setMockPythPrice(ctx, market, 205);

    // Should succeed (no state change unless liquidatable per spec)
    await program.methods
      .markPosition()
      .accounts({
        market: market.marketPDA,
        position: positions.alicePos,
        priceUpdate: pythAcct.publicKey,
      })
      .rpc();

    await program.methods
      .markPosition()
      .accounts({
        market: market.marketPDA,
        position: positions.bobPos,
        priceUpdate: pythAcct.publicKey,
      })
      .rpc();
  });

  it("mark_position with stale oracle fails with OracleStale", async () => {
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(5),
      leverageBps: 1000,
    });

    // Stale oracle: publish_time = 120 seconds ago (> 60s max)
    const staleOracle = Keypair.generate();
    const staleTime = BigInt(Math.floor(Date.now() / 1000) - 120);
    const staleData = createMockPriceUpdateData({
      feedId: solUsdFeedId(),
      price: BigInt(200_00000000),
      exponent: -8,
      publishTime: staleTime,
    });
    ctx.setAccount(staleOracle.publicKey, {
      lamports: LAMPORTS_PER_SOL,
      data: staleData,
      owner: new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"),
      executable: false,
    });

    await expectError(
      () =>
        program.methods
          .markPosition()
          .accounts({
            market: market.marketPDA,
            position: positions.alicePos,
            priceUpdate: staleOracle.publicKey,
          })
          .rpc(),
      "OracleStale"
    );
  });
});

// =============================================================================

describe("8. Funding accrual", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD8a");
  });

  it("update_funding succeeds and updates last_funding_ts", async () => {
    const pythAcct = await setMockPythPrice(ctx, market, 200);

    // Advance clock past funding interval
    const clock = await ctx.banksClient.getClock();
    ctx.setClock({
      slot: clock.slot + BigInt(1000),
      epochStartTimestamp: clock.epochStartTimestamp,
      epoch: clock.epoch,
      leaderScheduleEpoch: clock.leaderScheduleEpoch,
      unixTimestamp: clock.unixTimestamp + BigInt(DEFAULT_FUNDING_INTERVAL_SECS + 1),
    });

    const mktBefore = await program.account.market.fetch(market.marketPDA);

    await program.methods
      .updateFunding()
      .accounts({
        market: market.marketPDA,
        orderBook: market.bookPDA,
        priceUpdate: pythAcct.publicKey,
      })
      .rpc();

    const mktAfter = await program.account.market.fetch(market.marketPDA);
    assert.ok(
      (mktAfter.lastFundingTs as BN).gt(mktBefore.lastFundingTs as BN),
      "last_funding_ts should advance"
    );
  });

  it("accrue_funding updates position last_funding_index", async () => {
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    const pythAcct = await setMockPythPrice(ctx, market, 200);

    // Advance clock
    const clock = await ctx.banksClient.getClock();
    ctx.setClock({
      slot: clock.slot + BigInt(1000),
      epochStartTimestamp: clock.epochStartTimestamp,
      epoch: clock.epoch,
      leaderScheduleEpoch: clock.leaderScheduleEpoch,
      unixTimestamp: clock.unixTimestamp + BigInt(DEFAULT_FUNDING_INTERVAL_SECS + 1),
    });

    await program.methods
      .updateFunding()
      .accounts({
        market: market.marketPDA,
        orderBook: market.bookPDA,
        priceUpdate: pythAcct.publicKey,
      })
      .rpc();

    const alicePosBefore = await program.account.position.fetch(
      positions.alicePos
    );

    await program.methods
      .accrueFunding()
      .accounts({
        market: market.marketPDA,
        position: positions.alicePos,
        userAccount: positions.alice.userPDA,
      })
      .rpc();

    // last_funding_index should be updated
    const alicePosAfter = await program.account.position.fetch(
      positions.alicePos
    );
    const marketAcct = await program.account.market.fetch(market.marketPDA);
    // After accrual, last_funding_index matches cum_funding_short (Alice is short)
    assert.equal(
      (alicePosAfter.lastFundingIndex as BN).toString(),
      (marketAcct.cumFundingShort as BN).toString(),
      "Alice last_funding_index should match cum_funding_short"
    );
  });

  it("update_funding before interval elapsed fails with FundingIntervalNotElapsed", async () => {
    const freshSetup = await setupContext();
    const freshMarket = await initializeMarket(
      freshSetup.context,
      freshSetup.program,
      "SOL-USD8b"
    );
    const pythAcct = await setMockPythPrice(freshSetup.context, freshMarket, 200);

    // Call immediately without advancing clock
    await expectError(
      () =>
        freshSetup.program.methods
          .updateFunding()
          .accounts({
            market: freshMarket.marketPDA,
            orderBook: freshMarket.bookPDA,
            priceUpdate: pythAcct.publicKey,
          })
          .rpc(),
      "FundingIntervalNotElapsed"
    );
  });
});

// =============================================================================

describe("9. Liquidation", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD9a");
  });

  it("Alice (short) liquidated at $212 — position status = Liquidated", async () => {
    /**
     * Alice short 10 lots @ $200, 10x leverage.
     * collateral = 10 * 200 * 100 / 1000 = 200 USDC
     * Loss at $212: (212-200) * 10 = 120 USDC
     * Collateral remaining: 200 - 120 = 80 USDC
     * collateral_ratio = collateral_at_entry / (collateral_at_entry + loss) = 200/320 = 62.5% < 120% => liquidatable
     */
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 1000,
    });

    const liquidator = Keypair.generate();
    ctx.setAccount(liquidator.publicKey, {
      lamports: 5 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const pythAcct = await setMockPythPrice(ctx, market, 212);

    await program.methods
      .liquidatePosition()
      .accounts({
        market: market.marketPDA,
        position: positions.alicePos,
        userAccount: positions.alice.userPDA,
        liquidator: liquidator.publicKey,
        priceUpdate: pythAcct.publicKey,
      })
      .signers([liquidator])
      .rpc();

    const alicePos = await program.account.position.fetch(positions.alicePos);
    const isLiquidated =
      JSON.stringify(alicePos.status) === JSON.stringify({ liquidated: {} });
    assert.equal(isLiquidated, true, "Alice position should be Liquidated");
  });

  it("liquidate when price has not crossed threshold — fails with NotLiquidatable", async () => {
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 1000,
    });

    const liquidator = Keypair.generate();
    ctx.setAccount(liquidator.publicKey, {
      lamports: 5 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    // Oracle at $200 — no loss, clearly not liquidatable
    const pythAcct = await setMockPythPrice(ctx, market, 200);

    await expectError(
      () =>
        program.methods
          .liquidatePosition()
          .accounts({
            market: market.marketPDA,
            position: positions.alicePos,
            userAccount: positions.alice.userPDA,
            liquidator: liquidator.publicKey,
            priceUpdate: pythAcct.publicKey,
          })
          .signers([liquidator])
          .rpc(),
      "NotLiquidatable"
    );
  });

  it("liquidate when market paused — fails with MarketPaused", async () => {
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 1000,
    });

    await program.methods
      .setMarketPaused(true)
      .accounts({ market: market.marketPDA, admin: market.admin.publicKey })
      .signers([market.admin])
      .rpc();

    const liquidator = Keypair.generate();
    ctx.setAccount(liquidator.publicKey, {
      lamports: 5 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });
    const pythAcct = await setMockPythPrice(ctx, market, 212);

    await expectError(
      () =>
        program.methods
          .liquidatePosition()
          .accounts({
            market: market.marketPDA,
            position: positions.alicePos,
            userAccount: positions.alice.userPDA,
            liquidator: liquidator.publicKey,
            priceUpdate: pythAcct.publicKey,
          })
          .signers([liquidator])
          .rpc(),
      "MarketPaused"
    );

    // Cleanup: unpause for subsequent tests
    await program.methods
      .setMarketPaused(false)
      .accounts({ market: market.marketPDA, admin: market.admin.publicKey })
      .signers([market.admin])
      .rpc();
  });
});

// =============================================================================

describe("10. Close position (voluntary)", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD10a");
  });

  it("Bob closes long at $205 — position status = Closed, realized_pnl >= 0", async () => {
    /**
     * Bob long 10 lots @ $200, 10x leverage.
     * Close at $205: realized PnL = (205-200) * 10 = +50 USDC
     */
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 1000,
    });

    const pythAcct = await setMockPythPrice(ctx, market, 205);

    await program.methods
      .closePosition()
      .accounts({
        market: market.marketPDA,
        position: positions.bobPos,
        userAccount: positions.bob.userPDA,
        owner: positions.bob.keypair.publicKey,
        priceUpdate: pythAcct.publicKey,
      })
      .signers([positions.bob.keypair])
      .rpc();

    const bobPos = await program.account.position.fetch(positions.bobPos);
    const isClosed =
      JSON.stringify(bobPos.status) === JSON.stringify({ closed: {} });
    assert.equal(isClosed, true, "Bob position should be Closed");

    const bobUser = await program.account.userAccount.fetch(positions.bob.userPDA);
    assert.ok(
      BigInt(bobUser.realizedPnl.toString()) >= BigInt(0),
      "Bob realized_pnl should be >= 0 on profitable close"
    );
  });

  it("non-owner cannot close position — fails with Unauthorized", async () => {
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 1000,
    });

    const pythAcct = await setMockPythPrice(ctx, market, 205);
    const stranger = Keypair.generate();
    ctx.setAccount(stranger.publicKey, {
      lamports: 5 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    await expectError(
      () =>
        program.methods
          .closePosition()
          .accounts({
            market: market.marketPDA,
            position: positions.bobPos,
            userAccount: positions.bob.userPDA,
            owner: stranger.publicKey, // wrong owner
            priceUpdate: pythAcct.publicKey,
          })
          .signers([stranger])
          .rpc(),
      "Unauthorized"
    );
  });
});

// =============================================================================

describe("11. Edge cases", () => {
  let ctx: ProgramTestContext;
  let program: anchor.Program;
  let market: MarketSetup;

  before(async () => {
    const setup = await setupContext();
    ctx = setup.context;
    program = setup.program;
    market = await initializeMarket(ctx, program, "SOL-USD11a");
  });

  it("place_order with leverage > MAX_LEVERAGE_BPS — fails with InvalidLeverage", async () => {
    const alice = await setupUser(ctx, program, market, 5000);
    const tooHighLeverage = DEFAULT_MAX_LEVERAGE_BPS + 1;
    const salt = randomSalt();
    const sizeLots = BigInt(5);
    const commitment = computeCommitment(
      salt,
      sizeLots,
      tooHighLeverage,
      alice.keypair.publicKey
    );

    await expectError(
      () =>
        program.methods
          .placeOrder(
            { short: {} },
            new BN(dollarsToPriceTicks(200).toString()),
            { small: {} },
            tooHighLeverage,
            Array.from(commitment)
          )
          .accounts({
            market: market.marketPDA,
            userAccount: alice.userPDA,
            orderBook: market.bookPDA,
            trader: alice.keypair.publicKey,
          })
          .signers([alice.keypair])
          .rpc(),
      "InvalidLeverage"
    );
  });

  it("place_order with insufficient collateral — fails with InsufficientCollateral", async () => {
    // User has only 1 USDC, tries to place 1x leveraged order needing $10 collateral
    const alice = await setupUser(ctx, program, market, 1);
    const salt = randomSalt();
    const sizeLots = BigInt(10);
    const leverageBps = 100; // 1x = needs full notional = 10 lots * $200 = $2000
    const commitment = computeCommitment(
      salt,
      sizeLots,
      leverageBps,
      alice.keypair.publicKey
    );

    await expectError(
      () =>
        program.methods
          .placeOrder(
            { short: {} },
            new BN(dollarsToPriceTicks(200).toString()),
            { small: {} },
            leverageBps,
            Array.from(commitment)
          )
          .accounts({
            market: market.marketPDA,
            userAccount: alice.userPDA,
            orderBook: market.bookPDA,
            trader: alice.keypair.publicKey,
          })
          .signers([alice.keypair])
          .rpc(),
      "InsufficientCollateral"
    );
  });

  it("withdraw more than unlocked balance — fails with WithdrawTooLarge", async () => {
    const alice = await setupUser(ctx, program, market, 100);
    const tooMuch = usdcAmount(200);

    await expectError(
      () =>
        program.methods
          .withdrawCollateral(new BN(tooMuch.toString()))
          .accounts({
            userAccount: alice.userPDA,
            market: market.marketPDA,
            vault: market.vaultPDA,
            vaultTokenAccount: market.vaultTokenAccount,
            userTokenAccount: alice.tokenAccount,
            owner: alice.keypair.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            mint: market.mint,
          })
          .signers([alice.keypair])
          .rpc(),
      "WithdrawTooLarge"
    );
  });

  it("deposit fails when market is paused — fails with MarketPaused", async () => {
    const alice = await setupUser(ctx, program, market, 0);

    await program.methods
      .setMarketPaused(true)
      .accounts({ market: market.marketPDA, admin: market.admin.publicKey })
      .signers([market.admin])
      .rpc();

    const provider = new BankrunProvider(ctx);
    // @ts-ignore
    const conn = provider.connection;
    const depositAmt = usdcAmount(100);
    await mintTo(conn as any, market.admin, market.mint, alice.tokenAccount, market.mintAuthority, depositAmt);

    await expectError(
      () =>
        program.methods
          .depositCollateral(new BN(depositAmt.toString()))
          .accounts({
            userAccount: alice.userPDA,
            market: market.marketPDA,
            vault: market.vaultPDA,
            vaultTokenAccount: market.vaultTokenAccount,
            userTokenAccount: alice.tokenAccount,
            owner: alice.keypair.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            mint: market.mint,
          })
          .signers([alice.keypair])
          .rpc(),
      "MarketPaused"
    );

    await program.methods
      .setMarketPaused(false)
      .accounts({ market: market.marketPDA, admin: market.admin.publicKey })
      .signers([market.admin])
      .rpc();
  });

  it("place_order with price=0 — fails with InvalidPrice", async () => {
    const alice = await setupUser(ctx, program, market, 5000);
    const salt = randomSalt();
    const sizeLots = BigInt(5);
    const leverageBps = 500;
    const commitment = computeCommitment(
      salt,
      sizeLots,
      leverageBps,
      alice.keypair.publicKey
    );

    await expectError(
      () =>
        program.methods
          .placeOrder(
            { short: {} },
            new BN(0),
            { small: {} },
            leverageBps,
            Array.from(commitment)
          )
          .accounts({
            market: market.marketPDA,
            userAccount: alice.userPDA,
            orderBook: market.bookPDA,
            trader: alice.keypair.publicKey,
          })
          .signers([alice.keypair])
          .rpc(),
      "InvalidPrice"
    );
  });

  it("claim_fill for already-claimed fill — fails with FillNotFound", async () => {
    const positions = await setupMatchedPositions(ctx, program, market, {
      priceUsd: 200,
      sizeLots: BigInt(10),
      leverageBps: 500,
    });

    // The fill was already claimed by setupMatchedPositions
    // Try to claim again with new accounts
    const alice2 = await setupUser(ctx, program, market, 10000);
    const bob2 = await setupUser(ctx, program, market, 10000);
    const settler = Keypair.generate();
    ctx.setAccount(settler.publicKey, {
      lamports: 5 * LAMPORTS_PER_SOL,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    // Place new orders to get fill id = 0 again (already claimed earlier)
    // Use fill_id = 0 which was the first fill
    const tu2 = await program.account.userAccount.fetch(bob2.userPDA);
    const mu2 = await program.account.userAccount.fetch(alice2.userPDA);
    const [b2] = derivePositionPDA(PROGRAM_ID, market.marketPDA, bob2.keypair.publicKey, BigInt(tu2.nextPositionIdx.toString()));
    const [a2] = derivePositionPDA(PROGRAM_ID, market.marketPDA, alice2.keypair.publicKey, BigInt(mu2.nextPositionIdx.toString()));

    await expectError(
      () =>
        program.methods
          .claimFill(
            new BN(0), // fill_id = 0 (already claimed)
            Array.from(randomSalt()),
            new BN(10),
            500,
            Array.from(Buffer.alloc(32)),
            Array.from(randomSalt()),
            new BN(10),
            500,
            Array.from(Buffer.alloc(32))
          )
          .accounts({
            market: market.marketPDA,
            orderBook: market.bookPDA,
            takerUser: bob2.userPDA,
            takerPosition: b2,
            makerUser: alice2.userPDA,
            makerPosition: a2,
            settler: settler.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([settler])
          .rpc(),
      "FillNotFound"
    );
  });
});

// =============================================================================
// ─── UNIT TESTS: Pure off-chain logic ────────────────────────────────────────
// =============================================================================

describe("12. Unit tests: commitment + PnL computation", () => {
  it("computeCommitment is deterministic for same inputs", () => {
    const salt = Buffer.alloc(32, 0xab);
    const trader = Keypair.generate().publicKey;

    const c1 = computeCommitment(salt, BigInt(10), 500, trader);
    const c2 = computeCommitment(salt, BigInt(10), 500, trader);
    assert.deepEqual(Array.from(c1), Array.from(c2));
  });

  it("commitments differ when salt differs", () => {
    const trader = Keypair.generate().publicKey;
    const c1 = computeCommitment(Buffer.alloc(32, 1), BigInt(10), 500, trader);
    const c2 = computeCommitment(Buffer.alloc(32, 2), BigInt(10), 500, trader);
    assert.notDeepEqual(Array.from(c1), Array.from(c2));
  });

  it("commitments differ when size_lots differs", () => {
    const salt = randomSalt();
    const trader = Keypair.generate().publicKey;
    const c1 = computeCommitment(salt, BigInt(10), 500, trader);
    const c2 = computeCommitment(salt, BigInt(11), 500, trader);
    assert.notDeepEqual(Array.from(c1), Array.from(c2));
  });

  it("commitments differ when leverage_bps differs", () => {
    const salt = randomSalt();
    const trader = Keypair.generate().publicKey;
    const c1 = computeCommitment(salt, BigInt(10), 500, trader);
    const c2 = computeCommitment(salt, BigInt(10), 1000, trader);
    assert.notDeepEqual(Array.from(c1), Array.from(c2));
  });

  it("commitments differ when trader pubkey differs", () => {
    const salt = randomSalt();
    const c1 = computeCommitment(salt, BigInt(10), 500, Keypair.generate().publicKey);
    const c2 = computeCommitment(salt, BigInt(10), 500, Keypair.generate().publicKey);
    assert.notDeepEqual(Array.from(c1), Array.from(c2));
  });

  it("computeCollateral matches on-chain formula", () => {
    // 10 lots @ $200 USDC, 5x (500 bps)
    // = (10 * 200_000_000 * 100) / 500 = 400_000_000 micro-USDC = 400 USDC
    const result = computeCollateral(BigInt(10), dollarsToPriceTicks(200), 500);
    const expected = BigInt(400) * BigInt(1_000_000);
    assert.equal(result.toString(), expected.toString());
  });

  it("unrealizedPnl: long profits when price rises", () => {
    const pnl = unrealizedPnl(
      "Long",
      dollarsToPriceTicks(200),
      dollarsToPriceTicks(205),
      BigInt(10)
    );
    assert.ok(pnl > BigInt(0), "long PnL should be positive");
    assert.equal(pnl, BigInt(50) * BigInt(1_000_000)); // 10 lots × $5 = $50
  });

  it("unrealizedPnl: short loses when price rises", () => {
    const pnl = unrealizedPnl(
      "Short",
      dollarsToPriceTicks(200),
      dollarsToPriceTicks(205),
      BigInt(10)
    );
    assert.ok(pnl < BigInt(0), "short PnL should be negative");
    assert.equal(pnl, BigInt(-50) * BigInt(1_000_000)); // 10 lots × -$5 = -$50
  });

  it("unrealizedPnl: long/short are symmetric (zero-sum)", () => {
    const entry = dollarsToPriceTicks(200);
    const mark = dollarsToPriceTicks(210);
    const size = BigInt(10);

    const longPnl = unrealizedPnl("Long", entry, mark, size);
    const shortPnl = unrealizedPnl("Short", entry, mark, size);

    assert.equal(longPnl, -shortPnl, "PnL should be zero-sum");
  });

  it("dollarsToPriceTicks converts correctly", () => {
    assert.equal(dollarsToPriceTicks(1), BigInt(1_000_000));
    assert.equal(dollarsToPriceTicks(200), BigInt(200_000_000));
  });

  it("usdcAmount converts human USDC to micro-units", () => {
    assert.equal(usdcAmount(1), BigInt(1_000_000));
    assert.equal(usdcAmount(100), BigInt(100_000_000));
  });
});
