import type {
  BlockchainGateway,
  IdentitySBTContractClient,
  OnchainIdentityRecord,
} from "../application/contracts";
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
import { FetchRpcProvider } from "../infrastructure/blockchain/fetch-rpc-provider";
import {
  normalizeLikeAddress,
  resolveTransactionSigner,
  submitSignedTransaction,
  type TransactionSigner,
} from "./providers";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
  signer?: TransactionSigner;
  rpcProvider?: RpcProvider;
}

export interface EvmIdentitySBTContractClientConfig {
  rpcUrl: string;
  contractAddress: string;
  signerPrivateKey?: string;
  signer?: TransactionSigner;
  rpcProvider?: RpcProvider;
}

export class EvmBlockchainGateway implements BlockchainGateway {
  private readonly rpcProvider: RpcProvider;
  private readonly signer: TransactionSigner;
  private readonly contractAddresses: ContractAddresses;
  private readonly releaseTxIdsByTask = new Map<string, string>();
  private txNonce = 0;

  constructor(private readonly config: EvmBlockchainGatewayConfig) {
    this.rpcProvider = config.rpcProvider ?? new FetchRpcProvider({ rpcUrl: config.rpcUrl });
    this.signer = resolveTransactionSigner(config.signer, config.signerPrivateKey, "pact-network-signer");
    this.contractAddresses = validateContractAddresses(config.contractAddresses);
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

    await this.sendRawTransaction(this.contractAddresses.escrow, data);

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

    const txId = await this.sendRawTransaction(this.contractAddresses.escrow, data);
    this.releaseTxIdsByTask.set(taskId, txId);
    return txId;
  }

  async getEscrow(taskId: string): Promise<EscrowAccount | undefined> {
    const data = encodeFunction("getEscrow", ["uint256"], [this.taskIdToUint256(taskId)]);
    const callResult = await this.rpcProvider.request("eth_call", [
      {
        to: this.contractAddresses.escrow,
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
    const nonce = await this.resolveNextNonce();
    return submitSignedTransaction(this.rpcProvider, this.signer, {
      to,
      data,
      nonce,
    });
  }

  private async resolveNextNonce(): Promise<number> {
    const providerNonce = await tryGetPendingNonce(this.rpcProvider, this.signer.getAddress());
    const nonce = providerNonce === undefined ? this.txNonce : Math.max(this.txNonce, providerNonce);
    this.txNonce = nonce + 1;
    return nonce;
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
    return identifierToUint256(taskId);
  }
}

export class EvmIdentitySBTContractClient implements IdentitySBTContractClient {
  private readonly rpcProvider: RpcProvider;
  private readonly signer: TransactionSigner;
  private readonly contractAddress: string;
  private txNonce = 0;

  constructor(private readonly config: EvmIdentitySBTContractClientConfig) {
    this.rpcProvider = config.rpcProvider ?? new FetchRpcProvider({ rpcUrl: config.rpcUrl });
    this.signer = resolveTransactionSigner(
      config.signer,
      config.signerPrivateKey,
      "pact-network-identity-signer",
    );
    this.contractAddress = normalizeContractAddress(config.contractAddress, "identitySBT");
  }

  async mint(
    to: string,
    participantId: string,
    role: string,
    level: number,
  ): Promise<bigint> {
    const encoded = encodeFunction(
      "mint",
      ["address", "uint256", "string", "uint256"],
      [
        normalizeLikeAddress(to),
        identifierToUint256(participantId),
        role,
        BigInt(assertUint8(level, "mint level")),
      ],
    );
    const selector = functionSelectorFromSignature("mint(address,uint256,string,uint8)");
    const data = `0x${selector.slice(2)}${encoded.slice(10)}`;
    await this.sendRawTransaction(this.contractAddress, data);
    return identifierToUint256(participantId);
  }

  async upgradeLevel(tokenId: bigint, newLevel: number): Promise<string> {
    const encoded = encodeFunction("upgradeLevel", ["uint256", "uint256"], [
      tokenId,
      BigInt(assertUint8(newLevel, "upgrade level")),
    ]);
    const selector = functionSelectorFromSignature("upgradeLevel(uint256,uint8)");
    const data = `0x${selector.slice(2)}${encoded.slice(10)}`;
    return this.sendRawTransaction(this.contractAddress, data);
  }

  async getIdentity(tokenId: bigint): Promise<OnchainIdentityRecord | undefined> {
    const data = encodeFunction("getIdentity", ["uint256"], [tokenId]);
    const callResult = await this.rpcProvider.request("eth_call", [
      {
        to: this.contractAddress,
        data,
      },
      "latest",
    ]);

    if (typeof callResult !== "string") {
      throw new Error("eth_call returned a non-hex response");
    }

    const [roleRaw, levelRaw, registeredAtRaw] = decodeFunctionResult(
      ["string", "uint256", "uint256"],
      callResult,
    );
    const role = String(roleRaw);
    const level = toUint8(levelRaw, "onchain identity level");
    const registeredAt = toSafeNumber(registeredAtRaw);

    if (role.length === 0 && level === 0 && registeredAt === 0) {
      return undefined;
    }

    return {
      role,
      level,
      registeredAt,
    };
  }

  private async sendRawTransaction(to: string, data: string): Promise<string> {
    const nonce = await this.resolveNextNonce();
    return submitSignedTransaction(this.rpcProvider, this.signer, {
      to,
      data,
      nonce,
    });
  }

  private async resolveNextNonce(): Promise<number> {
    const providerNonce = await tryGetPendingNonce(this.rpcProvider, this.signer.getAddress());
    const nonce = providerNonce === undefined ? this.txNonce : Math.max(this.txNonce, providerNonce);
    this.txNonce = nonce + 1;
    return nonce;
  }
}

export { MockRpcProvider };

function findRecipientId(recipientIds: string[], token: string): string | undefined {
  const lowered = token.toLowerCase();
  return recipientIds.find((id) => id.toLowerCase().includes(lowered));
}

function validateContractAddresses(addresses: ContractAddresses): ContractAddresses {
  const normalized: ContractAddresses = {
    escrow: normalizeContractAddress(addresses.escrow, "escrow"),
    identitySBT: normalizeContractAddress(addresses.identitySBT, "identitySBT"),
    staking: normalizeContractAddress(addresses.staking, "staking"),
    payRouter: normalizeContractAddress(addresses.payRouter, "payRouter"),
  };
  const uniqueAddresses = new Set(Object.values(normalized));
  if (uniqueAddresses.size !== Object.keys(normalized).length) {
    throw new Error("contractAddresses must contain unique contract addresses");
  }
  return normalized;
}

function normalizeContractAddress(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`contract address ${label} is required`);
  }

  const normalized = value.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`contract address ${label} must be a 20-byte hex address`);
  }
  if (normalized === ZERO_ADDRESS) {
    throw new Error(`contract address ${label} cannot be the zero address`);
  }
  return normalized;
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

async function tryGetPendingNonce(
  rpcProvider: RpcProvider,
  address: string,
): Promise<number | undefined> {
  try {
    const result = await rpcProvider.request("eth_getTransactionCount", [address, "pending"]);
    return parseRpcNonce(result);
  } catch (error) {
    if (isNonceSyncFallbackError(error)) {
      return undefined;
    }
    throw error;
  }
}

function parseRpcNonce(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`eth_getTransactionCount returned an invalid numeric nonce: ${value}`);
    }
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!/^0x[0-9a-f]+$/.test(normalized)) {
      throw new Error(`eth_getTransactionCount returned an invalid hex nonce: ${value}`);
    }
    const parsed = Number.parseInt(normalized.slice(2), 16);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`eth_getTransactionCount returned an unsafe nonce: ${value}`);
    }
    return parsed;
  }

  throw new Error(`eth_getTransactionCount returned unsupported nonce payload: ${typeof value}`);
}

function isNonceSyncFallbackError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.startsWith("No mock response configured for eth_getTransactionCount")
    || error.message.includes("RPC error -32601");
}

function toUint8(value: unknown, context: string): number {
  if (typeof value !== "bigint") {
    throw new Error(`Expected bigint for ${context}, received ${typeof value}`);
  }
  if (value < 0n || value > 255n) {
    throw new Error(`${context} is out of uint8 range: ${value}`);
  }
  return Number(value);
}

function assertUint8(value: number, context: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${context} must be an integer in [0, 255]. Received: ${value}`);
  }
  return value;
}

function identifierToUint256(identifier: string): bigint {
  if (/^\d+$/.test(identifier)) {
    return BigInt(identifier);
  }
  return BigInt(`0x${keccak256Hex(identifier)}`);
}
