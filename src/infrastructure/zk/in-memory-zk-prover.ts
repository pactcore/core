import type { ZKProver } from "../../application/contracts";
import { generateId } from "../../application/utils";
import type { ZKProof, ZKProofRequest } from "../../domain/zk-proofs";

/**
 * Simulated ZK prover backed by HMAC-SHA256 commitments (testing/runtime friendly).
 */
export class InMemoryZKProver implements ZKProver {
  private readonly secret: string;

  constructor(secret: string = "pact-zk-test-secret") {
    this.secret = secret;
  }

  async generate(request: ZKProofRequest, witness: unknown): Promise<ZKProof> {
    const publicInputs = this.normalizeValue(request.publicInputs) as Record<string, unknown>;

    const commitmentInput = this.stableStringify({
      type: request.type,
      proverId: request.proverId,
      challenge: request.challenge,
      publicInputs,
      witness,
    });

    const commitment = await this.hmac(commitmentInput);

    const proofInput = this.stableStringify({
      type: request.type,
      proverId: request.proverId,
      commitment,
      publicInputs,
      createdAt: request.createdAt,
    });

    return {
      id: generateId("zkp"),
      type: request.type,
      proverId: request.proverId,
      commitment,
      publicInputs,
      proof: await this.hmac(proofInput),
      verified: false,
      createdAt: request.createdAt,
    };
  }

  private async hmac(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.normalizeValue(value));
  }

  private normalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeValue(item));
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};

      for (const key of Object.keys(record).sort()) {
        normalized[key] = this.normalizeValue(record[key]);
      }

      return normalized;
    }

    return value;
  }
}
