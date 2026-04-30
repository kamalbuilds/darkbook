import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 uses Turbopack by default.
  // Empty turbopack config satisfies the requirement to have one when webpack is also configured.
  turbopack: {},

  // Transpile wallet adapter packages to avoid ESM/CJS issues under Turbopack
  transpilePackages: [
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-wallets",
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-phantom",
    "@solana/wallet-adapter-solflare",
  ],
};

export default nextConfig;
