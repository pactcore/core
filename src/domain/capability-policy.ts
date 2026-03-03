import { CapabilityDeniedError } from "./errors";
import type { AgentCapability, CapabilityPolicy, ParticipantRole } from "./types";

export const recommendedCapabilityPolicy: CapabilityPolicy = {
  roleCapabilities: {
    issuer: ["mission.claim", "settlement.trigger", "task.assign"],
    worker: ["mission.claim", "mission.execute", "evidence.submit", "task.submit"],
    agent: ["mission.claim", "mission.execute", "evidence.submit"],
    validator: ["verdict.submit"],
    jury: ["verdict.submit"],
  },
  maxAutonomousRetries: 3,
  escalationThresholdScore: 0.66,
};

export class CapabilityPolicyEngine {
  constructor(private readonly policy: CapabilityPolicy = recommendedCapabilityPolicy) {}

  can(role: ParticipantRole, capability: AgentCapability): boolean {
    const allowed = this.policy.roleCapabilities[role] ?? [];
    return allowed.includes(capability);
  }

  assert(role: ParticipantRole, capability: AgentCapability): void {
    if (!this.can(role, capability)) {
      throw new CapabilityDeniedError(role, capability);
    }
  }

  allowedCapabilities(role: ParticipantRole): AgentCapability[] {
    return [...(this.policy.roleCapabilities[role] ?? [])];
  }

  getMaxAutonomousRetries(): number {
    return this.policy.maxAutonomousRetries;
  }

  getEscalationThresholdScore(): number {
    return this.policy.escalationThresholdScore;
  }
}
