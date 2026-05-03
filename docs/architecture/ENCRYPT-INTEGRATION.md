# Encrypt FHE Integration for DarkBook

**Status**: Alpha (production encryption layer, pre-alpha Encrypt mainnet)  
**Date**: 2026-05-06  
**Author**: DarkBook Team

## Overview

This document describes DarkBook's integration with Encrypt.xyz's Fully Homomorphic Encryption framework for Solana. The integration provides a layered approach to order privacy:

1. **Client-side encryption** (Stage 1, active now): Real AES-256-GCM encryption of order blobs using ephemeral x25519 ECDH
2. **On-chain commitment** (active now): sha256 fingerprint proves order correctness without revealing plaintext
3. **Threshold decryption** (Stage 2, Q3 2026): CPI to Encrypt program for decryption by threshold validator network
4. **FHE matching** (Stage 3, Q4 2026): Full on-chain matching on encrypted data (when Encrypt supports computation)

## Current Implementation (Stage 1)

### Client-Side: `sdk/src/encrypt.ts`

Implements FHE-ready encryption for order blobs:

#### Core Functions

```typescript
// Encrypt an order with ephemeral x25519 ECDH + AES-256-GCM
async function encryptOrderBlob(
  salt: Uint8Array,
  sizeLots: bigint,
  leverageBps: number,
  side: Side,
  priceTicks: bigint,
  settlerPubKey: Uint8Array,
): Promise<EncryptedOrderBlob>

// Decrypt using ephemeral private key (held by settler)
async function decryptOrderBlob(
  encryptedBlob: Uint8Array,
  ephemeralPriv: Uint8Array,
  settlerPubKey: Uint8Array,
): Promise<OrderData>

// Verify decrypted blob matches on-chain commitment (ZK proof)
function verifyEncryptedCommitment(
  encryptedBlob: Uint8Array,
  onChainCommitment: Uint8Array,
): boolean
```

#### Encryption Format

**Plaintext (49 bytes)**:
```
salt[32] || sizeLots_le8 || leverageBps_le2 || side_u8 || priceTicks_le8
```

**Ciphertext (ECIES wire format)**:
```
ephemeral_pub[32] || ciphertext_with_tag[plaintext_len + 16]
```

#### Key Derivation

1. **Ephemeral key pair**: Random x25519 per order
2. **ECDH**: Shared secret = x25519(ephemeralPriv, settlerPubKey)
3. **HKDF-SHA256**: Derive 32-byte key + 12-byte IV from shared secret
4. **AES-256-GCM**: Encrypt plaintext with derived key
5. **Commitment**: sha256(ephemeral_pub || ciphertext+tag)

### On-Chain: `programs/darkbook/src/encrypt_bridge.rs`

Provides validation and future CPI interface:

#### Functions

```rust
// Verify encrypted blob matches commitment (zero-knowledge proof)
pub fn verify_encrypted_commitment(
    encrypted_blob: &[u8],
    onchain_commitment: &[u8; 32],
) -> bool

// Validate blob is well-formed (minimum size)
pub fn validate_encrypted_blob(encrypted_blob: &[u8]) -> bool
```

#### Integration with Settlement

At `claim_fill` time:

1. **Settler reveals** encrypted blob (off-chain)
2. **On-chain checks**: `verify_encrypted_commitment(encrypted_blob, onchain_commitment)`
3. **Settler verifies**: Decrypts blob and confirms plaintext values match on-chain fills
4. **PnL settlement**: Uses decrypted values to compute realized PnL

## Usage Flow

### Placing an Order (Client)

```typescript
const config: EncryptFheConfig = {
  enabled: process.env.DARKBOOK_USE_FHE === "1",
  settlerPublicKey: Buffer.from(settlerPubKeyHex, "hex"),
};

if (config.enabled) {
  // Encrypt order blob
  const encrypted = await encryptOrderBlob(
    orderPayload.salt,
    orderPayload.sizeLots,
    orderPayload.leverageBps,
    side,
    priceTicks,
    config.settlerPublicKey,
  );

  // Store encrypted blob off-chain (e.g., IPFS, Discord, DB)
  // Use commitment for on-chain place_order
  await placeOrder(side, priceTicks, sizeBand, leverage, encrypted.commitment);
} else {
  // Backward compatible: plaintext commitment (existing flow)
  const { commitment } = generateOrderPayload(sizeLots, leverage, trader);
  await placeOrder(side, priceTicks, sizeBand, leverage, commitment);
}
```

### Claiming Fill (Settlement)

```typescript
// Settler retrieves encrypted blob from off-chain storage
const encrypted = await retrieveFromStorage(fillId);

// Verify it matches on-chain commitment
if (!verifyEncryptedCommitment(encrypted.ciphertext, onChainCommitment)) {
  throw new Error("Encrypted blob does not match on-chain commitment");
}

// Decrypt to verify fill details
const decrypted = await decryptOrderBlob(
  encrypted.ciphertext,
  ephemeralPrivKey,
  settlerPubKey,
);

// Verify decrypted values match on-chain fills
require(
  decrypted.sizeLots === onChainFillSize,
  "Size mismatch in decryption",
);
require(
  decrypted.leverageBps === onChainFillLeverage,
  "Leverage mismatch in decryption",
);

// Proceed with normal settlement
await claimFill(...);
```

## Migration Path

### Stage 1: Client-Side Encryption (NOW)

- [x] Client-side order encryption (`sdk/src/encrypt.ts`)
- [x] On-chain commitment verification (`programs/darkbook/src/encrypt_bridge.rs`)
- [x] Integration with `generateOrderPayload` and `place_order` flow
- [ ] Off-chain storage infrastructure (IPFS, Discord relay, or encrypted database)
- [ ] Settler UI for managing ephemeral private keys

### Stage 2: Threshold Decryption (Q3 2026)

**Blocking**: Encrypt mainnet launch (currently devnet pre-alpha)

- [ ] Implement CPI call to Encrypt program in `encrypt_bridge.rs::request_threshold_decrypt_cpi`
- [ ] Add `request_decrypt` instruction to darkbook program
- [ ] Integrate with `claim_fill` for automatic threshold decryption
- [ ] Remove requirement for settler to hold ephemeral private key

### Stage 3: FHE Matching (Q4 2026)

**Blocking**: Encrypt's FHE computation primitives for matching logic

- [ ] Move matching logic on-chain via Encrypt's FHE compute layer
- [ ] Eliminate ER (ephemeral rollup) dependency, execute directly on FHE validators
- [ ] Support encrypted price/size queries without revealing plaintext to public RPC nodes

## Security Considerations

### Current (Stage 1)

- **Ephemeral private keys**: Settler must securely store and never reveal. Lost key = order lost forever (settler can't prove claim).
- **Commitment binds**: On-chain commitment is sha256(encrypted_blob), not plaintext. Prevents commitment collision attacks.
- **Authenticated encryption**: AES-256-GCM provides authentication tag; tampering detected at decryption.
- **No on-chain plaintext**: Order details never appear on-chain, only hashed commitment and size band.

### Future (Stage 2+)

- **Threshold security**: Multiple decryptors required; no single party sees plaintext
- **Verifiable decryption**: Encrypt threshold network provides ZK proof that decryption is correct
- **Settler key rotation**: Support re-encryption with new settler key if needed

## Testing

Unit tests in `programs/darkbook/src/encrypt_bridge.rs`:

```bash
cd programs/darkbook
cargo test encrypt_bridge
```

Integration tests (client + on-chain):
```bash
cd sdk
npm test -- encrypt.test.ts
```

## References

- [Encrypt.xyz Documentation](https://docs.encrypt.xyz)
- [Encrypt FHE Framework](https://encrypt.xyz)
- [DarkBook Architecture](./ARCHITECTURE.md)
- [Order Commitment Scheme](../orders/COMMITMENT-SCHEME.md)
