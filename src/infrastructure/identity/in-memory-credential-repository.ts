import type { CredentialRepository } from "../../application/contracts";
import type { VerifiableCredential } from "../../domain/types";

export class InMemoryCredentialRepository implements CredentialRepository {
  private readonly credentials = new Map<string, VerifiableCredential>();

  async save(credential: VerifiableCredential): Promise<void> {
    this.credentials.set(credential.id, credential);
  }

  async getById(id: string): Promise<VerifiableCredential | undefined> {
    return this.credentials.get(id);
  }

  async getBySubject(subjectId: string): Promise<VerifiableCredential[]> {
    return [...this.credentials.values()].filter(
      (c) => c.credentialSubject.id === subjectId,
    );
  }

  async getBySubjectAndCapability(
    subjectId: string,
    capability: string,
  ): Promise<VerifiableCredential[]> {
    return [...this.credentials.values()].filter(
      (c) =>
        c.credentialSubject.id === subjectId &&
        c.credentialSubject.capability === capability,
    );
  }
}
