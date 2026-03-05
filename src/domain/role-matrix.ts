import type { IdentityLevel } from "./identity-levels";

export enum ParticipantRole {
  TaskIssuer = "task_issuer",
  Worker = "worker",
  Validator = "validator",
  DataProvider = "data_provider",
  ComputeProvider = "compute_provider",
  Developer = "developer",
  Governor = "governor",
  Investor = "investor",
}

export type RoleModule =
  | "tasks"
  | "compute"
  | "data"
  | "pay"
  | "id"
  | "dev"
  | "governance"
  | "economics";

export type RoleCapabilityActionMap = Record<string, boolean>;
export type RoleCapabilityMatrix = Record<RoleModule, RoleCapabilityActionMap>;

export interface RoleRequirements {
  minReputation: number;
  requiredIdentityLevel: IdentityLevel;
  minStake: number;
}

const ROLE_MODULES: RoleModule[] = [
  "tasks",
  "compute",
  "data",
  "pay",
  "id",
  "dev",
  "governance",
  "economics",
];

function buildCapabilityMatrix(
  entries: Partial<Record<RoleModule, Record<string, boolean>>>,
): RoleCapabilityMatrix {
  const matrix = {} as RoleCapabilityMatrix;
  for (const module of ROLE_MODULES) {
    const actions = entries[module] ?? {};
    matrix[module] = { ...actions };
  }
  return matrix;
}

const ROLE_CAPABILITY_MATRIX: Record<ParticipantRole, RoleCapabilityMatrix> = {
  [ParticipantRole.TaskIssuer]: buildCapabilityMatrix({
    tasks: {
      create: true,
      assign: true,
      cancel: true,
      dispute: true,
      claim: false,
      execute: false,
      submit_evidence: false,
      validate: false,
    },
    compute: {
      request_job: true,
      dispatch_job: true,
      offer_capacity: false,
      run_job: false,
      set_pricing: false,
    },
    data: {
      purchase: true,
      publish: false,
      list: false,
      manage_access: false,
      curate: false,
    },
    pay: {
      create_escrow: true,
      release_payment: true,
      withdraw: true,
      stake: true,
    },
    id: {
      register: true,
      verify: true,
      issue_credential: false,
      attest: false,
    },
    dev: {
      install_plugin: true,
      publish_plugin: false,
      manage_policy: false,
    },
    governance: {
      propose: false,
      vote: false,
      execute: false,
    },
    economics: {
      fund_treasury: true,
      receive_yield: true,
    },
  }),
  [ParticipantRole.Worker]: buildCapabilityMatrix({
    tasks: {
      claim: true,
      execute: true,
      submit_evidence: true,
      create: false,
      assign: false,
      validate: false,
      dispute: true,
      cancel: false,
    },
    compute: {
      request_job: true,
      dispatch_job: false,
      offer_capacity: false,
      run_job: false,
      set_pricing: false,
    },
    data: {
      purchase: true,
      publish: false,
      list: false,
      manage_access: false,
      curate: false,
    },
    pay: {
      create_escrow: false,
      release_payment: false,
      withdraw: true,
      stake: true,
    },
    id: {
      register: true,
      verify: true,
      issue_credential: false,
      attest: false,
    },
    dev: {
      install_plugin: true,
      publish_plugin: false,
      manage_policy: false,
    },
    governance: {
      propose: false,
      vote: false,
      execute: false,
    },
    economics: {
      fund_treasury: false,
      receive_yield: true,
    },
  }),
  [ParticipantRole.Validator]: buildCapabilityMatrix({
    tasks: {
      validate: true,
      dispute: true,
      claim: false,
      execute: false,
      submit_evidence: false,
      create: false,
      assign: false,
      cancel: false,
    },
    compute: {
      request_job: false,
      dispatch_job: false,
      offer_capacity: false,
      run_job: false,
      set_pricing: false,
    },
    data: {
      purchase: false,
      publish: false,
      list: false,
      manage_access: false,
      curate: true,
    },
    pay: {
      create_escrow: false,
      release_payment: false,
      withdraw: true,
      stake: true,
    },
    id: {
      register: true,
      verify: true,
      issue_credential: false,
      attest: true,
    },
    dev: {
      install_plugin: false,
      publish_plugin: false,
      manage_policy: false,
    },
    governance: {
      propose: false,
      vote: true,
      execute: false,
    },
    economics: {
      fund_treasury: false,
      receive_yield: true,
    },
  }),
  [ParticipantRole.DataProvider]: buildCapabilityMatrix({
    tasks: {
      create: false,
      assign: false,
      cancel: false,
      dispute: true,
      claim: false,
      execute: false,
      submit_evidence: false,
      validate: false,
    },
    compute: {
      request_job: false,
      dispatch_job: false,
      offer_capacity: false,
      run_job: false,
      set_pricing: false,
    },
    data: {
      publish: true,
      list: true,
      manage_access: true,
      curate: true,
      purchase: false,
    },
    pay: {
      create_escrow: false,
      release_payment: false,
      withdraw: true,
      stake: true,
    },
    id: {
      register: true,
      verify: true,
      issue_credential: false,
      attest: false,
    },
    dev: {
      install_plugin: false,
      publish_plugin: true,
      manage_policy: false,
    },
    governance: {
      propose: false,
      vote: true,
      execute: false,
    },
    economics: {
      fund_treasury: false,
      receive_yield: true,
    },
  }),
  [ParticipantRole.ComputeProvider]: buildCapabilityMatrix({
    tasks: {
      create: false,
      assign: false,
      cancel: false,
      dispute: true,
      claim: false,
      execute: false,
      submit_evidence: false,
      validate: false,
    },
    compute: {
      offer_capacity: true,
      run_job: true,
      set_pricing: true,
      request_job: false,
      dispatch_job: false,
    },
    data: {
      purchase: false,
      publish: false,
      list: false,
      manage_access: false,
      curate: false,
    },
    pay: {
      create_escrow: false,
      release_payment: false,
      withdraw: true,
      stake: true,
    },
    id: {
      register: true,
      verify: true,
      issue_credential: false,
      attest: false,
    },
    dev: {
      install_plugin: false,
      publish_plugin: false,
      manage_policy: false,
    },
    governance: {
      propose: false,
      vote: true,
      execute: false,
    },
    economics: {
      fund_treasury: false,
      receive_yield: true,
    },
  }),
  [ParticipantRole.Developer]: buildCapabilityMatrix({
    tasks: {
      create: true,
      assign: false,
      cancel: true,
      dispute: true,
      claim: false,
      execute: false,
      submit_evidence: false,
      validate: false,
    },
    compute: {
      request_job: true,
      dispatch_job: true,
      offer_capacity: false,
      run_job: false,
      set_pricing: false,
    },
    data: {
      publish: true,
      list: true,
      manage_access: true,
      curate: false,
      purchase: true,
    },
    pay: {
      create_escrow: true,
      release_payment: false,
      withdraw: true,
      stake: true,
    },
    id: {
      register: true,
      verify: true,
      issue_credential: true,
      attest: true,
    },
    dev: {
      publish_plugin: true,
      install_plugin: true,
      manage_policy: true,
    },
    governance: {
      propose: true,
      vote: true,
      execute: false,
    },
    economics: {
      fund_treasury: true,
      receive_yield: true,
    },
  }),
  [ParticipantRole.Governor]: buildCapabilityMatrix({
    tasks: {
      create: true,
      assign: true,
      cancel: true,
      dispute: true,
      claim: false,
      execute: false,
      submit_evidence: false,
      validate: true,
    },
    compute: {
      request_job: true,
      dispatch_job: true,
      offer_capacity: false,
      run_job: false,
      set_pricing: false,
    },
    data: {
      purchase: true,
      publish: false,
      list: false,
      manage_access: true,
      curate: true,
    },
    pay: {
      create_escrow: true,
      release_payment: true,
      withdraw: true,
      stake: true,
    },
    id: {
      register: true,
      verify: true,
      issue_credential: true,
      attest: true,
    },
    dev: {
      install_plugin: true,
      publish_plugin: true,
      manage_policy: true,
    },
    governance: {
      propose: true,
      vote: true,
      execute: true,
    },
    economics: {
      fund_treasury: true,
      receive_yield: true,
    },
  }),
  [ParticipantRole.Investor]: buildCapabilityMatrix({
    tasks: {
      create: false,
      assign: false,
      cancel: false,
      dispute: false,
      claim: false,
      execute: false,
      submit_evidence: false,
      validate: false,
    },
    compute: {
      request_job: false,
      dispatch_job: false,
      offer_capacity: false,
      run_job: false,
      set_pricing: false,
    },
    data: {
      purchase: true,
      publish: false,
      list: false,
      manage_access: false,
      curate: false,
    },
    pay: {
      create_escrow: true,
      release_payment: false,
      withdraw: true,
      stake: true,
    },
    id: {
      register: true,
      verify: true,
      issue_credential: false,
      attest: false,
    },
    dev: {
      install_plugin: true,
      publish_plugin: false,
      manage_policy: false,
    },
    governance: {
      propose: false,
      vote: true,
      execute: false,
    },
    economics: {
      fund_treasury: true,
      receive_yield: true,
    },
  }),
};

const ROLE_REQUIREMENTS: Record<ParticipantRole, RoleRequirements> = {
  [ParticipantRole.TaskIssuer]: {
    minReputation: 40,
    requiredIdentityLevel: "verified",
    minStake: 1_000,
  },
  [ParticipantRole.Worker]: {
    minReputation: 25,
    requiredIdentityLevel: "basic",
    minStake: 100,
  },
  [ParticipantRole.Validator]: {
    minReputation: 70,
    requiredIdentityLevel: "trusted",
    minStake: 2_500,
  },
  [ParticipantRole.DataProvider]: {
    minReputation: 60,
    requiredIdentityLevel: "verified",
    minStake: 1_500,
  },
  [ParticipantRole.ComputeProvider]: {
    minReputation: 65,
    requiredIdentityLevel: "verified",
    minStake: 2_000,
  },
  [ParticipantRole.Developer]: {
    minReputation: 50,
    requiredIdentityLevel: "trusted",
    minStake: 750,
  },
  [ParticipantRole.Governor]: {
    minReputation: 80,
    requiredIdentityLevel: "elite",
    minStake: 10_000,
  },
  [ParticipantRole.Investor]: {
    minReputation: 20,
    requiredIdentityLevel: "basic",
    minStake: 5_000,
  },
};

const ROLE_ALIASES: Record<string, ParticipantRole> = {
  taskissuer: ParticipantRole.TaskIssuer,
  task_issuer: ParticipantRole.TaskIssuer,
  "task-issuer": ParticipantRole.TaskIssuer,
  issuer: ParticipantRole.TaskIssuer,
  worker: ParticipantRole.Worker,
  validator: ParticipantRole.Validator,
  dataprovider: ParticipantRole.DataProvider,
  data_provider: ParticipantRole.DataProvider,
  "data-provider": ParticipantRole.DataProvider,
  computeprovider: ParticipantRole.ComputeProvider,
  compute_provider: ParticipantRole.ComputeProvider,
  "compute-provider": ParticipantRole.ComputeProvider,
  developer: ParticipantRole.Developer,
  governor: ParticipantRole.Governor,
  investor: ParticipantRole.Investor,
};

export function getRoleCapabilities(role: ParticipantRole): RoleCapabilityMatrix {
  return cloneCapabilityMatrix(ROLE_CAPABILITY_MATRIX[role]);
}

export function canPerformAction(role: ParticipantRole, action: string, module: RoleModule): boolean {
  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) {
    return false;
  }

  const capabilities = ROLE_CAPABILITY_MATRIX[role][module];
  return capabilities[normalizedAction] === true;
}

export function getRoleRequirements(role: ParticipantRole): RoleRequirements {
  const requirements = ROLE_REQUIREMENTS[role];
  return { ...requirements };
}

export function isRoleModule(value?: string): value is RoleModule {
  return value === "tasks" ||
    value === "compute" ||
    value === "data" ||
    value === "pay" ||
    value === "id" ||
    value === "dev" ||
    value === "governance" ||
    value === "economics";
}

export function parseParticipantRole(value?: string): ParticipantRole | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeAction(value);
  if (!normalized) {
    return null;
  }

  return ROLE_ALIASES[normalized] ?? null;
}

function normalizeAction(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function cloneCapabilityMatrix(matrix: RoleCapabilityMatrix): RoleCapabilityMatrix {
  return {
    tasks: { ...matrix.tasks },
    compute: { ...matrix.compute },
    data: { ...matrix.data },
    pay: { ...matrix.pay },
    id: { ...matrix.id },
    dev: { ...matrix.dev },
    governance: { ...matrix.governance },
    economics: { ...matrix.economics },
  };
}
