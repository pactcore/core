import type {
  SettlementConnectorProviderProfile,
  SettlementConnectorTransport,
  SettlementConnectors,
} from "../../application/settlement-connectors";
import { InMemoryApiQuotaAllocationConnector } from "./in-memory-api-quota-allocation-connector";
import { InMemoryCloudCreditBillingConnector } from "./in-memory-cloud-credit-billing-connector";
import { InMemoryLlmTokenMeteringConnector } from "./in-memory-llm-token-metering-connector";
import { ExternalApiQuotaAllocationConnector } from "./external-api-quota-allocation-connector";
import { ExternalCloudCreditBillingConnector } from "./external-cloud-credit-billing-connector";
import { ExternalLlmTokenMeteringConnector } from "./external-llm-token-metering-connector";
import { FetchSettlementConnectorTransport } from "./fetch-settlement-connector-transport";
import {
  loadSettlementConnectorProviderProfilesFromEnv,
  type LoadedSettlementConnectorProviderProfiles,
} from "./provider-profile-loader";

type EnvLike = Record<string, string | undefined>;

export interface CreateDefaultSettlementConnectorsOptions {
  transport?: SettlementConnectorTransport;
  profiles?: LoadedSettlementConnectorProviderProfiles;
}

export function createDefaultSettlementConnectors(
  options: CreateDefaultSettlementConnectorsOptions = {},
): SettlementConnectors {
  const transport = options.transport ?? new FetchSettlementConnectorTransport();

  return {
    llmTokenMetering: createLlmConnector(options.profiles?.llmTokenMetering, transport),
    cloudCreditBilling: createCloudConnector(options.profiles?.cloudCreditBilling, transport),
    apiQuotaAllocation: createApiConnector(options.profiles?.apiQuotaAllocation, transport),
  };
}

export function createDefaultSettlementConnectorsFromEnv(
  env: EnvLike,
  options: Omit<CreateDefaultSettlementConnectorsOptions, "profiles"> = {},
): SettlementConnectors {
  return createDefaultSettlementConnectors({
    ...options,
    profiles: loadSettlementConnectorProviderProfilesFromEnv(env),
  });
}

function createLlmConnector(
  profile: SettlementConnectorProviderProfile | undefined,
  transport: SettlementConnectorTransport,
) {
  if (!profile) {
    return new InMemoryLlmTokenMeteringConnector();
  }

  if (!profile.endpoint) {
    throw new Error("llm settlement provider profile requires endpoint for external adapter");
  }

  return new ExternalLlmTokenMeteringConnector({ transport, providerProfile: profile });
}

function createCloudConnector(
  profile: SettlementConnectorProviderProfile | undefined,
  transport: SettlementConnectorTransport,
) {
  if (!profile) {
    return new InMemoryCloudCreditBillingConnector();
  }

  if (!profile.endpoint) {
    throw new Error("cloud settlement provider profile requires endpoint for external adapter");
  }

  return new ExternalCloudCreditBillingConnector({ transport, providerProfile: profile });
}

function createApiConnector(
  profile: SettlementConnectorProviderProfile | undefined,
  transport: SettlementConnectorTransport,
) {
  if (!profile) {
    return new InMemoryApiQuotaAllocationConnector();
  }

  if (!profile.endpoint) {
    throw new Error("api settlement provider profile requires endpoint for external adapter");
  }

  return new ExternalApiQuotaAllocationConnector({ transport, providerProfile: profile });
}
