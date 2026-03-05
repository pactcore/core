import { describe, expect, it } from "bun:test";
import { createApp } from "../src/api/app";
import {
  calculateVerificationCost,
  selectVerificationLayers,
} from "../src/domain/multi-layer-verification";
import {
  ParticipantCategory,
  getApplicableRoles,
  getParticipantCategory,
} from "../src/domain/participant-matrix";
import {
  ParticipantRole,
  canPerformAction,
  getRoleCapabilities,
  getRoleRequirements,
} from "../src/domain/role-matrix";

describe("role matrix domain", () => {
  it("returns role capabilities by module/action", () => {
    const workerCapabilities = getRoleCapabilities(ParticipantRole.Worker);
    expect(workerCapabilities.tasks.claim).toBeTrue();
    expect(workerCapabilities.tasks.execute).toBeTrue();
    expect(workerCapabilities.tasks.assign).toBeFalse();
    expect(workerCapabilities.compute.offer_capacity).toBeFalse();
  });

  it("returns a cloned capability matrix", () => {
    const capabilities = getRoleCapabilities(ParticipantRole.Developer);
    capabilities.dev.publish_plugin = false;

    const freshRead = getRoleCapabilities(ParticipantRole.Developer);
    expect(freshRead.dev.publish_plugin).toBeTrue();
  });

  it("checks role actions against the matrix", () => {
    expect(canPerformAction(ParticipantRole.TaskIssuer, "create", "tasks")).toBeTrue();
    expect(canPerformAction(ParticipantRole.TaskIssuer, "run_job", "compute")).toBeFalse();
    expect(canPerformAction(ParticipantRole.ComputeProvider, "run_job", "compute")).toBeTrue();
  });

  it("returns role requirements and keeps source immutable", () => {
    const requirements = getRoleRequirements(ParticipantRole.Validator);
    expect(requirements.minReputation).toBe(70);
    expect(requirements.requiredIdentityLevel).toBe("trusted");
    expect(requirements.minStake).toBe(2_500);

    requirements.minReputation = 0;
    expect(getRoleRequirements(ParticipantRole.Validator).minReputation).toBe(70);
  });
});

describe("participant matrix domain", () => {
  it("maps participant type and agent flag to 2x2 category", () => {
    expect(getParticipantCategory("individual", false)).toBe(ParticipantCategory.HumanIndividual);
    expect(getParticipantCategory("organization", false)).toBe(
      ParticipantCategory.HumanOrganization,
    );
    expect(getParticipantCategory("individual", true)).toBe(ParticipantCategory.AgentIndividual);
    expect(getParticipantCategory("organization", true)).toBe(
      ParticipantCategory.AgentOrganization,
    );
  });

  it("returns applicable roles for a matrix category", () => {
    const roles = getApplicableRoles(ParticipantCategory.HumanOrganization);
    expect(roles).toContain(ParticipantRole.Governor);
    expect(roles).toContain(ParticipantRole.DataProvider);
    expect(roles).not.toContain(ParticipantRole.Worker);
  });

  it("returns a copy of applicable roles", () => {
    const roles = getApplicableRoles(ParticipantCategory.AgentIndividual);
    roles.pop();

    const freshRead = getApplicableRoles(ParticipantCategory.AgentIndividual);
    expect(freshRead).toContain(ParticipantRole.Worker);
    expect(freshRead).toContain(ParticipantRole.ComputeProvider);
  });
});

describe("multi-layer verification domain", () => {
  it("selects lightweight layers for low risk + low value", () => {
    expect(selectVerificationLayers(1_000, "low")).toEqual(["auto_ai"]);
  });

  it("selects all layers for critical risk or high value", () => {
    expect(selectVerificationLayers(3_000, "critical")).toEqual([
      "auto_ai",
      "agent_validator",
      "human_jury",
    ]);
    expect(selectVerificationLayers(75_000, "low")).toEqual([
      "auto_ai",
      "agent_validator",
      "human_jury",
    ]);
  });

  it("calculates verification cost with unique layers", () => {
    expect(calculateVerificationCost(["auto_ai", "auto_ai", "agent_validator"])).toBe(20);
    expect(calculateVerificationCost(["auto_ai", "agent_validator", "human_jury"])).toBe(140);
  });
});

describe("role and participant matrix API", () => {
  it("exposes role capability and requirement routes", async () => {
    const app = createApp();

    const capabilitiesResponse = await app.request("/roles/worker/capabilities");
    expect(capabilitiesResponse.status).toBe(200);
    const capabilitiesBody = (await capabilitiesResponse.json()) as {
      role: string;
      capabilities: { tasks: { claim: boolean } };
    };
    expect(capabilitiesBody.role).toBe("worker");
    expect(capabilitiesBody.capabilities.tasks.claim).toBeTrue();

    const requirementsResponse = await app.request("/roles/validator/requirements");
    expect(requirementsResponse.status).toBe(200);
    const requirementsBody = (await requirementsResponse.json()) as {
      requirements: { minReputation: number; requiredIdentityLevel: string };
    };
    expect(requirementsBody.requirements.minReputation).toBe(70);
    expect(requirementsBody.requirements.requiredIdentityLevel).toBe("trusted");
  });

  it("rejects invalid role params", async () => {
    const app = createApp();
    const response = await app.request("/roles/not-a-role/requirements");
    expect(response.status).toBe(400);
  });

  it("checks actions through the role matrix endpoint", async () => {
    const app = createApp();

    const allowedResponse = await app.request("/roles/check-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "task_issuer",
        module: "tasks",
        action: "create",
      }),
    });
    expect(allowedResponse.status).toBe(200);
    const allowedBody = (await allowedResponse.json()) as { allowed: boolean };
    expect(allowedBody.allowed).toBeTrue();

    const deniedResponse = await app.request("/roles/check-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "investor",
        module: "tasks",
        action: "create",
      }),
    });
    expect(deniedResponse.status).toBe(200);
    const deniedBody = (await deniedResponse.json()) as { allowed: boolean };
    expect(deniedBody.allowed).toBeFalse();
  });

  it("validates role action checks and participant category requests", async () => {
    const app = createApp();

    const invalidRoleModule = await app.request("/roles/check-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "worker",
        module: "unknown_module",
        action: "claim",
      }),
    });
    expect(invalidRoleModule.status).toBe(400);

    const categoryResponse = await app.request("/participants/matrix/category", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "organization",
        isAgent: true,
      }),
    });
    expect(categoryResponse.status).toBe(200);
    const categoryBody = (await categoryResponse.json()) as {
      category: string;
      applicableRoles: string[];
    };
    expect(categoryBody.category).toBe("agent_organization");
    expect(categoryBody.applicableRoles).toContain("governor");

    const invalidCategoryResponse = await app.request("/participants/matrix/category", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "collective",
        isAgent: false,
      }),
    });
    expect(invalidCategoryResponse.status).toBe(400);
  });
});
