import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ComputeExecutionAdapter, ScheduledJob } from "../../application/contracts";
import { generateId } from "../../application/utils";
import type { ComputeJobResult, ComputeProvider, ComputeUsageRecord } from "../../domain/types";

export interface DockerExecutionAdapterOptions {
  dockerBinary?: string;
  timeout?: number;
}

interface ProcessCompletion {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class DockerExecutionAdapter implements ComputeExecutionAdapter {
  private readonly dockerBinary: string;
  private readonly timeout: number;

  constructor(options: DockerExecutionAdapterOptions = {}) {
    this.dockerBinary = options.dockerBinary ?? "docker";
    this.timeout = options.timeout ?? 60_000;
  }

  async execute(job: ScheduledJob, provider: ComputeProvider): Promise<ComputeJobResult> {
    const startedAt = Date.now();

    const payload = isObject(job.payload) ? job.payload : {};
    const image = typeof payload.image === "string" ? payload.image : undefined;
    const command = typeof payload.command === "string" ? payload.command : undefined;
    const metadata = isObject(payload.metadata) ? payload.metadata : undefined;

    if (!image || !command) {
      return this.createFailedResult(
        job.id,
        provider,
        0,
        "Compute job payload must include image and command strings",
      );
    }

    const args = this.buildDockerArgs(image, command, provider, metadata);
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let timedOut = false;

    try {
      const child = this.spawnProcess(args);

      child.stdout.on("data", (chunk) => {
        stdoutChunks.push(String(chunk));
      });
      child.stderr.on("data", (chunk) => {
        stderrChunks.push(String(chunk));
      });

      const completion = await this.waitForCompletion(child, () => {
        timedOut = true;
      });

      const durationSeconds = Math.max(0, (Date.now() - startedAt) / 1_000);
      const usage = this.createUsage(job.id, provider, durationSeconds);
      const stdout = stdoutChunks.join("").trim();
      const stderr = stderrChunks.join("").trim();

      if (timedOut) {
        return {
          jobId: job.id,
          providerId: provider.id,
          status: "failed",
          error: `Docker execution timed out after ${this.timeout}ms`,
          usage,
          completedAt: Date.now(),
        };
      }

      if (completion.code === 0) {
        return {
          jobId: job.id,
          providerId: provider.id,
          status: "completed",
          output: stdout,
          usage,
          completedAt: Date.now(),
        };
      }

      const suffix = stderr ? `: ${stderr}` : "";
      const signalSuffix = completion.signal ? ` (signal: ${completion.signal})` : "";
      return {
        jobId: job.id,
        providerId: provider.id,
        status: "failed",
        error: `Docker exited with code ${completion.code ?? "null"}${signalSuffix}${suffix}`,
        usage,
        completedAt: Date.now(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const unavailable = this.isDockerUnavailable(error);
      const durationSeconds = unavailable ? 0 : Math.max(0, (Date.now() - startedAt) / 1_000);
      const message = unavailable
        ? `Docker is not available (${this.dockerBinary})`
        : `Docker execution failed: ${errorMessage}`;
      return this.createFailedResult(job.id, provider, durationSeconds, message);
    }
  }

  protected spawnProcess(args: string[]): ChildProcessWithoutNullStreams {
    return spawn(this.dockerBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  private buildDockerArgs(
    image: string,
    command: string,
    provider: ComputeProvider,
    metadata?: Record<string, unknown>,
  ): string[] {
    const args = [
      "run",
      "--rm",
      "--cpus",
      String(Math.max(1, provider.capabilities.cpuCores)),
      "--memory",
      `${Math.max(1, provider.capabilities.memoryMB)}m`,
    ];

    if (provider.capabilities.gpuCount > 0) {
      args.push("--gpus", String(provider.capabilities.gpuCount));
    }

    if (metadata) {
      for (const [key, value] of Object.entries(metadata)) {
        if (typeof value !== "string") {
          continue;
        }
        args.push("-e", `${key}=${value}`);
      }
    }

    args.push(image, "sh", "-lc", command);
    return args;
  }

  private waitForCompletion(
    child: ChildProcessWithoutNullStreams,
    onTimeout: () => void,
  ): Promise<ProcessCompletion> {
    return new Promise<ProcessCompletion>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        onTimeout();
        child.kill("SIGKILL");
      }, this.timeout);

      child.once("error", (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });

      child.once("close", (code, signal) => {
        clearTimeout(timeoutHandle);
        resolve({
          code,
          signal,
        });
      });
    });
  }

  private createFailedResult(
    jobId: string,
    provider: ComputeProvider,
    durationSeconds: number,
    error: string,
  ): ComputeJobResult {
    return {
      jobId,
      providerId: provider.id,
      status: "failed",
      error,
      usage: this.createUsage(jobId, provider, durationSeconds),
      completedAt: Date.now(),
    };
  }

  private createUsage(
    jobId: string,
    provider: ComputeProvider,
    durationSeconds: number,
  ): ComputeUsageRecord {
    const safeDurationSeconds = Math.max(0, durationSeconds);
    const cpuSeconds = safeDurationSeconds * Math.max(1, provider.capabilities.cpuCores);
    const memoryMBHours = (provider.capabilities.memoryMB * safeDurationSeconds) / 3_600;
    const gpuCount = Math.max(0, provider.capabilities.gpuCount);
    const gpuSeconds = gpuCount > 0 ? safeDurationSeconds * gpuCount : 0;
    const totalCostCents = Math.round(
      cpuSeconds * provider.pricePerCpuSecondCents +
      memoryMBHours * provider.pricePerMemoryMBHourCents +
      gpuSeconds * provider.pricePerGpuSecondCents,
    );
    const recordedAt = Date.now();

    return {
      id: generateId("usage"),
      jobId,
      providerId: provider.id,
      cpuSeconds,
      memoryMBHours,
      gpuSeconds,
      totalCostCents,
      recordedAt,
    };
  }

  private isDockerUnavailable(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const withCode = error as NodeJS.ErrnoException;
    if (withCode.code === "ENOENT") {
      return true;
    }
    return error.message.toLowerCase().includes("not found");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
