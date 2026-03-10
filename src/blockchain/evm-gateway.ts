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
  private readonly releaseTxIdsByTask = new Map<string, string>();
  private txNonce = 0;

  constructor(private readonly config: EvmBlockchainGatewayConfig) {
    this.rpcProvider = config.rpcProvider ?? new FetchRpcProvider({ rpcUrl: config.rpcUrl });
    this.signer = resolveTransactionSigner(config.signer, config.signerPrivateKey, "pact-network-signer");
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
    const nonce = this.txNonce;
    this.txNonce += 1;
    return submitSignedTransaction(this.rpcProvider, this.signer, {
      to,
      data,
      nonce,
    });
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
  private txNonce = 0;

  constructor(private readonly config: EvmIdentitySBTContractClientConfig) {
    this.rpcProvider = config.rpcProvider ?? new FetchRpcProvider({ rpcUrl: config.rpcUrl });
    this.signer = resolveTransactionSigner(
      config.signer,
      config.signerPrivateKey,
      "pact-network-identity-signer",
    );
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
    await this.sendRawTransaction(this.config.contractAddress, data);
    return identifierToUint256(participantId);
  }

  async upgradeLevel(tokenId: bigint, newLevel: number): Promise<string> {
    const encoded = encodeFunction("upgradeLevel", ["uint256", "uint256"], [
      tokenId,
      BigInt(assertUint8(newLevel, "upgrade level")),
    ]);
    const selector = functionSelectorFromSignature("upgradeLevel(uint256,uint8)");
    const data = `0x${selector.slice(2)}${encoded.slice(10)}`;
    return this.sendRawTransaction(this.config.contractAddress, data);
  }

  async getIdentity(tokenId: bigint): Promise<OnchainIdentityRecord | undefined> {
    const data = encodeFunction("getIdentity", ["uint256"], [tokenId]);
    const callResult = await this.rpcProvider.request("eth_call", [
      {
        to: normalizeLikeAddress(this.config.contractAddress),
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
    const nonce = this.txNonce;
    this.txNonce += 1;
    return submitSignedTransaction(this.rpcProvider, this.signer, {
      to,
      data,
      nonce,
    });
  }
}

export { MockRpcProvider };

function findRecipientId(recipientIds: string[], token: string): string | undefined {
  const lowered = token.toLowerCase();
  return recipientIds.find((id) => id.toLowerCase().includes(lowered));
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
