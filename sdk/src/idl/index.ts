/**
 * Stub IDL for the DarkBook Anchor program.
 * Once `anchor build` produces target/idl/darkbook.json, run:
 *   cp ../target/idl/darkbook.json ./src/idl/darkbook.json
 * and regenerate types with `anchor client-gen`.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const DARKBOOK_IDL = require("./darkbook.json") as Record<string, unknown>;
