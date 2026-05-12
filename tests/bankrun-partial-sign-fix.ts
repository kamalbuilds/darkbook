/**
 * Preload before any test imports `BankrunProvider` from `anchor-bankrun`.
 *
 * anchor-bankrun@0.5.0 calls `tx.partialSign(signer)` once per signer in a loop.
 * Each `partialSign` recompiles the message and can reset signature slots, so
 * multi-signer Anchor RPCs fail with "unknown signer". Use one
 * `partialSign(...signers)` then `wallet.signTransaction` (fee payer), matching
 * the intended two-step flow without recompiling between extra signers.
 */
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, SendTransactionError } from "@solana/web3.js";
import type { PublicKey, Transaction } from "@solana/web3.js";
import type { BanksClient } from "solana-bankrun";
import bs58 from "bs58";

function patchBankrunProviderMultiSignerPartialSign(): void {
  const proto = BankrunProvider.prototype as unknown as {
    __darkbookBankrunSignerPatch?: boolean;
    send: (...args: unknown[]) => Promise<string>;
    sendAndConfirm: (...args: unknown[]) => Promise<string>;
    sendAll: (...args: unknown[]) => Promise<string[]>;
    simulate: (...args: unknown[]) => Promise<unknown>;
  };
  if (proto.__darkbookBankrunSignerPatch) return;
  proto.__darkbookBankrunSignerPatch = true;

  async function sendWithErr(tx: unknown, client: BanksClient): Promise<void> {
    const res = await client.tryProcessTransaction(tx as never);
    const errMsg = res.result;
    if (errMsg !== null) {
      const logs = res.meta?.logMessages;
      throw new SendTransactionError({
        action: "send",
        signature: "",
        transactionMessage: errMsg,
        logs: logs ?? [],
      });
    }
  }

  proto.send = async function (
    this: InstanceType<typeof BankrunProvider>,
    tx: { version?: number } & Record<string, unknown>,
    signers?: Array<{ publicKey: unknown; secretKey: Uint8Array }>,
    _opts?: unknown
  ): Promise<string> {
    if ("version" in tx) {
      signers?.forEach((signer) => (tx as never).sign([signer]));
    } else {
      const extra = (signers ?? []) as Keypair[];
      tx.feePayer =
        (tx as { feePayer?: PublicKey }).feePayer ??
        extra[0]?.publicKey ??
        this.wallet.publicKey;
      tx.recentBlockhash = (
        await this.context.banksClient.getLatestBlockhash()
      )[0];
      if (extra.length) (tx as Transaction).partialSign(...extra);
    }
    if (
      "version" in tx ||
      (tx as { feePayer?: PublicKey }).feePayer?.equals(this.wallet.publicKey)
    ) {
      await this.wallet.signTransaction(tx as never);
    }
    let signature: string;
    if ("version" in tx) {
      signature = bs58.encode((tx as { signatures: Uint8Array[] }).signatures[0]);
    } else {
      const legacy = tx as { signature: Uint8Array | null };
      if (!legacy.signature) throw new Error("Missing fee payer signature");
      signature = bs58.encode(legacy.signature);
    }
    await this.context.banksClient.sendTransaction(tx as never);
    return signature;
  };

  proto.sendAndConfirm = async function (
    this: InstanceType<typeof BankrunProvider>,
    tx: { version?: number } & Record<string, unknown>,
    signers?: Array<{ publicKey: unknown; secretKey: Uint8Array }>,
    _opts?: unknown
  ): Promise<string> {
    if ("version" in tx) {
      signers?.forEach((signer) => (tx as never).sign([signer]));
    } else {
      const extra = (signers ?? []) as Keypair[];
      tx.feePayer =
        (tx as { feePayer?: PublicKey }).feePayer ??
        extra[0]?.publicKey ??
        this.wallet.publicKey;
      tx.recentBlockhash = (
        await this.context.banksClient.getLatestBlockhash()
      )[0];
      if (extra.length) (tx as Transaction).partialSign(...extra);
    }
    if (
      "version" in tx ||
      (tx as { feePayer?: PublicKey }).feePayer?.equals(this.wallet.publicKey)
    ) {
      await this.wallet.signTransaction(tx as never);
    }
    let signature: string;
    if ("version" in tx) {
      signature = bs58.encode((tx as { signatures: Uint8Array[] }).signatures[0]);
    } else {
      const legacy = tx as { signature: Uint8Array | null };
      if (!legacy.signature) throw new Error("Missing fee payer signature");
      signature = bs58.encode(legacy.signature);
    }
    await sendWithErr(tx, this.context.banksClient);
    return signature;
  };

  proto.sendAll = async function (
    this: InstanceType<typeof BankrunProvider>,
    txWithSigners: Array<{ tx: { version?: number } & Record<string, unknown>; signers?: unknown[] }>,
    _opts?: unknown
  ): Promise<string[]> {
    const recentBlockhash = (
      await this.context.banksClient.getLatestBlockhash()
    )[0];
    const txs = txWithSigners.map((r) => {
      const tx = r.tx;
      if ("version" in tx) {
        if (r.signers) (tx as never).sign(r.signers);
        return tx;
      }
      const legacy = tx;
      const extra = (r.signers ?? []) as Keypair[];
      legacy.feePayer =
        legacy.feePayer ?? extra[0]?.publicKey ?? this.wallet.publicKey;
      legacy.recentBlockhash = recentBlockhash;
      if (extra.length) (legacy as Transaction).partialSign(...extra);
      return legacy;
    });
    const signedTxs: unknown[] = [];
    for (const one of txs) {
      if ("version" in one) {
        const [s] = await this.wallet.signAllTransactions([one as never]);
        signedTxs.push(s);
      } else {
        const lt = one as Transaction;
        if (lt.feePayer?.equals(this.wallet.publicKey)) {
          const [s] = await this.wallet.signAllTransactions([lt as never]);
          signedTxs.push(s);
        } else {
          signedTxs.push(lt);
        }
      }
    }
    const sigs: string[] = [];
    for (let k = 0; k < signedTxs.length; k += 1) {
      const tx = signedTxs[k] as {
        version?: number;
        signature: Uint8Array;
        signatures: Uint8Array[];
      };
      if ("version" in tx) {
        sigs.push(bs58.encode(tx.signatures[0]));
      } else {
        sigs.push(bs58.encode(tx.signature));
      }
      await sendWithErr(tx, this.context.banksClient);
    }
    return sigs;
  };

  proto.simulate = async function (
    this: InstanceType<typeof BankrunProvider>,
    tx: { version?: number } & Record<string, unknown>,
    signers?: Array<{ publicKey: unknown; secretKey: Uint8Array }>,
    commitment?: unknown,
    includeAccounts?: unknown
  ): Promise<unknown> {
    if (includeAccounts !== undefined) {
      throw new Error("includeAccounts cannot be used with BankrunProvider");
    }
    if ("version" in tx) {
      signers?.forEach((signer) => (tx as never).sign([signer]));
    } else {
      const extra = (signers ?? []) as Keypair[];
      tx.feePayer =
        (tx as { feePayer?: PublicKey }).feePayer ??
        extra[0]?.publicKey ??
        this.wallet.publicKey;
      tx.recentBlockhash = (
        await this.context.banksClient.getLatestBlockhash()
      )[0];
      if (extra.length) (tx as Transaction).partialSign(...extra);
    }
    const rawResult = await this.context.banksClient.simulateTransaction(
      tx as never,
      commitment as never
    );
    const returnDataRaw = rawResult.meta.returnData;
    const b64 = Buffer.from(returnDataRaw.data).toString("base64");
    return {
      logs: rawResult.meta.logMessages,
      unitsConsumed: Number(rawResult.meta.computeUnitsConsumed),
      returnData: {
        programId: returnDataRaw.programId.toString(),
        data: [b64, "base64"],
      },
    };
  };
}

patchBankrunProviderMultiSignerPartialSign();
