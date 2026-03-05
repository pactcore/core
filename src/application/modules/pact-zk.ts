import type { ZKProofRepository, ZKProver, ZKVerifier } from "../contracts";
import { generateId } from "../utils";
import type {
  ZKCompletionClaim,
  ZKIdentityClaim,
  ZKLocationClaim,
  ZKProof,
  ZKProofRequest,
  ZKProofType,
  ZKReputationClaim,
} from "../../domain/zk-proofs";

export class PactZK {
  constructor(
    private readonly prover: ZKProver,
    private readonly verifier: ZKVerifier,
    private readonly proofRepository: ZKProofRepository,
  ) {}

  async generateLocationProof(proverId: string, claim: ZKLocationClaim): Promise<ZKProof> {
    return this.generateProof("location", proverId, claim, claim);
  }

  async generateCompletionProof(proverId: string, claim: ZKCompletionClaim): Promise<ZKProof> {
    return this.generateProof("completion", proverId, claim, claim);
  }

  async generateIdentityProof(proverId: string, claim: ZKIdentityClaim): Promise<ZKProof> {
    return this.generateProof("identity", proverId, claim, claim);
  }

  async generateReputationProof(proverId: string, claim: ZKReputationClaim): Promise<ZKProof> {
    return this.generateProof("reputation", proverId, claim, claim);
  }

  async verifyProof(proofId: string): Promise<boolean> {
    const proof = await this.proofRepository.getById(proofId);
    if (!proof) {
      return false;
    }

    const verified = await this.verifier.verify(proof);
    await this.proofRepository.save({
      ...proof,
      verified,
    });

    return verified;
  }

  async getProof(proofId: string): Promise<ZKProof | undefined> {
    return this.proofRepository.getById(proofId);
  }

  async listProofsByProver(proverId: string): Promise<ZKProof[]> {
    return this.proofRepository.getByProver(proverId);
  }

  private async generateProof(
    type: ZKProofType,
    proverId: string,
    publicInputsSource: Record<string, unknown>,
    witness: unknown,
  ): Promise<ZKProof> {
    const publicInputs = { ...publicInputsSource };
    const request: ZKProofRequest = {
      type,
      proverId,
      challenge: generateId("challenge"),
      publicInputs,
      createdAt: Date.now(),
    };

    const proof = await this.prover.generate(request, witness);
    await this.proofRepository.save(proof);
    return proof;
  }
}
