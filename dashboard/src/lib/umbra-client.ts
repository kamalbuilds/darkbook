/**
 * Umbra privacy integration for DarkBook dashboard.
 *
 * Post-settlement shield: after closePosition, the trader can optionally
 * shield their USDC payout into an Umbra encrypted balance to break the
 * on-chain graph between position settlement and wallet withdrawal.
 */

import {
  createSignerFromWalletAccount,
  connectDarkbookUmbraClient,
  ensureUmbraRegistered,
  shieldPublicAtaToEncryptedBalance,
} from "@darkbook/sdk";
import type { IUmbraClient } from "@umbra-privacy/sdk/interfaces";
import type { WalletAccount } from "@wallet-standard/base";

let _umbraClient: IUmbraClient | null = null;

export function getUmbraClient(): IUmbraClient | null {
  return _umbraClient;
}

export async function initUmbraFromWallet(
  walletAccount: WalletAccount,
  rpcUrl: string,
): Promise<IUmbraClient | null> {
  if (_umbraClient) return _umbraClient;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signer = createSignerFromWalletAccount(walletAccount as any, { autoApprove: true } as any);
    const wsUrl = rpcUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    const client = await connectDarkbookUmbraClient({
      signer,
      rpcUrl,
      rpcSubscriptionsUrl: wsUrl,
    });
    _umbraClient = client;
    return client;
  } catch (err) {
    console.warn("[umbra-client] init failed:", err);
    return null;
  }
}

export function resetUmbraClient(): void {
  _umbraClient = null;
}

export async function shieldUsdcPayout(
  client: IUmbraClient,
  usdcMint: string,
  amountBaseUnits: bigint,
): Promise<{ queueSignature: string; callbackSignature: string } | null> {
  try {
    await ensureUmbraRegistered(client).catch(() => {});
    return await shieldPublicAtaToEncryptedBalance({
      client,
      mintBase58: usdcMint,
      amountBaseUnits,
    });
  } catch (err) {
    console.error("[umbra-client] shield failed:", err);
    return null;
  }
}
