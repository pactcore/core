import type { AdapterDurability } from "../../application/adapter-runtime";
import {
  summarizeManagedBackendProfile,
  type ManagedBackendDomain,
  type ManagedBackendHealthReport,
  type ManagedBackendProfile,
  type ManagedBackendQueueAdapter,
  type ManagedQueueDepth,
  type ManagedQueueMessage,
  type ManagedQueueReceipt,
} from "../../application/managed-backends";

export interface RemoteHttpManagedQueueAdapterSkeletonOptions {
  domain: ManagedBackendDomain;
  profile: ManagedBackendProfile;
}

export class RemoteHttpManagedQueueAdapterSkeleton<TPayload = unknown>
  implements ManagedBackendQueueAdapter<TPayload>
{
  readonly capability = "queue" as const;
  readonly mode = "remote" as const;
  readonly durability: AdapterDurability = "remote";
  readonly domain: ManagedBackendDomain;

  private readonly profile: ManagedBackendProfile;
  private readonly queued = new Map<string, ManagedQueueMessage<TPayload>>();

  constructor(options: RemoteHttpManagedQueueAdapterSkeletonOptions) {
    this.domain = options.domain;
    this.profile = {
      ...options.profile,
      configuredCredentialFields: [...(options.profile.configuredCredentialFields ?? [])],
      metadata: options.profile.metadata ? { ...options.profile.metadata } : undefined,
    };
  }

  async enqueue(message: ManagedQueueMessage<TPayload>): Promise<ManagedQueueReceipt> {
    this.queued.set(message.id, cloneMessage(message));

    return {
      messageId: message.id,
      backendMessageId: `${this.profile.backendId}:${message.id}`,
      acceptedAt: Date.now(),
      state: message.runAt !== undefined && message.runAt > Date.now() ? "scheduled" : "queued",
      metadata: {
        providerId: this.profile.providerId,
        skeleton: "true",
      },
    };
  }

  getDepth(): ManagedQueueDepth {
    let scheduled = 0;
    const now = Date.now();

    for (const message of this.queued.values()) {
      if (message.runAt !== undefined && message.runAt > now) {
        scheduled += 1;
      }
    }

    return {
      available: this.queued.size,
      scheduled,
    };
  }

  getManagedHealth(): ManagedBackendHealthReport {
    const requiredFields = (this.profile.credentialSchema?.fields ?? [])
      .filter((field) => field.required)
      .map((field) => field.key);
    const configuredFields = new Set(this.profile.configuredCredentialFields ?? []);
    const missingFields = requiredFields.filter((field) => !configuredFields.has(field));
    const state = this.profile.endpoint && missingFields.length === 0 ? "healthy" : "degraded";

    return {
      name: `${this.domain}-remote-queue-backend`,
      domain: this.domain,
      capability: "queue",
      mode: "remote",
      state,
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        managedQueue: true,
        skeleton: true,
        queuedMessages: this.queued.size,
        scheduledMessages: this.getDepth().scheduled ?? 0,
      },
      profile: summarizeManagedBackendProfile(this.profile),
      lastError: missingFields.length > 0
        ? {
            adapter: this.domain,
            operation: "configure_remote_queue",
            code: "managed_backend_credentials_incomplete",
            message: `Missing credential fields: ${missingFields.join(", ")}`,
            retryable: false,
            occurredAt: Date.now(),
            details: {
              missingFields: missingFields.join(","),
            },
          }
        : undefined,
    };
  }
}

function cloneMessage<TPayload>(message: ManagedQueueMessage<TPayload>): ManagedQueueMessage<TPayload> {
  return {
    ...message,
    metadata: message.metadata ? { ...message.metadata } : undefined,
  };
}
