import { create } from "zustand";
import type { Position, Fill, OrderBookLevel, MarketInfo } from "@/lib/darkbook-types";

export interface DarkbookState {
  /** Currently selected market (asset id, e.g. "SOL") */
  selectedMarket: string;
  /** Live mark price from Pyth Lazer (null = not yet received) */
  markPrice: number | null;
  /** 24h price change percent */
  change24h: number | null;
  /** Open positions for connected wallet */
  positions: Position[];
  /** Recent fills (last 20) */
  fills: Fill[];
  /** Aggregated order book levels */
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  /** Market metadata */
  marketInfo: MarketInfo | null;
  /** Whether chain data is loading */
  isLoading: boolean;
  /** Last error from chain operations */
  chainError: string | null;
  /** SNS name cache: pubkey -> .sol name (with expiry) */
  snsCache: Map<string, { name: string | null; expiresAt: number }>;

  // Actions
  setSelectedMarket: (market: string) => void;
  setMarkPrice: (price: number) => void;
  setChange24h: (pct: number) => void;
  setPositions: (positions: Position[]) => void;
  addFill: (fill: Fill) => void;
  setFills: (fills: Fill[]) => void;
  setOrderBook: (bids: OrderBookLevel[], asks: OrderBookLevel[]) => void;
  setMarketInfo: (info: MarketInfo) => void;
  setLoading: (loading: boolean) => void;
  setChainError: (error: string | null) => void;
  setSnsCache: (pubkey: string, name: string | null, expiresAt: number) => void;
}

export const useDarkbookStore = create<DarkbookState>((set) => ({
  selectedMarket: "SOLUSD",
  markPrice: null,
  change24h: null,
  positions: [],
  fills: [],
  bids: [],
  asks: [],
  marketInfo: null,
  isLoading: true,
  chainError: null,
  snsCache: new Map(),

  setSelectedMarket: (market) => set({ selectedMarket: market, markPrice: null, isLoading: true }),
  setMarkPrice: (price) => set({ markPrice: price }),
  setChange24h: (pct) => set({ change24h: pct }),
  setPositions: (positions) => set({ positions }),
  addFill: (fill) =>
    set((state) => ({
      fills: [fill, ...state.fills].slice(0, 20),
    })),
  setFills: (fills) => set({ fills }),
  setOrderBook: (bids, asks) => set({ bids, asks }),
  setMarketInfo: (info) => set({ marketInfo: info }),
  setLoading: (isLoading) => set({ isLoading }),
  setChainError: (chainError) => set({ chainError }),
  setSnsCache: (pubkey, name, expiresAt) =>
    set((state) => {
      const newCache = new Map(state.snsCache);
      newCache.set(pubkey, { name, expiresAt });
      return { snsCache: newCache };
    }),
}));
