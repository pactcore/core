import type { DIDRepository } from "../../application/contracts";
import type { DIDDocument } from "../../domain/types";

export class InMemoryDIDRepository implements DIDRepository {
  private readonly docs = new Map<string, DIDDocument>();

  async save(doc: DIDDocument): Promise<void> {
    this.docs.set(doc.id, doc);
  }

  async getByDID(did: string): Promise<DIDDocument | undefined> {
    return this.docs.get(did);
  }

  async getByParticipantId(participantId: string): Promise<DIDDocument | undefined> {
    return this.docs.get(`did:pact:${participantId}`);
  }
}
