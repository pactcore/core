import {
  type ManagedBackendDomain,
  type ManagedBackendHealthReport,
  type ManagedBackendProfile,
  type ManagedBackendQueueAdapter,
  type ManagedQueueDepth,
  type ManagedQueueMessage,
  type ManagedQueueReceipt,
} from "../../application/managed-backends";
import {
  cloneManagedBackendProfile,
  createRemoteManagedBackendHealth,
  REMOTE_MANAGED_BACKEND_DURABILITY,
} from "./remote-http-managed-backend-skeleton-helpers";

export interface RemoteHttpManagedQueueAdapterSkeletonOptions {
  domain: ManagedBackendDomain;
  profile: ManagedBackendProfile;
}

export class RemoteHttpManagedQueueAdapterSkeleton<TPayload = unknown>
  implements ManagedBackendQueueAdapter<TPayload>
{
  readonly capability = "queue" as const;
  readonly mode = "remote" as const;
  readonly durability = REMOTE_MANAGED_BACKEND_DURABILITY;
  readonly domain: ManagedBackendDomain;

  private readonly profile: ManagedBackendProfile;
  private readonly queued = new Map<string, ManagedQueueMessage<TPayload>>();

  constructor(options: RemoteHttpManagedQueueAdapterSkeletonOptions) {
    this.domain = options.domain;
    this.profile = cloneManagedBackendProfile(options.profile);
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
    return createRemoteManagedBackendHealth({
      domain: this.domain,
      capability: "queue",
      profile: this.profile,
      missingFieldsOperation: "configure_remote_queue",
      features: {
        managedQueue: true,
        queuedMessages: this.queued.size,
        scheduledMessages: this.getDepth().scheduled ?? 0,
      },
    });
  }
}

function cloneMessage<TPayload>(message: ManagedQueueMessage<TPayload>): ManagedQueueMessage<TPayload> {
  return {
    ...message,
    metadata: message.metadata ? { ...message.metadata } : undefined,
  };
}
