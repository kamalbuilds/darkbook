/**
 * Commitment scheme + ECIES helpers for DarkBook order privacy.
 *
 * Commitment = sha256(salt(32) || sizeLots_le8(8) || leverageBps_le2(2) || trader_bytes(32))
 * Total preimage: 74 bytes.
 *
 * ECIES wire format: ephemeral_pub(32) || ciphertext_with_tag(n+16)
 * Uses x25519 ECDH + HKDF-SHA256 + AES-256-GCM (via @noble/curves, @noble/hashes, SubtleCrypto).
 */

import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import type { PublicKey } from "@solana/web3.js";
import type { OrderPayload, SizeBand } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
    "raw", key, { name: "AES-GCM" }, false, ["encrypt"],
  );
  const buf = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, cryptoKey, plaintext,
  );
  return new Uint8Array(buf);
}

async function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw", key, { name: "AES-GCM" }, false, ["decrypt"],
  );
  const buf = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, cryptoKey, ciphertext,
  );
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// Commitment scheme
// ---------------------------------------------------------------------------

/** Compute commitment hash from its components. Pure, no side effects. */
export function computeCommitment(
  salt: Uint8Array,
  sizeLots: bigint,
  leverageBps: number,
  trader: PublicKey,
): Uint8Array {
  const preimage = concatBytes(
    salt,
    encodeU64LE(sizeLots),
    encodeU16LE(leverageBps),
    trader.toBytes(),
  );
  return sha256(preimage);
}

/**
 * Generates a fresh OrderPayload (random 32-byte salt) and its on-chain commitment.
 * commitment = sha256(salt || sizeLots_le8 || leverageBps_le2 || trader_bytes)
 */
export function generateOrderPayload(
  sizeLots: bigint,
  leverageBps: number,
  trader: PublicKey,
): { payload: OrderPayload; commitment: Uint8Array } {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const payload: OrderPayload = { salt, sizeLots, leverageBps };
  const commitment = computeCommitment(salt, sizeLots, leverageBps, trader);
  return { payload, commitment };
}

/**
 * Verifies that an OrderPayload matches a stored on-chain commitment.
 * Uses constant-time comparison to avoid timing leaks.
 */
export function verifyCommitment(
  payload: OrderPayload,
  trader: PublicKey,
  commitment: Uint8Array,
): boolean {
  const expected = computeCommitment(
    payload.salt, payload.sizeLots, payload.leverageBps, trader,
  );
  if (expected.length !== commitment.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ commitment[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// ECIES
// ---------------------------------------------------------------------------

/**
 * ECIES encrypt: x25519 ECDH + HKDF-SHA256 + AES-256-GCM.
 * Wire format: ephemeral_pub(32) || ciphertext_with_tag(n+16)
 *
 * @param plaintext    - bytes to encrypt
 * @param recipientPub - recipient's x25519 public key (32 bytes)
 */
export async function eciesEncrypt(
  plaintext: Uint8Array,
  recipientPub: Uint8Array,
): Promise<Uint8Array> {
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, recipientPub);
  const { rawKey, iv } = deriveKeyAndIv(sharedSecret, ephemeralPub, recipientPub);
  const ciphertextWithTag = await aesGcmEncrypt(rawKey, iv, plaintext);
  return concatBytes(ephemeralPub, ciphertextWithTag);
}

/**
 * ECIES decrypt.
 *
 * @param ciphertext   - bytes from eciesEncrypt (ephemeral_pub || ciphertext+tag)
 * @param recipientPriv - recipient's x25519 private key (32 bytes)
 */
export async function eciesDecrypt(
  ciphertext: Uint8Array,
  recipientPriv: Uint8Array,
): Promise<Uint8Array> {
  if (ciphertext.length < 48) {
    throw new Error("ECIES ciphertext too short (need at least 48 bytes: 32 pub + 16 tag)");
  }
  const ephemeralPub = ciphertext.slice(0, 32);
  const body = ciphertext.slice(32);
  const recipientPub = x25519.getPublicKey(recipientPriv);
  const sharedSecret = x25519.getSharedSecret(recipientPriv, ephemeralPub);
  const { rawKey, iv } = deriveKeyAndIv(sharedSecret, ephemeralPub, recipientPub);
  return aesGcmDecrypt(rawKey, iv, body);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Returns the SizeBand for a given lot count per ARCHITECTURE thresholds. */
export function lotsToBand(sizeLots: bigint): SizeBand {
  // Import SizeBand enum values as numbers — avoids circular import.
  if (sizeLots <= 10n) return 0 as SizeBand;   // Small
  if (sizeLots <= 100n) return 1 as SizeBand;  // Medium
  if (sizeLots <= 1000n) return 2 as SizeBand; // Large
  return 3 as SizeBand;                         // Whale
}
