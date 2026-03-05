import type { CredentialIssuer } from "../../application/contracts";
import type { VerifiableCredential } from "../../domain/types";
import { generateId } from "../../application/utils";

/**
 * In-memory credential issuer using HMAC-SHA256 for proof generation (testing only).
 */
export class InMemoryCredentialIssuer implements CredentialIssuer {
  private readonly secret: string;

  constructor(secret: string = "pact-test-secret") {
    this.secret = secret;
  }

  async issue(
    credential: Omit<VerifiableCredential, "id" | "proof">,
  ): Promise<VerifiableCredential> {
    const id = generateId("vc");
    const proofInput = JSON.stringify({
      issuer: credential.issuer,
      subject: credential.credentialSubject,
      issuanceDate: credential.issuanceDate,
    });

    const proofValue = await this.hmac(proofInput);

    return {
      ...credential,
      id,
      proof: {
        type: "HmacSha256Signature2024",
        created: Date.now(),
        verificationMethod: `did:pact:${credential.issuer}#key-1`,
        proofValue,
      },
    };
  }

  async verify(credential: VerifiableCredential): Promise<boolean> {
    const proofInput = JSON.stringify({
      issuer: credential.issuer,
      subject: credential.credentialSubject,
      issuanceDate: credential.issuanceDate,
    });

    const expected = await this.hmac(proofInput);
    return credential.proof.proofValue === expected;
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
}
