import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";

interface TaskResponse {
  id: string;
  status: string;
}

interface LedgerRow {
  to: string;
  amountCents: number;
}

describe("API + event orchestration", () => {
  it("completes full task flow through events", async () => {
    const app = createApp({
      autoAI: { enabled: true, passThreshold: 0.8 },
      agentValidators: { enabled: true, passThreshold: 0.66, requiredParticipants: 3 },
      humanJury: { enabled: true, passThreshold: 0.6, requiredParticipants: 5 },
    });

    await app.request("/id/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "issuer-1",
        role: "issuer",
        displayName: "Issuer",
        location: { latitude: 37.7749, longitude: -122.4194 },
      }),
    });

    await app.request("/id/participants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "worker-1",
        role: "worker",
        displayName: "Worker",
        skills: ["photo", "gps"],
        capacity: 2,
        initialReputation: 92,
        location: { latitude: 37.775, longitude: -122.4195 },
      }),
    });

    const createTaskResp = await app.request("/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Storefront check",
        description: "Take timestamped storefront photos",
        issuerId: "issuer-1",
        paymentCents: 10000,
        location: { latitude: 37.7749, longitude: -122.4194 },
        constraints: {
          requiredSkills: ["photo", "gps"],
          maxDistanceKm: 10,
          minReputation: 70,
          capacityRequired: 1,
        },
      }),
    });

    expect(createTaskResp.status).toBe(201);
    const task = (await createTaskResp.json()) as TaskResponse;

    const assignResp = await app.request(`/tasks/${task.id}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: "worker-1" }),
    });
    expect(assignResp.status).toBe(200);

    const submitResp = await app.request(`/tasks/${task.id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summary: "All requested photos uploaded",
        artifactUris: ["ipfs://artifact-1"],
        validation: {
          autoAIScore: 0.4,
          agentVotes: [
            { participantId: "validator-1", approve: true },
            { participantId: "validator-2", approve: true },
            { participantId: "validator-3", approve: false },
          ],
          humanVotes: [],
        },
      }),
    });

    expect(submitResp.status).toBe(200);
    const finalTask = (await submitResp.json()) as TaskResponse;
    expect(finalTask.status).toBe("Completed");

    const ledgerResp = await app.request("/payments/ledger");
    const ledger = (await ledgerResp.json()) as LedgerRow[];

    const total = ledger.reduce((sum: number, row) => sum + row.amountCents, 0);
    expect(total).toBe(10000);

    const workerPayout = ledger.find((row) => row.to === "worker-1");
    expect(workerPayout?.amountCents).toBe(8500);
  });
});
