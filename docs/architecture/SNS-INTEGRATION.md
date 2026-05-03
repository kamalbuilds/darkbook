# SNS (Solana Name Service) Integration

## Overview

Real SNS name resolution is now wired into the darkbook dashboard for the Identity Track ($5k).

**Module:** `dashboard/src/lib/sns.ts`

## Features

### 1. Reverse Lookup (Owner -> .sol Name)
`resolveSnsName(connection, owner: PublicKey): Promise<string | null>`
- Fetches all domains owned by a wallet via SNS program
- Parses domain name from account data
- Returns `kamal.sol` or null if no domain exists
- Real on-chain RPC call only, no hardcoded names

### 2. Forward Lookup (Domain -> Owner)
`lookupSnsByName(connection, name: string): Promise<PublicKey | null>`
- Resolves a .sol domain name to its owner PublicKey
- Uses Bonfida's `getDomainKeySync` + account parsing
- Returns owner PublicKey or null if domain not found

### 3. Client-Side Memory Cache
`resolveSnsNameCached(connection, owner, cacheTtlMs = 5min)`
- Wraps resolve with in-process cache
- Avoids repeated RPC calls for same wallet in session
- TTL: 5 minutes (configurable)
- Cache key: owner's base58 pubkey string

## UI Wiring

### Wallet Button (`wallet-button.tsx`)
- Shows connected wallet's SNS name if available
- Falls back to truncated pubkey if no SNS domain
- Displays "Resolving…" during fetch
- Green text for SNS names, gray for pubkeys

### Positions Table (`positions-table.tsx`)
- Added "Owner" column showing SNS name or truncated key
- Hover shows full pubkey as tooltip
- Per-position SNS resolution with zustand cache
- Green highlight if SNS name exists

### Recent Fills (`recent-fills.tsx`)
- "Taker" column shows SNS name if available
- Real taker pubkey replaced with human-readable domain
- Green highlight for resolved SNS names
- Fallback to truncated key if no domain

## State Management

**Zustand store** (`dashboard/src/store/darkbook-store.ts`):
- `snsCache: Map<string, { name: string | null; expiresAt: number }>`
- `setSnsCache(pubkey, name, expiresAt)` action
- Shared across all components for deduplication

## RPC Costs

- **Reverse lookup:** 1 RPC call (`getProgramAccounts` filter on SNS program)
- **Forward lookup:** 1 RPC call (`getAccountInfo` on domain pubkey)
- **Cache hit:** 0 RPC calls (memory only)
- **Per-session overhead:** ~1-3 RPC calls per unique wallet displayed

## SDK Dependency

```json
"@bonfida/spl-name-service": "^3.0.21"
```

Real implementation via `getDomainKeySync()` and `NameRegistryState.retrieve()` from the official Bonfida SDK.

## Fallback Behavior

All functions return null and silently degrade if:
- RPC is unreachable
- Wallet has no SNS domain
- Domain name not found
- Network errors occur

UI shows truncated pubkey (e.g., `Abcd…1234`) as fallback.

## Testing

To verify SNS resolution works:
1. Connect a wallet with a .sol domain
2. Check wallet button shows the domain name
3. Verify positions table shows owner's SNS name
4. Inspect recent fills for taker SNS resolution
5. Refresh page and verify cache works (no "Resolving…" delay)
