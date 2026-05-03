# Jito Bundle Integration for Settler

## Overview

Atomic settlement via Jito bundles on mainnet. Taker and maker positions are settled together in a single bundle, ensuring both or neither execute.

## Implementation

### File: `services/settler/src/jito-bundle.ts`

**submitJitoBundle(connection, txs, settlerKeypair)**
- Takes already-signed VersionedTransaction array
- POSTs to Jito Block Engine: `{JITO_BLOCK_ENGINE_URL}/api/v1/bundles`
- Method: sendBundle (JSON-RPC 2.0)
- Returns: bundle ID or fallback sig
- On Jito failure: falls back to direct RPC send

### Integration in Settler

In `services/settler/src/index.ts:processFills()`:
1. Build claimFill instruction
2. Create VersionedTransaction with proper blockhash
3. Sign transaction with settlerKeypair
4. Call submitJitoBundle([signedTx], settlerKeypair)
5. Log bundle ID or fallback sig

### Environment Variables

- `JITO_BLOCK_ENGINE_URL`: Default `https://mainnet.block-engine.jito.wtf`
- `JITO_TIP_LAMPORTS`: Default `10000` (0.00001 SOL)

### Fallback Behavior

If Jito unavailable:
1. Log warning with error details
2. Send transaction directly to RPC
3. Return transaction signature (not bundle ID)

### Current Limitations

- No tip instruction included (simplified for hackathon)
- Assumes single tx per bundle (no multi-tx atomicity yet)
- No retry loop if Jito endpoint down

### Future Enhancements

- Add tip instruction to Jito pool
- Bundle multiple settlements in parallel
- Implement exponential backoff retry
- Monitor bundle status via Jito API
