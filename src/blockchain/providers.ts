import { keccak256Hex } from "./abi-encoder";
import {
  OnchainFinalityRuntime,
  type OnchainFinalityProvider,
  type OnchainFinalitySummary,
  type OnchainTransactionPage,
  type OnchainTransactionQuery,
  type OnchainTransactionRecord,
  type RecordCanonicalBlockInput,
  type RecordOnchainTransactionInclusionInput,
  type TrackOnchainTransactionInput,
} from "../domain/onchain-finality";
import type { RpcProvider } from "../infrastructure/blockchain/mock-rpc-provider";

export type OnchainRpcProvider = RpcProvider;

export interface UnsignedSerializedTransaction {
  to: string;
  data: string;
  nonce: number;
}

export interface SerializedTransactionPayload extends UnsignedSerializedTransaction {
  from: string;
}

export interface TransactionSigner {
  getAddress(): string;
  signTransaction(payload: UnsignedSerializedTransaction): Promise<string>;
}

export class DeterministicTransactionSigner implements TransactionSigner {
  private readonly address: string;

  constructor(seed = "pact-network-signer") {
    this.address = normalizeLikeAddress(seed);
  }

  getAddress(): string {
    return this.address;
  }

  async signTransaction(payload: UnsignedSerializedTransaction): Promise<string> {
    return hexEncodeUtf8(
      JSON.stringify({
        from: this.address,
        to: normalizeLikeAddress(payload.to),
        data: payload.data,
        nonce: payload.nonce,
      } satisfies SerializedTransactionPayload),
    );
  }
}

export class RuntimeOnchainFinalityProvider implements OnchainFinalityProvider {
  constructor(private readonly runtime: OnchainFinalityRuntime = new OnchainFinalityRuntime()) {}

  trackTransaction(input: TrackOnchainTransactionInput): OnchainTransactionRecord {
    return this.runtime.trackTransaction(input);
  }

  recordTransactionInclusion(
    input: RecordOnchainTransactionInclusionInput,
  ): OnchainTransactionRecord {
    return this.runtime.recordTransactionInclusion(input);
  }

  recordCanonicalBlock(input: RecordCanonicalBlockInput): void {
    this.runtime.recordCanonicalBlock(input);
  }

  advanceHead(blockNumber: number, blockHash?: string): OnchainFinalitySummary {
    return this.runtime.advanceHead(blockNumber, blockHash);
  }

  getTransaction(txId: string): OnchainTransactionRecord | undefined {
    return this.runtime.getTransaction(txId);
  }

  listTransactions(query?: OnchainTransactionQuery): OnchainTransactionPage {
    return this.runtime.listTransactions(query);
  }

  getSummary(): OnchainFinalitySummary {
    return this.runtime.getSummary();
  }

  getRuntime(): OnchainFinalityRuntime {
    return this.runtime;
  }
}

export function resolveTransactionSigner(
  signer: TransactionSigner | undefined,
  signerPrivateKey: string | undefined,
  defaultSeed: string,
): TransactionSigner {
  if (signer) {
    return signer;
  }

  return new DeterministicTransactionSigner(signerPrivateKey ?? defaultSeed);
}

export async function submitSignedTransaction(
  rpcProvider: RpcProvider,
  signer: TransactionSigner,
  payload: UnsignedSerializedTransaction,
): Promise<string> {
  const rawTx = await signer.signTransaction({
    ...payload,
    to: normalizeLikeAddress(payload.to),
  });
  const result = await rpcProvider.request("eth_sendRawTransaction", [rawTx]);

  if (typeof result === "string") {
    return result;
  }

  return `0x${keccak256Hex(rawTx)}`;
}

export function normalizeLikeAddress(value: string): string {
  const normalized = value.toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(normalized)) {
    return normalized;
  }
  const hash = keccak256Hex(normalized);
  return `0x${hash.slice(24)}`;
}

export function hexEncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `0x${hex}`;
}
