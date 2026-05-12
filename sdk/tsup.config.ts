import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "encrypt-fhe": "src/encrypt-fhe.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    "@coral-xyz/anchor",
    "@solana/web3.js",
    "@solana/spl-token",
    "@magicblock-labs/ephemeral-rollups-sdk",
    "@umbra-privacy/sdk",
    "@encrypt.xyz/pre-alpha-solana-client",
    "@grpc/grpc-js",
    "bn.js",
    "ws",
  ],
});
