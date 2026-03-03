import { describe, expect, it } from "bun:test";
import { createContainer } from "../src/application/container";

describe("Heartbeat supervisor", () => {
  it("registers, executes, disables, enables, and re-executes heartbeat tasks", async () => {
    const container = createContainer();
    const base = Date.now();

    const task = await container.pactHeartbeat.registerTask({
      name: "mission-health-check",
      intervalMs: 1000,
      startAt: base + 10,
      payload: { kind: "health" },
    });

    const noRun = await container.pactHeartbeat.tick(base);
    expect(noRun.length).toBe(0);

    const firstRun = await container.pactHeartbeat.tick(base + 10);
    expect(firstRun.length).toBe(1);
    expect(firstRun[0]?.task.id).toBe(task.id);

    const disabled = await container.pactHeartbeat.disableTask(task.id);
    expect(disabled.enabled).toBeFalse();

    const disabledRun = await container.pactHeartbeat.tick(base + 5000);
    expect(disabledRun.length).toBe(0);

    const enabled = await container.pactHeartbeat.enableTask(task.id);
    expect(enabled.enabled).toBeTrue();

    const secondRun = await container.pactHeartbeat.tick(enabled.nextRunAt);
    expect(secondRun.length).toBe(1);
    expect(secondRun[0]?.task.lastRunAt).toBe(enabled.nextRunAt);

    const events = await container.eventJournal.replay();
    const names = events.map((record) => record.event.name);
    expect(names).toContain("heartbeat.task_registered");
    expect(names).toContain("heartbeat.task_disabled");
    expect(names).toContain("heartbeat.task_enabled");
    expect(names).toContain("heartbeat.task_executed");
  });
});
