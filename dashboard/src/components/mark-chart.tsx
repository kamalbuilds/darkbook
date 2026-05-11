"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
} from "lightweight-charts";
import { useDarkbookStore } from "@/store/darkbook-store";
import { subscribeMarkPrice } from "@/lib/darkbook-client";
import { fetchOhlcvBaseQuote, type Candle } from "@/lib/birdeye";
import { spotBaseMintForMarket, USDC_MINT_MAINNET } from "@/lib/market-assets";

export function MarkChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const { markPrice, setMarkPrice, selectedMarket } = useDarkbookStore();

  const [currentCandle, setCurrentCandle] = useState<CandlestickData<Time> | null>(null);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#09090b" },
        textColor: "#71717a",
      },
      grid: {
        vertLines: { color: "#18181b" },
        horzLines: { color: "#18181b" },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#3f3f46", style: 1 },
        horzLine: { color: "#3f3f46", style: 1 },
      },
      rightPriceScale: {
        borderColor: "#27272a",
        textColor: "#71717a",
      },
      timeScale: {
        borderColor: "#27272a",
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#34d399",
      downColor: "#f87171",
      borderUpColor: "#34d399",
      borderDownColor: "#f87171",
      wickUpColor: "#34d399",
      wickDownColor: "#f87171",
    });

    const markLine = chart.addLineSeries({
      color: "#34d399",
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    markLineRef.current = markLine;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markLineRef.current = null;
    };
  }, []);

  // Birdeye aggregate OHLCV (base vs USDC) for the selected perp reference asset
  useEffect(() => {
    const loadBirdeyeCandles = async () => {
      try {
        const base = spotBaseMintForMarket(selectedMarket);
        const candles = await fetchOhlcvBaseQuote(base, USDC_MINT_MAINNET, "1m", 100);

        if (candles.length > 0 && candleSeriesRef.current) {
          const chartCandles = candles.map((c: Candle) => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }));
          candleSeriesRef.current.setData(chartCandles);
        }
      } catch (error) {
        console.warn("[mark-chart] Birdeye load failed, relying on Pyth stream", { error });
      }
    };

    if (candleSeriesRef.current) {
      loadBirdeyeCandles();
    }
  }, [selectedMarket]);

  // Hermes poll (+ optional Pyth Lazer WS) for mark vs USD for the selected market
  useEffect(() => {
    const unsubscribe = subscribeMarkPrice((price) => {
      setMarkPrice(price);
    }, selectedMarket);
    return unsubscribe;
  }, [selectedMarket, setMarkPrice]);

  // Update mark line when price changes
  useEffect(() => {
    if (!markLineRef.current || markPrice == null) return;

    const nowSec = Math.floor(Date.now() / 1000) as Time;

    // Update current candle with the live price
    setCurrentCandle((prev) => {
      const candleTime = (Math.floor(Date.now() / 60000) * 60) as Time;
      if (!prev || prev.time !== candleTime) {
        const newCandle: CandlestickData<Time> = {
          time: candleTime,
          open: (prev?.close as number) ?? markPrice,
          high: markPrice,
          low: markPrice,
          close: markPrice,
        };
        return newCandle;
      }
      return {
        ...prev,
        high: Math.max(prev.high as number, markPrice),
        low: Math.min(prev.low as number, markPrice),
        close: markPrice,
      };
    });

    markLineRef.current.update({ time: nowSec, value: markPrice });
  }, [markPrice]);

  // Push current candle to chart
  useEffect(() => {
    if (!candleSeriesRef.current || !currentCandle) return;
    candleSeriesRef.current.update(currentCandle);
  }, [currentCandle]);

  return (
    <div className="w-full h-full relative">
      {!markPrice && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-zinc-600 text-sm font-mono">Loading from chain…</span>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
