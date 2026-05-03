# DarkBook Torque MCP Integration

## Overview

DarkBook's Torque MCP server bridges autonomous trading agents with real on-chain order execution via the Model Context Protocol. This integration enables Torque agents to place orders, cancel positions, and monitor market state on Solana mainnet or devnet without manual intervention.

## Architecture

```
Torque Agent
    ↓
MCP Client (protocol: stdio)
    ↓
DarkBook Torque MCP Server
    ↓
DarkbookClient SDK (Anchor wrapper)
    ↓
DarkBook Solana Program
```

## Setup Steps

### 1. Install Dependencies

The server depends on:
- `@modelcontextprotocol/sdk` — Official MCP SDK for building servers
- `@darkbook/sdk` — DarkBook Anchor client (handles all on-chain logic)
- `@solana/web3.js` — Solana blockchain interactions
- `zod` — Input schema validation

### 2. Configure Environment

Set three environment variables:

1. **SOLANA_RPC_URL** (required)
   - Example: `https://api.devnet.solana.com` or `http://localhost:8899`
   - Used for all blockchain reads and transaction sends

2. **DARKBOOK_PROGRAM_ID** (required)
   - The deployed DarkBook program's public key
   - Example: `DarkbookProgramId123456789000000000`

3. **SIGNER_SECRET_KEY** (required)
   - JSON-encoded 64-byte secret key array
   - Example: `[1,2,3,...,64]`
   - Generated from `solana-keygen` and encoded as JSON

### 3. Add to Torque Config

In your Torque agent's configuration file (e.g., `torque-config.json`):

```json
{
  "mcp_servers": {
    "darkbook": {
      "command": "node",
      "args": ["/absolute/path/to/darkbook/services/torque-mcp/dist/index.js"],
      "env": {
        "SOLANA_RPC_URL": "https://api.devnet.solana.com",
        "DARKBOOK_PROGRAM_ID": "11111111111111111111111111111111",
        "SIGNER_SECRET_KEY": "[1,2,3,...,64]"
      }
    }
  }
}
```

### 4. Build and Deploy

```bash
cd /path/to/darkbook

# Build the MCP server
bun run -F @darkbook/torque-mcp build

# Verify compilation
bun run -F @darkbook/torque-mcp typecheck

# Start server to verify it runs (ctrl+c to exit)
bun run -F @darkbook/torque-mcp start
```

## Tool Lifecycle

When a Torque agent calls a DarkBook tool:

1. **Validation**: Input is validated against Zod schemas
2. **Client Init**: DarkbookClient is lazily initialized on first use
3. **Execution**: The corresponding SDK method is called
4. **Response**: Result (tx signature or data) is serialized to JSON
5. **Error Handling**: Any error is caught and returned as `isError: true`

All tools are **stateless** — each call is independent and does not modify server state.

## Security Considerations

- **Keys**: The signer keypair is never logged or sent over the network. It stays in the server process memory.
- **RPC Privacy**: All RPC calls go directly to the configured RPC endpoint, not through Torque's proxy.
- **Tool Constraints**: Input validation via Zod schemas prevents malformed requests from reaching the blockchain.

## Supported Chains

The server works on any Solana cluster with DarkBook deployed:
- **Devnet**: For testing and development
- **Mainnet-Beta**: For production trading

Switch chains by updating `SOLANA_RPC_URL` and redeploy.

## Monitoring and Logs

Server logs are written to stderr during operation:
- `console.error("DarkBook Torque MCP server started")` on boot
- `console.error("Fatal error:", error)` on crash

To monitor in production, capture the process's stderr stream.

## Limitations

- **Order Frequency**: Limited by Solana block time (~400ms)
- **Price Oracle**: Relies on Pyth for mark price data; may lag actual market
- **Position Capacity**: Each owner can have up to N open positions per market (enforced on-chain)

## Future Enhancements

- WebSocket transport for real-time price updates
- Batch order submission for multi-leg strategies
- Built-in position simulator before sending orders
- Custom event subscriptions (fills, liquidations, funding)
