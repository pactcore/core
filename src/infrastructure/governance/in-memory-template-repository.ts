import type { TemplateRepository } from "../../application/contracts";
import type { SDKTemplate } from "../../domain/types";

export class InMemoryTemplateRepository implements TemplateRepository {
  private readonly templates = new Map<string, SDKTemplate>();

  async save(template: SDKTemplate): Promise<void> {
    this.templates.set(template.id, template);
  }

  async getById(id: string): Promise<SDKTemplate | undefined> {
    return this.templates.get(id);
  }

  async list(): Promise<SDKTemplate[]> {
    return [...this.templates.values()];
  }
}
