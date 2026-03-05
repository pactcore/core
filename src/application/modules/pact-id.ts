import type {
  CredentialIssuer,
  CredentialRepository,
  DIDRepository,
  ParticipantRepository,
  ReputationService,
  WorkerRepository,
} from "../contracts";
import type {
  DIDDocument,
  GeoPoint,
  Participant,
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

const defaultLocation: GeoPoint = {
  latitude: 0,
  longitude: 0,
};

export class PactID {
  constructor(
    private readonly participantRepository: ParticipantRepository,
    private readonly workerRepository: WorkerRepository,
    private readonly reputationService: ReputationService,
    private readonly didRepository: DIDRepository,
    private readonly credentialIssuer: CredentialIssuer,
    private readonly credentialRepository: CredentialRepository,
  ) {}

  // ── Participant registration (with DID) ────────────────────

  async registerParticipant(input: RegisterParticipantInput): Promise<Participant> {
    const participant: Participant = {
      id: input.id,
      role: input.role,
      displayName: input.displayName,
      skills: input.skills ?? [],
      location: input.location ?? defaultLocation,
    };

    await this.participantRepository.save(participant);
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

    return participant;
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

  async getWorker(workerId: string): Promise<WorkerProfile | undefined> {
    return this.workerRepository.getById(workerId);
  }

  async listWorkers(): Promise<WorkerProfile[]> {
    return this.workerRepository.list();
  }
}
