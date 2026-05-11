import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-wallets",
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-phantom",
    "@solana/wallet-adapter-solflare",
  ],

  serverExternalPackages: [
    "@encrypt.xyz/pre-alpha-solana-client",
    "@grpc/grpc-js",
    "@protobuf-ts/grpcweb-transport",
  ],
};

export default nextConfig;
