import type { AdapterHealthReport } from "../../application/adapter-runtime";
import type { ExternalZKProverAdapter } from "../../application/contracts";
import { hashZKBridgePayload, type ExternalZKProveRequest, type ExternalZKVerifyRequest } from "../../domain/zk-bridge";

export interface DeterministicLocalZKProverAdapterOptions {
  adapterName?: string;
}

export class DeterministicLocalZKProverAdapter implements ExternalZKProverAdapter {
  readonly durability = "memory" as const;
  readonly adapterName: string;

  constructor(options: DeterministicLocalZKProverAdapterOptions | string = {}) {
    this.adapterName = typeof options === "string"
      ? options
      : options.adapterName ?? "deterministic-local-zk-prover";
  }

  async loadArtifact(artifact: ExternalZKProveRequest["manifest"]["artifacts"][number]): Promise<string | Uint8Array> {
    if (artifact.inlineData !== undefined) {
      return artifact.inlineData;
    }

    return new TextEncoder().encode(`${artifact.role}:${artifact.uri}:${artifact.version}`);
  }

  async prove(request: ExternalZKProveRequest) {
    const commitment = await hashZKBridgePayload({
      adapter: this.adapterName,
      manifestId: request.manifest.id,
      manifestIntegrity: request.manifest.manifestIntegrity,
      proofType: request.proofType,
      proverId: request.proverId,
      challenge: request.challenge,
      publicInputs: request.publicInputs,
      witness: request.witness,
    });

    const proof = await this.computeProof({
      manifestId: request.manifest.id,
      manifestIntegrity: request.manifest.manifestIntegrity,
      proofType: request.proofType,
      proverId: request.proverId,
      publicInputs: request.publicInputs,
      createdAt: request.createdAt,
      commitment,
    });

    return {
      commitment,
      proof,
      traceId: `${request.traceId}:prove`,
      adapterReceiptId: `${this.adapterName}:prove:${request.requestId}`,
    };
  }

  async verify(request: ExternalZKVerifyRequest) {
    const expected = await this.computeProof({
      manifestId: request.manifest.id,
      manifestIntegrity: request.manifest.manifestIntegrity,
      proofType: request.proofType,
      proverId: request.proverId,
      publicInputs: request.publicInputs,
      createdAt: request.createdAt,
      commitment: request.commitment,
    });

    return {
      verified: expected === request.proof,
      traceId: `${request.traceId}:verify`,
      adapterReceiptId: `${this.adapterName}:verify:${request.proofId}`,
      details: {
        adapter: this.adapterName,
        manifestId: request.manifest.id,
        manifestIntegrity: request.manifest.manifestIntegrity,
        deterministic: "true",
      },
    };
  }

  getHealth(): AdapterHealthReport {
    return {
      name: this.adapterName,
      state: "healthy",
      checkedAt: Date.now(),
      durable: false,
      durability: this.durability,
      features: {
        externalProver: true,
        receiptTraceability: true,
        artifactIntegrity: true,
        deterministicLocal: true,
      },
    };
  }

  private async computeProof(input: {
    manifestId: string;
    manifestIntegrity: string;
    proofType: string;
    proverId: string;
    publicInputs: Record<string, unknown>;
    createdAt: number;
    commitment: string;
  }): Promise<string> {
    return hashZKBridgePayload({
      adapter: this.adapterName,
      manifestId: input.manifestId,
      manifestIntegrity: input.manifestIntegrity,
      proofType: input.proofType,
      proverId: input.proverId,
      publicInputs: input.publicInputs,
      createdAt: input.createdAt,
      commitment: input.commitment,
    });
  }
}
