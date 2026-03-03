import { describe, expect, it } from "bun:test";
import { InMemoryReputationRepository } from "../src/infrastructure/repositories/in-memory-reputation-repository";
import { InMemoryReputationService } from "../src/infrastructure/reputation/in-memory-reputation-service";

describe("Reputation score", () => {
  it("clamps scores to 0-100", async () => {
    const repo = new InMemoryReputationRepository();
    const service = new InMemoryReputationService(repo);

    await service.setScore("worker-1", "worker", 130);
    await service.adjustScore("worker-1", "worker", -200);

    expect(await service.getScore("worker-1")).toBe(0);
  });
});
