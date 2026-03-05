import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import { createContainer } from "../src/application/container";
import {
  EcosystemModule,
  assessEcosystemHealth,
  calculateCrossAppSynergy,
  getModuleDependencies,
} from "../src/domain/ecosystem";

describe("ecosystem dependency graph", () => {
  it("returns the module dependency graph", () => {
    const graph = getModuleDependencies();

    expect(graph[EcosystemModule.Tasks]).toContain(EcosystemModule.ID);
    expect(graph[EcosystemModule.Tasks]).toContain(EcosystemModule.Pay);
    expect(graph[EcosystemModule.Dev]).toContain(EcosystemModule.Tasks);
    expect(graph[EcosystemModule.ID]).toEqual([]);
  });

  it("returns dependencies for a specific module", () => {
    const devDependencies = getModuleDependencies(EcosystemModule.Dev);
    expect(devDependencies).toContain(EcosystemModule.Compute);
    expect(devDependencies).toContain(EcosystemModule.Data);
  });
});

describe("ecosystem health assessment", () => {
  it("marks the ecosystem healthy for strong module metrics", () => {
    const health = assessEcosystemHealth({
      [EcosystemModule.Tasks]: {
        availability: 0.99,
        errorRate: 0.01,
        latencyMs: 150,
        throughput: 800,
        activeUsers: 250,
      },
      [EcosystemModule.Pay]: {
        availability: 0.98,
        errorRate: 0.01,
        latencyMs: 180,
        throughput: 650,
        activeUsers: 210,
      },
      [EcosystemModule.ID]: {
        availability: 0.995,
        errorRate: 0.002,
        latencyMs: 95,
        throughput: 900,
        activeUsers: 320,
      },
      [EcosystemModule.Data]: {
        availability: 0.96,
        errorRate: 0.02,
        latencyMs: 260,
        throughput: 520,
        activeUsers: 190,
      },
      [EcosystemModule.Compute]: {
        availability: 0.97,
        errorRate: 0.01,
        latencyMs: 240,
        throughput: 480,
        activeUsers: 170,
      },
      [EcosystemModule.Dev]: {
        availability: 0.95,
        errorRate: 0.03,
        latencyMs: 280,
        throughput: 420,
        activeUsers: 140,
      },
    });

    expect(health.status).toBe("healthy");
    expect(health.healthyModules).toBe(6);
    expect(health.score).toBeGreaterThan(80);
  });

  it("applies dependency pressure when an upstream module degrades", () => {
    const health = assessEcosystemHealth({
      [EcosystemModule.Tasks]: {
        availability: 0.95,
        errorRate: 0.02,
        latencyMs: 240,
        throughput: 300,
        activeUsers: 130,
      },
      [EcosystemModule.Pay]: {
        availability: 0.92,
        errorRate: 0.05,
        latencyMs: 340,
        throughput: 210,
        activeUsers: 110,
      },
      [EcosystemModule.ID]: {
        availability: 0.25,
        errorRate: 0.7,
        latencyMs: 4_000,
        throughput: 50,
        activeUsers: 10,
      },
      [EcosystemModule.Data]: {
        availability: 0.93,
        errorRate: 0.04,
        latencyMs: 320,
        throughput: 160,
        activeUsers: 70,
      },
      [EcosystemModule.Compute]: {
        availability: 0.9,
        errorRate: 0.06,
        latencyMs: 460,
        throughput: 140,
        activeUsers: 65,
      },
      [EcosystemModule.Dev]: {
        availability: 0.9,
        errorRate: 0.05,
        latencyMs: 350,
        throughput: 120,
        activeUsers: 55,
      },
    });

    expect(health.dependencyRisk).toBeGreaterThan(0);
    expect(health.modules[EcosystemModule.Tasks].dependencyIssues).toContain(EcosystemModule.ID);
    expect(health.modules[EcosystemModule.Pay].dependencyIssues).toContain(EcosystemModule.ID);
  });
});

describe("cross-app synergy", () => {
  it("returns neutral metrics for empty activity", () => {
    const synergy = calculateCrossAppSynergy([]);
    expect(synergy.synergyScore).toBe(0);
    expect(synergy.amplificationFactor).toBe(1);
    expect(synergy.activeUsers).toBe(0);
  });

  it("increases synergy for broader multi-module usage", () => {
    const narrow = calculateCrossAppSynergy([
      { userId: "u1", module: EcosystemModule.ID },
      { userId: "u2", module: EcosystemModule.ID },
      { userId: "u3", module: EcosystemModule.Tasks },
    ]);
    const broad = calculateCrossAppSynergy([
      { userId: "u1", module: EcosystemModule.ID },
      { userId: "u1", module: EcosystemModule.Tasks },
      { userId: "u1", module: EcosystemModule.Pay },
      { userId: "u1", module: EcosystemModule.Data },
      { userId: "u2", module: EcosystemModule.ID },
      { userId: "u2", module: EcosystemModule.Compute },
      { userId: "u2", module: EcosystemModule.Dev },
      { userId: "u3", module: EcosystemModule.ID },
      { userId: "u3", module: EcosystemModule.Tasks },
      { userId: "u3", module: EcosystemModule.Pay },
    ]);

    expect(broad.synergyScore).toBeGreaterThan(narrow.synergyScore);
    expect(broad.amplificationFactor).toBeGreaterThan(narrow.amplificationFactor);
    expect(broad.averageAppsPerUser).toBeGreaterThan(narrow.averageAppsPerUser);
  });
});

describe("PactEcosystem module + API", () => {
  it("aggregates ecosystem status and synergy from live modules", async () => {
    const container = createContainer();

    await container.pactID.registerParticipant({
      id: "issuer-eco",
      role: "issuer",
      displayName: "Issuer Eco",
      skills: ["coordination"],
    });
    await container.pactID.registerParticipant({
      id: "worker-eco",
      role: "worker",
      displayName: "Worker Eco",
      skills: ["vision"],
      capacity: 2,
    });

    const task = await container.pactTasks.createTask({
      title: "Ecosystem Task",
      description: "Cross-module task",
      issuerId: "issuer-eco",
      paymentCents: 500,
      location: { latitude: 0, longitude: 0 },
      constraints: {
        requiredSkills: ["vision"],
        maxDistanceKm: 10,
        minReputation: 0,
        capacityRequired: 1,
      },
    });
    await container.pactTasks.assignTask(task.id, "worker-eco");
    await container.pactTasks.submitEvidence(task.id, {
      summary: "evidence",
      artifactUris: ["ipfs://artifact"],
      submittedAt: Date.now(),
      validation: {
        autoAIScore: 0.95,
        agentVotes: [],
        humanVotes: [],
      },
    });

    await container.pactPay.routePayment(
      "issuer-eco",
      "worker-eco",
      250,
      "USD_CENTS",
      "ecosystem-flow",
    );

    await container.pactCompute.registerProvider({
      id: "provider-eco",
      name: "Provider Eco",
      capabilities: {
        cpuCores: 4,
        memoryMB: 8_192,
        gpuCount: 0,
      },
      pricePerCpuSecondCents: 1,
      pricePerGpuSecondCents: 2,
      pricePerMemoryMBHourCents: 1,
      status: "available",
      registeredAt: Date.now(),
    });

    await container.pactData.publish({
      ownerId: "issuer-eco",
      title: "Data Asset",
      uri: "ipfs://ecosystem-data",
      tags: ["dataset"],
    });

    await container.pactDev.register({
      ownerId: "issuer-eco",
      name: "Dev Integration",
      webhookUrl: "https://example.com/hook",
    });

    const status = await container.pactEcosystem.getEcosystemStatus();
    const synergy = await container.pactEcosystem.getCrossAppMetrics();

    expect(status.modules[EcosystemModule.ID].activeUsers).toBeGreaterThanOrEqual(2);
    expect(status.modules[EcosystemModule.Tasks].throughput).toBeGreaterThanOrEqual(1);
    expect(synergy.activeUsers).toBeGreaterThanOrEqual(2);
    expect(synergy.participatingModules).toContain(EcosystemModule.Tasks);
    expect(synergy.participatingModules).toContain(EcosystemModule.Pay);
    expect(synergy.participatingModules).toContain(EcosystemModule.ID);
  });

  it("exposes ecosystem routes", async () => {
    const app = createApp();

    const statusResponse = await app.request("/ecosystem/status");
    expect(statusResponse.status).toBe(200);
    const statusBody = (await statusResponse.json()) as {
      score: number;
      status: string;
      modules: Record<string, unknown>;
    };
    expect(statusBody.score).toBeGreaterThanOrEqual(0);
    expect(typeof statusBody.status).toBe("string");
    expect(typeof statusBody.modules).toBe("object");

    const modulesResponse = await app.request("/ecosystem/modules");
    expect(modulesResponse.status).toBe(200);
    const modulesBody = (await modulesResponse.json()) as Record<string, unknown>;
    expect(Object.keys(modulesBody).length).toBe(6);
    expect(Array.isArray(modulesBody[EcosystemModule.Tasks])).toBeTrue();

    const synergyResponse = await app.request("/ecosystem/synergy");
    expect(synergyResponse.status).toBe(200);
    const synergyBody = (await synergyResponse.json()) as {
      synergyScore: number;
      sevenAppModel: { appCount: number };
    };
    expect(synergyBody.synergyScore).toBeGreaterThanOrEqual(0);
    expect(synergyBody.sevenAppModel.appCount).toBe(7);
  });
});
