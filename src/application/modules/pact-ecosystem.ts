import type { PactCompute } from "./pact-compute";
import type { PactData } from "./pact-data";
import type { PactDev } from "./pact-dev";
import type { PactID } from "./pact-id";
import type { PactPay } from "./pact-pay";
import type { PactTasks } from "./pact-tasks";
import {
  EcosystemModule,
  type CrossAppSynergy,
  type CrossAppUserActivity,
  type EcosystemHealth,
  type EcosystemModuleStats,
  type ModuleDependency,
  assessEcosystemHealth,
  calculateCrossAppSynergy,
  getModuleDependencies,
} from "../../domain/ecosystem";

interface EcosystemSnapshot {
  tasks: Awaited<ReturnType<PactTasks["listTasks"]>>;
  routes: Awaited<ReturnType<PactPay["listRoutes"]>>;
  participants: Awaited<ReturnType<PactID["listParticipants"]>>;
  workers: Awaited<ReturnType<PactID["listWorkers"]>>;
  assets: Awaited<ReturnType<PactData["list"]>>;
  dataMarketplaceStats: Awaited<ReturnType<PactData["getMarketplaceStats"]>>;
  providers: Awaited<ReturnType<PactCompute["listProviders"]>>;
  usageRecords: Awaited<ReturnType<PactCompute["getUsageRecords"]>>;
  integrations: Awaited<ReturnType<PactDev["list"]>>;
  templates: Awaited<ReturnType<PactDev["listTemplates"]>>;
  policies: Awaited<ReturnType<PactDev["listPolicies"]>>;
}

export interface PactEcosystemOptions {
  pactTasks: PactTasks;
  pactPay: PactPay;
  pactID: PactID;
  pactData: PactData;
  pactCompute: PactCompute;
  pactDev: PactDev;
}

export class PactEcosystem {
  constructor(private readonly options: PactEcosystemOptions) {}

  async getEcosystemStatus(): Promise<EcosystemHealth> {
    const snapshot = await this.collectSnapshot();
    return assessEcosystemHealth(this.mapSnapshotToModuleStats(snapshot));
  }

  getModuleGraph(): ModuleDependency {
    return getModuleDependencies();
  }

  async getCrossAppMetrics(): Promise<CrossAppSynergy> {
    const snapshot = await this.collectSnapshot();
    return calculateCrossAppSynergy(this.mapSnapshotToUserActivity(snapshot));
  }

  private async collectSnapshot(): Promise<EcosystemSnapshot> {
    const [
      tasks,
      routes,
      participants,
      workers,
      assets,
      dataMarketplaceStats,
      providers,
      usageRecords,
      integrations,
      templates,
      policies,
    ] = await Promise.all([
      this.options.pactTasks.listTasks(),
      this.options.pactPay.listRoutes(),
      this.options.pactID.listParticipants(),
      this.options.pactID.listWorkers(),
      this.options.pactData.list(),
      this.options.pactData.getMarketplaceStats(),
      this.options.pactCompute.listProviders(),
      this.options.pactCompute.getUsageRecords(),
      this.options.pactDev.list(),
      this.options.pactDev.listTemplates(),
      this.options.pactDev.listPolicies(),
    ]);

    return {
      tasks,
      routes,
      participants,
      workers,
      assets,
      dataMarketplaceStats,
      providers,
      usageRecords,
      integrations,
      templates,
      policies,
    };
  }

  private mapSnapshotToModuleStats(snapshot: EcosystemSnapshot): EcosystemModuleStats {
    const completedTasks = snapshot.tasks.filter((task) => task.status === "Completed").length;
    const taskDurations = snapshot.tasks
      .filter((task) => task.status === "Completed")
      .map((task) => Math.max(0, task.updatedAt - task.createdAt));
    const taskActiveUsers = uniqueCount([
      ...snapshot.tasks.map((task) => task.issuerId),
      ...snapshot.tasks
        .map((task) => task.assigneeId)
        .filter((assigneeId): assigneeId is string => Boolean(assigneeId)),
    ]);

    const completedRoutes = snapshot.routes.filter((route) => route.status === "completed").length;
    const failedRoutes = snapshot.routes.filter((route) => route.status === "failed").length;
    const payActiveUsers = uniqueCount([
      ...snapshot.routes.map((route) => route.fromId),
      ...snapshot.routes.map((route) => route.toId),
    ]);

    const dataActiveUsers = uniqueCount(snapshot.assets.map((asset) => asset.ownerId));
    const onlineProviders = snapshot.providers.filter((provider) => provider.status !== "offline").length;
    const computeActiveUsers = uniqueCount(snapshot.providers.map((provider) => provider.id));
    const computeDurationsMs = snapshot.usageRecords
      .map((record) => record.cpuSeconds * 1_000)
      .filter((value) => Number.isFinite(value) && value >= 0);
    const activeIntegrations = snapshot.integrations.filter(
      (integration) => integration.status === "active",
    ).length;
    const deprecatedIntegrations = snapshot.integrations.filter(
      (integration) => integration.status === "deprecated",
    ).length;
    const devActiveUsers = uniqueCount(snapshot.integrations.map((integration) => integration.ownerId));

    return {
      [EcosystemModule.Tasks]: {
        availability:
          snapshot.tasks.length === 0
            ? 1
            : clamp01(0.75 + (completedTasks / snapshot.tasks.length) * 0.25),
        errorRate:
          snapshot.tasks.length === 0
            ? 0
            : clamp01(((snapshot.tasks.length - completedTasks) / snapshot.tasks.length) * 0.08),
        latencyMs: average(taskDurations, 450),
        throughput: snapshot.tasks.length,
        activeUsers: taskActiveUsers,
      },
      [EcosystemModule.Pay]: {
        availability:
          snapshot.routes.length === 0 ? 1 : clamp01(completedRoutes / snapshot.routes.length),
        errorRate: snapshot.routes.length === 0 ? 0 : clamp01(failedRoutes / snapshot.routes.length),
        latencyMs: snapshot.routes.length === 0 ? 180 : 260,
        throughput: snapshot.routes.length,
        activeUsers: payActiveUsers,
      },
      [EcosystemModule.ID]: {
        availability:
          snapshot.participants.length === 0
            ? 1
            : clamp01(
                0.92 +
                  Math.min(1, snapshot.workers.length / Math.max(1, snapshot.participants.length)) *
                    0.08,
              ),
        errorRate: 0,
        latencyMs: 120,
        throughput: snapshot.participants.length + snapshot.workers.length,
        activeUsers: snapshot.participants.length,
      },
      [EcosystemModule.Data]: {
        availability:
          snapshot.dataMarketplaceStats.totalListings === 0
            ? 1
            : clamp01(
                0.85 +
                  Math.min(
                    1,
                    snapshot.dataMarketplaceStats.totalPurchases /
                      Math.max(1, snapshot.dataMarketplaceStats.totalListings),
                  ) *
                    0.15,
              ),
        errorRate:
          snapshot.dataMarketplaceStats.totalListings === 0
            ? 0
            : clamp01(
                ((snapshot.dataMarketplaceStats.totalListings -
                  snapshot.dataMarketplaceStats.totalPurchases) /
                  snapshot.dataMarketplaceStats.totalListings) *
                  0.05,
              ),
        latencyMs: 320,
        throughput:
          snapshot.assets.length +
          snapshot.dataMarketplaceStats.totalListings +
          snapshot.dataMarketplaceStats.totalPurchases,
        activeUsers: dataActiveUsers,
      },
      [EcosystemModule.Compute]: {
        availability:
          snapshot.providers.length === 0 ? 1 : clamp01(onlineProviders / snapshot.providers.length),
        errorRate: 0,
        latencyMs: average(computeDurationsMs, 350),
        throughput: snapshot.providers.length + snapshot.usageRecords.length,
        activeUsers: computeActiveUsers,
      },
      [EcosystemModule.Dev]: {
        availability:
          snapshot.integrations.length === 0
            ? 1
            : clamp01(0.8 + (activeIntegrations / snapshot.integrations.length) * 0.2),
        errorRate:
          snapshot.integrations.length === 0
            ? 0
            : clamp01(deprecatedIntegrations / snapshot.integrations.length),
        latencyMs: 260,
        throughput: snapshot.integrations.length + snapshot.templates.length + snapshot.policies.length,
        activeUsers: devActiveUsers,
      },
    };
  }

  private mapSnapshotToUserActivity(snapshot: EcosystemSnapshot): CrossAppUserActivity[] {
    const activity: CrossAppUserActivity[] = [];

    for (const participant of snapshot.participants) {
      activity.push({
        userId: participant.id,
        module: EcosystemModule.ID,
        interactions: 1,
      });
    }

    for (const task of snapshot.tasks) {
      activity.push({
        userId: task.issuerId,
        module: EcosystemModule.Tasks,
        interactions: 1,
      });
      if (task.assigneeId) {
        activity.push({
          userId: task.assigneeId,
          module: EcosystemModule.Tasks,
          interactions: 1,
        });
      }
    }

    for (const route of snapshot.routes) {
      activity.push({
        userId: route.fromId,
        module: EcosystemModule.Pay,
        interactions: 1,
      });
      activity.push({
        userId: route.toId,
        module: EcosystemModule.Pay,
        interactions: 1,
      });
    }

    for (const asset of snapshot.assets) {
      activity.push({
        userId: asset.ownerId,
        module: EcosystemModule.Data,
        interactions: 1,
      });
    }

    for (const provider of snapshot.providers) {
      activity.push({
        userId: provider.id,
        module: EcosystemModule.Compute,
        interactions: 1,
      });
    }

    for (const integration of snapshot.integrations) {
      activity.push({
        userId: integration.ownerId,
        module: EcosystemModule.Dev,
        interactions: 1,
      });
    }

    return activity;
  }
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) {
    return fallback;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function uniqueCount(values: string[]): number {
  const set = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized) {
      set.add(normalized);
    }
  }
  return set.size;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
