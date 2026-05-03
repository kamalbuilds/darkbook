import { spawnSync } from 'child_process';
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { DarkbookClient } from '@darkbook/sdk';
import { Side, SizeBand } from '@darkbook/sdk';

interface PortfolioSignal {
  action: 'LONG' | 'SHORT' | 'CLOSE' | 'NONE';
  asset: string;
  confidence: number;
  reason: string;
}

interface RiskLimits {
  maxPositionSize: number;
  maxDrawdown: number;
  maxLeverage: number;
}

interface OrderState {
  orderId: string;
  side: number;
  market: string;
  payload: { salt: number[]; sizeLots: string; leverageBps: number };
  timestamp: number;
}

/**
 * Autonomous trading agent powered by Zerion CLI
 * Polls portfolio data, analyzes market signals, executes DarkBook trades
 */
class ZerionAutonomousAgent {
  private keypair: Keypair;
  private connection: Connection;
  private darkbookClient: DarkbookClient;
  private riskLimits: RiskLimits;
  private apiKey: string;
  private programId: PublicKey;
  private marketId: PublicKey;
  private stateFile: string;
  private orderState: Map<string, OrderState>;

  constructor() {
    // Load configuration from environment
    this.apiKey = process.env.ZERION_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('ZERION_API_KEY environment variable not set');
    }

    const keypairPath = process.env.ZERION_AGENT_KEYPAIR_PATH || '';
    if (!keypairPath) {
      throw new Error('ZERION_AGENT_KEYPAIR_PATH environment variable not set');
    }

    // Load funded keypair
    const secretKey = JSON.parse(readFileSync(keypairPath, 'utf-8'));
    this.keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));

    // Initialize RPC connection
    const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    // Store DarkBook program ID and market ID
    const programIdStr = process.env.DARKBOOK_PROGRAM_ID;
    if (!programIdStr) {
      throw new Error('DARKBOOK_PROGRAM_ID environment variable not set');
    }
    this.programId = new PublicKey(programIdStr);

    const marketIdStr = process.env.DARKBOOK_MARKET_ID;
    if (!marketIdStr) {
      throw new Error('DARKBOOK_MARKET_ID environment variable not set');
    }
    this.marketId = new PublicKey(marketIdStr);

    // Initialize DarkBook client
    this.darkbookClient = new DarkbookClient({
      connection: this.connection,
      erConnection: this.connection,
      wallet: new Wallet(this.keypair),
      programId: this.programId,
    });

    // Load risk parameters
    this.riskLimits = {
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '10000'), // USDC
      maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN || '0.2'), // 20% max drawdown
      maxLeverage: parseFloat(process.env.MAX_LEVERAGE || '5'),
    };

    // Initialize order state persistence
    this.stateFile = process.env.ORDER_STATE_FILE || '.zerion-agent-state.json';
    this.orderState = new Map();
    this.loadOrderState();

    console.log(`[Agent] Initialized with keypair: ${this.keypair.publicKey.toString()}`);
    console.log(`[Agent] DarkBook program: ${this.programId.toString()}`);
    console.log(`[Agent] Market: ${this.marketId.toString()}`);
    console.log(`[Agent] Risk limits:`, this.riskLimits);
  }

  /**
   * Load persisted order state from file
   */
  private loadOrderState(): void {
    if (existsSync(this.stateFile)) {
      try {
        const data = JSON.parse(readFileSync(this.stateFile, 'utf-8'));
        for (const order of data.orders || []) {
          this.orderState.set(order.orderId, order);
        }
        console.log(`[State] Loaded ${this.orderState.size} orders from persistence`);
      } catch (e) {
        console.warn(`[State] Failed to load order state:`, e);
      }
    }
  }

  /**
   * Persist order state to file
   */
  private saveOrderState(): void {
    const orders = Array.from(this.orderState.values());
    writeFileSync(this.stateFile, JSON.stringify({ orders }, null, 2));
  }

  /**
   * Execute Zerion CLI command and parse JSON output
   */
  private execZerionCli(args: string[]): unknown {
    const result = spawnSync('zerion', args, {
      env: { ...process.env, ZERION_API_KEY: this.apiKey },
      encoding: 'utf-8',
    });

    if (result.error) {
      throw new Error(`Zerion CLI error: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(`Zerion CLI failed with code ${result.status}: ${result.stderr}`);
    }

    try {
      return JSON.parse(result.stdout);
    } catch (e) {
      throw new Error(`Failed to parse Zerion CLI output: ${result.stdout}`);
    }
  }

  /**
   * Fetch portfolio data from Zerion
   */
  private getPortfolio(): {
    totalValue: number;
    positions: Array<{ symbol: string; balance: number; price: number }>;
  } {
    console.log('[Portfolio] Fetching via Zerion CLI...');

    try {
      const result = this.execZerionCli([
        'analyze',
        this.keypair.publicKey.toString(),
        '--output',
        'json',
      ]) as { total_value?: number; positions?: Array<unknown> };

      return {
        totalValue: result.total_value || 0,
        positions: (result.positions || []).map((p: any) => ({
          symbol: p.symbol || 'UNKNOWN',
          balance: p.balance || 0,
          price: p.price || 0,
        })),
      };
    } catch (error) {
      console.error('[Portfolio] Failed to fetch:', error);
      return { totalValue: 0, positions: [] };
    }
  }

  /**
   * Analyze market conditions and generate trading signals
   */
  private analyzeSignals(portfolio: {
    totalValue: number;
    positions: Array<{ symbol: string; balance: number; price: number }>;
  }): PortfolioSignal[] {
    const signals: PortfolioSignal[] = [];

    for (const pos of portfolio.positions) {
      if (pos.symbol === 'SOL') {
        if (pos.price > 100) {
          signals.push({
            action: 'LONG',
            asset: 'SOL-USDC',
            confidence: 0.7,
            reason: 'Price above support level, bullish on SOL',
          });
        } else {
          signals.push({
            action: 'CLOSE',
            asset: 'SOL-USDC',
            confidence: 0.6,
            reason: 'Price below threshold, reducing exposure',
          });
        }
      }
    }

    return signals;
  }

  /**
   * Retry wrapper for RPC calls with exponential backoff
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxAttempts - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, lastError.message);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError || new Error('Retry exhausted');
  }

  /**
   * Execute a trading signal on DarkBook
   */
  private async executeTrade(signal: PortfolioSignal, totalValue: number): Promise<void> {
    // Validate position size against risk limits
    const positionSize = Math.min(signal.confidence * this.riskLimits.maxPositionSize, totalValue * 0.1);

    if (positionSize > this.riskLimits.maxPositionSize) {
      console.warn(
        `[Risk] Position size ${positionSize} exceeds limit ${this.riskLimits.maxPositionSize}, skipping`
      );
      return;
    }

    console.log(`[Trade] Executing ${signal.action} for ${signal.asset} at size ${positionSize}`);

    try {
      switch (signal.action) {
        case 'LONG': {
          const result = await this.withRetry(() =>
            this.darkbookClient.placeOrder(
              this.marketId,
              Side.Long,
              BigInt(10000),
              SizeBand.Medium,
              200,
              BigInt(Math.floor(positionSize / 100))
            )
          );
          this.orderState.set(result.orderId.toString(), {
            orderId: result.orderId.toString(),
            side: Side.Long,
            market: this.marketId.toString(),
            payload: {
              salt: Array.from(result.payload.salt),
              sizeLots: result.payload.sizeLots.toString(),
              leverageBps: result.payload.leverageBps,
            },
            timestamp: Date.now(),
          });
          this.saveOrderState();
          console.log(
            `[Trade] LONG order placed: ${positionSize} USDC @ 2x leverage, sig: ${result.sig}`
          );
          break;
        }

        case 'SHORT': {
          const result = await this.withRetry(() =>
            this.darkbookClient.placeOrder(
              this.marketId,
              Side.Short,
              BigInt(10000),
              SizeBand.Medium,
              200,
              BigInt(Math.floor(positionSize / 100))
            )
          );
          this.orderState.set(result.orderId.toString(), {
            orderId: result.orderId.toString(),
            side: Side.Short,
            market: this.marketId.toString(),
            payload: {
              salt: Array.from(result.payload.salt),
              sizeLots: result.payload.sizeLots.toString(),
              leverageBps: result.payload.leverageBps,
            },
            timestamp: Date.now(),
          });
          this.saveOrderState();
          console.log(
            `[Trade] SHORT order placed: ${positionSize} USDC @ 2x leverage, sig: ${result.sig}`
          );
          break;
        }

        case 'CLOSE': {
          for (const [orderId, order] of this.orderState) {
            try {
              await this.withRetry(() =>
                this.darkbookClient.cancelOrder(
                  new PublicKey(order.market),
                  BigInt(orderId),
                  {
                    salt: new Uint8Array(order.payload.salt),
                    sizeLots: BigInt(order.payload.sizeLots),
                    leverageBps: order.payload.leverageBps,
                  }
                )
              );
              this.orderState.delete(orderId);
              this.saveOrderState();
              console.log(`[Trade] CLOSE: cancelled order ${orderId}`);
            } catch (cancelError) {
              console.error(`[Trade] Failed to cancel order ${orderId}:`, cancelError);
            }
          }
          break;
        }

        default:
          console.log(`[Trade] Skipping NONE signal`);
      }
    } catch (error) {
      console.error(`[Trade] Failed to execute ${signal.action}:`, error);
    }
  }

  /**
   * Main agent loop: poll -> analyze -> execute
   */
  run(intervalSeconds: number = 60): void {
    console.log(`[Agent] Starting autonomous loop (${intervalSeconds}s interval)`);

    const loop = (): void => {
      try {
        const portfolio = this.getPortfolio();
        console.log(`[Portfolio] Total value: ${portfolio.totalValue} USDC`);

        const signals = this.analyzeSignals(portfolio);
        console.log(`[Signals] Generated ${signals.length} signals`);

        for (const signal of signals) {
          if (signal.action !== 'NONE') {
            this.executeTrade(signal, portfolio.totalValue);
          }
        }

        console.log(`[Agent] Cycle complete. Waiting ${intervalSeconds}s until next poll...`);
        setTimeout(loop, intervalSeconds * 1000);
      } catch (error) {
        console.error('[Agent] Unexpected error in loop:', error);
        setTimeout(loop, 5000);
      }
    };

    loop();
  }
}

function main() {
  try {
    const agent = new ZerionAutonomousAgent();
    const pollInterval = parseInt(process.env.POLL_INTERVAL_SECONDS || '60', 10);
    agent.run(pollInterval);
  } catch (error) {
    console.error('[Fatal]', error);
    process.exit(1);
  }
}

main();
