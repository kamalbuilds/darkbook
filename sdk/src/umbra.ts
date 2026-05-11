/**
 * Umbra privacy completion for DarkBook.
 *
 * Dark Commit hides intent before fill; Umbra direct deposit shields USDC that
 * already sits in the trader's public ATA after settlement (post-trade graph break).
 *
 * Uses the official `@umbra-privacy/sdk` (getUmbraClient, registration, public→encrypted deposit).
 * Atomic close→Umbra in one transaction would need a new DarkBook ix with Umbra CPI (future).
 */

import {
  createInMemorySigner,
  createSignerFromPrivateKeyBytes,
  createSignerFromWalletAccount,
  getPublicBalanceToEncryptedBalanceDirectDepositorFunction,
  getUmbraClient,
  getUserRegistrationFunction,
} from "@umbra-privacy/sdk";
import type { GetUmbraClientArgs } from "@umbra-privacy/sdk";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";
import type { U64 } from "@umbra-privacy/sdk/types";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, TransactionSignature } from "@solana/web3.js";

/** Devnet program (Umbra docs). */
export const UMBRA_PROGRAM_ID_DEVNET = new PublicKey(
  "DSuKkyqGVGgo4QtPABfxKJKygUDACbUhirnuv63mEpAJ",
);

/** Mainnet program (Umbra docs). */
export const UMBRA_PROGRAM_ID_MAINNET = new PublicKey(
  "UMBRAD2ishebJTcgCLkTkNUx1v3GyoAgpTRPeWoLykh",
);

/** Default Umbra indexer (devnet). */
export const UMBRA_INDEXER_DEVNET_DEFAULT =
  "https://utxo-indexer.api-devnet.umbraprivacy.com";

/** Default Umbra indexer (mainnet). */
export const UMBRA_INDEXER_MAINNET_DEFAULT =
  "https://utxo-indexer.api.umbraprivacy.com";

/** Default relayer API (devnet); used for claim/mixer flows, not direct deposit. */
export const UMBRA_RELAYER_DEVNET_DEFAULT =
  "https://relayer.api-devnet.umbraprivacy.com";

/** Default relayer API (mainnet). */
export const UMBRA_RELAYER_MAINNET_DEFAULT =
  "https://relayer.api.umbraprivacy.com";

export type UmbraCluster = "devnet" | "mainnet";

/**
 * Resolve Umbra program id. Override with `UMBRA_PROGRAM_ID`; else map cluster.
 */
export function resolveUmbraProgramId(): PublicKey {
  const raw = process.env.UMBRA_PROGRAM_ID?.trim();
  if (raw) return new PublicKey(raw);
  const cluster =
    process.env.UMBRA_CLUSTER ?? process.env.NEXT_PUBLIC_SOLANA_CLUSTER;
  if (cluster === "mainnet-beta" || cluster === "mainnet") {
    return UMBRA_PROGRAM_ID_MAINNET;
  }
  return UMBRA_PROGRAM_ID_DEVNET;
}

export function darkbookClusterToUmbraCluster(): UmbraCluster {
  const cluster =
    process.env.UMBRA_CLUSTER?.trim() ??
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim();
  if (cluster === "mainnet-beta" || cluster === "mainnet") return "mainnet";
  return "devnet";
}

export function defaultUmbraIndexerUrl(cluster: UmbraCluster): string {
  if (cluster === "mainnet") {
    return (
      process.env.UMBRA_INDEXER_MAINNET_URL?.trim() ||
      UMBRA_INDEXER_MAINNET_DEFAULT
    );
  }
  return (
    process.env.UMBRA_INDEXER_DEVNET_URL?.trim() || UMBRA_INDEXER_DEVNET_DEFAULT
  );
}

export function defaultUmbraRelayerUrl(cluster: UmbraCluster): string {
  if (cluster === "mainnet") {
    return (
      process.env.UMBRA_RELAYER_MAINNET_URL?.trim() ||
      UMBRA_RELAYER_MAINNET_DEFAULT
    );
  }
  return (
    process.env.UMBRA_RELAYER_DEVNET_URL?.trim() || UMBRA_RELAYER_DEVNET_DEFAULT
  );
}

/** Derive `wss://` RPC URL from `https://` JSON-RPC URL when subscriptions URL is omitted. */
export function solanaWsUrlFromHttp(rpcUrl: string): string {
  try {
    const u = new URL(rpcUrl);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  } catch {
    return rpcUrl.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  }
}

export type ConnectDarkbookUmbraClientParams = Pick<
  GetUmbraClientArgs,
  "signer" | "rpcUrl" | "rpcSubscriptionsUrl" | "deferMasterSeedSignature"
> & {
  /** Defaults from env / mainnet-beta mapping. */
  cluster?: UmbraCluster;
  indexerApiEndpoint?: string;
};

/**
 * Build an Umbra client aligned with DarkBook cluster defaults and indexer.
 */
export async function connectDarkbookUmbraClient(
  params: ConnectDarkbookUmbraClientParams,
): Promise<IUmbraClient> {
  const cluster = params.cluster ?? darkbookClusterToUmbraCluster();
  const indexer =
    params.indexerApiEndpoint ?? defaultUmbraIndexerUrl(cluster);
  return getUmbraClient({
    signer: params.signer,
    network: cluster,
    rpcUrl: params.rpcUrl,
    rpcSubscriptionsUrl: params.rpcSubscriptionsUrl,
    indexerApiEndpoint: indexer,
    deferMasterSeedSignature: params.deferMasterSeedSignature,
  });
}

/**
 * Idempotent Umbra registration (confidential + anonymous). Safe to call more than once;
 * prefer gating in UI to avoid extra fees.
 */
export async function ensureUmbraRegistered(
  client: IUmbraClient,
): Promise<readonly TransactionSignature[]> {
  const register = getUserRegistrationFunction({ client });
  return register({ confidential: true, anonymous: true });
}

/**
 * Shield SPL from the signer's public ATA into their Umbra encrypted balance (direct deposit).
 * `mintBase58` must be supported on the chosen cluster; amount is raw token base units.
 */
type UmbraMintAddress = Parameters<
  ReturnType<typeof getPublicBalanceToEncryptedBalanceDirectDepositorFunction>
>[1];

export async function shieldPublicAtaToEncryptedBalance(opts: {
  client: IUmbraClient;
  /** SPL mint base58 (must match token Umbra supports on this cluster). */
  mintBase58: string;
  amountBaseUnits: bigint;
}): Promise<{ queueSignature: string; callbackSignature: string }> {
  const deposit = getPublicBalanceToEncryptedBalanceDirectDepositorFunction({
    client: opts.client,
  });
  const amount = opts.amountBaseUnits as U64;
  const mint = opts.mintBase58 as unknown as UmbraMintAddress;
  return deposit(opts.client.signer.address, mint, amount) as Promise<{
    queueSignature: string;
    callbackSignature: string;
  }>;
}

export type ClosePositionShieldedResult = {
  closeSignature: TransactionSignature;
  umbraRegistration?: readonly TransactionSignature[];
  umbraDeposit?: { queueSignature: string; callbackSignature: string };
};

export type LiquidatePositionShieldedResult = ClosePositionShieldedResult;

/**
 * Umbra helpers for DarkBook flows: chain health check plus optional post-close shield.
 */
export class UmbraShieldedClient {
  static programId(): PublicKey {
    return resolveUmbraProgramId();
  }

  readonly connection: Connection;
  readonly wallet: Wallet;
  readonly provider: AnchorProvider;

  constructor(connection: Connection, wallet: Wallet) {
    this.connection = connection;
    this.wallet = wallet;
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      skipPreflight: false,
    });
  }

  /**
   * Close a DarkBook position; optionally shield a chosen USDC amount into Umbra afterward.
   * Shielding assumes the close has credited the signer's public ATA (same wallet as `IUmbraClient`).
   */
  async closePositionShielded(opts: {
    darkbookClient: {
      closePosition(
        positionPdaKey: PublicKey,
        priceUpdateAccount: PublicKey,
      ): Promise<TransactionSignature>;
    };
    positionPdaKey: PublicKey;
    /** Pyth `PriceUpdateV2` (or compatible) account the program reads for mark-at-close. */
    priceUpdateAccount: PublicKey;
    mint: PublicKey;
    shieldPayoutWithUmbra?: {
      client: IUmbraClient;
      amountBaseUnits: bigint;
    };
  }): Promise<ClosePositionShieldedResult> {
    const closeSignature = await opts.darkbookClient.closePosition(
      opts.positionPdaKey,
      opts.priceUpdateAccount,
    );
    const out: ClosePositionShieldedResult = { closeSignature };
    if (!opts.shieldPayoutWithUmbra) return out;

    out.umbraRegistration = await ensureUmbraRegistered(
      opts.shieldPayoutWithUmbra.client,
    );
    out.umbraDeposit = await shieldPublicAtaToEncryptedBalance({
      client: opts.shieldPayoutWithUmbra.client,
      mintBase58: opts.mint.toBase58(),
      amountBaseUnits: opts.shieldPayoutWithUmbra.amountBaseUnits,
    });
    return out;
  }

  /**
   * Liquidate a DarkBook position; optional Umbra shield of liquidator payout (same pattern as close).
   */
  async liquidatePositionShielded(opts: {
    darkbookClient: {
      liquidatePosition(
        positionPdaKey: PublicKey,
        priceUpdateAccount: PublicKey,
        mint: PublicKey,
      ): Promise<TransactionSignature>;
    };
    positionPdaKey: PublicKey;
    priceUpdateAccount: PublicKey;
    mint: PublicKey;
    shieldPayoutWithUmbra?: {
      client: IUmbraClient;
      amountBaseUnits: bigint;
    };
  }): Promise<LiquidatePositionShieldedResult> {
    const closeSignature = await opts.darkbookClient.liquidatePosition(
      opts.positionPdaKey,
      opts.priceUpdateAccount,
      opts.mint,
    );
    const out: LiquidatePositionShieldedResult = { closeSignature };
    if (!opts.shieldPayoutWithUmbra) return out;

    out.umbraRegistration = await ensureUmbraRegistered(
      opts.shieldPayoutWithUmbra.client,
    );
    out.umbraDeposit = await shieldPublicAtaToEncryptedBalance({
      client: opts.shieldPayoutWithUmbra.client,
      mintBase58: opts.mint.toBase58(),
      amountBaseUnits: opts.shieldPayoutWithUmbra.amountBaseUnits,
    });
    return out;
  }

  async verifyUmbraSetup(): Promise<void> {
    const pid = resolveUmbraProgramId();
    const programInfo = await this.connection.getAccountInfo(pid);
    if (!programInfo) {
      throw new Error(`Umbra program ${pid.toBase58()} not found on chain`);
    }
    if (!programInfo.executable) {
      throw new Error("Umbra program is not executable");
    }
  }
}

let _instance: UmbraShieldedClient | null = null;

export function initUmbraShielded(
  connection: Connection,
  wallet: Wallet,
): UmbraShieldedClient {
  _instance = new UmbraShieldedClient(connection, wallet);
  return _instance;
}

export function getUmbraShielded(): UmbraShieldedClient {
  if (!_instance) {
    throw new Error(
      "UmbraShieldedClient not initialized. Call initUmbraShielded() first.",
    );
  }
  return _instance;
}

export {
  createInMemorySigner,
  createSignerFromPrivateKeyBytes,
  createSignerFromWalletAccount,
};
