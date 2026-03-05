export type ThreatCategory =
  | "sybil_attack"
  | "collusion"
  | "front_running"
  | "replay_attack"
  | "data_poisoning"
  | "identity_theft"
  | "ddos"
  | "smart_contract_exploit";

export type ThreatSeverity = "low" | "medium" | "high" | "critical";

export interface ThreatEntry {
  id: string;
  category: ThreatCategory;
  description: string;
  severity: ThreatSeverity;
  mitigations: string[];
  residualRisk: number;
}

export interface SecurityAuditResult {
  timestamp: number;
  threats: ThreatEntry[];
  overallRiskScore: number;
  recommendations: string[];
}

export interface SecurityNetworkStats {
  participants: number;
  transactions: number;
  disputes: number;
  avgReputation: number;
}

interface RiskPressure {
  scale: number;
  activity: number;
  disputes: number;
  reputation: number;
}

const SEVERITY_WEIGHTS: Record<ThreatSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const THREAT_PRESSURES: Record<ThreatCategory, RiskPressure> = {
  sybil_attack: {
    scale: 0.4,
    activity: 0.2,
    disputes: 0.35,
    reputation: 0.9,
  },
  collusion: {
    scale: 0.35,
    activity: 0.45,
    disputes: 0.8,
    reputation: 0.4,
  },
  front_running: {
    scale: 0.15,
    activity: 1,
    disputes: 0.5,
    reputation: 0.2,
  },
  replay_attack: {
    scale: 0.1,
    activity: 0.8,
    disputes: 0.5,
    reputation: 0.2,
  },
  data_poisoning: {
    scale: 0.3,
    activity: 0.65,
    disputes: 0.8,
    reputation: 0.6,
  },
  identity_theft: {
    scale: 0.3,
    activity: 0.45,
    disputes: 0.5,
    reputation: 0.85,
  },
  ddos: {
    scale: 0.7,
    activity: 0.95,
    disputes: 0.2,
    reputation: 0.1,
  },
  smart_contract_exploit: {
    scale: 0.2,
    activity: 0.6,
    disputes: 0.45,
    reputation: 0.15,
  },
};

const THREAT_RECOMMENDATIONS: Record<ThreatCategory, string> = {
  sybil_attack:
    "Increase identity assurance: require stronger DID attestations and more stake for low-history participants.",
  collusion:
    "Tighten collusion analytics thresholds and escalate repeated participant pairings to manual review.",
  front_running:
    "Shorten acceptance windows, randomize ordering where possible, and flag suspicious timestamp clusters.",
  replay_attack:
    "Enforce strict nonce sequencing and reject out-of-order or duplicate operation submissions.",
  data_poisoning:
    "Require higher-integrity proofs and validator sampling for high-impact data updates.",
  identity_theft:
    "Mandate multi-factor credential checks and monitor abnormal account recovery patterns.",
  ddos:
    "Raise per-actor rate limiting and anti-spam stake under high load; isolate abusive traffic sources.",
  smart_contract_exploit:
    "Increase contract guardrails, run additional invariant checks, and gate high-risk settlement flows.",
};

const THREAT_CATALOG: ThreatEntry[] = [
  {
    id: "tm-12-1-sybil",
    category: "sybil_attack",
    description:
      "Adversaries create many pseudo-identities to gain disproportionate influence in validation, matching, or governance.",
    severity: "critical",
    mitigations: [
      "DID-linked participant identities with progressive trust levels.",
      "Stake-weighted anti-spam controls for task and listing actions.",
      "Reputation-aware validation thresholds across pipeline layers.",
    ],
    residualRisk: 0.42,
  },
  {
    id: "tm-12-1-collusion",
    category: "collusion",
    description:
      "Coordinated participants manipulate bidding, validation outcomes, or dispute votes for unfair advantage.",
    severity: "high",
    mitigations: [
      "Auction and vote-pattern monitoring for repeated pairings and timing correlations.",
      "Economic penalties through challenge stakes and forfeiture policies.",
      "Independent jury escalation path for contested outcomes.",
    ],
    residualRisk: 0.35,
  },
  {
    id: "tm-12-1-front-running",
    category: "front_running",
    description:
      "Actors exploit timing visibility to submit strategically ordered transactions ahead of legitimate operations.",
    severity: "high",
    mitigations: [
      "Short-lived request windows and route-level rate limiting.",
      "Timestamp-correlation analysis for suspiciously close submissions.",
      "Deterministic replayable event logs for forensic attribution.",
    ],
    residualRisk: 0.31,
  },
  {
    id: "tm-12-1-replay",
    category: "replay_attack",
    description:
      "Previously valid requests are resent to trigger duplicate state transitions or unauthorized repeat settlement.",
    severity: "high",
    mitigations: [
      "Per-participant nonce monotonicity checks.",
      "Event-journal traceability for duplicate operation detection.",
      "Idempotent settlement record reconciliation.",
    ],
    residualRisk: 0.29,
  },
  {
    id: "tm-12-1-data-poisoning",
    category: "data_poisoning",
    description:
      "Malicious or low-quality payloads contaminate shared datasets, model outputs, or provenance chains.",
    severity: "critical",
    mitigations: [
      "Integrity-proof registration and verification for data assets.",
      "Lineage graph inspection before derivative publication.",
      "Challenge + dispute workflow for contested evidence.",
    ],
    residualRisk: 0.38,
  },
  {
    id: "tm-12-1-identity-theft",
    category: "identity_theft",
    description:
      "Credential compromise allows attackers to impersonate trusted participants and misuse capabilities.",
    severity: "critical",
    mitigations: [
      "Credential issuance and verification checks.",
      "On-chain identity synchronization and level progression controls.",
      "Capability-bound access enforcement per participant role.",
    ],
    residualRisk: 0.33,
  },
  {
    id: "tm-12-1-ddos",
    category: "ddos",
    description:
      "High-volume request floods attempt to degrade API availability and disrupt normal protocol execution.",
    severity: "high",
    mitigations: [
      "Global and route-level request throttling.",
      "Participant-level anti-spam cooldowns and stake escalation.",
      "Operational telemetry for anomaly detection and response.",
    ],
    residualRisk: 0.36,
  },
  {
    id: "tm-12-1-smart-contract-exploit",
    category: "smart_contract_exploit",
    description:
      "Bugs or unexpected contract interactions create pathways for settlement abuse or escrow compromise.",
    severity: "critical",
    mitigations: [
      "Explicit contract client abstractions with typed boundaries.",
      "Deterministic settlement record lifecycle and replay.",
      "Conservative default routing and guarded state transitions.",
    ],
    residualRisk: 0.27,
  },
];

export function buildThreatModel(): ThreatEntry[] {
  return THREAT_CATALOG.map((entry) => ({
    ...entry,
    mitigations: [...entry.mitigations],
  }));
}

export function assessRisk(networkStats: SecurityNetworkStats): SecurityAuditResult {
  const stats = normalizeStats(networkStats);
  const pressure = deriveRiskPressure(stats);

  const threats = buildThreatModel().map((entry) => ({
    ...entry,
    residualRisk: computeAdjustedResidualRisk(entry, pressure),
  }));

  const overallRiskScore = calculateOverallRiskScore(threats);

  return {
    timestamp: Date.now(),
    threats,
    overallRiskScore,
    recommendations: buildRecommendations(threats, pressure),
  };
}

function computeAdjustedResidualRisk(entry: ThreatEntry, pressure: RiskPressure): number {
  const modifiers = THREAT_PRESSURES[entry.category];
  const additivePressure =
    pressure.scale * modifiers.scale * 0.25 +
    pressure.activity * modifiers.activity * 0.35 +
    pressure.disputes * modifiers.disputes * 0.3 +
    pressure.reputation * modifiers.reputation * 0.35;

  return roundTo3(clamp01(entry.residualRisk + additivePressure));
}

function calculateOverallRiskScore(threats: ThreatEntry[]): number {
  let totalWeight = 0;
  let weightedRisk = 0;

  for (const threat of threats) {
    const weight = SEVERITY_WEIGHTS[threat.severity];
    totalWeight += weight;
    weightedRisk += threat.residualRisk * weight;
  }

  if (totalWeight === 0) {
    return 0;
  }

  return roundTo2((weightedRisk / totalWeight) * 100);
}

function buildRecommendations(threats: ThreatEntry[], pressure: RiskPressure): string[] {
  const recommendations: string[] = [];
  const elevated = threats
    .filter((threat) => threat.residualRisk >= 0.6)
    .sort((a, b) => b.residualRisk - a.residualRisk);

  for (const threat of elevated) {
    recommendations.push(THREAT_RECOMMENDATIONS[threat.category]);
  }

  if (pressure.disputes >= 0.6) {
    recommendations.push("Increase dispute-review capacity and shorten escalation response times.");
  }

  if (pressure.reputation >= 0.6) {
    recommendations.push(
      "Raise identity verification requirements for new participants until average reputation stabilizes.",
    );
  }

  if (recommendations.length === 0) {
    return ["Current risk posture is stable; continue periodic audits and control validation."];
  }

  return [...new Set(recommendations)];
}

function deriveRiskPressure(stats: SecurityNetworkStats): RiskPressure {
  const participants = Math.max(1, stats.participants);
  const transactions = Math.max(1, stats.transactions);
  const activityPerParticipant = stats.transactions / participants;
  const disputeRate = stats.disputes / transactions;

  return {
    scale: clamp01(Math.log10(stats.participants + 1) / 4),
    activity: clamp01(activityPerParticipant / 25),
    disputes: clamp01(disputeRate / 0.2),
    reputation: 1 - clamp01(stats.avgReputation / 100),
  };
}

function normalizeStats(stats: SecurityNetworkStats): SecurityNetworkStats {
  assertNonNegativeFinite(stats.participants, "participants");
  assertNonNegativeFinite(stats.transactions, "transactions");
  assertNonNegativeFinite(stats.disputes, "disputes");

  if (!Number.isFinite(stats.avgReputation) || stats.avgReputation < 0 || stats.avgReputation > 100) {
    throw new Error("avgReputation must be between 0 and 100");
  }

  return {
    participants: stats.participants,
    transactions: stats.transactions,
    disputes: stats.disputes,
    avgReputation: stats.avgReputation,
  };
}

function assertNonNegativeFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundTo3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
