import { NavBar } from "@/components/nav-bar";
import { PositionsTable } from "@/components/positions-table";

export default function PositionsPage() {
  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
      <NavBar />

      <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-mono font-semibold text-zinc-200 uppercase tracking-wider">
            Open Positions
          </h1>
        </div>

        <div className="flex-1 min-h-0 bg-zinc-900/40 border border-zinc-800 rounded-sm">
          <PositionsTable showEmpty />
        </div>
      </div>
    </div>
  );
}
