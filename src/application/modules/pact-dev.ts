import type { PolicyRegistry, TemplateRepository } from "../contracts";
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
}

export interface RegisterDevIntegrationInput {
  ownerId: string;
  name: string;
  webhookUrl: string;
}

export interface RegisterSDKTemplateInput {
  name: string;
  language: string;
  repoUrl: string;
  description: string;
  tags?: string[];
}

export class PactDev {
  private readonly integrations = new Map<string, DevIntegration>();

  constructor(
    private readonly policyRegistry: PolicyRegistry,
    private readonly templateRepository: TemplateRepository,
  ) {}

  // ── Integration management ─────────────────────────────────

  async register(input: RegisterDevIntegrationInput): Promise<DevIntegration> {
    const integration: DevIntegration = {
      id: generateId("dev"),
      ownerId: input.ownerId,
      name: input.name,
      webhookUrl: input.webhookUrl,
      status: "draft",
      createdAt: Date.now(),
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

  private transitionStatus(
    id: string,
    target: DevIntegrationStatus,
    allowedFrom: DevIntegrationStatus[],
  ): DevIntegration {
    const integration = this.integrations.get(id);
    if (!integration) throw new Error(`Integration ${id} not found`);
    if (!allowedFrom.includes(integration.status)) {
      throw new Error(
        `Cannot transition from ${integration.status} to ${target}`,
      );
    }
    integration.status = target;
    return integration;
  }

  // ── Policy management ──────────────────────────────────────

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

  // ── SDK Template management ────────────────────────────────

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
}
