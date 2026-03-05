export interface NetworkSnapshot {
  participants: number;
  applications: number;
  transactions: number;
}

export interface GrowthProjection extends NetworkSnapshot {
  month: number;
  networkValue: number;
  participantGrowthRate: number;
  applicationGrowthRate: number;
  transactionGrowthRate: number;
}

export interface ApplicationUsage {
  participantId: string;
  applicationId: string;
  transactionCount?: number;
}

export interface SynergyScore {
  score: number;
  amplificationFactor: number;
  participantCount: number;
  applicationCount: number;
  crossApplicationParticipants: number;
  crossApplicationRate: number;
  averageApplicationsPerParticipant: number;
}

interface NetworkEffectsParameters {
  metcalfeExponent: number;
  applicationWeight: number;
  transactionWeight: number;
  valueScale: number;
}

interface GrowthSimulationParameters {
  participantGrowthRate: number;
  applicationGrowthRate: number;
  transactionGrowthRate: number;
  participantCapacityMultiplier: number;
  applicationCapacityMultiplier: number;
  transactionCapacityMultiplier: number;
  minimumParticipantCapacity: number;
  minimumApplicationCapacity: number;
  minimumTransactionCapacity: number;
}

const DEFAULT_NETWORK_PARAMETERS: NetworkEffectsParameters = {
  metcalfeExponent: 1.9,
  applicationWeight: 0.25,
  transactionWeight: 0.12,
  valueScale: 1,
};

const DEFAULT_GROWTH_PARAMETERS: GrowthSimulationParameters = {
  participantGrowthRate: 0.22,
  applicationGrowthRate: 0.16,
  transactionGrowthRate: 0.28,
  participantCapacityMultiplier: 5,
  applicationCapacityMultiplier: 4,
  transactionCapacityMultiplier: 8,
  minimumParticipantCapacity: 1_000,
  minimumApplicationCapacity: 25,
  minimumTransactionCapacity: 20_000,
};

export class NetworkEffectsModel {
  private readonly parameters: NetworkEffectsParameters;

  constructor(parameters: Partial<NetworkEffectsParameters> = {}) {
    this.parameters = { ...DEFAULT_NETWORK_PARAMETERS, ...parameters };
  }

  calculateNetworkValue(participants: number, applications: number, transactions: number): number {
    const participantCount = toNonNegative(participants);
    if (participantCount < 2) {
      return 0;
    }

    const applicationCount = Math.max(1, toNonNegative(applications));
    const transactionCount = toNonNegative(transactions);
    const pairCount = participantCount * (participantCount - 1);
    const metcalfeTerm = Math.pow(pairCount, this.parameters.metcalfeExponent / 2);
    const applicationTerm = 1 + this.parameters.applicationWeight * Math.log2(applicationCount + 1);
    const transactionTerm = 1 + this.parameters.transactionWeight * Math.log10(transactionCount + 10);

    const value =
      this.parameters.valueScale * metcalfeTerm * applicationTerm * transactionTerm;
    return roundTo(value, 2);
  }
}

export class CrossApplicationSynergy {
  calculateSynergyScore(usage: ApplicationUsage[]): SynergyScore {
    const usageByParticipant = new Map<string, Set<string>>();
    const applicationIds = new Set<string>();

    for (const entry of usage) {
      if (!entry.participantId || !entry.applicationId) {
        continue;
      }

      applicationIds.add(entry.applicationId);
      const participantUsage = usageByParticipant.get(entry.participantId);
      if (participantUsage) {
        participantUsage.add(entry.applicationId);
      } else {
        usageByParticipant.set(entry.participantId, new Set([entry.applicationId]));
      }
    }

    const participantCount = usageByParticipant.size;
    if (participantCount === 0) {
      return {
        score: 0,
        amplificationFactor: 1,
        participantCount: 0,
        applicationCount: applicationIds.size,
        crossApplicationParticipants: 0,
        crossApplicationRate: 0,
        averageApplicationsPerParticipant: 0,
      };
    }

    let totalApplicationTouches = 0;
    let crossApplicationParticipants = 0;

    for (const appSet of usageByParticipant.values()) {
      totalApplicationTouches += appSet.size;
      if (appSet.size > 1) {
        crossApplicationParticipants += 1;
      }
    }

    const averageApplicationsPerParticipant = totalApplicationTouches / participantCount;
    const crossApplicationRate = crossApplicationParticipants / participantCount;
    const maxSpread = Math.max(1, applicationIds.size - 1);
    const breadthFactor = clamp01((averageApplicationsPerParticipant - 1) / maxSpread);
    const normalizedScore = clamp01(crossApplicationRate * 0.65 + breadthFactor * 0.35);
    const score = roundTo(normalizedScore * 100, 2);
    const amplificationFactor = roundTo(1 + normalizedScore * 0.75, 4);

    return {
      score,
      amplificationFactor,
      participantCount,
      applicationCount: applicationIds.size,
      crossApplicationParticipants,
      crossApplicationRate: roundTo(crossApplicationRate, 4),
      averageApplicationsPerParticipant: roundTo(averageApplicationsPerParticipant, 4),
    };
  }

  amplifyValue(baseValue: number, synergy: SynergyScore): number {
    const sanitizedValue = Math.max(0, baseValue);
    if (!Number.isFinite(sanitizedValue) || sanitizedValue === 0) {
      return 0;
    }
    return roundTo(sanitizedValue * Math.max(1, synergy.amplificationFactor), 2);
  }
}

export class NetworkGrowthSimulator {
  private readonly networkModel: NetworkEffectsModel;
  private readonly parameters: GrowthSimulationParameters;

  constructor(
    networkModel: NetworkEffectsModel = new NetworkEffectsModel(),
    parameters: Partial<GrowthSimulationParameters> = {},
  ) {
    this.networkModel = networkModel;
    this.parameters = { ...DEFAULT_GROWTH_PARAMETERS, ...parameters };
  }

  projectGrowth(current: NetworkSnapshot, months: number): GrowthProjection[] {
    const projectionHorizon = Math.max(0, Math.floor(months));
    if (projectionHorizon === 0) {
      return [];
    }

    const startingParticipants = Math.max(1, toNonNegative(current.participants));
    const startingApplications = Math.max(1, toNonNegative(current.applications));
    const startingTransactions = Math.max(1, toNonNegative(current.transactions));

    const participantCapacity = Math.max(
      this.parameters.minimumParticipantCapacity,
      Math.round(startingParticipants * this.parameters.participantCapacityMultiplier),
    );
    const applicationCapacity = Math.max(
      this.parameters.minimumApplicationCapacity,
      Math.round(startingApplications * this.parameters.applicationCapacityMultiplier),
    );
    const transactionCapacity = Math.max(
      this.parameters.minimumTransactionCapacity,
      Math.round(startingTransactions * this.parameters.transactionCapacityMultiplier),
    );

    const projections: GrowthProjection[] = [];
    let previousParticipants = startingParticipants;
    let previousApplications = startingApplications;
    let previousTransactions = startingTransactions;

    for (let month = 1; month <= projectionHorizon; month += 1) {
      const participants = projectLogistic(
        startingParticipants,
        participantCapacity,
        this.parameters.participantGrowthRate,
        month,
      );
      const applications = projectLogistic(
        startingApplications,
        applicationCapacity,
        this.parameters.applicationGrowthRate,
        month,
      );
      const transactions = projectLogistic(
        startingTransactions,
        transactionCapacity,
        this.parameters.transactionGrowthRate,
        month,
      );

      const networkValue = this.networkModel.calculateNetworkValue(
        participants,
        applications,
        transactions,
      );

      projections.push({
        month,
        participants,
        applications,
        transactions,
        networkValue,
        participantGrowthRate: roundTo(relativeGrowth(previousParticipants, participants), 4),
        applicationGrowthRate: roundTo(relativeGrowth(previousApplications, applications), 4),
        transactionGrowthRate: roundTo(relativeGrowth(previousTransactions, transactions), 4),
      });

      previousParticipants = participants;
      previousApplications = applications;
      previousTransactions = transactions;
    }

    return projections;
  }
}

export function calculateNetworkValue(
  participants: number,
  applications: number,
  transactions: number,
): number {
  return new NetworkEffectsModel().calculateNetworkValue(participants, applications, transactions);
}

export function projectGrowth(current: NetworkSnapshot, months: number): GrowthProjection[] {
  return new NetworkGrowthSimulator().projectGrowth(current, months);
}

export function calculateSynergyScore(usage: ApplicationUsage[]): SynergyScore {
  return new CrossApplicationSynergy().calculateSynergyScore(usage);
}

function projectLogistic(
  initial: number,
  carryingCapacity: number,
  growthRate: number,
  month: number,
): number {
  const adjustedInitial = Math.max(1, initial);
  const adjustedCapacity = Math.max(adjustedInitial + 1, carryingCapacity);
  const exponent = Math.exp(-growthRate * month);
  const projected =
    adjustedCapacity /
    (1 + ((adjustedCapacity - adjustedInitial) / adjustedInitial) * exponent);
  return Math.max(adjustedInitial, Math.round(projected));
}

function relativeGrowth(previous: number, current: number): number {
  if (previous <= 0) {
    return 0;
  }
  return (current - previous) / previous;
}

function toNonNegative(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function roundTo(value: number, decimals: number): number {
  const precision = Math.pow(10, decimals);
  return Math.round(value * precision) / precision;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
