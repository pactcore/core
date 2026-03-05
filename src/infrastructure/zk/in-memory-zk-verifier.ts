import type { ZKVerifier } from "../../application/contracts";
import type { ZKProof } from "../../domain/zk-proofs";

/**
 * Simulated ZK verifier that validates an HMAC proof over commitment + public inputs.
 */
export class InMemoryZKVerifier implements ZKVerifier {
  private readonly secret: string;

  constructor(secret: string = "pact-zk-test-secret") {
    this.secret = secret;
  }

  async verify(proof: ZKProof): Promise<boolean> {
    const publicInputs = this.normalizeValue(proof.publicInputs) as Record<string, unknown>;
    const proofInput = this.stableStringify({
      type: proof.type,
      proverId: proof.proverId,
      commitment: proof.commitment,
      publicInputs,
      createdAt: proof.createdAt,
    });

    const expected = await this.hmac(proofInput);
    return expected === proof.proof;
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
