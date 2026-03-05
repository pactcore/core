import type { EventJournal, EventJournalRecord } from "../contracts";
import { DomainEvents } from "../events";
import type { AntiSpamAction } from "../../domain/anti-spam";
import type { PaymentRoute } from "../../domain/payment-routing";
import type { Task } from "../../domain/types";
import { PactAntiSpam } from "./pact-anti-spam";
import { PactCompute } from "./pact-compute";
import { PactData } from "./pact-data";
import { PactDisputes } from "./pact-disputes";
import { PactEconomics } from "./pact-economics";
import { PactID } from "./pact-id";
import { PactMissions } from "./pact-missions";
import { PactPay } from "./pact-pay";
import { PactReputation } from "./pact-reputation";
import { PactTasks } from "./pact-tasks";

const EVENT_REPLAY_PAGE_SIZE = 500;
const ANALYTICS_ACTIONS: AntiSpamAction[] = ["task_creation", "bid_submission", "data_listing"];

export type AnalyticsPeriod = "hour" | "day" | "week";

export interface TopCategory {
  category: string;
  count: number;
}

export interface TopEarner {
  participantId: string;
  amountCents: number;
}

export interface ModuleRevenue {
  module: string;
  amountCents: number;
}

export interface NetworkStats {
  totalParticipants: number;
  totalTasks: number;
  completedTasks: number;
  disputeRate: number;
  avgReputation: number;
  totalRevenueCents: number;
  activeComputeProviders: number;
  dataAssetsCount: number;
}

export interface TaskAnalytics {
  created: number;
  completed: number;
  failed: number;
  avgCompletionTimeMs: number;
  topCategories: TopCategory[];
}

export interface EconomicAnalytics {
  totalSettled: number;
  avgPaymentCents: number;
  topEarners: TopEarner[];
  revenueByModule: ModuleRevenue[];
}

export interface SecurityAnalytics {
  spamBlockedCount: number;
  disputeCount: number;
  challengeCount: number;
  avgSpamScore: number;
}

export interface PactAnalyticsOptions {
  pactAntiSpam: PactAntiSpam;
  pactCompute: PactCompute;
  pactData: PactData;
  pactDisputes: PactDisputes;
  pactEconomics: PactEconomics;
  pactID: PactID;
  pactMissions: PactMissions;
  pactPay: PactPay;
  pactReputation: PactReputation;
  pactTasks: PactTasks;
  eventJournal: EventJournal;
  now?: () => number;
}

export class PactAnalytics {
  private readonly now: () => number;

  constructor(private readonly options: PactAnalyticsOptions) {
    this.now = options.now ?? Date.now;
  }

  async getNetworkStats(): Promise<NetworkStats> {
    const [participants, tasks, disputes, providers, assets, economics] = await Promise.all([
      this.options.pactID.listParticipants(),
      this.options.pactTasks.listTasks(),
      this.options.pactDisputes.listDisputes(),
      this.options.pactCompute.listProviders(),
      this.options.pactData.list(),
      this.getEconomicAnalytics(),
    ]);

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((task) => task.status === "Completed").length;
    const disputeRate = totalTasks > 0 ? disputes.length / totalTasks : 0;
    const avgReputation = await this.computeAverageReputation(participants.map((participant) => participant.id));

    return {
      totalParticipants: participants.length,
      totalTasks,
      completedTasks,
      disputeRate,
      avgReputation,
      totalRevenueCents: economics.totalSettled,
      activeComputeProviders: providers.filter((provider) => provider.status !== "offline").length,
      dataAssetsCount: assets.length,
    };
  }

  async getTaskAnalytics(period: AnalyticsPeriod): Promise<TaskAnalytics> {
    const periodStart = this.now() - periodWindowMs(period);
    const records = await this.replayAllEvents();
    const createdAtByTaskId = new Map<string, number>();
    const completionDurations: number[] = [];
    const topCategoryCounts = new Map<string, number>();

    let created = 0;
    let completed = 0;
    let failed = 0;

    for (const record of records) {
      if (record.event.name !== DomainEvents.TaskCreated) {
        continue;
      }
      const task = taskFromPayload(record.event.payload);
      if (!task) {
        continue;
      }
      const createdAt = typeof task.createdAt === "number" ? task.createdAt : record.event.createdAt;
      createdAtByTaskId.set(task.id, createdAt);
      if (record.event.createdAt >= periodStart) {
        created += 1;
        const category = taskCategory(task);
        topCategoryCounts.set(category, (topCategoryCounts.get(category) ?? 0) + 1);
      }
    }

    for (const record of records) {
      if (record.event.createdAt < periodStart) {
        continue;
      }

      if (record.event.name === DomainEvents.TaskCompleted) {
        completed += 1;
        const task = taskFromPayload(record.event.payload);
        const taskId = task?.id ?? taskIdFromPayload(record.event.payload);
        if (!taskId) {
          continue;
        }
        const createdAt = createdAtByTaskId.get(taskId);
        if (createdAt !== undefined) {
          completionDurations.push(Math.max(0, record.event.createdAt - createdAt));
        }
        continue;
      }

      if (record.event.name === DomainEvents.TaskValidationFailed) {
        failed += 1;
      }
    }

    const avgCompletionTimeMs = completionDurations.length > 0
      ? completionDurations.reduce((sum, value) => sum + value, 0) / completionDurations.length
      : 0;

    return {
      created,
      completed,
      failed,
      avgCompletionTimeMs,
      topCategories: [...topCategoryCounts.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category))
        .slice(0, 5),
    };
  }

  async getEconomicAnalytics(): Promise<EconomicAnalytics> {
    const [routes, settlementRecords, dataStats] = await Promise.all([
      this.options.pactPay.listRoutes(),
      this.options.pactEconomics.listSettlementRecords(),
      this.options.pactData.getMarketplaceStats(),
    ]);

    const revenueByModule = new Map<string, number>();
    const earningsByParticipant = new Map<string, number>();
    let paymentCount = 0;

    for (const route of routes) {
      if (!isCompletedRoute(route)) {
        continue;
      }
      addAmount(revenueByModule, "pact-pay", route.amount);
      addAmount(earningsByParticipant, route.toId, route.amount);
      paymentCount += 1;
    }

    for (const record of settlementRecords) {
      const moduleName = record.connectorMetadata?.module ?? "pact-economics";
      addAmount(revenueByModule, moduleName, record.amount);
      addAmount(earningsByParticipant, record.payeeId, record.amount);
      paymentCount += 1;
    }

    if (dataStats.totalRevenueCents > 0) {
      addAmount(revenueByModule, "pact-data", dataStats.totalRevenueCents);
      paymentCount += dataStats.totalPurchases;
    }

    const revenueByModuleList = [...revenueByModule.entries()]
      .map(([module, amountCents]) => ({ module, amountCents }))
      .sort((left, right) => right.amountCents - left.amountCents || left.module.localeCompare(right.module));
    const totalSettled = revenueByModuleList.reduce((sum, entry) => sum + entry.amountCents, 0);
    const avgPaymentCents = paymentCount > 0 ? totalSettled / paymentCount : 0;
    const topEarners = [...earningsByParticipant.entries()]
      .map(([participantId, amountCents]) => ({ participantId, amountCents }))
      .sort(
        (left, right) =>
          right.amountCents - left.amountCents || left.participantId.localeCompare(right.participantId),
      )
      .slice(0, 5);

    return {
      totalSettled,
      avgPaymentCents,
      topEarners,
      revenueByModule: revenueByModuleList,
    };
  }

  async getSecurityAnalytics(): Promise<SecurityAnalytics> {
    const [participants, disputes, missions] = await Promise.all([
      this.options.pactID.listParticipants(),
      this.options.pactDisputes.listDisputes(),
      this.options.pactMissions.listMissions(),
    ]);

    let spamBlockedCount = 0;
    let spamScoreTotal = 0;
    for (const participant of participants) {
      const profile = await this.options.pactAntiSpam.getParticipantSpamProfile(participant.id);
      spamScoreTotal += profile.spamScore;

      for (const action of ANALYTICS_ACTIONS) {
        const rateLimit = await this.options.pactAntiSpam.checkRateLimit(participant.id, action);
        if (!rateLimit.allowed) {
          spamBlockedCount += 1;
        }
      }
    }

    const challengeCount = missions.reduce((sum, mission) => sum + mission.challenges.length, 0);

    return {
      spamBlockedCount,
      disputeCount: disputes.length,
      challengeCount,
      avgSpamScore: participants.length > 0 ? spamScoreTotal / participants.length : 0,
    };
  }

  private async replayAllEvents(): Promise<EventJournalRecord[]> {
    const allRecords: EventJournalRecord[] = [];
    let nextOffset = 0;

    while (true) {
      const page = await this.options.eventJournal.replay(nextOffset, EVENT_REPLAY_PAGE_SIZE);
      if (page.length === 0) {
        return allRecords;
      }

      allRecords.push(...page);
      const last = page.at(-1);
      if (!last) {
        return allRecords;
      }
      nextOffset = last.offset + 1;
    }
  }

  private async computeAverageReputation(participantIds: string[]): Promise<number> {
    if (participantIds.length === 0) {
      return 0;
    }

    const profiles = await Promise.all(
      participantIds.map((participantId) => this.options.pactReputation.getProfile(participantId)),
    );
    const total = profiles.reduce((sum, profile) => sum + profile.overallScore, 0);
    return total / profiles.length;
  }
}

function periodWindowMs(period: AnalyticsPeriod): number {
  switch (period) {
    case "hour":
      return 60 * 60 * 1000;
    case "day":
      return 24 * 60 * 60 * 1000;
    case "week":
      return 7 * 24 * 60 * 60 * 1000;
  }
}

function taskFromPayload(payload: unknown): Task | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const task = (payload as { task?: unknown }).task;
  if (!task || typeof task !== "object") {
    return undefined;
  }

  const taskId = (task as { id?: unknown }).id;
  if (typeof taskId !== "string" || taskId.length === 0) {
    return undefined;
  }

  return task as Task;
}

function taskIdFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const taskId = (payload as { taskId?: unknown }).taskId;
  return typeof taskId === "string" && taskId.length > 0 ? taskId : undefined;
}

function taskCategory(task: Task): string {
  const requiredSkills = task.constraints?.requiredSkills;
  if (Array.isArray(requiredSkills) && requiredSkills.length > 0 && requiredSkills[0]) {
    return String(requiredSkills[0]);
  }
  return "uncategorized";
}

function isCompletedRoute(route: PaymentRoute): boolean {
  return route.status === "completed" && Number.isFinite(route.amount) && route.amount > 0;
}

function addAmount(target: Map<string, number>, key: string, rawAmount: number): void {
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return;
  }
  target.set(key, (target.get(key) ?? 0) + rawAmount);
}
