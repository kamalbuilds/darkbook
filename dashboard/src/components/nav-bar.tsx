"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "@/components/wallet-button";
import { FaucetButton } from "@/components/faucet-button";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/positions", label: "Positions" },
  { href: "/history", label: "History" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="h-11 flex items-center justify-between px-4 border-b border-zinc-800 bg-zinc-950 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-6">
        <Link href="/trade" className="flex items-center gap-2 group">
          <span className="font-mono font-bold text-sm text-zinc-100 tracking-tight">
            DARK<span className="text-emerald-400">BOOK</span>
          </span>
          <span className="text-[9px] text-zinc-600 font-mono tracking-widest hidden sm:block">
            private. fast. solana.
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "px-3 py-1 text-xs font-mono rounded-sm transition-colors",
                pathname === href || pathname.startsWith(href + "/")
                  ? "text-zinc-100 bg-zinc-800"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <FaucetButton />
        <WalletButton />
      </div>
    </header>
  );
}
