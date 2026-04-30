import { NavBar } from "@/components/nav-bar";
import { MarketHeader } from "@/components/market-header";
import { OrderEntry } from "@/components/order-entry";
import { OrderBook } from "@/components/order-book";
import { MarkChart } from "@/components/mark-chart";
import { RecentFills } from "@/components/recent-fills";
import { PositionsTable } from "@/components/positions-table";

export default function TradePage() {
  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
      <NavBar />

      {/* Market header bar */}
      <div className="h-12 border-b border-zinc-800 shrink-0">
        <MarketHeader />
      </div>

      {/* Main trading area */}
      <div className="flex-1 flex min-h-0">
        {/* Left: order entry */}
        <div className="w-56 shrink-0 border-r border-zinc-800 overflow-y-auto">
          <OrderEntry />
        </div>

        {/* Center: chart + fills */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chart */}
          <div className="flex-1 min-h-0">
            <MarkChart />
          </div>

          {/* Recent fills */}
          <div className="h-36 border-t border-zinc-800 shrink-0">
            <RecentFills />
          </div>
        </div>

        {/* Right: order book */}
        <div className="w-48 shrink-0 border-l border-zinc-800">
          <OrderBook />
        </div>
      </div>

      {/* Bottom: positions */}
      <div className="h-40 border-t border-zinc-800 shrink-0">
        <PositionsTable />
      </div>
    </div>
  );
}
