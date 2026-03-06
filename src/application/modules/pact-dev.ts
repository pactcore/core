import type { PolicyRegistry, TemplateRepository } from "../contracts";
import {
  aggregateAdapterHealth,
  DevAdapterError,
  type AdapterCompatibilityReport,
  type AdapterHealthReport,
  type AdapterHealthSummary,
} from "../adapter-runtime";
import type {
  DevIntegrationStatus,
  PolicyEvaluationResult,
  PolicyPackage,
  SDKTemplate,
} from "../../domain/types";
import { generateId } from "../utils";

export interface DevIntegration {
  id: string;
  ownerId: string;
  name: string;
  webhookUrl: string;
  status: DevIntegrationStatus;
  createdAt: number;
  version?: string;
  supportedCoreVersions?: string[];
}

export interface RegisterDevIntegrationInput {
  ownerId: string;
  name: string;
  webhookUrl: string;
  version?: string;
  supportedCoreVersions?: string[];
}

export interface RegisterSDKTemplateInput {
  name: string;
  language: string;
  repoUrl: string;
  description: string;
  tags?: string[];
}

export interface DevIntegrationHealthReport extends AdapterHealthReport {
  integrationId: string;
  integrationStatus: DevIntegrationStatus;
  webhookConfigured: boolean;
  version?: string;
}

export interface PactDevOptions {
  runtimeVersion?: string;
}

const DEFAULT_RUNTIME_VERSION = "0.2.0";

export class PactDev {
  private readonly integrations = new Map<string, DevIntegration>();

  constructor(
    private readonly policyRegistry: PolicyRegistry,
    private readonly templateRepository: TemplateRepository,
    private readonly options: PactDevOptions = {},
  ) {}

  async register(input: RegisterDevIntegrationInput): Promise<DevIntegration> {
    const integration: DevIntegration = {
      id: generateId("dev"),
      ownerId: input.ownerId,
      name: input.name,
      webhookUrl: input.webhookUrl,
      status: "draft",
      createdAt: Date.now(),
      version: input.version,
      supportedCoreVersions: input.supportedCoreVersions,
    };

    this.integrations.set(integration.id, integration);
    return integration;
  }

  async getIntegration(id: string): Promise<DevIntegration | undefined> {
    return this.integrations.get(id);
  }

  async list(): Promise<DevIntegration[]> {
    return [...this.integrations.values()];
  }

  async activate(id: string): Promise<DevIntegration> {
    return this.transitionStatus(id, "active", ["draft", "suspended"]);
  }

  async suspend(id: string): Promise<DevIntegration> {
    return this.transitionStatus(id, "suspended", ["active"]);
  }

  async deprecate(id: string): Promise<DevIntegration> {
    return this.transitionStatus(id, "deprecated", ["active", "suspended"]);
  }

  async registerPolicy(pkg: PolicyPackage): Promise<void> {
    await this.policyRegistry.registerPackage(pkg);
  }

  async getPolicy(id: string): Promise<PolicyPackage | undefined> {
    return this.policyRegistry.getPackage(id);
  }

  async listPolicies(): Promise<PolicyPackage[]> {
    return this.policyRegistry.listPackages();
  }

  async evaluatePolicy(context: Record<string, unknown>): Promise<PolicyEvaluationResult> {
    return this.policyRegistry.evaluatePolicy(context);
  }

  async registerTemplate(input: RegisterSDKTemplateInput): Promise<SDKTemplate> {
    const template: SDKTemplate = {
      id: generateId("tmpl"),
      name: input.name,
      language: input.language,
      repoUrl: input.repoUrl,
      description: input.description,
      tags: input.tags ?? [],
      createdAt: Date.now(),
    };

    await this.templateRepository.save(template);
    return template;
  }

  async listTemplates(): Promise<SDKTemplate[]> {
    return this.templateRepository.list();
  }

  async getTemplate(id: string): Promise<SDKTemplate | undefined> {
    return this.templateRepository.getById(id);
  }

  checkVersionCompatibility(
    supportedVersions: string[] | undefined,
    runtimeVersion = this.options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION,
  ): AdapterCompatibilityReport {
    const supported = supportedVersions?.filter((value) => value.length > 0) ?? [];
    if (supported.length === 0) {
      return {
        compatible: true,
        currentVersion: runtimeVersion,
        supportedVersions: [],
        reason: "No version constraints declared",
      };
    }

    const compatible = supported.some((constraint) => matchesVersionConstraint(runtimeVersion, constraint));
    return {
      compatible,
      currentVersion: runtimeVersion,
      supportedVersions: supported,
      reason: compatible
        ? "Runtime version satisfies declared constraints"
        : "Runtime version is outside the declared compatibility set",
    };
  }

  async getIntegrationHealth(
    id: string,
    runtimeVersion = this.options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION,
  ): Promise<DevIntegrationHealthReport> {
    const integration = this.integrations.get(id);
    if (!integration) {
      throw new DevAdapterError(`Integration ${id} not found`, {
        operation: "get_integration_health",
        code: "integration_not_found",
        retryable: false,
      });
    }

    const compatibility = this.checkVersionCompatibility(
      integration.supportedCoreVersions,
      runtimeVersion,
    );
    const state = integration.status === "active"
      ? compatibility.compatible ? "healthy" : "unhealthy"
      : "degraded";

    return {
      name: integration.name,
      integrationId: integration.id,
      integrationStatus: integration.status,
      state,
      checkedAt: Date.now(),
      webhookConfigured: integration.webhookUrl.length > 0,
      version: integration.version,
      compatibility,
      features: {
        versionChecks: true,
        operationalHooks: true,
      },
    };
  }

  async listIntegrationHealth(
    runtimeVersion = this.options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION,
  ): Promise<AdapterHealthSummary & { integrations: DevIntegrationHealthReport[]; runtimeVersion: string }> {
    const integrations = await Promise.all(
      [...this.integrations.keys()].map((id) => this.getIntegrationHealth(id, runtimeVersion)),
    );
    const summary = aggregateAdapterHealth(integrations);
    return {
      ...summary,
      integrations,
      runtimeVersion,
    };
  }

  private transitionStatus(
    id: string,
    target: DevIntegrationStatus,
    allowedFrom: DevIntegrationStatus[],
  ): DevIntegration {
    const integration = this.integrations.get(id);
    if (!integration) throw new Error(`Integration ${id} not found`);
    if (!allowedFrom.includes(integration.status)) {
      throw new Error(`Cannot transition from ${integration.status} to ${target}`);
    }
    integration.status = target;
    return integration;
  }
}

function matchesVersionConstraint(version: string, constraint: string): boolean {
  if (constraint === "*" || constraint.toLowerCase() === "x") {
    return true;
  }
  if (constraint.startsWith("^")) {
    const base = parseVersion(constraint.slice(1));
    const current = parseVersion(version);
    return current.major === base.major && compareVersions(current, base) >= 0;
  }
  if (constraint.startsWith("~")) {
    const base = parseVersion(constraint.slice(1));
    const current = parseVersion(version);
    return current.major === base.major && current.minor === base.minor && compareVersions(current, base) >= 0;
  }
  if (constraint.startsWith(">=")) {
    return compareVersions(parseVersion(version), parseVersion(constraint.slice(2))) >= 0;
  }
  if (constraint.endsWith(".x")) {
    const [major, minor] = constraint.slice(0, -2).split(".");
    const current = parseVersion(version);
    return current.major === Number(major) && current.minor === Number(minor);
  }

  return compareVersions(parseVersion(version), parseVersion(constraint)) === 0;
}

function parseVersion(version: string) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  const [major = "0", minor = "0", patch = "0"] = normalized.split(".");
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
}

function compareVersions(
  left: { major: number; minor: number; patch: number },
  right: { major: number; minor: number; patch: number },
): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}
