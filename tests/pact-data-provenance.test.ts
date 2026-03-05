import { describe, expect, test } from "bun:test";
import { PactData } from "../src/application/modules/pact-data";
import { InMemoryDataAssetRepository } from "../src/infrastructure/data/in-memory-data-asset-repository";
import { InMemoryProvenanceGraph } from "../src/infrastructure/data/in-memory-provenance-graph";
import { InMemoryIntegrityProofRepository } from "../src/infrastructure/data/in-memory-integrity-proof-repository";
import { InMemoryDataAccessPolicyRepository } from "../src/infrastructure/data/in-memory-data-access-policy-repository";

function setup() {
  return new PactData(
    new InMemoryDataAssetRepository(),
    new InMemoryProvenanceGraph(),
    new InMemoryIntegrityProofRepository(),
    new InMemoryDataAccessPolicyRepository(),
  );
}

describe("PactData Provenance & Integrity", () => {
  test("publishes data assets and lists them", async () => {
    const data = setup();
    const a1 = await data.publish({ ownerId: "u1", title: "Dataset A", uri: "s3://a" });
    const a2 = await data.publish({ ownerId: "u2", title: "Dataset B", uri: "s3://b" });

    expect(a1.id).toMatch(/^data_/);
    const all = await data.list();
    expect(all).toHaveLength(2);
  });

  test("creates provenance edges when publishing with derivedFrom", async () => {
    const data = setup();
    const parent1 = await data.publish({ ownerId: "u1", title: "Raw", uri: "s3://raw" });
    const parent2 = await data.publish({ ownerId: "u1", title: "Labels", uri: "s3://labels" });
    const child = await data.publish({
      ownerId: "u1",
      title: "Training Set",
      uri: "s3://train",
      derivedFrom: [parent1.id, parent2.id],
    });

    const lineage = await data.getLineage(child.id);
    expect(lineage).toHaveLength(2);
    expect(lineage.map((e) => e.parentId).sort()).toEqual([parent1.id, parent2.id].sort());
  });

  test("traverses ancestors through multi-level lineage", async () => {
    const data = setup();
    const grandparent = await data.publish({ ownerId: "u1", title: "GP", uri: "s3://gp" });
    const parent = await data.publish({
      ownerId: "u1",
      title: "P",
      uri: "s3://p",
      derivedFrom: [grandparent.id],
    });
    const child = await data.publish({
      ownerId: "u1",
      title: "C",
      uri: "s3://c",
      derivedFrom: [parent.id],
    });

    const lineage = await data.getLineage(child.id);
    // Should include edge from child→parent AND parent→grandparent
    expect(lineage).toHaveLength(2);
    const parentIds = lineage.map((e) => e.parentId);
    expect(parentIds).toContain(parent.id);
    expect(parentIds).toContain(grandparent.id);
  });

  test("traverses dependents (children)", async () => {
    const data = setup();
    const parent = await data.publish({ ownerId: "u1", title: "Source", uri: "s3://src" });
    const c1 = await data.publish({
      ownerId: "u1",
      title: "Derived1",
      uri: "s3://d1",
      derivedFrom: [parent.id],
    });
    const c2 = await data.publish({
      ownerId: "u1",
      title: "Derived2",
      uri: "s3://d2",
      derivedFrom: [parent.id],
    });

    const deps = await data.getDependents(parent.id);
    expect(deps).toHaveLength(2);
    expect(deps.map((e) => e.childId).sort()).toEqual([c1.id, c2.id].sort());
  });

  test("registers and verifies integrity proof", async () => {
    const data = setup();
    const asset = await data.publish({ ownerId: "u1", title: "File", uri: "s3://file" });

    const hash = "abc123def456";
    const proof = await data.registerIntegrityProof(asset.id, hash);
    expect(proof.algorithm).toBe("sha-256");
    expect(proof.hash).toBe(hash);

    const valid = await data.verifyIntegrity(asset.id, hash);
    expect(valid).toBe(true);
  });

  test("integrity verification fails with wrong hash", async () => {
    const data = setup();
    const asset = await data.publish({ ownerId: "u1", title: "File", uri: "s3://file" });

    await data.registerIntegrityProof(asset.id, "correct-hash");

    const valid = await data.verifyIntegrity(asset.id, "wrong-hash");
    expect(valid).toBe(false);
  });

  test("integrity verification fails when no proof registered", async () => {
    const data = setup();
    const valid = await data.verifyIntegrity("nonexistent", "some-hash");
    expect(valid).toBe(false);
  });

  test("published assets default to public access", async () => {
    const data = setup();
    const asset = await data.publish({ ownerId: "u1", title: "Public", uri: "s3://pub" });

    const canAccess = await data.checkAccess(asset.id, "random-user");
    expect(canAccess).toBe(true);
  });

  test("restricted access denies unauthorized participants", async () => {
    const data = setup();
    const asset = await data.publish({ ownerId: "u1", title: "Private", uri: "s3://priv" });

    await data.setAccessPolicy(asset.id, ["u1", "u2"], false);

    expect(await data.checkAccess(asset.id, "u1")).toBe(true);
    expect(await data.checkAccess(asset.id, "u2")).toBe(true);
    expect(await data.checkAccess(asset.id, "u3")).toBe(false);
  });

  test("access check returns false for unknown asset", async () => {
    const data = setup();
    const result = await data.checkAccess("nonexistent", "u1");
    expect(result).toBe(false);
  });
});
