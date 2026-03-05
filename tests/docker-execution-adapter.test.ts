import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ScheduledJob } from "../src/application/contracts";
import type { ComputeProvider } from "../src/domain/types";
import { DockerExecutionAdapter } from "../src/infrastructure/compute/docker-execution-adapter";

class StubDockerExecutionAdapter extends DockerExecutionAdapter {
  constructor(
    private readonly processFactory: (args: string[]) => ChildProcessWithoutNullStreams,
  ) {
    super({ timeout: 500 });
  }

  protected override spawnProcess(args: string[]): ChildProcessWithoutNullStreams {
    return this.processFactory(args);
  }
}

interface FakeChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill(signal?: NodeJS.Signals): boolean;
}

function createFakeChild(
  behavior: (child: FakeChildProcess) => void,
): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as FakeChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;

  queueMicrotask(() => behavior(child));
  return child as unknown as ChildProcessWithoutNullStreams;
}

function makeProvider(): ComputeProvider {
  return {
    id: "provider-1",
    name: "docker-provider",
    capabilities: {
      cpuCores: 2,
      memoryMB: 4_096,
      gpuCount: 0,
    },
    pricePerCpuSecondCents: 1,
    pricePerGpuSecondCents: 5,
    pricePerMemoryMBHourCents: 0.001,
    status: "available",
    registeredAt: Date.now(),
  };
}

function makeJob(): ScheduledJob {
  return {
    id: "job-1",
    topic: "compute.exec",
    payload: {
      image: "alpine:latest",
      command: "echo hello",
    },
    runAt: Date.now(),
  };
}

describe("DockerExecutionAdapter", () => {
  test("returns ComputeJobResult for successful execution", async () => {
    const adapter = new StubDockerExecutionAdapter((_args) =>
      createFakeChild((child) => {
        child.stdout.emit("data", "hello\n");
        child.emit("close", 0, null);
      }),
    );

    const result = await adapter.execute(makeJob(), makeProvider());

    expect(result.jobId).toBe("job-1");
    expect(result.providerId).toBe("provider-1");
    expect(result.status).toBe("completed");
    expect(result.output).toBe("hello");
    expect(result.usage.jobId).toBe("job-1");
    expect(result.usage.providerId).toBe("provider-1");
    expect(result.completedAt).toBeNumber();
  });

  test("returns failed result when docker exits with non-zero code", async () => {
    const adapter = new StubDockerExecutionAdapter((_args) =>
      createFakeChild((child) => {
        child.stderr.emit("data", "runtime error");
        child.emit("close", 125, null);
      }),
    );

    const result = await adapter.execute(makeJob(), makeProvider());

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Docker exited with code 125");
    expect(result.error).toContain("runtime error");
    expect(result.usage.id).toMatch(/^usage_/);
  });

  test("falls back gracefully when Docker is unavailable", async () => {
    const adapter = new StubDockerExecutionAdapter((_args) =>
      createFakeChild((child) => {
        const error = Object.assign(new Error("spawn docker ENOENT"), {
          code: "ENOENT",
        });
        child.emit("error", error);
      }),
    );

    const result = await adapter.execute(makeJob(), makeProvider());

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Docker is not available");
    expect(result.usage.totalCostCents).toBe(0);
  });
});
