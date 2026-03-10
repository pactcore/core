import type { AdapterDurability } from "../../application/adapter-runtime";
import type { AdapterHealthReport } from "../../application/adapter-runtime";
import type { ExternalZKProverAdapter } from "../../application/contracts";
import type { ExternalZKProveRequest, ExternalZKVerifyRequest } from "../../domain/zk-bridge";
import { DeterministicLocalZKProverAdapter } from "./deterministic-local-zk-prover-adapter";

export interface RemoteHttpZKProverAdapterSkeletonOptions {
  endpoint?: string;
  adapterName?: string;
  providerId?: string;
  configuredCredentialFields?: string[];
  requiredCredentialFields?: string[];
}

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
    this.configuredCredentialFields = [...(options.configuredCredentialFields ?? [])];
    this.requiredCredentialFields = [...(options.requiredCredentialFields ?? ["apiKey"])];
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
    const configuredFields = new Set(this.configuredCredentialFields);
    const missingFields = this.requiredCredentialFields.filter((field) => !configuredFields.has(field));
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
      lastError: buildConfigurationError({
        hasEndpoint,
        missingFields,
      }),
    };
  }
}

function buildConfigurationError(input: {
  hasEndpoint: boolean;
  missingFields: string[];
}): AdapterHealthReport["lastError"] {
  if (input.hasEndpoint && input.missingFields.length === 0) {
    return undefined;
  }

  if (!input.hasEndpoint && input.missingFields.length === 0) {
    return {
      adapter: "zk",
      operation: "configure_remote_zk_prover",
      code: "zk_remote_endpoint_missing",
      message: "Remote ZK prover endpoint is required",
      retryable: false,
      occurredAt: Date.now(),
    };
  }

  if (input.hasEndpoint && input.missingFields.length > 0) {
    const details: Record<string, string> = {
      missingFields: input.missingFields.join(","),
    };

    return {
      adapter: "zk",
      operation: "configure_remote_zk_prover",
      code: "zk_remote_credentials_incomplete",
      message: `Missing credential fields: ${input.missingFields.join(", ")}`,
      retryable: false,
      occurredAt: Date.now(),
      details,
    };
  }

  const details: Record<string, string> = {
    missingFields: input.missingFields.join(","),
    missingEndpoint: "true",
  };

  return {
    adapter: "zk",
    operation: "configure_remote_zk_prover",
    code: "zk_remote_configuration_incomplete",
    message: `Remote ZK prover endpoint is required and credential fields are missing: ${input.missingFields.join(", ")}`,
    retryable: false,
    occurredAt: Date.now(),
    details,
  };
}
