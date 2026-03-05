import { describe, expect, it } from "bun:test";
import type { IdentitySBTContractClient } from "../src/application/contracts";
import { PactID } from "../src/application/modules/pact-id";
import {
  decodeFunctionResult,
  encodeFunction,
  functionSelectorFromSignature,
} from "../src/blockchain/abi-encoder";
import { EvmIdentitySBTContractClient } from "../src/blockchain/evm-gateway";
import { createApp } from "../src/api/app";
import { InMemoryCredentialIssuer } from "../src/infrastructure/identity/in-memory-credential-issuer";
import { InMemoryCredentialRepository } from "../src/infrastructure/identity/in-memory-credential-repository";
import { InMemoryDIDRepository } from "../src/infrastructure/identity/in-memory-did-repository";
import { InMemoryParticipantStatsRepository } from "../src/infrastructure/identity/in-memory-participant-stats-repository";
import { MockRpcProvider } from "../src/infrastructure/blockchain/mock-rpc-provider";
import { InMemoryParticipantRepository } from "../src/infrastructure/repositories/in-memory-participant-repository";
import { InMemoryReputationRepository } from "../src/infrastructure/repositories/in-memory-reputation-repository";
import { InMemoryWorkerRepository } from "../src/infrastructure/repositories/in-memory-worker-repository";
import { InMemoryReputationService } from "../src/infrastructure/reputation/in-memory-reputation-service";
import type { ParticipantStats } from "../src/domain/types";

const IDENTITY_SBT_ADDRESS = "0x2222222222222222222222222222222222222222";

interface PactIdDeps {
  participantRepository: InMemoryParticipantRepository;
  workerRepository: InMemoryWorkerRepository;
  reputationService: InMemoryReputationService;
  didRepository: InMemoryDIDRepository;
  credentialIssuer: InMemoryCredentialIssuer;
  credentialRepository: InMemoryCredentialRepository;
  participantStatsRepository: InMemoryParticipantStatsRepository;
}

function createDeps(): PactIdDeps {
  const reputationRepository = new InMemoryReputationRepository();
  return {
    participantRepository: new InMemoryParticipantRepository(),
    workerRepository: new InMemoryWorkerRepository(),
    reputationService: new InMemoryReputationService(reputationRepository),
    didRepository: new InMemoryDIDRepository(),
    credentialIssuer: new InMemoryCredentialIssuer("id-sbt-bridge-test-secret"),
    credentialRepository: new InMemoryCredentialRepository(),
    participantStatsRepository: new InMemoryParticipantStatsRepository(),
  };
}

function createPactId(
  deps: PactIdDeps,
  identityClient?: IdentitySBTContractClient,
): {
  pactID: PactID;
  participantStatsRepository: InMemoryParticipantStatsRepository;
} {
  return {
    pactID: new PactID(
      deps.participantRepository,
      deps.workerRepository,
      deps.reputationService,
      deps.didRepository,
      deps.credentialIssuer,
      deps.credentialRepository,
      deps.participantStatsRepository,
      identityClient,
    ),
    participantStatsRepository: deps.participantStatsRepository,
  };
}

function createBridgeClient(): {
  rpc: MockRpcProvider;
  client: EvmIdentitySBTContractClient;
} {
  const rpc = new MockRpcProvider();
  let txCounter = 0;
  rpc.setMethodResponse("eth_sendRawTransaction", () => {
    txCounter += 1;
    return `0xtx-${txCounter}`;
  });
  const client = new EvmIdentitySBTContractClient({
    rpcUrl: "http://localhost:8545",
    contractAddress: IDENTITY_SBT_ADDRESS,
    rpcProvider: rpc,
  });
  return { rpc, client };
}

function decodeRawTxPayload(rawTx: unknown): { to: string; data: string } {
  if (typeof rawTx !== "string") {
    throw new Error(`Expected raw transaction as hex string, received ${typeof rawTx}`);
  }
  return JSON.parse(Buffer.from(rawTx.slice(2), "hex").toString("utf8")) as {
    to: string;
    data: string;
  };
}

function encodeIdentityCallResult(role: string, level: number, registeredAt: number): string {
  const encoded = encodeFunction("identityResult", ["string", "uint256", "uint256"], [
    role,
    BigInt(level),
    BigInt(registeredAt),
  ]);
  return `0x${encoded.slice(10)}`;
}

function buildStats(
  participantId: string,
  overrides: Partial<ParticipantStats> = {},
): ParticipantStats {
  return {
    participantId,
    taskCount: 0,
    completedTaskCount: 0,
    reputation: 0,
    hasZKProofOfHumanity: false,
    hasPhoneVerification: false,
    hasIdVerification: false,
    ...overrides,
  };
}

describe("Identity SBT bridge", () => {
  it("EvmIdentitySBTContractClient.mint sends mint calldata and returns token id", async () => {
    const { rpc, client } = createBridgeClient();
    const tokenId = await client.mint("worker-alpha", "worker-alpha", "worker", 0);

    expect(typeof tokenId).toBe("bigint");

    const sendCalls = rpc.getCalls("eth_sendRawTransaction");
    expect(sendCalls.length).toBe(1);

    const payload = decodeRawTxPayload(sendCalls[0]?.params[0]);
    expect(payload.to).toBe(IDENTITY_SBT_ADDRESS);
    expect(payload.data.slice(0, 10)).toBe(
      functionSelectorFromSignature("mint(address,uint256,string,uint8)"),
    );

    const [to, participantTokenId, role, level] = decodeFunctionResult(
      ["address", "uint256", "string", "uint256"],
      `0x${payload.data.slice(10)}`,
    );
    expect(String(to)).toMatch(/^0x[0-9a-f]{40}$/);
    expect(participantTokenId).toBe(tokenId);
    expect(role).toBe("worker");
    expect(level).toBe(0n);
  });

  it("EvmIdentitySBTContractClient.getIdentity decodes eth_call payload", async () => {
    const { rpc, client } = createBridgeClient();
    rpc.setMethodResponse("eth_call", encodeIdentityCallResult("worker", 2, 1_700_000_123));

    const identity = await client.getIdentity(7n);
    expect(identity).toEqual({
      role: "worker",
      level: 2,
      registeredAt: 1_700_000_123,
    });

    const call = rpc.getCalls("eth_call")[0];
    expect(call?.params[0]).toEqual({
      to: IDENTITY_SBT_ADDRESS,
      data: encodeFunction("getIdentity", ["uint256"], [7n]),
    });
    expect(call?.params[1]).toBe("latest");
  });

  it("EvmIdentitySBTContractClient.getIdentity returns undefined for empty identity tuple", async () => {
    const { rpc, client } = createBridgeClient();
    rpc.setMethodResponse("eth_call", encodeIdentityCallResult("", 0, 0));

    const identity = await client.getIdentity(99n);
    expect(identity).toBeUndefined();
  });

  it("PactID registerParticipant mints SBT and getOnchainIdentity reads it", async () => {
    const deps = createDeps();
    const { rpc, client } = createBridgeClient();
    const { pactID } = createPactId(deps, client);

    await pactID.registerParticipant({
      id: "worker-1",
      role: "worker",
      displayName: "Worker One",
    });
    rpc.setMethodResponse("eth_call", encodeIdentityCallResult("worker", 0, 1_700_000_001));

    const onchain = await pactID.getOnchainIdentity("worker-1");
    expect(onchain).toBeDefined();
    if (!onchain) {
      throw new Error("Expected onchain identity for worker-1");
    }
    expect(onchain.participantId).toBe("worker-1");
    expect(onchain.tokenId).toMatch(/^\d+$/);
    expect(onchain.role).toBe("worker");
    expect(onchain.level).toBe(0);
    expect(onchain.registeredAt).toBe(1_700_000_001);

    const sendCalls = rpc.getCalls("eth_sendRawTransaction");
    expect(sendCalls.length).toBe(1);
    const payload = decodeRawTxPayload(sendCalls[0]?.params[0]);
    expect(payload.data.slice(0, 10)).toBe(
      functionSelectorFromSignature("mint(address,uint256,string,uint8)"),
    );
  });

  it("PactID upgradeIdentityLevel calls onchain upgradeLevel when SBT exists", async () => {
    const deps = createDeps();
    const { rpc, client } = createBridgeClient();
    const { pactID, participantStatsRepository } = createPactId(deps, client);

    await pactID.registerParticipant({
      id: "worker-2",
      role: "worker",
      displayName: "Worker Two",
    });
    await participantStatsRepository.save(
      buildStats("worker-2", {
        hasPhoneVerification: true,
        hasIdVerification: true,
      }),
    );

    const result = await pactID.upgradeIdentityLevel("worker-2");
    expect(result.newLevel).toBe("verified");

    const sendCalls = rpc.getCalls("eth_sendRawTransaction");
    expect(sendCalls.length).toBe(2);

    const upgradePayload = decodeRawTxPayload(sendCalls[1]?.params[0]);
    expect(upgradePayload.data.slice(0, 10)).toBe(
      functionSelectorFromSignature("upgradeLevel(uint256,uint8)"),
    );

    const [, level] = decodeFunctionResult(
      ["uint256", "uint256"],
      `0x${upgradePayload.data.slice(10)}`,
    );
    expect(level).toBe(1n);
  });

  it("PactID.syncOnchainIdentity mints for existing participant when token is missing", async () => {
    const deps = createDeps();
    const { pactID: withoutBridge } = createPactId(deps);
    await withoutBridge.registerParticipant({
      id: "worker-3",
      role: "worker",
      displayName: "Worker Three",
    });

    const { rpc, client } = createBridgeClient();
    const { pactID: withBridge } = createPactId(deps, client);
    rpc.setMethodResponse("eth_call", encodeIdentityCallResult("worker", 0, 1_700_000_333));

    const synced = await withBridge.syncOnchainIdentity("worker-3");
    expect(synced).toBeDefined();
    if (!synced) {
      throw new Error("Expected synced onchain identity for worker-3");
    }
    expect(synced.participantId).toBe("worker-3");
    expect(synced.tokenId).toMatch(/^\d+$/);
    expect(synced.role).toBe("worker");
    expect(synced.level).toBe(0);
    expect(synced.registeredAt).toBe(1_700_000_333);

    const sendCalls = rpc.getCalls("eth_sendRawTransaction");
    expect(sendCalls.length).toBe(1);
    const payload = decodeRawTxPayload(sendCalls[0]?.params[0]);
    expect(payload.data.slice(0, 10)).toBe(
      functionSelectorFromSignature("mint(address,uint256,string,uint8)"),
    );
  });

  it("API exposes onchain routes and returns null when bridge is not configured", async () => {
    const app = createApp();

    const create = await app.request("/id/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "agent-onchain-routes",
        role: "agent",
        displayName: "Agent Onchain",
      }),
    });
    expect(create.status).toBe(201);

    const read = await app.request("/id/onchain/agent-onchain-routes");
    expect(read.status).toBe(200);
    expect(await read.json()).toBeNull();

    const sync = await app.request("/id/onchain/agent-onchain-routes/sync", { method: "POST" });
    expect(sync.status).toBe(200);
    expect(await sync.json()).toBeNull();
  });
});
