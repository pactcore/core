import type { ZKArtifactManifestRepository } from "../../application/contracts";
import type { ZKArtifactManifest } from "../../domain/zk-bridge";
import type { ZKProofType } from "../../domain/zk-proofs";

export class InMemoryZKArtifactManifestRepository implements ZKArtifactManifestRepository {
  private readonly manifests = new Map<string, ZKArtifactManifest>();

  async save(manifest: ZKArtifactManifest): Promise<void> {
    this.manifests.set(manifest.id, structuredClone(manifest));
  }

  async getById(id: string): Promise<ZKArtifactManifest | undefined> {
    const manifest = this.manifests.get(id);
    return manifest ? structuredClone(manifest) : undefined;
  }

  async getByType(type: ZKProofType, manifestVersion?: string): Promise<ZKArtifactManifest | undefined> {
    const manifests = [...this.manifests.values()]
      .filter((manifest) => manifest.proofType === type)
      .sort((left, right) => right.createdAt - left.createdAt);

    const match = manifestVersion
      ? manifests.find((manifest) => manifest.manifestVersion === manifestVersion)
      : manifests[0];

    return match ? structuredClone(match) : undefined;
  }
}
