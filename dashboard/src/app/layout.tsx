import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SolanaWalletProvider } from "@/components/wallet-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DarkBook | Private. Fast. Solana.",
  description:
    "Institutional-grade perpetuals on Solana. Dark order books, sub-50ms matching via MagicBlock ephemeral rollups.",
  keywords: ["darkbook", "perps", "solana", "defi", "trading", "private"],
  openGraph: {
    title: "DarkBook",
    description: "private. fast. solana.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full dark antialiased`}
    >
      <body className="min-h-full bg-zinc-950 text-zinc-100">
        <SolanaWalletProvider>
          <TooltipProvider>
            {children}
            <Toaster position="bottom-right" theme="dark" richColors />
          </TooltipProvider>
        </SolanaWalletProvider>
      </body>
    </html>
  );
}
