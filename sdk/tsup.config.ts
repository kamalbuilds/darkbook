import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
    "bn.js",
    "ws",
  ],
});
