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
    const manifests = this.sortManifests(this.filterByType(type));

    const match = manifestVersion
      ? manifests.find((manifest) => manifest.manifestVersion === manifestVersion)
      : manifests[0];

    return match ? structuredClone(match) : undefined;
  }

  async listByType(type?: ZKProofType): Promise<ZKArtifactManifest[]> {
    return this.sortManifests(this.filterByType(type)).map((manifest) => structuredClone(manifest));
  }

  private filterByType(type?: ZKProofType): ZKArtifactManifest[] {
    return [...this.manifests.values()].filter((manifest) => type === undefined || manifest.proofType === type);
  }

  private sortManifests(manifests: ZKArtifactManifest[]): ZKArtifactManifest[] {
    return manifests.sort((left, right) => {
      if (left.proofType !== right.proofType) {
        return left.proofType.localeCompare(right.proofType);
      }

      if (left.createdAt !== right.createdAt) {
        return right.createdAt - left.createdAt;
      }

      return right.manifestVersion.localeCompare(left.manifestVersion);
    });
  }
}
