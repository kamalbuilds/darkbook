# Jupiter Swap Integration

## Overview

Real-time swap routing for converting any token to USDC collateral via Jupiter Protocol's V6 API.

## Implementation

### File: `dashboard/src/lib/jupiter.ts`

Two exported functions:

1. **quoteUsdcSwap(connection, fromMint, usdcMint, amountLamports)**
   - Fetches real quote from https://quote-api.jup.ag/v6/quote
   - Parameters: inputMint, outputMint, amount, slippageBps=100 (1%)
   - Returns: outputAmount, routePlan

2. **executeSwapToUsdc(connection, wallet, fromMint, usdcMint, amountLamports)**
   - Step 1: Call quoteUsdcSwap
   - Step 2: POST to https://quote-api.jup.ag/v6/swap for tx
   - Step 3: Sign with wallet, send, confirm
   - Returns: transaction signature

### Environment Variables

- `NEXT_PUBLIC_JUPITER_API_KEY`: Optional (public tier works)

### Error Handling

- Fetch errors logged to console
- Retries on RPC send (maxRetries=3)
- Confirmation waits on "confirmed" commitment

### Integration Points

Can be wired into deposit-collateral flow:
- Check if user holds non-USDC token
- Show "Swap & Deposit" button
- Call executeSwapToUsdc before deposit instruction

### Test Endpoints

- **Devnet Quote API**: https://quote-api.jup.ag/v6/quote (same across networks)
- **Devnet RPC**: https://api.devnet.solana.com
