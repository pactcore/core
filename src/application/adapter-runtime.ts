export type AdapterHealthState = "healthy" | "degraded" | "unhealthy";

export type AdapterDurability = "memory" | "filesystem" | "database" | "remote" | "unknown";

export interface AdapterErrorDescriptor {
  adapter: string;
  operation: string;
  code: string;
  message: string;
  retryable: boolean;
  occurredAt: number;
  details?: Record<string, string>;
}

export interface AdapterCompatibilityReport {
  compatible: boolean;
  currentVersion?: string;
  supportedVersions?: string[];
  reason?: string;
}

export interface AdapterHealthReport {
  name: string;
  state: AdapterHealthState;
  checkedAt: number;
  durable?: boolean;
  durability?: AdapterDurability;
  features?: Record<string, string | number | boolean>;
  compatibility?: AdapterCompatibilityReport;
  lastError?: AdapterErrorDescriptor;
}

export interface AdapterHealthSummary {
  status: AdapterHealthState;
  checkedAt: number;
  adapters: AdapterHealthReport[];
}

export interface AdapterOperationErrorOptions {
  adapter: string;
  operation: string;
  code: string;
  retryable: boolean;
  details?: Record<string, string>;
  occurredAt?: number;
  cause?: unknown;
}

export class AdapterOperationError extends Error {
  readonly adapter: string;
  readonly operation: string;
  readonly code: string;
  readonly retryable: boolean;
  readonly occurredAt: number;
  readonly details?: Record<string, string>;

  constructor(message: string, options: AdapterOperationErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AdapterOperationError";
    this.adapter = options.adapter;
    this.operation = options.operation;
    this.code = options.code;
    this.retryable = options.retryable;
    this.occurredAt = options.occurredAt ?? Date.now();
    this.details = options.details;
  }

  toDescriptor(): AdapterErrorDescriptor {
    return {
      adapter: this.adapter,
      operation: this.operation,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      occurredAt: this.occurredAt,
      details: this.details,
    };
  }
}

export class DataAdapterError extends AdapterOperationError {
  constructor(message: string, options: Omit<AdapterOperationErrorOptions, "adapter">) {
    super(message, {
      ...options,
      adapter: "data",
    });
    this.name = "DataAdapterError";
  }
}

export class ComputeAdapterError extends AdapterOperationError {
  constructor(message: string, options: Omit<AdapterOperationErrorOptions, "adapter">) {
    super(message, {
      ...options,
      adapter: "compute",
    });
    this.name = "ComputeAdapterError";
  }
}

export class DevAdapterError extends AdapterOperationError {
  constructor(message: string, options: Omit<AdapterOperationErrorOptions, "adapter">) {
    super(message, {
      ...options,
      adapter: "dev",
    });
    this.name = "DevAdapterError";
  }
}

export function aggregateAdapterHealth(adapters: AdapterHealthReport[]): AdapterHealthSummary {
  return {
    status: adapters.some((adapter) => adapter.state === "unhealthy")
      ? "unhealthy"
      : adapters.some((adapter) => adapter.state === "degraded")
        ? "degraded"
        : "healthy",
    checkedAt: Date.now(),
    adapters,
  };
}
