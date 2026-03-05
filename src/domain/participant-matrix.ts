import { ParticipantRole } from "./role-matrix";

export type ParticipantType = "individual" | "organization";

export enum ParticipantCategory {
  HumanIndividual = "human_individual",
  HumanOrganization = "human_organization",
  AgentIndividual = "agent_individual",
  AgentOrganization = "agent_organization",
}

export interface ParticipantMatrixCell {
  category: ParticipantCategory;
  type: ParticipantType;
  isAgent: boolean;
  applicableRoles: ParticipantRole[];
}

const PARTICIPANT_MATRIX: Record<ParticipantCategory, ParticipantMatrixCell> = {
  [ParticipantCategory.HumanIndividual]: {
    category: ParticipantCategory.HumanIndividual,
    type: "individual",
    isAgent: false,
    applicableRoles: [
      ParticipantRole.TaskIssuer,
      ParticipantRole.Worker,
      ParticipantRole.Validator,
      ParticipantRole.Developer,
      ParticipantRole.Investor,
    ],
  },
  [ParticipantCategory.HumanOrganization]: {
    category: ParticipantCategory.HumanOrganization,
    type: "organization",
    isAgent: false,
    applicableRoles: [
      ParticipantRole.TaskIssuer,
      ParticipantRole.DataProvider,
      ParticipantRole.ComputeProvider,
      ParticipantRole.Developer,
      ParticipantRole.Governor,
      ParticipantRole.Investor,
    ],
  },
  [ParticipantCategory.AgentIndividual]: {
    category: ParticipantCategory.AgentIndividual,
    type: "individual",
    isAgent: true,
    applicableRoles: [
      ParticipantRole.TaskIssuer,
      ParticipantRole.Worker,
      ParticipantRole.Validator,
      ParticipantRole.DataProvider,
      ParticipantRole.ComputeProvider,
      ParticipantRole.Developer,
    ],
  },
  [ParticipantCategory.AgentOrganization]: {
    category: ParticipantCategory.AgentOrganization,
    type: "organization",
    isAgent: true,
    applicableRoles: [
      ParticipantRole.TaskIssuer,
      ParticipantRole.Worker,
      ParticipantRole.Validator,
      ParticipantRole.DataProvider,
      ParticipantRole.ComputeProvider,
      ParticipantRole.Developer,
      ParticipantRole.Governor,
    ],
  },
};

export function getParticipantCategory(
  type: ParticipantType,
  isAgent: boolean,
): ParticipantCategory {
  if (type === "individual") {
    return isAgent ? ParticipantCategory.AgentIndividual : ParticipantCategory.HumanIndividual;
  }
  return isAgent ? ParticipantCategory.AgentOrganization : ParticipantCategory.HumanOrganization;
}

export function getApplicableRoles(category: ParticipantCategory): ParticipantRole[] {
  return [...PARTICIPANT_MATRIX[category].applicableRoles];
}

export function isParticipantType(value?: string): value is ParticipantType {
  return value === "individual" || value === "organization";
}

export function isParticipantCategory(value?: string): value is ParticipantCategory {
  return value === ParticipantCategory.HumanIndividual ||
    value === ParticipantCategory.HumanOrganization ||
    value === ParticipantCategory.AgentIndividual ||
    value === ParticipantCategory.AgentOrganization;
}
