/**
 * Jupiter Protocol Integration
 * Real swap routing for USDC collateral deposits
 *
 * Calls live Jupiter V6 API endpoints:
 * - Quote: https://quote-api.jup.ag/v6/quote
 * - Swap: https://quote-api.jup.ag/v6/swap
 */

import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

const JUPITER_API_BASE = "https://quote-api.jup.ag/v6";

export interface QuoteResult {
  outputAmount: string;
  routePlan: unknown;
  slippageBps: number;
}

export interface SwapResponse {
  swapTransaction: string;
}

/**
 * Fetch a real quote from Jupiter for swapping any token to USDC
 * @param connection Solana connection
 * @param fromMint Source token mint (e.g., SOL)
 * @param usdcMint USDC token mint address
 * @param amountLamports Amount in smallest units
 * @returns Quote with output amount and route plan
 */
export async function quoteUsdcSwap(
  connection: Connection,
  fromMint: PublicKey,
  usdcMint: PublicKey,
  amountLamports: number,
): Promise<QuoteResult> {
  const params = new URLSearchParams({
    inputMint: fromMint.toBase58(),
    outputMint: usdcMint.toBase58(),
    amount: amountLamports.toString(),
    slippageBps: "100", // 1% slippage
  });

  const url = `${JUPITER_API_BASE}/quote?${params}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Jupiter quote failed: ${response.statusText}`);
    }

    const data = (await response.json()) as QuoteResult;
    return data;
  } catch (error) {
    console.error("[jupiter] quote failed", { fromMint: fromMint.toBase58(), error });
    throw error;
  }
}

/**
 * Execute a real swap via Jupiter using wallet signature
 * Fetches quote, builds swap tx, signs with wallet, sends to network
 *
 * @param connection Solana connection
 * @param wallet Solana wallet context (must be connected)
 * @param fromMint Source token mint
 * @param usdcMint USDC token mint
 * @param amountLamports Amount to swap
 * @returns Transaction signature
 */
export async function executeSwapToUsdc(
  connection: Connection,
  wallet: WalletContextState,
  fromMint: PublicKey,
  usdcMint: PublicKey,
  amountLamports: number,
): Promise<string> {
  if (!wallet.publicKey) {
    throw new Error("Wallet not connected");
  }

  if (!wallet.signTransaction) {
    throw new Error("Wallet does not support signTransaction");
  }

  // Step 1: Get quote
  console.log("[jupiter] fetching quote...", { amount: amountLamports });
  const quote = await quoteUsdcSwap(connection, fromMint, usdcMint, amountLamports);

  console.log("[jupiter] quote received", {
    outputAmount: quote.outputAmount,
    slippageBps: quote.slippageBps,
  });

  // Step 2: Request swap transaction from Jupiter
  const swapBody = {
    quoteResponse: quote,
    userPublicKey: wallet.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    prioritizationFeeLamports: 1000, // 1000 lamports priority fee
  };

  let swapResponse: SwapResponse;
  try {
    const swapRes = await fetch(`${JUPITER_API_BASE}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapBody),
    });

    if (!swapRes.ok) {
      throw new Error(`Jupiter swap failed: ${swapRes.statusText}`);
    }

    swapResponse = (await swapRes.json()) as SwapResponse;
  } catch (error) {
    console.error("[jupiter] swap build failed", error);
    throw error;
  }

  // Step 3: Deserialize and sign transaction
  const swapTransactionBuf = Buffer.from(swapResponse.swapTransaction, "base64");
  const swapTransaction = VersionedTransaction.deserialize(swapTransactionBuf);

  console.log("[jupiter] signing transaction...");
  const signed = await wallet.signTransaction(swapTransaction);

  // Step 4: Send to network
  const sig = await connection.sendTransaction(signed, {
    skipPreflight: false,
    maxRetries: 3,
  });

  console.log("[jupiter] swap submitted", { signature: sig });

  // Wait for confirmation
  const confirmation = await connection.confirmTransaction(sig, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`Swap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  console.log("[jupiter] swap confirmed", { signature: sig });
  return sig;
}
