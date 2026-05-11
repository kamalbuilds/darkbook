/**
 * Encrypt FHE Stage 2 integration (Node.js only, gRPC-based).
 *
 * Uses @encrypt.xyz/pre-alpha-solana-client v0.1.1
 * Communicates with the Encrypt threshold network via gRPC.
 *
 * Pre-alpha disclaimer: data is plaintext on-chain. Real FHE encryption
 * will be available at mainnet. This integration is forward-compatible.
 *
 * IMPORTANT: Do NOT import this from browser code. The Encrypt SDK uses
 * @grpc/grpc-js which is Node.js only. Import from @darkbook/sdk/encrypt-fhe
 * directly in Node.js services.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _encryptCreateClient: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _encryptChainSolana: any;
let _encryptModuleLoaded = false;

async function loadEncryptModule(): Promise<void> {
  if (_encryptModuleLoaded) return;
  try {
    const mod = await import("@encrypt.xyz/pre-alpha-solana-client/grpc");
    _encryptCreateClient = mod.createEncryptClient;
    _encryptChainSolana = mod.Chain?.Solana ?? 0;
    _encryptModuleLoaded = true;
  } catch {
    throw new Error(
      "@encrypt.xyz/pre-alpha-solana-client not installed. " +
      "Install with: bun add @encrypt.xyz/pre-alpha-solana-client",
    );
  }
}

const ENCRYPT_DEFAULT_GRPC_URL =
  typeof process !== "undefined" && process.env.ENCRYPT_GRPC_URL
    ? process.env.ENCRYPT_GRPC_URL
    : "http://localhost:50051";

export async function createEncryptFheInput(
  orderBytes: Uint8Array,
  authorizedAccount: Uint8Array,
  networkEncryptionPubKey: Uint8Array,
  grpcUrl?: string,
): Promise<{ ciphertextIdentifiers: Uint8Array[] }> {
  await loadEncryptModule();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = _encryptCreateClient(grpcUrl ?? ENCRYPT_DEFAULT_GRPC_URL);
  const result = await client.createInput({
    chain: _encryptChainSolana,
    inputs: [{ plaintext: Buffer.from(orderBytes), fheType: 0 }],
    authorized: Buffer.from(authorizedAccount),
    networkEncryptionPublicKey: Buffer.from(networkEncryptionPubKey),
  });
  return { ciphertextIdentifiers: result.ciphertextIdentifiers.map((c: Uint8Array) => new Uint8Array(c)) };
}

export async function readEncryptCiphertext(
  ciphertextIdentifier: Uint8Array,
  reencryptionKey: Uint8Array,
  epoch: bigint,
  signerPrivateKey: Uint8Array,
  grpcUrl?: string,
): Promise<{ value: Uint8Array; fheType: number; digest: Uint8Array }> {
  await loadEncryptModule();
  const { encodeReadCiphertextMessage } = await import("@encrypt.xyz/pre-alpha-solana-client/grpc");
  const message = encodeReadCiphertextMessage(
    _encryptChainSolana as number, ciphertextIdentifier, reencryptionKey, epoch,
  );
  const { ed25519 } = await import("@noble/curves/ed25519");
  const signature = ed25519.sign(message, signerPrivateKey);
  const signerPubKey = ed25519.getPublicKey(signerPrivateKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = _encryptCreateClient(grpcUrl ?? ENCRYPT_DEFAULT_GRPC_URL);
  const result = await client.readCiphertext({
    message, signature: Buffer.from(signature), signer: Buffer.from(signerPubKey),
  });
  return {
    value: new Uint8Array(result.value),
    fheType: result.fheType,
    digest: new Uint8Array(result.digest),
  };
}

export async function encryptOrderViaEncryptNetwork(
  orderBytes: Uint8Array,
  authorizedAccount: Uint8Array,
  networkEncryptionPubKey: Uint8Array,
  grpcUrl?: string,
): Promise<{
  encryptedBlob: Uint8Array;
  fheCiphertextIds: Uint8Array[];
  commitment: Uint8Array;
}> {
  const { encryptOrderBlob } = await import("./encrypt.js");
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const blob = await encryptOrderBlob(salt, 0n, 0, 0, 0n, authorizedAccount);

  let fheIds: Uint8Array[] = [];
  try {
    const fheResult = await createEncryptFheInput(orderBytes, authorizedAccount, networkEncryptionPubKey, grpcUrl);
    fheIds = fheResult.ciphertextIdentifiers;
  } catch { /* FHE network unavailable — fall back to Stage 1 */ }

  return { encryptedBlob: blob.ciphertext, fheCiphertextIds: fheIds, commitment: blob.commitment };
}
