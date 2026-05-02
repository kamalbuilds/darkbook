# DarkBook Torque MCP Server

Model Context Protocol server that enables Torque agents to trade on DarkBook with real order placement, cancellation, position tracking, and market data queries.

## Features

- **Place Orders**: `darkbook.placeOrder(market, side, sizeLots, leverageBps, priceTicks)`
- **Cancel Orders**: `darkbook.cancelOrder(market, orderId, salt, sizeLots, leverageBps)`
- **View Positions**: `darkbook.getPositions(market, owner?)`
- **Read Order Book**: `darkbook.getOrderBook(market)`
- **Get Mark Price**: `darkbook.getMarkPrice(market)`

## Environment Setup

```bash
export SOLANA_RPC_URL="https://api.devnet.solana.com"
export DARKBOOK_PROGRAM_ID="<program-id>"
export SIGNER_SECRET_KEY='[<secret-key-bytes>]'
```

The `SIGNER_SECRET_KEY` must be a JSON array of 64 bytes representing the keypair's secret key.

## Build & Run

```bash
# From monorepo root
bun run -F @darkbook/torque-mcp build

# Start MCP server (stdio mode)
bun run -F @darkbook/torque-mcp start
```

## Integration with Torque

Add the following to your Torque agent config:

```json
{
  "mcp_servers": {
    "darkbook": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "SOLANA_RPC_URL": "https://api.devnet.solana.com",
        "DARKBOOK_PROGRAM_ID": "<program-id>",
        "SIGNER_SECRET_KEY": "[...]"
      }
    }
  }
}
```

Once configured, Torque agents can call any of the five DarkBook tools natively.

## Tool Reference

### darkbook.placeOrder

Place a limit order on the market.

**Parameters:**
- `market` (string): Market public key
- `side` (enum): "buy" or "sell"
- `sizeLots` (number): Order size in lots
- `leverageBps` (number): Leverage in basis points (10000 = 1x)
- `priceTicks` (number): Limit price in ticks

**Returns:** Transaction signature and order details

### darkbook.cancelOrder

Cancel an open order.

**Parameters:**
- `market` (string): Market public key
- `orderId` (number): Order ID
- `salt` (number): Order salt
- `sizeLots` (number): Original order size
- `leverageBps` (number): Original leverage

**Returns:** Transaction signature

### darkbook.getPositions

Fetch all open positions for an owner.

**Parameters:**
- `market` (string): Market public key
- `owner` (string, optional): Owner address (defaults to signer)

**Returns:** Array of positions with size, entry price, and PnL

### darkbook.getOrderBook

Fetch bid and ask levels for a market.

**Parameters:**
- `market` (string): Market public key

**Returns:** Bids and asks with price and size

### darkbook.getMarkPrice

Get the current mark price for a market.

**Parameters:**
- `market` (string): Market public key

**Returns:** Mark price from Pyth oracle
