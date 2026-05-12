import * as readline from "readline";
import { z } from "zod";
import {
  Connection,
  PublicKey,
  Keypair,
} from "@solana/web3.js";
import {
  DarkbookClient,
  Side,
  lotsToBand,
} from "@darkbook/sdk";
import { Wallet } from "@coral-xyz/anchor";

// Environment configuration
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "http://localhost:8899";
const DARKBOOK_PROGRAM_ID = new PublicKey(
  process.env.DARKBOOK_PROGRAM_ID || "DarkbookProgramIdHere123456789"
);
const SIGNER_SECRET_KEY = process.env.SIGNER_SECRET_KEY;

// Initialize Solana connection and client
let client: DarkbookClient | null = null;

function initializeClient(): DarkbookClient {
  if (client) return client;

  if (!SIGNER_SECRET_KEY) {
    throw new Error("SIGNER_SECRET_KEY environment variable is required");
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const secretKey = new Uint8Array(JSON.parse(SIGNER_SECRET_KEY));
  const keypair = Keypair.fromSecretKey(secretKey);
  const wallet = new Wallet(keypair);

  client = new DarkbookClient({
    connection,
    erConnection: connection,
    wallet,
    programId: DARKBOOK_PROGRAM_ID,
  });

  return client;
}

// Tool schemas
const placeOrderSchema = z.object({
  market: z.string(),
  side: z.enum(["long", "short"]),
  priceTicks: z.string(),
  sizeLots: z.string(),
  leverageBps: z.number(),
});

const cancelOrderSchema = z.object({
  market: z.string(),
  orderId: z.string(),
  salt: z.string(),
  sizeLots: z.string(),
  leverageBps: z.number(),
});

const getPositionsSchema = z.object({
  market: z.string(),
  owner: z.string().optional(),
});

const getOrderBookSchema = z.object({
  market: z.string(),
});

// Tool implementations
async function placeOrder(params: z.infer<typeof placeOrderSchema>) {
  const client = initializeClient();
  const marketPk = new PublicKey(params.market);
  const side = params.side === "long" ? Side.Long : Side.Short;
  const priceTicks = BigInt(params.priceTicks);
  const sizeLots = BigInt(params.sizeLots);
  const sizeBand = lotsToBand(sizeLots);

  const result = await client.placeOrder(
    marketPk,
    side,
    priceTicks,
    sizeBand,
    params.leverageBps,
    sizeLots
  );

  return {
    type: "text",
    text: JSON.stringify(
      {
        status: "success",
        message: "Order placed successfully",
        signature: result.sig,
        orderId: result.orderId.toString(),
        market: params.market,
        side: params.side,
        sizeLots: params.sizeLots,
        leverageBps: params.leverageBps,
        priceTicks: params.priceTicks,
      },
      null,
      2
    ),
  };
}

async function cancelOrder(params: z.infer<typeof cancelOrderSchema>) {
  const client = initializeClient();
  const marketPk = new PublicKey(params.market);
  const orderId = BigInt(params.orderId);
  const salt = new Uint8Array(Buffer.from(params.salt, "hex"));
  const sizeLots = BigInt(params.sizeLots);

  const payload = {
    salt,
    sizeLots,
    leverageBps: params.leverageBps,
  };

  const signature = await client.cancelOrder(marketPk, orderId, payload);

  return {
    type: "text",
    text: JSON.stringify(
      {
        status: "success",
        message: "Order cancelled successfully",
        signature,
        market: params.market,
        orderId: params.orderId,
      },
      null,
      2
    ),
  };
}

async function getPositions(params: z.infer<typeof getPositionsSchema>) {
  const client = initializeClient();
  const marketPk = new PublicKey(params.market);
  const owner = params.owner ? new PublicKey(params.owner) : client.wallet.publicKey;

  const positions = await client.fetchUserPositions(marketPk, owner);

  return {
    type: "text",
    text: JSON.stringify(
      {
        status: "success",
        market: params.market,
        owner: owner.toString(),
        positions: positions.map((p) => ({
          positionIdx: p.positionIdx,
          owner: p.owner.toString(),
          market: p.market.toString(),
          side: Object.keys(p.side)[0],
          sizeLots: p.sizeLots.toString(),
          entryPriceTicks: p.entryPriceTicks.toString(),
          collateralLocked: p.collateralLocked.toString(),
          status: Object.keys(p.status)[0],
          openedTs: p.openedTs.toString(),
        })),
        count: positions.length,
      },
      null,
      2
    ),
  };
}

async function getOrderBook(params: z.infer<typeof getOrderBookSchema>) {
  const client = initializeClient();
  const marketPk = new PublicKey(params.market);

  const book = await client.fetchOrderBook(marketPk);

  return {
    type: "text",
    text: JSON.stringify(
      {
        status: "success",
        market: params.market,
        bids: book.bids.map((order) => ({
          orderId: order.orderId.toString(),
          trader: order.trader.toString(),
          side: Object.keys(order.side)[0],
          priceTicks: order.priceTicks.toString(),
          sizeBand: Object.keys(order.sizeBand)[0],
          leverageBps: order.leverageBps,
          placedSlot: order.placedSlot.toString(),
        })),
        asks: book.asks.map((order) => ({
          orderId: order.orderId.toString(),
          trader: order.trader.toString(),
          side: Object.keys(order.side)[0],
          priceTicks: order.priceTicks.toString(),
          sizeBand: Object.keys(order.sizeBand)[0],
          leverageBps: order.leverageBps,
          placedSlot: order.placedSlot.toString(),
        })),
      },
      null,
      2
    ),
  };
}

// Tool definitions
const tools = [
  {
    name: "darkbook.placeOrder",
    description:
      "Place a new limit order on DarkBook. Returns transaction signature.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Market public key (base58)" },
        side: {
          type: "string",
          enum: ["long", "short"],
          description: "Order side",
        },
        sizeLots: { type: "string", description: "Size in lots (as string)" },
        leverageBps: {
          type: "number",
          description: "Leverage in basis points (e.g., 100 = 1x)",
        },
        priceTicks: { type: "string", description: "Limit price in ticks" },
      },
      required: ["market", "side", "sizeLots", "leverageBps", "priceTicks"],
    },
  },
  {
    name: "darkbook.cancelOrder",
    description: "Cancel an existing order. Returns transaction signature.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Market public key (base58)" },
        orderId: { type: "string", description: "Order ID to cancel (as string)" },
        salt: { type: "string", description: "Order salt (hex-encoded)" },
        sizeLots: { type: "string", description: "Original order size in lots (as string)" },
        leverageBps: {
          type: "number",
          description: "Original leverage in basis points",
        },
      },
      required: ["market", "orderId", "salt", "sizeLots", "leverageBps"],
    },
  },
  {
    name: "darkbook.getPositions",
    description: "Get all positions for an owner on a specific market.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Market public key (base58)" },
        owner: {
          type: "string",
          description: "Owner address (defaults to signer if omitted)",
        },
      },
      required: ["market"],
    },
  },
  {
    name: "darkbook.getOrderBook",
    description: "Get the order book (bids and asks) for a specific market.",
    inputSchema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Market public key (base58)" },
      },
      required: ["market"],
    },
  },
];

// Simple MCP stdio protocol handler
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", async (line) => {
  try {
    const request = JSON.parse(line);

    if (request.method === "tools/list") {
      const response = {
        jsonrpc: "2.0",
        id: request.id,
        result: { tools },
      };
      process.stdout.write(JSON.stringify(response) + "\n");
    } else if (request.method === "tools/call") {
      const { name, arguments: args } = request.params;

      let result;
      switch (name) {
        case "darkbook.placeOrder": {
          const params = placeOrderSchema.parse(args);
          result = await placeOrder(params);
          break;
        }

        case "darkbook.cancelOrder": {
          const params = cancelOrderSchema.parse(args);
          result = await cancelOrder(params);
          break;
        }

        case "darkbook.getPositions": {
          const params = getPositionsSchema.parse(args);
          result = await getPositions(params);
          break;
        }

        case "darkbook.getOrderBook": {
          const params = getOrderBookSchema.parse(args);
          result = await getOrderBook(params);
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const response = {
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [result] },
      };
      process.stdout.write(JSON.stringify(response) + "\n");
    } else {
      const response = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32601,
          message: `Unknown method: ${request.method}`,
        },
      };
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    let requestId;
    try {
      requestId = (JSON.parse(line) as { id?: string | number }).id;
    } catch {
      requestId = null;
    }
    const response = {
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code: -32000,
        message: errorMessage,
      },
    };
    process.stdout.write(JSON.stringify(response) + "\n");
  }
});

process.stderr.write("DarkBook Torque MCP server started\n");
