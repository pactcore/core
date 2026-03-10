import { encodeFunction, functionSelectorFromSignature, keccak256Hex } from "../blockchain/abi-encoder";
import {
  normalizeLikeAddress,
  resolveTransactionSigner,
  submitSignedTransaction,
  type TransactionSigner,
} from "../blockchain/providers";
import { FetchRpcProvider } from "../infrastructure/blockchain/fetch-rpc-provider";
import {
  MockRpcProvider,
  type RpcProvider,
} from "../infrastructure/blockchain/mock-rpc-provider";

const DEFAULT_GOVERNANCE_CONTRACT_ADDRESS = "0x5555555555555555555555555555555555555555";

export type GovernanceVoteChoice = "for" | "against" | "abstain";

export type GovernanceProposalStatus =
  | "pending"
  | "active"
  | "succeeded"
  | "defeated"
  | "executed";

export interface GovernanceProposalAction {
  target: string;
  signature: string;
  calldata: string;
  value: number;
  description?: string;
}

export interface GovernanceVoteRecord {
  proposalId: string;
  voterId: string;
  choice: GovernanceVoteChoice;
  weight: number;
  castAt: number;
  txId: string;
}

export interface GovernanceProposal {
  id: string;
  proposerId: string;
  title: string;
  description: string;
  actions: GovernanceProposalAction[];
  quorum: number;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  status: GovernanceProposalStatus;
  createdAt: number;
  votingStartsAt: number;
  votingEndsAt: number;
  creationTxId: string;
  executedAt?: number;
  executedBy?: string;
  executionTxId?: string;
  votes: GovernanceVoteRecord[];
}

export interface CreateGovernanceProposalInput {
  proposerId: string;
  title: string;
  description: string;
  actions?: GovernanceProposalAction[];
  quorum?: number;
  votingStartsAt?: number;
  votingEndsAt: number;
}

export interface VoteGovernanceProposalInput {
  proposalId: string;
  voterId: string;
  choice: GovernanceVoteChoice;
  weight?: number;
}

export interface ExecuteGovernanceProposalInput {
  proposalId: string;
  executorId: string;
}

export interface GovernanceBridgeConfig {
  rpcUrl?: string;
  contractAddress?: string;
  signerPrivateKey?: string;
  signer?: TransactionSigner;
  rpcProvider?: RpcProvider;
  now?: () => number;
}

interface StoredGovernanceProposal extends Omit<GovernanceProposal, "status" | "votes"> {
  votes: GovernanceVoteRecord[];
}

export class MockEvmGovernanceBridge {
  private readonly rpcProvider: RpcProvider;
  private readonly signer: TransactionSigner;
  private readonly now: () => number;
  private readonly contractAddress: string;
  private readonly proposals = new Map<string, StoredGovernanceProposal>();
  private txNonce = 0;
  private txCounter = 0;
  private proposalSequence = 0;

  constructor(config: GovernanceBridgeConfig = {}) {
    this.rpcProvider = config.rpcProvider
      ?? (config.rpcUrl ? new FetchRpcProvider({ rpcUrl: config.rpcUrl }) : new MockRpcProvider());
    this.signer = resolveTransactionSigner(
      config.signer,
      config.signerPrivateKey,
      "pact-network-governance-signer",
    );
    this.now = config.now ?? (() => Date.now());
    this.contractAddress = normalizeLikeAddress(
      config.contractAddress ?? DEFAULT_GOVERNANCE_CONTRACT_ADDRESS,
    );

    if (
      this.rpcProvider instanceof MockRpcProvider
      && !this.rpcProvider.hasConfiguredResponse("eth_sendRawTransaction")
    ) {
      this.rpcProvider.setMethodResponse("eth_sendRawTransaction", () => {
        this.txCounter += 1;
        return `0xgovtx-${this.txCounter}`;
      });
    }
  }

  async createProposal(input: CreateGovernanceProposalInput): Promise<GovernanceProposal> {
    const proposerId = assertNonEmptyString(input.proposerId, "proposerId");
    const title = assertNonEmptyString(input.title, "title");
    const description = assertNonEmptyString(input.description, "description");
    const createdAt = this.now();
    const votingStartsAt =
      typeof input.votingStartsAt === "number" ? assertTimestamp(input.votingStartsAt, "votingStartsAt") : createdAt;
    const votingEndsAt = assertTimestamp(input.votingEndsAt, "votingEndsAt");
    const quorum = assertPositiveInteger(input.quorum ?? 1, "quorum");

    if (votingEndsAt <= votingStartsAt) {
      throw new Error("votingEndsAt must be greater than votingStartsAt");
    }

    const actions = (input.actions ?? []).map((action, index) => normalizeAction(action, index));
    const proposalId = `proposal-${this.proposalSequence + 1}`;
    const data = encodeFunction(
      "createProposal",
      ["uint256", "address", "string", "string", "uint256", "uint256", "uint256", "uint256"],
      [
        identifierToUint256(proposalId),
        normalizeLikeAddress(proposerId),
        title,
        description,
        BigInt(votingStartsAt),
        BigInt(votingEndsAt),
        BigInt(quorum),
        BigInt(actions.length),
      ],
    );
    const txId = await this.sendRawTransaction(this.contractAddress, data);
    this.proposalSequence += 1;

    this.proposals.set(proposalId, {
      id: proposalId,
      proposerId,
      title,
      description,
      actions,
      quorum,
      forVotes: 0,
      againstVotes: 0,
      abstainVotes: 0,
      createdAt,
      votingStartsAt,
      votingEndsAt,
      creationTxId: txId,
      votes: [],
    });

    return this.getRequiredProposal(proposalId);
  }

  async voteProposal(input: VoteGovernanceProposalInput): Promise<GovernanceProposal> {
    const proposal = this.getStoredProposal(input.proposalId);
    if (!proposal) {
      throw new Error(`Governance proposal ${input.proposalId} not found`);
    }

    if (this.resolveStatus(proposal) !== "active") {
      throw new Error(`Governance proposal ${proposal.id} is not active`);
    }

    const voterId = assertNonEmptyString(input.voterId, "voterId");
    const weight = assertPositiveInteger(input.weight ?? 1, "weight");
    const choice = assertVoteChoice(input.choice);

    if (proposal.votes.some((vote) => vote.voterId === voterId)) {
      throw new Error(`Participant ${voterId} has already voted on proposal ${proposal.id}`);
    }

    const data = encodeFunction(
      "voteProposal",
      ["uint256", "address", "uint256", "uint256"],
      [
        identifierToUint256(proposal.id),
        normalizeLikeAddress(voterId),
        BigInt(choiceToCode(choice)),
        BigInt(weight),
      ],
    );
    const txId = await this.sendRawTransaction(this.contractAddress, withSelector(
      "voteProposal(uint256,address,uint256,uint256)",
      data,
    ));
    const vote: GovernanceVoteRecord = {
      proposalId: proposal.id,
      voterId,
      choice,
      weight,
      castAt: this.now(),
      txId,
    };

    proposal.votes.push(vote);
    switch (choice) {
      case "for":
        proposal.forVotes += weight;
        break;
      case "against":
        proposal.againstVotes += weight;
        break;
      case "abstain":
        proposal.abstainVotes += weight;
        break;
    }

    return this.getRequiredProposal(proposal.id);
  }

  async executeProposal(input: ExecuteGovernanceProposalInput): Promise<GovernanceProposal> {
    const proposal = this.getStoredProposal(input.proposalId);
    if (!proposal) {
      throw new Error(`Governance proposal ${input.proposalId} not found`);
    }
    if (proposal.executionTxId) {
      throw new Error(`Governance proposal ${proposal.id} has already been executed`);
    }

    const status = this.resolveStatus(proposal);
    if (status === "pending" || status === "active") {
      throw new Error(`Governance proposal ${proposal.id} voting window is still open`);
    }
    if (status === "defeated") {
      throw new Error(`Governance proposal ${proposal.id} did not pass execution checks`);
    }

    const executorId = assertNonEmptyString(input.executorId, "executorId");
    const data = encodeFunction("executeProposal", ["uint256", "address"], [
      identifierToUint256(proposal.id),
      normalizeLikeAddress(executorId),
    ]);
    const txId = await this.sendRawTransaction(
      this.contractAddress,
      withSelector("executeProposal(uint256,address)", data),
    );

    proposal.executedAt = this.now();
    proposal.executedBy = executorId;
    proposal.executionTxId = txId;
    return this.getRequiredProposal(proposal.id);
  }

  async getProposal(proposalId: string): Promise<GovernanceProposal | undefined> {
    const proposal = this.getStoredProposal(proposalId);
    return proposal ? this.snapshotProposal(proposal) : undefined;
  }

  async listProposals(): Promise<GovernanceProposal[]> {
    return [...this.proposals.values()]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((proposal) => this.snapshotProposal(proposal));
  }

  private getStoredProposal(proposalId: string): StoredGovernanceProposal | undefined {
    return this.proposals.get(proposalId);
  }

  private getRequiredProposal(proposalId: string): GovernanceProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new Error(`Governance proposal ${proposalId} not found`);
    }
    return this.snapshotProposal(proposal);
  }

  private snapshotProposal(proposal: StoredGovernanceProposal): GovernanceProposal {
    return {
      ...proposal,
      actions: proposal.actions.map((action) => ({ ...action })),
      status: this.resolveStatus(proposal),
      votes: proposal.votes.map((vote) => ({ ...vote })),
    };
  }

  private resolveStatus(proposal: StoredGovernanceProposal): GovernanceProposalStatus {
    if (proposal.executionTxId) {
      return "executed";
    }

    const now = this.now();
    if (now < proposal.votingStartsAt) {
      return "pending";
    }
    if (now <= proposal.votingEndsAt) {
      return "active";
    }

    return proposal.forVotes >= proposal.quorum && proposal.forVotes > proposal.againstVotes
      ? "succeeded"
      : "defeated";
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

function normalizeAction(action: GovernanceProposalAction, index: number): GovernanceProposalAction {
  return {
    target: assertNonEmptyString(action.target, `actions[${index}].target`),
    signature: assertNonEmptyString(action.signature, `actions[${index}].signature`),
    calldata: typeof action.calldata === "string" ? action.calldata : "0x",
    value: assertNonNegativeInteger(action.value ?? 0, `actions[${index}].value`),
    description: action.description ? String(action.description) : undefined,
  };
}

function withSelector(signature: string, encodedCall: string): string {
  const selector = functionSelectorFromSignature(signature);
  return `0x${selector.slice(2)}${encodedCall.slice(10)}`;
}

function choiceToCode(choice: GovernanceVoteChoice): number {
  switch (choice) {
    case "against":
      return 0;
    case "for":
      return 1;
    case "abstain":
      return 2;
  }
}

function assertVoteChoice(choice: GovernanceVoteChoice): GovernanceVoteChoice {
  if (choice === "for" || choice === "against" || choice === "abstain") {
    return choice;
  }
  throw new Error(`Invalid governance vote choice: ${String(choice)}`);
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
}

function assertPositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return Number(value);
}

function assertNonNegativeInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return Number(value);
}

function assertTimestamp(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative timestamp`);
  }
  return Math.floor(value);
}

function identifierToUint256(identifier: string): bigint {
  if (/^\d+$/.test(identifier)) {
    return BigInt(identifier);
  }
  return BigInt(`0x${keccak256Hex(identifier)}`);
}
