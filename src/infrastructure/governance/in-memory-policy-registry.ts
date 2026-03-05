import type { PolicyRegistry } from "../../application/contracts";
import type { PolicyEvaluationResult, PolicyPackage, PolicyRule } from "../../domain/types";

export class InMemoryPolicyRegistry implements PolicyRegistry {
  private readonly packages = new Map<string, PolicyPackage>();

  async registerPackage(pkg: PolicyPackage): Promise<void> {
    this.packages.set(pkg.id, pkg);
  }

  async getPackage(id: string): Promise<PolicyPackage | undefined> {
    return this.packages.get(id);
  }

  async listPackages(): Promise<PolicyPackage[]> {
    return [...this.packages.values()];
  }

  async evaluatePolicy(context: Record<string, unknown>): Promise<PolicyEvaluationResult> {
    // Collect all enabled rules from all packages, sorted by priority descending
    const allRules: PolicyRule[] = [];
    for (const pkg of this.packages.values()) {
      for (const rule of pkg.rules) {
        if (rule.enabled) {
          allRules.push(rule);
        }
      }
    }
    allRules.sort((a, b) => b.priority - a.priority);

    const matchedRules: PolicyRule[] = [];
    let deniedBy: PolicyRule | undefined;

    for (const rule of allRules) {
      if (this.matchesCondition(rule.condition, context)) {
        matchedRules.push(rule);
        if (rule.action === "deny" && !deniedBy) {
          deniedBy = rule;
        }
      }
    }

    return {
      allowed: !deniedBy,
      matchedRules,
      deniedBy,
    };
  }

  private matchesCondition(
    condition: Record<string, unknown>,
    context: Record<string, unknown>,
  ): boolean {
    for (const [key, value] of Object.entries(condition)) {
      if (context[key] !== value) return false;
    }
    return true;
  }
}
