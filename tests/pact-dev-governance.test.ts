import { describe, expect, test } from "bun:test";
import { PactDev } from "../src/application/modules/pact-dev";
import { InMemoryPolicyRegistry } from "../src/infrastructure/governance/in-memory-policy-registry";
import { InMemoryTemplateRepository } from "../src/infrastructure/governance/in-memory-template-repository";
import type { PolicyPackage } from "../src/domain/types";
import { generateId } from "../src/application/utils";

function setup() {
  return new PactDev(new InMemoryPolicyRegistry(), new InMemoryTemplateRepository());
}

function makePolicyPackage(overrides: Partial<PolicyPackage> = {}): PolicyPackage {
  const now = Date.now();
  return {
    id: generateId("pkg"),
    name: "test-policy",
    version: "1.0.0",
    rules: [],
    ownerId: "admin",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("PactDev Governance", () => {
  test("registers and lists policy packages", async () => {
    const dev = setup();
    const pkg = makePolicyPackage({ name: "security" });
    await dev.registerPolicy(pkg);

    const list = await dev.listPolicies();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("security");

    const fetched = await dev.getPolicy(pkg.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("security");
  });

  test("evaluates policy: allow when no deny rules match", async () => {
    const dev = setup();
    const pkg = makePolicyPackage({
      rules: [
        {
          id: "r1",
          name: "allow-all",
          condition: { action: "read" },
          action: "allow",
          priority: 10,
          enabled: true,
        },
      ],
    });
    await dev.registerPolicy(pkg);

    const result = await dev.evaluatePolicy({ action: "read", user: "agent-1" });
    expect(result.allowed).toBe(true);
    expect(result.matchedRules).toHaveLength(1);
    expect(result.deniedBy).toBeUndefined();
  });

  test("evaluates policy: deny blocks action", async () => {
    const dev = setup();
    const pkg = makePolicyPackage({
      rules: [
        {
          id: "r1",
          name: "deny-delete",
          condition: { action: "delete" },
          action: "deny",
          priority: 100,
          enabled: true,
        },
        {
          id: "r2",
          name: "allow-delete-admin",
          condition: { action: "delete", role: "admin" },
          action: "allow",
          priority: 50,
          enabled: true,
        },
      ],
    });
    await dev.registerPolicy(pkg);

    const result = await dev.evaluatePolicy({ action: "delete" });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy!.name).toBe("deny-delete");
  });

  test("evaluates policy: require_review does not deny", async () => {
    const dev = setup();
    const pkg = makePolicyPackage({
      rules: [
        {
          id: "r1",
          name: "review-large",
          condition: { action: "transfer" },
          action: "require_review",
          priority: 10,
          enabled: true,
        },
      ],
    });
    await dev.registerPolicy(pkg);

    const result = await dev.evaluatePolicy({ action: "transfer" });
    expect(result.allowed).toBe(true); // require_review ≠ deny
    expect(result.matchedRules).toHaveLength(1);
    expect(result.matchedRules[0].action).toBe("require_review");
  });

  test("disabled rules are skipped", async () => {
    const dev = setup();
    const pkg = makePolicyPackage({
      rules: [
        {
          id: "r1",
          name: "disabled-deny",
          condition: { action: "write" },
          action: "deny",
          priority: 100,
          enabled: false,
        },
      ],
    });
    await dev.registerPolicy(pkg);

    const result = await dev.evaluatePolicy({ action: "write" });
    expect(result.allowed).toBe(true);
    expect(result.matchedRules).toHaveLength(0);
  });

  test("rules from multiple packages are evaluated together by priority", async () => {
    const dev = setup();
    const pkg1 = makePolicyPackage({
      name: "base",
      rules: [
        {
          id: "r1",
          name: "base-allow",
          condition: { action: "deploy" },
          action: "allow",
          priority: 10,
          enabled: true,
        },
      ],
    });
    const pkg2 = makePolicyPackage({
      name: "strict",
      rules: [
        {
          id: "r2",
          name: "strict-deny",
          condition: { action: "deploy" },
          action: "deny",
          priority: 100,
          enabled: true,
        },
      ],
    });
    await dev.registerPolicy(pkg1);
    await dev.registerPolicy(pkg2);

    const result = await dev.evaluatePolicy({ action: "deploy" });
    expect(result.allowed).toBe(false);
    expect(result.matchedRules).toHaveLength(2);
    // Strict deny should be first (higher priority)
    expect(result.matchedRules[0].name).toBe("strict-deny");
  });

  // ── Integration lifecycle ──────────────────────────────────

  test("integration lifecycle: draft → active → suspended → deprecated", async () => {
    const dev = setup();
    const integration = await dev.register({
      ownerId: "dev1",
      name: "my-webhook",
      webhookUrl: "https://example.com/hook",
    });

    expect(integration.status).toBe("draft");

    const activated = await dev.activate(integration.id);
    expect(activated.status).toBe("active");

    const suspended = await dev.suspend(integration.id);
    expect(suspended.status).toBe("suspended");

    const deprecated = await dev.deprecate(integration.id);
    expect(deprecated.status).toBe("deprecated");
  });

  test("invalid lifecycle transition throws", async () => {
    const dev = setup();
    const integration = await dev.register({
      ownerId: "dev1",
      name: "test",
      webhookUrl: "https://x.com",
    });

    // Can't suspend from draft
    expect(() => dev.suspend(integration.id)).toThrow("Cannot transition");

    // Can't deprecate from draft
    expect(() => dev.deprecate(integration.id)).toThrow("Cannot transition");
  });

  test("getIntegration returns registered integration", async () => {
    const dev = setup();
    const integration = await dev.register({
      ownerId: "dev1",
      name: "lookup-test",
      webhookUrl: "https://x.com",
    });

    const found = await dev.getIntegration(integration.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("lookup-test");

    const missing = await dev.getIntegration("nonexistent");
    expect(missing).toBeUndefined();
  });

  // ── SDK Templates ──────────────────────────────────────────

  test("registers and lists SDK templates", async () => {
    const dev = setup();
    const t1 = await dev.registerTemplate({
      name: "typescript-starter",
      language: "TypeScript",
      repoUrl: "https://github.com/pact/ts-starter",
      description: "Basic TS template",
      tags: ["typescript", "starter"],
    });

    const t2 = await dev.registerTemplate({
      name: "python-agent",
      language: "Python",
      repoUrl: "https://github.com/pact/py-agent",
      description: "Python agent template",
    });

    expect(t1.id).toMatch(/^tmpl_/);
    expect(t2.tags).toEqual([]);

    const all = await dev.listTemplates();
    expect(all).toHaveLength(2);

    const found = await dev.getTemplate(t1.id);
    expect(found!.name).toBe("typescript-starter");
  });
});
