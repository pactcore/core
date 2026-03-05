export type IdentityLevel = "basic" | "verified" | "trusted" | "elite";

export interface IdentityLevelRequirements {
  level: IdentityLevel;
  requiredTaskCount?: number;
  requiredMinReputation?: number;
  requiresZKProofOfHumanity?: boolean;
  requiresPhoneVerification?: boolean;
  requiresIdVerification?: boolean;
}

export interface IdentityLevelBenefits {
  level: IdentityLevel;
  maxConcurrentTasks: number;
  feeDiscountBps: number;
  canAccessPremiumTasks: boolean;
  taskPayoutMultiplierBps: number;
}

export interface IdentityLevelConfig {
  requirements: IdentityLevelRequirements;
  benefits: IdentityLevelBenefits;
}

export const DEFAULT_LEVEL_CONFIG: IdentityLevelConfig[] = [
  {
    requirements: { level: "basic" },
    benefits: {
      level: "basic",
      maxConcurrentTasks: 1,
      feeDiscountBps: 0,
      canAccessPremiumTasks: false,
      taskPayoutMultiplierBps: 10_000,
    },
  },
  {
    requirements: {
      level: "verified",
      requiresPhoneVerification: true,
      requiresIdVerification: true,
    },
    benefits: {
      level: "verified",
      maxConcurrentTasks: 3,
      feeDiscountBps: 250,
      canAccessPremiumTasks: false,
      taskPayoutMultiplierBps: 10_250,
    },
  },
  {
    requirements: {
      level: "trusted",
      requiresZKProofOfHumanity: true,
    },
    benefits: {
      level: "trusted",
      maxConcurrentTasks: 5,
      feeDiscountBps: 500,
      canAccessPremiumTasks: true,
      taskPayoutMultiplierBps: 10_500,
    },
  },
  {
    requirements: {
      level: "elite",
      requiredTaskCount: 100,
      requiredMinReputation: 95,
    },
    benefits: {
      level: "elite",
      maxConcurrentTasks: 10,
      feeDiscountBps: 1_000,
      canAccessPremiumTasks: true,
      taskPayoutMultiplierBps: 11_500,
    },
  },
];

interface IdentityLevelStats {
  taskCount: number;
  reputation: number;
  hasZKProof: boolean;
  hasPhoneVerification: boolean;
  hasIdVerification: boolean;
}

const LEVEL_ORDER: IdentityLevel[] = ["elite", "trusted", "verified", "basic"];

function satisfiesRequirements(
  stats: IdentityLevelStats,
  requirements: IdentityLevelRequirements,
): boolean {
  if (
    typeof requirements.requiredTaskCount === "number" &&
    stats.taskCount < requirements.requiredTaskCount
  ) {
    return false;
  }

  if (
    typeof requirements.requiredMinReputation === "number" &&
    stats.reputation < requirements.requiredMinReputation
  ) {
    return false;
  }

  if (requirements.requiresZKProofOfHumanity && !stats.hasZKProof) {
    return false;
  }

  if (requirements.requiresPhoneVerification && !stats.hasPhoneVerification) {
    return false;
  }

  if (requirements.requiresIdVerification && !stats.hasIdVerification) {
    return false;
  }

  return true;
}

export function determineLevel(stats: IdentityLevelStats): IdentityLevel {
  for (const level of LEVEL_ORDER) {
    const config = DEFAULT_LEVEL_CONFIG.find((entry) => entry.requirements.level === level);
    if (!config) {
      continue;
    }
    if (satisfiesRequirements(stats, config.requirements)) {
      return config.requirements.level;
    }
  }

  return "basic";
}

export function getLevelBenefits(level: IdentityLevel): IdentityLevelBenefits {
  const config = DEFAULT_LEVEL_CONFIG.find((entry) => entry.requirements.level === level);
  if (!config) {
    throw new Error(`Unknown identity level: ${level}`);
  }
  return { ...config.benefits };
}
