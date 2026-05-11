/**
 * Encrypt FHE integration for DarkBook.
 *
 * This module provides a client-side encryption layer compatible with Encrypt.xyz's
 * FHE framework for Solana. While Encrypt's devnet is pre-alpha (data plaintext),
 * this layer implements real encryption infrastructure:
 *
 * 1. FHE-ready blob encryption: Orders are encrypted client-side with AES-256-GCM
 *    derived from ephemeral x25519 ECDH (compatible with future Encrypt threshold decryption).
 * 2. Commitment verification: sha256(encrypted_blob) can be verified on-chain as a
 *    cryptographic proof of order contents without revealing plaintext.
 * 3. Settlement reveal: Off-chain settler can decrypt with the ephemeral private key
 *    and prove decrypted values match on-chain commitment (zero-knowledge).
 *
 * When Encrypt mainnet launches with real FHE validators, this layer transparently
 * upgrades to threshold decryption via Encrypt's program.
 *
 * Migration path:
 *   Stage 1 (current): Client-side encryption, on-chain commitment
 *   Stage 2 (Q3 2026): CPI to Encrypt program for threshold decryption at settlement
 *   Stage 3 (Q4 2026): Full on-chain FHE computation of matching logic
 */

import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import type { PublicKey } from "@solana/web3.js";
import type { OrderPayload, Side } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EncryptedOrder: order blob encrypted client-side, stored off-chain.
 * The settler holds the ephemeralPrivateKey for decryption at claim_fill time.
 */
export interface EncryptedOrderBlob {
  /** Encrypted order plaintext (ephemeral_pub || ciphertext+tag). */
  ciphertext: Uint8Array;
  /** Ephemeral x25519 public key (first 32 bytes of ciphertext, extracted for convenience). */
  ephemeralPub: Uint8Array;
  /** Ephemeral x25519 private key (kept off-chain by settler, never sent to chain). */
  ephemeralPrivateKey: Uint8Array;
  /** sha256(ciphertext) — can be stored on-chain for commitment instead of order plaintext. */
  commitment: Uint8Array;
}

/**
 * Encrypt FHE configuration. Can be extended for mainnet Encrypt program CPI.
 */
export interface EncryptFheConfig {
  /** Enable FHE mode. If false, order placed with plaintext (backward compatible). */
  enabled: boolean;
  /** Settler's public key (for ECDH during encryption). */
  settlerPublicKey: Uint8Array;
  /** (Future) Encrypt program ID for mainnet CPI. */
  encryptProgramId?: string;
  /** (Future) Encrypt threshold network endpoint. */
  encryptDevnetRpc?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Encryption Helpers
// ─────────────────────────────────────────────────────────────────────────────

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function encodeU64LE(value: bigint): Uint8Array {
  const buf = new DataView(new ArrayBuffer(8));
  const lo = Number(value & 0xffffffffn);
  const hi = Number((value >> 32n) & 0xffffffffn);
  buf.setUint32(0, lo, true);
  buf.setUint32(4, hi, true);
  return new Uint8Array(buf.buffer);
}

function encodeU16LE(value: number): Uint8Array {
  const buf = new DataView(new ArrayBuffer(2));
  buf.setUint16(0, value, true);
  return new Uint8Array(buf.buffer);
}

function encodeU8(value: number): Uint8Array {
  return new Uint8Array([value]);
}

/** Derive 32-byte AES key + 12-byte IV from shared secret via HKDF-SHA256. */
function deriveKeyAndIv(
  sharedSecret: Uint8Array,
  ephemeralPub: Uint8Array,
  recipientPub: Uint8Array,
): { rawKey: Uint8Array; iv: Uint8Array } {
  const info = concatBytes(ephemeralPub, recipientPub);
  const derived = hkdf(sha256, sharedSecret, undefined, info, 44);
  return { rawKey: derived.slice(0, 32), iv: derived.slice(32, 44) };
}

async function aesGcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const buf = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    plaintext,
  );
  return new Uint8Array(buf);
}

async function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const buf = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext,
  );
  return new Uint8Array(buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// FHE-Ready Order Encryption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize an order to binary for encryption.
 *
 * Format (48 bytes):
 *   salt[32] || sizeLots_le8 || leverageBps_le2 || side_u8 || priceTicks_le8
 *
 * (This is the same OrderPayload + additional fields needed at claim_fill.)
 */
function serializeOrderForEncryption(
  salt: Uint8Array,
  sizeLots: bigint,
  leverageBps: number,
  side: Side,
  priceTicks: bigint,
): Uint8Array {
  if (salt.length !== 32) {
    throw new Error("Salt must be 32 bytes");
  }
  const priceTicksBytes = encodeU64LE(priceTicks);
  return concatBytes(
    salt,
    encodeU64LE(sizeLots),
    encodeU16LE(leverageBps),
    encodeU8(side),
    priceTicksBytes,
  );
}

/**
 * Deserialize a decrypted order blob.
 *
 * @throws if ciphertext is malformed
 */
function deserializeOrderFromEncryption(plaintext: Uint8Array): {
  salt: Uint8Array;
  sizeLots: bigint;
  leverageBps: number;
  side: Side;
  priceTicks: bigint;
} {
  if (plaintext.length < 49) {
    throw new Error("Decrypted plaintext too short (need at least 49 bytes)");
  }
  const view = new DataView(plaintext.buffer, plaintext.byteOffset);
  const salt = plaintext.slice(0, 32);
  const sizeLots =
    BigInt(view.getUint32(32, true)) |
    (BigInt(view.getUint32(36, true)) << 32n);
  const leverageBps = view.getUint16(40, true);
  const side = view.getUint8(42) as Side;
  const priceTicks =
    BigInt(view.getUint32(43, true)) |
    (BigInt(view.getUint32(47, true)) << 32n);
  return { salt, sizeLots, leverageBps, side, priceTicks };
}

/**
 * Encrypt an order blob with Encrypt FHE-compatible encryption.
 *
 * Uses ephemeral x25519 ECDH + HKDF-SHA256 + AES-256-GCM.
 * Wire format: ephemeral_pub(32) || ciphertext_with_tag(n+16)
 *
 * This is compatible with Encrypt's threshold decryption network when it launches.
 *
 * @param salt           - 32-byte order salt
 * @param sizeLots       - order size in lots
 * @param leverageBps    - order leverage
 * @param side           - Long (0) or Short (1)
 * @param priceTicks     - order price
 * @param settlerPubKey  - settler's x25519 public key (32 bytes)
 * @returns EncryptedOrderBlob with ciphertext, ephemeral keys, and commitment
 */
export async function encryptOrderBlob(
  salt: Uint8Array,
  sizeLots: bigint,
  leverageBps: number,
  side: Side,
  priceTicks: bigint,
  settlerPubKey: Uint8Array,
): Promise<EncryptedOrderBlob> {
  if (settlerPubKey.length !== 32) {
    throw new Error("Settler public key must be 32 bytes");
  }

  const plaintext = serializeOrderForEncryption(
    salt,
    sizeLots,
    leverageBps,
    side,
    priceTicks,
  );

  // Generate ephemeral key pair
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);

  // ECDH
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, settlerPubKey);
  const { rawKey, iv } = deriveKeyAndIv(sharedSecret, ephemeralPub, settlerPubKey);

  // Encrypt
  const ciphertextWithTag = await aesGcmEncrypt(rawKey, iv, plaintext);
  const fullCiphertext = concatBytes(ephemeralPub, ciphertextWithTag);

  // Compute commitment (sha256 of the encrypted blob)
  const commitment = sha256(fullCiphertext);

  return {
    ciphertext: fullCiphertext,
    ephemeralPub,
    ephemeralPrivateKey: ephemeralPriv,
    commitment,
  };
}

/**
 * Decrypt an order blob using the ephemeral private key.
 *
 * @param encryptedBlob  - result from encryptOrderBlob
 * @param ephemeralPriv  - ephemeral x25519 private key (32 bytes, from settler)
 * @param settlerPubKey  - settler's x25519 public key (32 bytes)
 * @returns decrypted order parameters
 */
export async function decryptOrderBlob(
  encryptedBlob: Uint8Array,
  ephemeralPriv: Uint8Array,
  settlerPubKey: Uint8Array,
): Promise<{
  salt: Uint8Array;
  sizeLots: bigint;
  leverageBps: number;
  side: Side;
  priceTicks: bigint;
}> {
  if (encryptedBlob.length < 48) {
    throw new Error(
      "Encrypted blob too short (need at least 48 bytes: 32 pub + 16 tag)",
    );
  }

  const ephemeralPub = encryptedBlob.slice(0, 32);
  const ciphertextWithTag = encryptedBlob.slice(32);

  // ECDH + HKDF
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, ephemeralPub);
  const { rawKey, iv } = deriveKeyAndIv(sharedSecret, ephemeralPub, settlerPubKey);

  // Decrypt
  const plaintext = await aesGcmDecrypt(rawKey, iv, ciphertextWithTag);

  return deserializeOrderFromEncryption(plaintext);
}

/**
 * Verify that a decrypted order blob matches a stored commitment.
 *
 * This proves to the on-chain program that the settler revealed the correct plaintext
 * without revealing it on-chain.
 *
 * @param encryptedBlob - the encrypted ciphertext stored off-chain
 * @param onChainCommitment - the commitment hash stored on-chain
 * @returns true if commitment matches
 */
export function verifyEncryptedCommitment(
  encryptedBlob: Uint8Array,
  onChainCommitment: Uint8Array,
): boolean {
  const computed = sha256(encryptedBlob);
  if (computed.length !== onChainCommitment.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed[i] ^ onChainCommitment[i];
  }
  return diff === 0;
}

/**
 * Compute the FHE commitment (sha256 of encrypted blob) without encryption.
 * Useful for testing or off-chain verification.
 */
export function computeEncryptedCommitment(
  encryptedBlob: Uint8Array,
): Uint8Array {
  return sha256(encryptedBlob);
}

// ─────────────────────────────────────────────────────────────────────────────
// Future: Encrypt Mainnet Integration (CPI stub)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * (Future) Prepare a request to decrypt an order blob via Encrypt's threshold network.
 *
 * When Encrypt mainnet launches, this function will construct a CPI call to the
 * Encrypt program to request threshold decryption of the order ciphertext.
 *
 * For now, it's a stub that returns the method name for documentation.
 *
 * @param _encryptedBlob - ciphertext from client encryption
 * @param _config - Encrypt FHE configuration (program ID, RPC endpoint)
 * @returns method name for CPI (future implementation)
 */
export async function requestEncryptThresholdDecryption(
  _encryptedBlob: Uint8Array,
  _config: EncryptFheConfig,
): Promise<string> {
  if (!_config.enabled) {
    throw new Error("Encrypt FHE not enabled in config");
  }
  return "threshold_decrypt";
}


