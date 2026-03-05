import type {
  CredentialIssuer,
  CredentialRepository,
  DIDRepository,
  IdentitySBTContractClient,
  OnchainIdentityRecord,
  ParticipantRepository,
  ParticipantStatsRepository,
  ReputationService,
  WorkerRepository,
} from "../contracts";
import { determineLevel, type IdentityLevel } from "../../domain/identity-levels";
import type {
  DIDDocument,
  GeoPoint,
  Participant,
  ParticipantStats,
  ParticipantRole,
  VerifiableCredential,
  WorkerProfile,
} from "../../domain/types";
import { generateId } from "../utils";

export interface RegisterParticipantInput {
  id: string;
  role: ParticipantRole;
  displayName: string;
  skills?: string[];
  location?: GeoPoint;
  capacity?: number;
  initialReputation?: number;
}

export interface OnchainParticipantIdentity {
  participantId: string;
  tokenId: string;
  role: string;
  level: number;
  registeredAt: number;
}

const defaultLocation: GeoPoint = {
  latitude: 0,
  longitude: 0,
};

export class ParticipantNotFoundError extends Error {
  constructor(participantId: string) {
    super(`Participant not found: ${participantId}`);
    this.name = "ParticipantNotFoundError";
  }
}

export class PactID {
  private readonly onchainTokenIdsByParticipant = new Map<string, bigint>();

  constructor(
    private readonly participantRepository: ParticipantRepository,
    private readonly workerRepository: WorkerRepository,
    private readonly reputationService: ReputationService,
    private readonly didRepository: DIDRepository,
    private readonly credentialIssuer: CredentialIssuer,
    private readonly credentialRepository: CredentialRepository,
    private readonly participantStatsRepository?: ParticipantStatsRepository,
    private readonly identitySbtClient?: IdentitySBTContractClient,
  ) {}

  // ── Participant registration (with DID) ────────────────────

  async registerParticipant(input: RegisterParticipantInput): Promise<Participant> {
    const stats = this.buildDefaultStats(input.id);
    const participant: Participant = {
      id: input.id,
      role: input.role,
      displayName: input.displayName,
      skills: input.skills ?? [],
      location: input.location ?? defaultLocation,
      identityLevel: "basic",
      stats,
    };

    await this.participantRepository.save(participant);
    if (this.participantStatsRepository) {
      await this.participantStatsRepository.save(stats);
    }
    await this.reputationService.setScore(
      participant.id,
      participant.role,
      input.initialReputation ?? 60,
    );

    // Create DID document
    const did = `did:pact:${participant.id}`;
    const now = Date.now();
    const didDoc: DIDDocument = {
      id: did,
      controller: did,
      verificationMethod: [
        {
          id: `${did}#key-1`,
          type: "Ed25519VerificationKey2020",
          controller: did,
          publicKeyHex: generateId("pk").replace(/-/g, ""),
        },
      ],
      service: [
        {
          id: `${did}#agent`,
          type: "AgentService",
          serviceEndpoint: `https://pact.network/agents/${participant.id}`,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await this.didRepository.save(didDoc);

    if (participant.role === "worker") {
      const worker: WorkerProfile = {
        id: participant.id,
        skills: participant.skills,
        reputation: input.initialReputation ?? 60,
        location: participant.location,
        capacity: input.capacity ?? 1,
        activeTaskIds: [],
      };
      await this.workerRepository.save(worker);
    }

    await this.mintOnchainIdentityIfEnabled(participant);

    return participant;
  }

  async getIdentityLevel(participantId: string): Promise<IdentityLevel> {
    const participant = await this.requireParticipant(participantId);
    const stats = await this.getParticipantStats(participantId);

    if (!stats) {
      return participant.identityLevel ?? "basic";
    }

    return determineLevel({
      taskCount: stats.taskCount,
      reputation: stats.reputation,
      hasZKProof: stats.hasZKProofOfHumanity,
      hasPhoneVerification: stats.hasPhoneVerification,
      hasIdVerification: stats.hasIdVerification,
    });
  }

  async upgradeIdentityLevel(
    participantId: string,
  ): Promise<{ previousLevel: IdentityLevel; newLevel: IdentityLevel; participant: Participant }> {
    const participant = await this.requireParticipant(participantId);
    const previousLevel = participant.identityLevel ?? "basic";
    const stats = await this.getOrCreateStats(participant);
    const newLevel = determineLevel({
      taskCount: stats.taskCount,
      reputation: stats.reputation,
      hasZKProof: stats.hasZKProofOfHumanity,
      hasPhoneVerification: stats.hasPhoneVerification,
      hasIdVerification: stats.hasIdVerification,
    });
    const updatedParticipant = await this.saveParticipantAndStats(participant, stats, newLevel);
    await this.upgradeOnchainIdentityIfEnabled(updatedParticipant.id, newLevel);

    return { previousLevel, newLevel, participant: updatedParticipant };
  }

  async getOnchainIdentity(participantId: string): Promise<OnchainParticipantIdentity | undefined> {
    await this.requireParticipant(participantId);

    if (!this.identitySbtClient) {
      return undefined;
    }

    const tokenId = this.onchainTokenIdsByParticipant.get(participantId);
    if (tokenId === undefined) {
      return undefined;
    }

    const identity = await this.identitySbtClient.getIdentity(tokenId);
    if (!identity) {
      return undefined;
    }

    return this.buildOnchainIdentity(participantId, tokenId, identity);
  }

  async syncOnchainIdentity(participantId: string): Promise<OnchainParticipantIdentity | undefined> {
    const participant = await this.requireParticipant(participantId);

    if (!this.identitySbtClient) {
      return undefined;
    }

    const localLevel = participant.identityLevel ?? "basic";
    const existingTokenId = this.onchainTokenIdsByParticipant.get(participantId);

    if (existingTokenId === undefined) {
      const mintedTokenId = await this.identitySbtClient.mint(
        participant.id,
        participant.id,
        participant.role,
        identityLevelToChainLevel(localLevel),
      );
      this.onchainTokenIdsByParticipant.set(participantId, mintedTokenId);
    } else {
      await this.identitySbtClient.upgradeLevel(existingTokenId, identityLevelToChainLevel(localLevel));
    }

    return this.getOnchainIdentity(participantId);
  }

  async getParticipantStats(participantId: string): Promise<ParticipantStats | undefined> {
    const participant = await this.participantRepository.getById(participantId);
    if (!participant) {
      return undefined;
    }

    if (this.participantStatsRepository) {
      const fromRepository = await this.participantStatsRepository.get(participantId);
      if (fromRepository) {
        return fromRepository;
      }
    }

    return participant.stats ?? this.buildDefaultStats(participantId);
  }

  async recordTaskCompletion(participantId: string): Promise<ParticipantStats> {
    const participant = await this.requireParticipant(participantId);
    const stats = await this.getOrCreateStats(participant);
    const updatedStats: ParticipantStats = {
      ...stats,
      taskCount: stats.taskCount + 1,
      completedTaskCount: stats.completedTaskCount + 1,
    };

    await this.saveParticipantAndStats(participant, updatedStats, participant.identityLevel ?? "basic");
    return updatedStats;
  }

  // ── DID operations ─────────────────────────────────────────

  async getDIDDocument(participantId: string): Promise<DIDDocument | undefined> {
    return this.didRepository.getByParticipantId(participantId);
  }

  async resolveDID(did: string): Promise<DIDDocument | undefined> {
    return this.didRepository.getByDID(did);
  }

  // ── Verifiable Credentials ─────────────────────────────────

  async issueCredential(
    issuerId: string,
    subjectId: string,
    capability: string,
    additionalClaims?: Record<string, unknown>,
    expirationDate?: number,
  ): Promise<VerifiableCredential> {
    const credential = await this.credentialIssuer.issue({
      type: ["VerifiableCredential", "PactCapabilityCredential"],
      issuer: issuerId,
      issuanceDate: Date.now(),
      expirationDate,
      credentialSubject: {
        id: subjectId,
        capability,
        ...additionalClaims,
      },
    });

    await this.credentialRepository.save(credential);
    return credential;
  }

  async verifyCredential(credential: VerifiableCredential): Promise<boolean> {
    // Check expiration
    if (credential.expirationDate && credential.expirationDate < Date.now()) {
      return false;
    }
    return this.credentialIssuer.verify(credential);
  }

  async getCredentials(subjectId: string): Promise<VerifiableCredential[]> {
    return this.credentialRepository.getBySubject(subjectId);
  }

  // ── Capability checking ────────────────────────────────────

  async checkCapability(participantId: string, capability: string): Promise<boolean> {
    const credentials = await this.credentialRepository.getBySubjectAndCapability(
      participantId,
      capability,
    );

    for (const cred of credentials) {
      if (cred.expirationDate && cred.expirationDate < Date.now()) {
        continue;
      }
      const valid = await this.credentialIssuer.verify(cred);
      if (valid) return true;
    }

    return false;
  }

  // ── Worker queries ─────────────────────────────────────────

  async listParticipants(): Promise<Participant[]> {
    const participantsByRole = await Promise.all(
      participantRoles.map((role) => this.participantRepository.listByRole(role)),
    );
    const byId = new Map<string, Participant>();
    for (const participant of participantsByRole.flat()) {
      byId.set(participant.id, participant);
    }
    return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  async getWorker(workerId: string): Promise<WorkerProfile | undefined> {
    return this.workerRepository.getById(workerId);
  }

  async listWorkers(): Promise<WorkerProfile[]> {
    return this.workerRepository.list();
  }

  private buildDefaultStats(participantId: string): ParticipantStats {
    return {
      participantId,
      taskCount: 0,
      completedTaskCount: 0,
      reputation: 0,
      hasZKProofOfHumanity: false,
      hasPhoneVerification: false,
      hasIdVerification: false,
    };
  }

  private async requireParticipant(participantId: string): Promise<Participant> {
    const participant = await this.participantRepository.getById(participantId);
    if (!participant) {
      throw new ParticipantNotFoundError(participantId);
    }
    return participant;
  }

  private async getOrCreateStats(participant: Participant): Promise<ParticipantStats> {
    const existing = await this.getParticipantStats(participant.id);
    if (existing) {
      return existing;
    }

    const created = this.buildDefaultStats(participant.id);
    if (this.participantStatsRepository) {
      await this.participantStatsRepository.save(created);
    }
    return created;
  }

  private async saveParticipantAndStats(
    participant: Participant,
    stats: ParticipantStats,
    identityLevel: IdentityLevel,
  ): Promise<Participant> {
    const updatedParticipant: Participant = {
      ...participant,
      identityLevel,
      stats,
    };
    await this.participantRepository.save(updatedParticipant);
    if (this.participantStatsRepository) {
      await this.participantStatsRepository.save(stats);
    }
    return updatedParticipant;
  }

  private async mintOnchainIdentityIfEnabled(participant: Participant): Promise<void> {
    if (!this.identitySbtClient) {
      return;
    }
    const tokenId = await this.identitySbtClient.mint(
      participant.id,
      participant.id,
      participant.role,
      identityLevelToChainLevel(participant.identityLevel ?? "basic"),
    );
    this.onchainTokenIdsByParticipant.set(participant.id, tokenId);
  }

  private async upgradeOnchainIdentityIfEnabled(
    participantId: string,
    identityLevel: IdentityLevel,
  ): Promise<void> {
    if (!this.identitySbtClient) {
      return;
    }
    const tokenId = this.onchainTokenIdsByParticipant.get(participantId);
    if (tokenId === undefined) {
      return;
    }
    await this.identitySbtClient.upgradeLevel(tokenId, identityLevelToChainLevel(identityLevel));
  }

  private buildOnchainIdentity(
    participantId: string,
    tokenId: bigint,
    onchainIdentity: OnchainIdentityRecord,
  ): OnchainParticipantIdentity {
    return {
      participantId,
      tokenId: tokenId.toString(),
      role: String(onchainIdentity.role),
      level: onchainIdentity.level,
      registeredAt: onchainIdentity.registeredAt,
    };
  }
}

function identityLevelToChainLevel(level: IdentityLevel): number {
  switch (level) {
    case "basic":
      return 0;
    case "verified":
      return 1;
    case "trusted":
      return 2;
    case "elite":
      return 3;
  }
}

const participantRoles: ParticipantRole[] = ["worker", "validator", "issuer", "agent", "jury"];
