import axios from 'axios';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { readFileSync } from 'fs';

interface DarkbookEvent {
  type: 'FillRecorded' | 'PositionOpened' | 'PositionLiquidated' | 'FundingApplied';
  trader: string;
  asset: string;
  side: 'long' | 'short';
  size: number;
  price: number;
  leverage?: number;
  timestamp: number;
  signature?: string;
}

interface Tweet {
  text: string;
  url?: string;
}

/**
 * SagaPad X Agent for DarkBook
 * Monitors on-chain events and posts insights to X for hackathon visibility
 */
class SagaPadXAgent {
  private xBearerToken: string;
  private connection: Connection;
  private programId: PublicKey;
  private eventCoder: any;
  private lastEventSignature: string = '';

  constructor() {
    this.xBearerToken = process.env.X_BEARER_TOKEN || '';
    if (!this.xBearerToken) {
      throw new Error('X_BEARER_TOKEN environment variable not set');
    }

    const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    const programIdStr = process.env.DARKBOOK_PROGRAM_ID;
    if (!programIdStr) {
      throw new Error('DARKBOOK_PROGRAM_ID environment variable not set');
    }
    this.programId = new PublicKey(programIdStr);

    // Initialize event coder from IDL
    try {
      const idlPath = process.env.DARKBOOK_IDL_PATH || '../../../sdk/src/idl/darkbook.json';
      const idlData = JSON.parse(readFileSync(idlPath, 'utf-8'));

      const dummyKeypair = new Keypair();
      const dummyWallet = new Wallet(dummyKeypair);
      const provider = new AnchorProvider(this.connection, dummyWallet, {
        commitment: 'confirmed',
      });
      const program = new Program(idlData as any, provider);
      this.eventCoder = program.coder.events;
    } catch (e) {
      console.warn('[Init] Failed to initialize event coder:', e);
      // Continue anyway - will catch missing events gracefully
      this.eventCoder = null as any;
    }

    console.log(`[SagaPad X Agent] Initialized for program: ${this.programId.toString()}`);
  }

  /**
   * Fetch recent DarkBook events by parsing transaction logs
   */
  private async fetchRecentEvents(): Promise<DarkbookEvent[]> {
    try {
      const signatures = await this.connection.getSignaturesForAddress(this.programId, {
        limit: 10,
      });

      const events: DarkbookEvent[] = [];

      for (const sig of signatures) {
        if (sig.signature === this.lastEventSignature) break;

        try {
          const tx = await this.connection.getTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (!tx || !tx.meta) continue;

          // Parse logs for Anchor events - look for program data hex strings
          const logs = tx.meta.logMessages || [];
          const eventLogs = logs
            .filter(log => log.includes('Program data:'))
            .map(log => {
              const match = log.match(/Program data: ([\da-f]+)/i);
              return match ? match[1] : null;
            })
            .filter((hex): hex is string => hex !== null);

          for (const hexData of eventLogs) {
            try {
              if (!this.eventCoder) continue;

              const buffer = Buffer.from(hexData, 'hex');
              const decoded = this.eventCoder.decode(hexData);

              if (!decoded) continue;

              const event = this.parseDecodedEvent(decoded, sig.signature);
              if (event) {
                events.push(event);
              }
            } catch (parseError) {
              console.debug(`[Events] Could not decode event log:`, parseError);
            }
          }
        } catch (e) {
          console.error(`[Events] Failed to parse transaction ${sig.signature}:`, e);
        }
      }

      if (signatures.length > 0) {
        this.lastEventSignature = signatures[0].signature;
      }

      return events;
    } catch (error) {
      console.error('[Events] Failed to fetch recent events:', error);
      return [];
    }
  }

  /**
   * Parse a decoded Anchor event into a DarkbookEvent
   */
  private parseDecodedEvent(decoded: any, signature: string): DarkbookEvent | null {
    const eventName = decoded.name || '';
    const data = decoded.data || {};

    switch (eventName) {
      case 'FillRecorded': {
        const side = data.side?.long ? 'long' : 'short';
        return {
          type: 'FillRecorded',
          trader: data.trader?.toString() || 'unknown',
          asset: 'SOL-USDC',
          side,
          size: Number(data.fillSize || 0),
          price: Number(data.fillPrice || 0) / 1e6,
          timestamp: (Date.now() / 1000) | 0,
          signature,
        };
      }

      case 'PositionOpened': {
        const side = data.side?.long ? 'long' : 'short';
        return {
          type: 'PositionOpened',
          trader: data.owner?.toString() || 'unknown',
          asset: 'SOL-USDC',
          side,
          size: Number(data.positionSize || 0),
          price: Number(data.entryPrice || 0) / 1e6,
          leverage: Number(data.leverage || 1),
          timestamp: (Date.now() / 1000) | 0,
          signature,
        };
      }

      case 'PositionLiquidated': {
        const side = data.side?.long ? 'long' : 'short';
        return {
          type: 'PositionLiquidated',
          trader: data.owner?.toString() || 'unknown',
          asset: 'SOL-USDC',
          side,
          size: Number(data.positionSize || 0),
          price: Number(data.liquidationPrice || 0) / 1e6,
          timestamp: (Date.now() / 1000) | 0,
          signature,
        };
      }

      case 'FundingApplied': {
        return {
          type: 'FundingApplied',
          trader: data.owner?.toString() || 'unknown',
          asset: 'SOL-USDC',
          side: 'long',
          size: Number(data.fundingAmount || 0),
          price: 0,
          timestamp: (Date.now() / 1000) | 0,
          signature,
        };
      }

      default:
        return null;
    }
  }

  /**
   * Compose a tweet about a DarkBook event
   */
  private composeTweet(event: DarkbookEvent): Tweet {
    const sideEmoji = event.side === 'long' ? '📈' : '📉';

    switch (event.type) {
      case 'FillRecorded':
        return {
          text: `${sideEmoji} DarkBook Fill: ${event.side.toUpperCase()} ${event.size.toFixed(2)} SOL at $${event.price.toFixed(2)}. Sub-50ms matching on @MagicBlock ER. #ColosseusFrontier #Solana`,
          url: `https://explorer.solana.com/tx/${event.signature}?cluster=devnet`,
        };

      case 'PositionOpened':
        return {
          text: `New Position: ${event.side.toUpperCase()} ${event.size.toFixed(2)} SOL @ ${event.leverage || 1}x leverage. Privacy-first perps on Solana. Live now: https://darkbook.dev #DarkBook #Perps`,
          url: undefined,
        };

      case 'PositionLiquidated':
        return {
          text: `Liquidation Alert: ${event.side.toUpperCase()} position liquidated at $${event.price.toFixed(2)}. DarkBook permissionless liquidations at mark price. #Solana #DeFi`,
          url: undefined,
        };

      case 'FundingApplied':
        return {
          text: `Funding applied to DarkBook positions. Transparent on-chain funding mechanics. Building institutional-grade perps on Solana. #ColosseusFrontier`,
          url: undefined,
        };

      default:
        return {
          text: `Event on DarkBook: ${event.type}. Confidential CLOB on Solana.`,
        };
    }
  }

  /**
   * Post tweet to X
   */
  private async postToX(tweet: Tweet): Promise<boolean> {
    try {
      const text = tweet.url ? `${tweet.text}\n\n${tweet.url}` : tweet.text;

      const response = await axios.post(
        'https://api.x.com/2/tweets',
        { text },
        {
          headers: {
            Authorization: `Bearer ${this.xBearerToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status === 201) {
        console.log(`[X] Posted tweet: ${text.substring(0, 80)}...`);
        return true;
      } else {
        console.error('[X] Unexpected response:', response.status);
        return false;
      }
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.warn('[X] Rate limited, will retry next cycle');
      } else {
        console.error('[X] Failed to post tweet:', error.message);
      }
      return false;
    }
  }

  /**
   * Main agent loop: fetch events -> compose tweets -> post to X
   */
  async run(pollIntervalSeconds: number = 120): Promise<void> {
    console.log(`[SagaPad] Starting X agent (${pollIntervalSeconds}s interval)`);

    while (true) {
      try {
        const events = await this.fetchRecentEvents();
        console.log(`[SagaPad] Found ${events.length} new events`);

        for (const event of events) {
          const tweet = this.composeTweet(event);
          const success = await this.postToX(tweet);

          if (success) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        console.log(`[SagaPad] Cycle complete. Waiting ${pollIntervalSeconds}s until next poll...`);
        await new Promise((resolve) => setTimeout(resolve, pollIntervalSeconds * 1000));
      } catch (error) {
        console.error('[SagaPad] Unexpected error in loop:', error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

async function main() {
  try {
    const agent = new SagaPadXAgent();
    const pollInterval = parseInt(process.env.POLL_INTERVAL_SECONDS || '120', 10);
    await agent.run(pollInterval);
  } catch (error) {
    console.error('[Fatal]', error);
    process.exit(1);
  }
}

main();
