import { describe, expect, it } from "bun:test";
import { createContainer } from "../src/application/container";

describe("Mission compensation integration", () => {
  it("creates mission with mixed compensation model", async () => {
    const container = createContainer();

    await container.pactID.registerParticipant({
      id: "issuer-1",
      role: "issuer",
      displayName: "Issuer",
      skills: [],
      location: { latitude: 0, longitude: 0 },
    });

    await container.pactID.registerParticipant({
      id: "agent-1",
      role: "agent",
      displayName: "Agent",
      skills: ["classification"],
      location: { latitude: 0, longitude: 0 },
    });

    const mission = await container.pactMissions.createMission({
      issuerId: "issuer-1",
      title: "Classify receipts",
      budgetCents: 5000,
      context: {
        objective: "extract fields",
        constraints: ["hash outputs"],
        successCriteria: [">=98% precision"],
      },
      compensationModel: {
        mode: "multi_asset",
        legs: [
          {
            id: "usdc-leg",
            payerId: "issuer-1",
            payeeId: "agent-1",
            assetId: "usdc-mainnet",
            amount: 15,
            unit: "USDC",
          },
          {
            id: "token-leg",
            payerId: "issuer-1",
            payeeId: "agent-1",
            assetId: "llm-token-gpt5",
            amount: 150000,
            unit: "token",
          },
        ],
      },
    });

    expect(mission.compensationModel).toBeDefined();
    expect(mission.compensationModel?.legs.length).toBe(2);
  });

  it("rejects invalid compensation model", async () => {
    const container = createContainer();

    await container.pactID.registerParticipant({
      id: "issuer-1",
      role: "issuer",
      displayName: "Issuer",
      skills: [],
      location: { latitude: 0, longitude: 0 },
    });

    await container.pactID.registerParticipant({
      id: "agent-1",
      role: "agent",
      displayName: "Agent",
      skills: ["classification"],
      location: { latitude: 0, longitude: 0 },
    });

    await expect(
      container.pactMissions.createMission({
        issuerId: "issuer-1",
        title: "Broken model",
        budgetCents: 1000,
        context: {
          objective: "obj",
          constraints: [],
          successCriteria: [],
        },
        compensationModel: {
          mode: "single_asset",
          legs: [
            {
              id: "leg-1",
              payerId: "issuer-1",
              payeeId: "agent-1",
              assetId: "usdc-mainnet",
              amount: 10,
              unit: "USDC",
            },
            {
              id: "leg-2",
              payerId: "issuer-1",
              payeeId: "agent-1",
              assetId: "cloud-credit",
              amount: 1,
              unit: "credit",
            },
          ],
        },
      }),
    ).rejects.toThrow();
  });
});
