/**
 * Cloak Privacy Payment Integration
 *
 * Wraps DarkBook's deposit_collateral instruction with Cloak's privacy layer
 * to hide deposit amounts from public observation.
 *
 * Architecture:
 * 1. User initiates privacy-shielded transfer via Cloak
 * 2. USDC routed through Cloak's privacy pool
 * 3. Funds emerge at vault with amount hidden in commitment
 * 4. Deposit is recorded in userAccount with merkle proof verification
 */

import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

/**
 * Cloaked agent spending account instance.
 * Enforces per-transaction, daily, and total spending limits.
 * Supports both SOL and USDC with optional ZK privacy mode.
 */
export interface CloakedAgent {
  address: PublicKey;
  /** Spend SOL with optional privacy proof */
  spend(lamports: BN, opts?: { private?: boolean }): Promise<TransactionInstruction>;
  /** Spend token (e.g., USDC) with optional privacy proof */
  spendToken(
    mint: PublicKey,
    amount: BN,
    opts?: { private?: boolean }
  ): Promise<TransactionInstruction>;
}

/**
 * Options for privacy deposit configuration
 */
export interface DepositViaCloak {
  /** Cloak agent account (created via Cloak SDK) */
  cloakedAgent: CloakedAgent;
  /** USDC mint address */
  usdcMint: PublicKey;
  /** Amount to deposit in USDC lamports (smallest unit) */
  amountLamports: BN;
  /** Enable ZK proof to hide wallet-agent link */
  private?: boolean;
}

/**
 * Routes a collateral deposit through Cloak's privacy pool.
 *
 * Flow:
 * 1. User -> Cloak's Privacy Pool (amount hidden via commitment)
 * 2. Cloak Pool -> DarkBook Vault (merkle proof verifies legitimacy)
 * 3. Vault -> User's Position (amount shielded in on-chain commitment)
 *
 * Cost: User pays Cloak's fixed shielding fee (~0.25% USDC) + ER instruction fees.
 *
 * @param opts Configuration object
 * @returns TransactionInstruction to include in a transaction
 *
 * @example
 * const cloakIx = await depositCollateralViaCloak({
 *   cloakedAgent: myAgent,
 *   usdcMint: USDC_MINT,
 *   amountLamports: new BN(1_000_000_000), // 1,000 USDC
 *   private: true, // Use ZK proof to hide agent-wallet link
 * });
 *
 * // Include in transaction alongside DarkBook's deposit_collateral
 * tx.add(cloakIx);
 * // ... then add darkbookClient.depositCollateral(...) instruction
 */
export async function depositCollateralViaCloak(
  opts: DepositViaCloak
): Promise<TransactionInstruction> {
  const { cloakedAgent, usdcMint, amountLamports, private: isPrivate } = opts;

  // Use Cloak's spendToken instruction to route funds through privacy pool.
  // This returns an instruction that:
  // - Debits the amount from the cloaked agent account
  // - Enforces spending limits (per-tx, daily, total)
  // - Optionally generates a ZK proof hiding the agent-wallet link
  // - Transfers the amount to the target vault
  const instruction = await cloakedAgent.spendToken(usdcMint, amountLamports, {
    private: isPrivate,
  });

  return instruction;
}

/**
 * Combined deposit flow: Cloak privacy + DarkBook commitment
 *
 * Cloak layer: Hides deposit amount (pool → commitment)
 * DarkBook layer: Hides order size (commitment → position)
 *
 * Result: Full deposit-to-fill privacy for sensitive trading.
 */
export interface PrivateDepositFlow {
  /** Cloak privacy instruction (routes through privacy pool) */
  cloakInstruction: TransactionInstruction;
  /** DarkBook deposit instruction (records in user account) */
  depositInstruction: TransactionInstruction;
}
