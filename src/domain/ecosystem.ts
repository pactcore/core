export enum EcosystemModule {
  Tasks = "tasks",
  Pay = "pay",
  ID = "id",
  Data = "data",
  Compute = "compute",
  Dev = "dev",
}

export type ModuleDependency = Record<EcosystemModule, readonly EcosystemModule[]>;

export interface ModuleStatSnapshot {
  availability?: number;
  errorRate?: number;
  latencyMs?: number;
  throughput?: number;
  activeUsers?: number;
}

export type EcosystemModuleStats = Partial<Record<EcosystemModule, ModuleStatSnapshot>>;

export type EcosystemHealthState = "healthy" | "degraded" | "critical";

export interface ModuleHealth {
  module: EcosystemModule;
  status: EcosystemHealthState;
  score: number;
  availability: number;
  errorRate: number;
  latencyMs: number;
  throughput: number;
  activeUsers: number;
  dependencies: EcosystemModule[];
  dependencyIssues: EcosystemModule[];
}

export interface EcosystemHealth {
  generatedAt: number;
  score: number;
  status: EcosystemHealthState;
  healthyModules: number;
  degradedModules: number;
  criticalModules: number;
  dependencyRisk: number;
  modules: Record<EcosystemModule, ModuleHealth>;
}

export interface CrossAppUserActivity {
  userId: string;
  module: EcosystemModule;
  interactions?: number;
}

export interface ModuleCoverage {
  users: number;
  adoptionRate: number;
}

export interface CrossAppSynergy {
  generatedAt: number;
  sevenAppModel: {
    appCount: number;
    maxConnectionsPerUser: number;
    coreSurface: "pact-core";
  };
  activeUsers: number;
  participatingModules: EcosystemModule[];
  usersInMultipleModules: number;
  crossModuleRate: number;
  averageModulesPerUser: number;
  averageAppsPerUser: number;
  realizedConnectionDensity: number;
  synergyScore: number;
  amplificationFactor: number;
  moduleCoverage: Record<EcosystemModule, ModuleCoverage>;
}

const MODULE_DEPENDENCY_GRAPH: ModuleDependency = {
  [EcosystemModule.Tasks]: [
    EcosystemModule.ID,
    EcosystemModule.Pay,
    EcosystemModule.Compute,
    EcosystemModule.Data,
  ],
  [EcosystemModule.Pay]: [EcosystemModule.ID],
  [EcosystemModule.ID]: [],
  [EcosystemModule.Data]: [EcosystemModule.ID, EcosystemModule.Pay],
  [EcosystemModule.Compute]: [EcosystemModule.ID, EcosystemModule.Pay],
  [EcosystemModule.Dev]: [
    EcosystemModule.ID,
    EcosystemModule.Tasks,
    EcosystemModule.Data,
    EcosystemModule.Compute,
    EcosystemModule.Pay,
  ],
};

const MODULE_ORDER: EcosystemModule[] = [
  EcosystemModule.Tasks,
  EcosystemModule.Pay,
  EcosystemModule.ID,
  EcosystemModule.Data,
  EcosystemModule.Compute,
  EcosystemModule.Dev,
];

const MODULE_COUNT = MODULE_ORDER.length;
const SEVEN_APP_COUNT = 7;
const SEVEN_APP_MAX_CONNECTIONS_PER_USER = combination(SEVEN_APP_COUNT, 2);

export function getModuleDependencies(module: EcosystemModule): readonly EcosystemModule[];
export function getModuleDependencies(): ModuleDependency;
export function getModuleDependencies(
  module?: EcosystemModule,
): ModuleDependency | readonly EcosystemModule[] {
  if (module) {
    return [...MODULE_DEPENDENCY_GRAPH[module]];
  }

  return {
    [EcosystemModule.Tasks]: [...MODULE_DEPENDENCY_GRAPH[EcosystemModule.Tasks]],
    [EcosystemModule.Pay]: [...MODULE_DEPENDENCY_GRAPH[EcosystemModule.Pay]],
    [EcosystemModule.ID]: [...MODULE_DEPENDENCY_GRAPH[EcosystemModule.ID]],
    [EcosystemModule.Data]: [...MODULE_DEPENDENCY_GRAPH[EcosystemModule.Data]],
    [EcosystemModule.Compute]: [...MODULE_DEPENDENCY_GRAPH[EcosystemModule.Compute]],
    [EcosystemModule.Dev]: [...MODULE_DEPENDENCY_GRAPH[EcosystemModule.Dev]],
  };
}

export function assessEcosystemHealth(moduleStats: EcosystemModuleStats): EcosystemHealth {
  const dependencies = getModuleDependencies() as ModuleDependency;
  const normalizedByModule = {} as Record<EcosystemModule, Required<ModuleStatSnapshot>>;
  const baseScoreByModule = {} as Record<EcosystemModule, number>;

  for (const module of MODULE_ORDER) {
    const normalized = normalizeStats(moduleStats[module]);
    normalizedByModule[module] = normalized;
    baseScoreByModule[module] = calculateBaseModuleScore(normalized);
  }

  let healthyModules = 0;
  let degradedModules = 0;
  let criticalModules = 0;
  let brokenDependencyEdges = 0;
  let totalDependencyEdges = 0;
  let moduleScoreTotal = 0;

  const modules = {} as Record<EcosystemModule, ModuleHealth>;
  for (const module of MODULE_ORDER) {
    const deps = dependencies[module];
    totalDependencyEdges += deps.length;
    const dependencyIssues = deps.filter((dep) => baseScoreByModule[dep] < 60);
    brokenDependencyEdges += dependencyIssues.length;

    const dependencyPenalty = dependencyIssues.reduce((penalty, dep) => {
      const dependencyScore = baseScoreByModule[dep];
      return penalty + (dependencyScore < 40 ? 12 : 6);
    }, 0);

    const score = roundTo(clamp(baseScoreByModule[module] - dependencyPenalty, 0, 100), 2);
    moduleScoreTotal += score;
    const status = resolveHealthStatus(score);
    if (status === "healthy") {
      healthyModules += 1;
    } else if (status === "degraded") {
      degradedModules += 1;
    } else {
      criticalModules += 1;
    }

    const stats = normalizedByModule[module];
    modules[module] = {
      module,
      status,
      score,
      availability: roundTo(stats.availability, 4),
      errorRate: roundTo(stats.errorRate, 4),
      latencyMs: roundTo(stats.latencyMs, 2),
      throughput: roundTo(stats.throughput, 2),
      activeUsers: roundTo(stats.activeUsers, 2),
      dependencies: [...deps],
      dependencyIssues,
    };
  }

  const dependencyRisk =
    totalDependencyEdges > 0
      ? roundTo((brokenDependencyEdges / totalDependencyEdges) * 100, 2)
      : 0;
  const averageModuleScore = moduleScoreTotal / MODULE_COUNT;
  const score = roundTo(clamp(averageModuleScore - dependencyRisk * 0.15, 0, 100), 2);

  return {
    generatedAt: Date.now(),
    score,
    status: resolveHealthStatus(score),
    healthyModules,
    degradedModules,
    criticalModules,
    dependencyRisk,
    modules,
  };
}

export function calculateCrossAppSynergy(userActivity: CrossAppUserActivity[]): CrossAppSynergy {
  const moduleTouchesByUser = new Map<string, Set<EcosystemModule>>();
  const moduleUsers = {
    [EcosystemModule.Tasks]: new Set<string>(),
    [EcosystemModule.Pay]: new Set<string>(),
    [EcosystemModule.ID]: new Set<string>(),
    [EcosystemModule.Data]: new Set<string>(),
    [EcosystemModule.Compute]: new Set<string>(),
    [EcosystemModule.Dev]: new Set<string>(),
  };

  for (const activity of userActivity) {
    const userId = activity.userId.trim();
    if (!userId || !isEcosystemModule(activity.module)) {
      continue;
    }

    let moduleSet = moduleTouchesByUser.get(userId);
    if (!moduleSet) {
      moduleSet = new Set<EcosystemModule>();
      moduleTouchesByUser.set(userId, moduleSet);
    }
    moduleSet.add(activity.module);
    moduleUsers[activity.module].add(userId);
  }

  const activeUsers = moduleTouchesByUser.size;
  const emptyModuleCoverage = buildCoverage(moduleUsers, activeUsers);
  if (activeUsers === 0) {
    return {
      generatedAt: Date.now(),
      sevenAppModel: {
        appCount: SEVEN_APP_COUNT,
        maxConnectionsPerUser: SEVEN_APP_MAX_CONNECTIONS_PER_USER,
        coreSurface: "pact-core",
      },
      activeUsers: 0,
      participatingModules: [],
      usersInMultipleModules: 0,
      crossModuleRate: 0,
      averageModulesPerUser: 0,
      averageAppsPerUser: 0,
      realizedConnectionDensity: 0,
      synergyScore: 0,
      amplificationFactor: 1,
      moduleCoverage: emptyModuleCoverage,
    };
  }

  let usersInMultipleModules = 0;
  let moduleTouchesTotal = 0;
  let appTouchesTotal = 0;
  let realizedConnections = 0;

  for (const moduleSet of moduleTouchesByUser.values()) {
    const modulesUsed = moduleSet.size;
    moduleTouchesTotal += modulesUsed;
    if (modulesUsed > 1) {
      usersInMultipleModules += 1;
    }

    // 7-app model: six modules + the core coordination surface.
    const appsUsed = Math.min(SEVEN_APP_COUNT, modulesUsed + 1);
    appTouchesTotal += appsUsed;
    realizedConnections += combination(appsUsed, 2);
  }

  const crossModuleRate = usersInMultipleModules / activeUsers;
  const averageModulesPerUser = moduleTouchesTotal / activeUsers;
  const averageAppsPerUser = appTouchesTotal / activeUsers;
  const realizedConnectionDensity =
    realizedConnections / (activeUsers * SEVEN_APP_MAX_CONNECTIONS_PER_USER);

  const participatingModules = MODULE_ORDER.filter(
    (module) => moduleUsers[module].size > 0,
  );
  const moduleBreadth = participatingModules.length / MODULE_COUNT;

  const normalizedSynergy = clamp01(
    crossModuleRate * 0.45 + realizedConnectionDensity * 0.35 + moduleBreadth * 0.2,
  );
  const synergyScore = roundTo(normalizedSynergy * 100, 2);
  const amplificationFactor = roundTo(1 + normalizedSynergy * 0.8, 4);

  return {
    generatedAt: Date.now(),
    sevenAppModel: {
      appCount: SEVEN_APP_COUNT,
      maxConnectionsPerUser: SEVEN_APP_MAX_CONNECTIONS_PER_USER,
      coreSurface: "pact-core",
    },
    activeUsers,
    participatingModules,
    usersInMultipleModules,
    crossModuleRate: roundTo(crossModuleRate, 4),
    averageModulesPerUser: roundTo(averageModulesPerUser, 4),
    averageAppsPerUser: roundTo(averageAppsPerUser, 4),
    realizedConnectionDensity: roundTo(realizedConnectionDensity, 4),
    synergyScore,
    amplificationFactor,
    moduleCoverage: buildCoverage(moduleUsers, activeUsers),
  };
}

function calculateBaseModuleScore(stats: Required<ModuleStatSnapshot>): number {
  const availabilityScore = stats.availability * 100;
  const errorScore = (1 - stats.errorRate) * 100;
  const latencyScore = latencyHealthScore(stats.latencyMs);
  const adoptionScore = activityHealthScore(stats.activeUsers, stats.throughput);

  return clamp(
    availabilityScore * 0.4 + errorScore * 0.25 + latencyScore * 0.2 + adoptionScore * 0.15,
    0,
    100,
  );
}

function normalizeStats(input?: ModuleStatSnapshot): Required<ModuleStatSnapshot> {
  return {
    availability: normalizeRatio(input?.availability, 1),
    errorRate: normalizeRatio(input?.errorRate, 0),
    latencyMs: normalizeNumber(input?.latencyMs, 400, 0),
    throughput: normalizeNumber(input?.throughput, 0, 0),
    activeUsers: normalizeNumber(input?.activeUsers, 0, 0),
  };
}

function normalizeRatio(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  if (value > 1) {
    return clamp(value / 100, 0, 1);
  }
  return clamp(value, 0, 1);
}

function normalizeNumber(value: number | undefined, fallback: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, value);
}

function latencyHealthScore(latencyMs: number): number {
  if (latencyMs <= 200) {
    return 100;
  }
  if (latencyMs <= 500) {
    return 85;
  }
  if (latencyMs <= 1_000) {
    return 70;
  }
  if (latencyMs <= 2_000) {
    return 50;
  }
  if (latencyMs <= 3_500) {
    return 35;
  }
  return 20;
}

function activityHealthScore(activeUsers: number, throughput: number): number {
  const activityIndex = Math.max(activeUsers, Math.sqrt(Math.max(0, throughput)));
  if (activityIndex >= 200) {
    return 100;
  }
  if (activityIndex >= 100) {
    return 85;
  }
  if (activityIndex >= 50) {
    return 70;
  }
  if (activityIndex >= 10) {
    return 55;
  }
  if (activityIndex > 0) {
    return 40;
  }
  return 35;
}

function resolveHealthStatus(score: number): EcosystemHealthState {
  if (score >= 75) {
    return "healthy";
  }
  if (score >= 50) {
    return "degraded";
  }
  return "critical";
}

function buildCoverage(
  moduleUsers: Record<EcosystemModule, Set<string>>,
  activeUsers: number,
): Record<EcosystemModule, ModuleCoverage> {
  const denominator = Math.max(1, activeUsers);
  return {
    [EcosystemModule.Tasks]: {
      users: moduleUsers[EcosystemModule.Tasks].size,
      adoptionRate: roundTo(moduleUsers[EcosystemModule.Tasks].size / denominator, 4),
    },
    [EcosystemModule.Pay]: {
      users: moduleUsers[EcosystemModule.Pay].size,
      adoptionRate: roundTo(moduleUsers[EcosystemModule.Pay].size / denominator, 4),
    },
    [EcosystemModule.ID]: {
      users: moduleUsers[EcosystemModule.ID].size,
      adoptionRate: roundTo(moduleUsers[EcosystemModule.ID].size / denominator, 4),
    },
    [EcosystemModule.Data]: {
      users: moduleUsers[EcosystemModule.Data].size,
      adoptionRate: roundTo(moduleUsers[EcosystemModule.Data].size / denominator, 4),
    },
    [EcosystemModule.Compute]: {
      users: moduleUsers[EcosystemModule.Compute].size,
      adoptionRate: roundTo(moduleUsers[EcosystemModule.Compute].size / denominator, 4),
    },
    [EcosystemModule.Dev]: {
      users: moduleUsers[EcosystemModule.Dev].size,
      adoptionRate: roundTo(moduleUsers[EcosystemModule.Dev].size / denominator, 4),
    },
  };
}

function combination(n: number, k: number): number {
  if (k > n || k < 0) {
    return 0;
  }
  if (k === 0 || k === n) {
    return 1;
  }
  if (k === 1) {
    return n;
  }
  return Math.round((n * (n - 1)) / 2);
}

function isEcosystemModule(value: string): value is EcosystemModule {
  return MODULE_ORDER.includes(value as EcosystemModule);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function roundTo(value: number, decimals: number): number {
  const precision = Math.pow(10, decimals);
  return Math.round(value * precision) / precision;
}
