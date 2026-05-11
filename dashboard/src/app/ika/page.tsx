import { NavBar } from "@/components/nav-bar";
import { IkaDWalletPanel } from "@/components/ika-dwallet";

export default function IkaPage() {
  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
      <NavBar />
      <div className="flex-1 overflow-y-auto">
        <IkaDWalletPanel />
      </div>
    </div>
  );
}
