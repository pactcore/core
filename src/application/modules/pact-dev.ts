import { generateId } from "../utils";

export interface DevIntegration {
  id: string;
  ownerId: string;
  name: string;
  webhookUrl: string;
  createdAt: number;
}

export interface RegisterDevIntegrationInput {
  ownerId: string;
  name: string;
  webhookUrl: string;
}

export class PactDev {
  private readonly integrations = new Map<string, DevIntegration>();

  async register(input: RegisterDevIntegrationInput): Promise<DevIntegration> {
    const integration: DevIntegration = {
      id: generateId("dev"),
      ownerId: input.ownerId,
      name: input.name,
      webhookUrl: input.webhookUrl,
      createdAt: Date.now(),
    };

    this.integrations.set(integration.id, integration);
    return integration;
  }

  async list(): Promise<DevIntegration[]> {
    return [...this.integrations.values()];
  }
}
