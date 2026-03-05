import type { BlockchainGateway } from "../application/contracts";
import type { EscrowAccount } from "./abstraction";
import {
  decodeFunctionResult,
  encodeFunction,
  encodeValueWord,
  functionSelectorFromSignature,
  keccak256Hex,
} from "./abi-encoder";
import type { ContractAddresses } from "./contract-abis";
import { MockRpcProvider, type RpcProvider } from "../infrastructure/blockchain/mock-rpc-provider";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface SerializedTxPayload {
  from: string;
  to: string;
  data: string;
  nonce: number;
}

interface EscrowRecipients {
  worker: string;
  validators: string;
  treasury: string;
  issuer: string;
}

export interface EvmBlockchainGatewayConfig {
  rpcUrl: string;
  contractAddresses: ContractAddresses;
  signerPrivateKey?: string;
  rpcProvider?: RpcProvider;
}

export class EvmBlockchainGateway implements BlockchainGateway {
  private readonly rpcProvider: RpcProvider;
  private readonly signerAddress: string;
  private readonly releaseTxIdsByTask = new Map<string, string>();
  private txNonce = 0;

  constructor(private readonly config: EvmBlockchainGatewayConfig) {
    this.rpcProvider = config.rpcProvider ?? new FetchRpcProvider(config.rpcUrl);
    this.signerAddress = config.signerPrivateKey
      ? normalizeLikeAddress(config.signerPrivateKey)
      : normalizeLikeAddress("pact-network-signer");
  }

  async createEscrow(taskId: string, payerId: string, amountCents: number): Promise<EscrowAccount> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error(`createEscrow requires a positive integer amount. Received: ${amountCents}`);
    }

    const data = encodeFunction("createEscrow", ["uint256", "address", "uint256"], [
      this.taskIdToUint256(taskId),
      normalizeLikeAddress(payerId),
      BigInt(amountCents),
    ]);

    await this.sendRawTransaction(this.config.contractAddresses.escrow, data);

    return {
      taskId,
      payerId,
      amountCents,
      released: false,
    };
  }

  async releaseEscrow(taskId: string, payouts: Record<string, number>): Promise<string> {
    const recipients = this.resolvePayoutRecipients(payouts);
    const selector = functionSelectorFromSignature("releaseEscrow(uint256,(address,address,address,address))");
    const payload = [
      encodeValueWord("uint256", this.taskIdToUint256(taskId)),
      encodeValueWord("address", recipients.worker),
      encodeValueWord("address", recipients.validators),
      encodeValueWord("address", recipients.treasury),
      encodeValueWord("address", recipients.issuer),
    ].join("");
    const data = `0x${selector.slice(2)}${payload}`;

    const txId = await this.sendRawTransaction(this.config.contractAddresses.escrow, data);
    this.releaseTxIdsByTask.set(taskId, txId);
    return txId;
  }

  async getEscrow(taskId: string): Promise<EscrowAccount | undefined> {
    const data = encodeFunction("getEscrow", ["uint256"], [this.taskIdToUint256(taskId)]);
    const callResult = await this.rpcProvider.request("eth_call", [
      {
        to: normalizeLikeAddress(this.config.contractAddresses.escrow),
        data,
      },
      "latest",
    ]);

    if (typeof callResult !== "string") {
      throw new Error("eth_call returned a non-hex response");
    }

    const [payer, amount, released, refunded] = decodeFunctionResult(
      ["address", "uint256", "bool", "bool"],
      callResult,
    );

    if (payer === ZERO_ADDRESS && amount === 0n && released === false && refunded === false) {
      return undefined;
    }

    return {
      taskId,
      payerId: String(payer),
      amountCents: toSafeNumber(amount),
      released: Boolean(released),
      releaseTxId: this.releaseTxIdsByTask.get(taskId),
    };
  }

  private async sendRawTransaction(to: string, data: string): Promise<string> {
    const payload: SerializedTxPayload = {
      from: this.signerAddress,
      to: normalizeLikeAddress(to),
      data,
      nonce: this.txNonce,
    };
    this.txNonce += 1;

    const rawTx = hexEncodeUtf8(JSON.stringify(payload));
    const result = await this.rpcProvider.request("eth_sendRawTransaction", [rawTx]);

    if (typeof result === "string") {
      return result;
    }
    return `0x${keccak256Hex(rawTx)}`;
  }

  private resolvePayoutRecipients(payouts: Record<string, number>): EscrowRecipients {
    const recipients = Object.entries(payouts)
      .filter(([, amount]) => amount > 0)
      .map(([id]) => id);

    const treasuryId = findRecipientId(recipients, "treasury");
    const issuerId = findRecipientId(recipients, "issuer");
    const validatorsId = findRecipientId(recipients, "validator");
    const workerId =
      findRecipientId(recipients, "worker")
      ?? recipients.find(
        (id) => id !== treasuryId && id !== issuerId && id !== validatorsId,
      );

    return {
      worker: normalizeLikeAddress(workerId ?? "worker"),
      validators: normalizeLikeAddress(validatorsId ?? "validators"),
      treasury: normalizeLikeAddress(treasuryId ?? "treasury"),
      issuer: normalizeLikeAddress(issuerId ?? "issuer"),
    };
  }

  private taskIdToUint256(taskId: string): bigint {
    if (/^\d+$/.test(taskId)) {
      return BigInt(taskId);
    }
    return BigInt(`0x${keccak256Hex(taskId)}`);
  }
}

export { MockRpcProvider };

class FetchRpcProvider implements RpcProvider {
  private nextId = 1;

  constructor(private readonly rpcUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async request(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId,
        method,
        params,
      }),
    });
    this.nextId += 1;

    if (!response.ok) {
      throw new Error(`RPC request failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      result?: unknown;
      error?: {
        code?: number;
        message?: string;
      };
    };

    if (payload.error) {
      throw new Error(`RPC error ${payload.error.code ?? "unknown"}: ${payload.error.message ?? "unknown"}`);
    }

    return payload.result;
  }
}

function findRecipientId(recipientIds: string[], token: string): string | undefined {
  const lowered = token.toLowerCase();
  return recipientIds.find((id) => id.toLowerCase().includes(lowered));
}

function normalizeLikeAddress(value: string): string {
  const normalized = value.toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(normalized)) {
    return normalized;
  }
  const hash = keccak256Hex(normalized);
  return `0x${hash.slice(24)}`;
}

function hexEncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `0x${hex}`;
}

function toSafeNumber(value: unknown): number {
  if (typeof value !== "bigint") {
    throw new Error(`Expected bigint value, received ${typeof value}`);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Cannot represent uint256 as number safely: ${value}`);
  }
  return Number(value);
}
