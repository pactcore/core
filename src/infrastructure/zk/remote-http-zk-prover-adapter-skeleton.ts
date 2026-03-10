import type { AdapterDurability } from "../../application/adapter-runtime";
import type { AdapterHealthReport } from "../../application/adapter-runtime";
import type { ExternalZKProverAdapter } from "../../application/contracts";
import type { ExternalZKProveRequest, ExternalZKVerifyRequest } from "../../domain/zk-bridge";
import { DeterministicLocalZKProverAdapter } from "./deterministic-local-zk-prover-adapter";
import {
  createRemoteZKProverConfigurationError,
  getConfiguredRemoteZKCredentialFields,
  getMissingRemoteZKCredentialFields,
  getRequiredRemoteZKCredentialFields,
  type RemoteHttpZKProverAdapterOptions,
} from "./remote-zk-prover-options";

export type RemoteHttpZKProverAdapterSkeletonOptions = RemoteHttpZKProverAdapterOptions;

export class RemoteHttpZKProverAdapterSkeleton implements ExternalZKProverAdapter {
  readonly durability: AdapterDurability = "remote";
  readonly adapterName: string;

  private readonly endpoint?: string;
  private readonly providerId?: string;
  private readonly configuredCredentialFields: string[];
  private readonly requiredCredentialFields: string[];
  private readonly deterministicFallback: DeterministicLocalZKProverAdapter;

  constructor(options: RemoteHttpZKProverAdapterSkeletonOptions = {}) {
    this.adapterName = options.adapterName ?? "remote-http-zk-prover-skeleton";
    this.endpoint = options.endpoint;
    this.providerId = options.providerId;
    this.configuredCredentialFields = getConfiguredRemoteZKCredentialFields(options);
    this.requiredCredentialFields = getRequiredRemoteZKCredentialFields(options);
    this.deterministicFallback = new DeterministicLocalZKProverAdapter({
      adapterName: `${this.adapterName}:fallback`,
    });
  }

  async loadArtifact(artifact: ExternalZKProveRequest["manifest"]["artifacts"][number]) {
    return this.deterministicFallback.loadArtifact?.(artifact);
  }

  async prove(request: ExternalZKProveRequest) {
    const response = await this.deterministicFallback.prove(request);

    return {
      ...response,
      adapterReceiptId: `${this.adapterName}:prove:${request.requestId}`,
      traceId: `${request.traceId}:remote-prove`,
    };
  }

  async verify(request: ExternalZKVerifyRequest) {
    const response = await this.deterministicFallback.verify(request);

    return {
      ...response,
      traceId: `${request.traceId}:remote-verify`,
      adapterReceiptId: `${this.adapterName}:verify:${request.proofId}`,
      details: {
        ...response.details,
        endpoint: this.endpoint ?? "unconfigured",
        providerId: this.providerId ?? "unknown",
        skeleton: "true",
      },
    };
  }

  getHealth(): AdapterHealthReport {
    const missingFields = getMissingRemoteZKCredentialFields({
      endpoint: this.endpoint,
      providerId: this.providerId,
      configuredCredentialFields: this.configuredCredentialFields,
      requiredCredentialFields: this.requiredCredentialFields,
    });
    const hasEndpoint = Boolean(this.endpoint);
    const state = hasEndpoint && missingFields.length === 0 ? "healthy" : "degraded";

    return {
      name: this.adapterName,
      state,
      checkedAt: Date.now(),
      durable: true,
      durability: this.durability,
      features: {
        externalProver: true,
        receiptTraceability: true,
        artifactIntegrity: true,
        remoteSkeleton: true,
        endpointConfigured: hasEndpoint,
        providerConfigured: Boolean(this.providerId),
        providerId: this.providerId ?? "unknown",
        configuredCredentialFields: this.configuredCredentialFields.join(",") || "none",
        requiredCredentialFields: this.requiredCredentialFields.join(",") || "none",
      },
      compatibility: {
        compatible: true,
      },
      lastError: createRemoteZKProverConfigurationError({
        endpoint: this.endpoint,
        providerId: this.providerId,
        configuredCredentialFields: this.configuredCredentialFields,
        requiredCredentialFields: this.requiredCredentialFields,
      }),
    };
  }
}
