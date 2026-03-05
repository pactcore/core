import { describe, expect, test } from "bun:test";
import { PactID } from "../src/application/modules/pact-id";
import { InMemoryParticipantRepository } from "../src/infrastructure/repositories/in-memory-participant-repository";
import { InMemoryWorkerRepository } from "../src/infrastructure/repositories/in-memory-worker-repository";
import { InMemoryReputationRepository } from "../src/infrastructure/repositories/in-memory-reputation-repository";
import { InMemoryReputationService } from "../src/infrastructure/reputation/in-memory-reputation-service";
import { InMemoryDIDRepository } from "../src/infrastructure/identity/in-memory-did-repository";
import { InMemoryCredentialIssuer } from "../src/infrastructure/identity/in-memory-credential-issuer";
import { InMemoryCredentialRepository } from "../src/infrastructure/identity/in-memory-credential-repository";

function setup() {
  const participantRepo = new InMemoryParticipantRepository();
  const workerRepo = new InMemoryWorkerRepository();
  const reputationRepo = new InMemoryReputationRepository();
  const reputationService = new InMemoryReputationService(reputationRepo);
  const didRepo = new InMemoryDIDRepository();
  const credentialIssuer = new InMemoryCredentialIssuer("test-secret");
  const credentialRepo = new InMemoryCredentialRepository();

  const pactID = new PactID(
    participantRepo,
    workerRepo,
    reputationService,
    didRepo,
    credentialIssuer,
    credentialRepo,
  );

  return { pactID, credentialIssuer };
}

describe("PactID Identity", () => {
  test("creates DID document on participant registration", async () => {
    const { pactID } = setup();

    const participant = await pactID.registerParticipant({
      id: "agent-001",
      role: "agent",
      displayName: "Test Agent",
    });

    expect(participant.id).toBe("agent-001");

    const did = await pactID.getDIDDocument("agent-001");
    expect(did).toBeDefined();
    expect(did!.id).toBe("did:pact:agent-001");
    expect(did!.controller).toBe("did:pact:agent-001");
    expect(did!.verificationMethod).toHaveLength(1);
    expect(did!.verificationMethod[0].type).toBe("Ed25519VerificationKey2020");
    expect(did!.service).toHaveLength(1);
    expect(did!.service[0].type).toBe("AgentService");
  });

  test("resolves DID by full DID string", async () => {
    const { pactID } = setup();

    await pactID.registerParticipant({
      id: "worker-001",
      role: "worker",
      displayName: "Worker One",
      skills: ["delivery"],
    });

    const did = await pactID.resolveDID("did:pact:worker-001");
    expect(did).toBeDefined();
    expect(did!.id).toBe("did:pact:worker-001");
  });

  test("returns undefined for non-existent DID", async () => {
    const { pactID } = setup();
    const did = await pactID.getDIDDocument("nonexistent");
    expect(did).toBeUndefined();
  });

  test("issues and verifies credentials", async () => {
    const { pactID } = setup();

    await pactID.registerParticipant({
      id: "issuer-001",
      role: "issuer",
      displayName: "Issuer",
    });
    await pactID.registerParticipant({
      id: "worker-001",
      role: "worker",
      displayName: "Worker",
    });

    const credential = await pactID.issueCredential(
      "issuer-001",
      "worker-001",
      "delivery.certified",
      { region: "US-West" },
    );

    expect(credential.id).toMatch(/^vc_/);
    expect(credential.issuer).toBe("issuer-001");
    expect(credential.credentialSubject.id).toBe("worker-001");
    expect(credential.credentialSubject.capability).toBe("delivery.certified");
    expect(credential.proof.type).toBe("HmacSha256Signature2024");

    // Verify
    const valid = await pactID.verifyCredential(credential);
    expect(valid).toBe(true);
  });

  test("rejects tampered credential", async () => {
    const { pactID } = setup();

    await pactID.registerParticipant({ id: "i1", role: "issuer", displayName: "I" });
    await pactID.registerParticipant({ id: "w1", role: "worker", displayName: "W" });

    const credential = await pactID.issueCredential("i1", "w1", "skill.ai");

    // Tamper with the credential
    const tampered = {
      ...credential,
      credentialSubject: { ...credential.credentialSubject, capability: "skill.hacking" },
    };

    const valid = await pactID.verifyCredential(tampered);
    expect(valid).toBe(false);
  });

  test("rejects expired credential", async () => {
    const { pactID } = setup();

    await pactID.registerParticipant({ id: "i1", role: "issuer", displayName: "I" });
    await pactID.registerParticipant({ id: "w1", role: "worker", displayName: "W" });

    const credential = await pactID.issueCredential(
      "i1",
      "w1",
      "skill.temp",
      undefined,
      Date.now() - 1000, // Already expired
    );

    const valid = await pactID.verifyCredential(credential);
    expect(valid).toBe(false);
  });

  test("checks capability with valid credential", async () => {
    const { pactID } = setup();

    await pactID.registerParticipant({ id: "i1", role: "issuer", displayName: "I" });
    await pactID.registerParticipant({ id: "w1", role: "worker", displayName: "W" });

    await pactID.issueCredential("i1", "w1", "mission.execute");

    const has = await pactID.checkCapability("w1", "mission.execute");
    expect(has).toBe(true);

    const hasNot = await pactID.checkCapability("w1", "mission.admin");
    expect(hasNot).toBe(false);
  });

  test("capability check fails for expired credential", async () => {
    const { pactID } = setup();

    await pactID.registerParticipant({ id: "i1", role: "issuer", displayName: "I" });
    await pactID.registerParticipant({ id: "w1", role: "worker", displayName: "W" });

    await pactID.issueCredential("i1", "w1", "mission.execute", undefined, Date.now() - 1000);

    const has = await pactID.checkCapability("w1", "mission.execute");
    expect(has).toBe(false);
  });

  test("lists credentials for a subject", async () => {
    const { pactID } = setup();

    await pactID.registerParticipant({ id: "i1", role: "issuer", displayName: "I" });
    await pactID.registerParticipant({ id: "w1", role: "worker", displayName: "W" });

    await pactID.issueCredential("i1", "w1", "skill.a");
    await pactID.issueCredential("i1", "w1", "skill.b");

    const creds = await pactID.getCredentials("w1");
    expect(creds).toHaveLength(2);
  });
});
