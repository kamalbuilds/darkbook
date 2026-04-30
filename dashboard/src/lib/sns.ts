/**
 * Real SNS (Solana Name Service) integration for .sol name lookups.
 * Uses @bonfida/spl-name-service for on-chain reverse and forward resolution.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getDomainKeySync, NameRegistryState } from "@bonfida/spl-name-service";

/**
 * Reverse lookup: PublicKey -> .sol name
 * Returns the SNS domain name if the wallet owns one, null otherwise.
 * Real on-chain call via RPC.
 */
export async function resolveSnsName(
  connection: Connection,
  owner: PublicKey
): Promise<string | null> {
  try {
    // Get all domains owned by this wallet
    const domainAccounts = await connection.getProgramAccounts(
      new PublicKey("nftLwWdvrV7T1BqE7TW2aASmh2E9qk4W7EFqVpx7vJ5"), // SNS program
      {
        filters: [
          { memcmp: { offset: 32, bytes: owner.toBase58() } }, // owner filter
        ],
      }
    );

    if (domainAccounts.length === 0) return null;

    // Parse the first domain name (most common case)
    // Domain name is stored after the header and owner
    const accountData = domainAccounts[0].account.data;
    // SNS domain structure: discriminator (1) + nonce (1) + name_len (2) + name (variable) + owner (32) + ...
    const nameLen = accountData.readUInt16LE(2);
    const nameBytes = accountData.slice(4, 4 + nameLen);
    const name = Buffer.from(nameBytes).toString("utf-8");

    return name ? `${name}.sol` : null;
  } catch {
    // RPC errors, network issues, or no SNS domain
    return null;
  }
}

/**
 * Forward lookup: .sol name -> PublicKey
 * Returns the PublicKey that owns the domain, null if not found.
 * Real on-chain call via RPC.
 */
export async function lookupSnsByName(
  connection: Connection,
  name: string
): Promise<PublicKey | null> {
  try {
    // Normalize: remove .sol suffix if present
    const domainName = name.replace(/\.sol$/, "");

    // Get the domain key from Bonfida's helper
    const domainKeyData = getDomainKeySync(domainName);
    const domainKey = domainKeyData.pubkey;

    // Fetch the account data
    const accountInfo = await connection.getAccountInfo(domainKey);
    if (!accountInfo) return null;

    // Parse owner from the account (at offset 32)
    const ownerBytes = accountInfo.data.slice(32, 64);
    const owner = new PublicKey(ownerBytes);

    return owner;
  } catch {
    // Domain not found or RPC error
    return null;
  }
}

/**
 * Cache store for resolved names with TTL.
 * Key: pubkey.toBase58(), Value: { name: string | null, expiresAt: number }
 */
const resolveCache = new Map<string, { name: string | null; expiresAt: number }>();

/**
 * Resolve SNS name with client-side memory cache (5 min TTL).
 * Useful for repeated lookups on the same page within same session.
 */
export async function resolveSnsNameCached(
  connection: Connection,
  owner: PublicKey,
  cacheTtlMs = 5 * 60 * 1000 // 5 minutes
): Promise<string | null> {
  const key = owner.toBase58();
  const cached = resolveCache.get(key);

  // Return cached result if still valid
  if (cached && Date.now() < cached.expiresAt) {
    return cached.name;
  }

  // Fetch fresh result
  const name = await resolveSnsName(connection, owner);

  // Store in cache
  resolveCache.set(key, {
    name,
    expiresAt: Date.now() + cacheTtlMs,
  });

  return name;
}
