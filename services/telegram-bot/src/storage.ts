/**
 * SQLite-backed subscriber storage using Bun's native bun:sqlite module.
 *
 * Schema:
 *   subscribers(wallet TEXT PRIMARY KEY, chat_id INTEGER NOT NULL, alerts TEXT NOT NULL)
 *   alerts = JSON-serialised string[] of event type names the user wants to receive.
 */

import { Database } from "bun:sqlite";

export type EventType =
  | "OrderPlaced"
  | "FillRecorded"
  | "PositionOpened"
  | "PositionLiquidated"
  | "FundingPaid";

export const ALL_EVENT_TYPES: EventType[] = [
  "OrderPlaced",
  "FillRecorded",
  "PositionOpened",
  "PositionLiquidated",
  "FundingPaid",
];

export interface Subscriber {
  wallet: string;
  chatId: number;
  alerts: EventType[];
}

export class SubscriberStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS subscribers (
        wallet  TEXT    PRIMARY KEY,
        chat_id INTEGER NOT NULL,
        alerts  TEXT    NOT NULL DEFAULT '[]'
      )
    `);
  }

  upsert(wallet: string, chatId: number, alerts: EventType[]): void {
    this.db
      .prepare(
        `INSERT INTO subscribers (wallet, chat_id, alerts)
         VALUES (?, ?, ?)
         ON CONFLICT(wallet) DO UPDATE SET chat_id = excluded.chat_id, alerts = excluded.alerts`,
      )
      .run(wallet, chatId, JSON.stringify(alerts));
  }

  remove(chatId: number): void {
    this.db.prepare("DELETE FROM subscribers WHERE chat_id = ?").run(chatId);
  }

  findByChatId(chatId: number): Subscriber | null {
    const row = this.db
      .prepare("SELECT wallet, chat_id, alerts FROM subscribers WHERE chat_id = ?")
      .get(chatId) as { wallet: string; chat_id: number; alerts: string } | null;
    return row ? this.parseRow(row) : null;
  }

  findByWallet(wallet: string): Subscriber | null {
    const row = this.db
      .prepare("SELECT wallet, chat_id, alerts FROM subscribers WHERE wallet = ?")
      .get(wallet) as { wallet: string; chat_id: number; alerts: string } | null;
    return row ? this.parseRow(row) : null;
  }

  /** Returns all subscribers interested in the given event type. */
  findByEventType(eventType: EventType): Subscriber[] {
    // SQLite JSON functions are available in modern Bun sqlite builds.
    // We use a LIKE check as a fast filter then validate in JS.
    const rows = this.db
      .prepare(
        `SELECT wallet, chat_id, alerts FROM subscribers WHERE alerts LIKE ?`,
      )
      .all(`%${eventType}%`) as { wallet: string; chat_id: number; alerts: string }[];
    return rows
      .map((r) => this.parseRow(r))
      .filter((s) => s.alerts.includes(eventType));
  }

  /** Returns all subscribers for a given wallet across all event types. */
  findAllForChat(chatId: number): Subscriber[] {
    const rows = this.db
      .prepare("SELECT wallet, chat_id, alerts FROM subscribers WHERE chat_id = ?")
      .all(chatId) as { wallet: string; chat_id: number; alerts: string }[];
    return rows.map((r) => this.parseRow(r));
  }

  close(): void {
    this.db.close();
  }

  private parseRow(row: { wallet: string; chat_id: number; alerts: string }): Subscriber {
    let alerts: EventType[] = [];
    try {
      alerts = JSON.parse(row.alerts) as EventType[];
    } catch {
      alerts = [];
    }
    return { wallet: row.wallet, chatId: row.chat_id, alerts };
  }
}
