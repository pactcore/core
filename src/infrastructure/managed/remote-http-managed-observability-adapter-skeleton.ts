import type {
  ManagedBackendDomain,
  ManagedBackendHealthReport,
  ManagedBackendObservabilityAdapter,
  ManagedBackendProfile,
  ManagedMetricRecord,
  ManagedTraceRecord,
} from "../../application/managed-backends";
import {
  cloneManagedBackendProfile,
  createRemoteManagedBackendHealth,
  REMOTE_MANAGED_BACKEND_DURABILITY,
} from "./remote-http-managed-backend-skeleton-helpers";

export interface RemoteHttpManagedObservabilityAdapterSkeletonOptions {
  domain: ManagedBackendDomain;
  profile: ManagedBackendProfile;
}

export class RemoteHttpManagedObservabilityAdapterSkeleton
  implements ManagedBackendObservabilityAdapter
{
  readonly capability = "observability" as const;
  readonly mode = "remote" as const;
  readonly durability = REMOTE_MANAGED_BACKEND_DURABILITY;
  readonly domain: ManagedBackendDomain;

  private readonly profile: ManagedBackendProfile;
  private readonly metrics: ManagedMetricRecord[] = [];
  private readonly traces: ManagedTraceRecord[] = [];
  private lastFlushedAt: number | "never" = "never";

  constructor(options: RemoteHttpManagedObservabilityAdapterSkeletonOptions) {
    this.domain = options.domain;
    this.profile = cloneManagedBackendProfile(options.profile);
  }

  async recordMetric(record: ManagedMetricRecord): Promise<void> {
    this.metrics.push(cloneMetricRecord(record));
  }

  async recordTrace(record: ManagedTraceRecord): Promise<void> {
    this.traces.push(cloneTraceRecord(record));
  }

  async flush(): Promise<void> {
    this.lastFlushedAt = Date.now();
  }

  getManagedHealth(): ManagedBackendHealthReport {
    return createRemoteManagedBackendHealth({
      domain: this.domain,
      capability: "observability",
      profile: this.profile,
      missingFieldsOperation: "configure_remote_observability",
      features: {
        managedObservability: true,
        bufferedMetrics: this.metrics.length,
        bufferedTraces: this.traces.length,
        lastFlushedAt: this.lastFlushedAt,
      },
    });
  }
}

function cloneMetricRecord(record: ManagedMetricRecord): ManagedMetricRecord {
  return {
    ...record,
    labels: record.labels ? { ...record.labels } : undefined,
  };
}

function cloneTraceRecord(record: ManagedTraceRecord): ManagedTraceRecord {
  return {
    ...record,
    attributes: record.attributes ? { ...record.attributes } : undefined,
  };
}
