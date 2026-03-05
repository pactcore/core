import { generateId } from "../application/utils";

export type PrivacyLevel = "none" | "partial" | "full";

export interface PrivacyProofSetting {
  id?: string;
  name: string;
  privacyLevel: PrivacyLevel;
  proof: Record<string, unknown> | string;
  utilityRetention?: number;
  verificationOverhead?: number;
}

export interface PrivacyExperimentConfig {
  publicInputs: Record<string, unknown>;
  proofSettings: PrivacyProofSetting[];
  baselineUtilityScore?: number;
}

export interface PrivacyExperimentObservation {
  id: string;
  settingId: string;
  settingName: string;
  privacyLevel: PrivacyLevel;
  informationLeakage: number;
  privacyScore: number;
  utilityScore: number;
  tradeoffScore: number;
}

export interface PrivacyExperimentResult {
  id: string;
  createdAt: number;
  baselineUtilityScore: number;
  settingsEvaluated: number;
  bestSettingId: string | null;
  bestSettingName: string | null;
  observations: PrivacyExperimentObservation[];
  averageLeakage: number;
  averagePrivacyScore: number;
  averageUtilityScore: number;
}

const DEFAULT_UTILITY_RETENTION: Record<PrivacyLevel, number> = {
  none: 1,
  partial: 0.9,
  full: 0.78,
};

const DEFAULT_VERIFICATION_OVERHEAD: Record<PrivacyLevel, number> = {
  none: 0.02,
  partial: 0.12,
  full: 0.24,
};

const DEFAULT_LEVEL_UTILITY_PENALTY: Record<PrivacyLevel, number> = {
  none: 0,
  partial: 5,
  full: 11,
};

const BASE_LEAKAGE_BY_LEVEL: Record<PrivacyLevel, number> = {
  none: 0.38,
  partial: 0.22,
  full: 0.1,
};

const LEAKAGE_MARKER_PATTERN = /witness|secret|private|plaintext|raw|trapdoor|nonce/;
const REDACTION_MARKER_PATTERN = /redact|masked|commitment|blinded|hash/;

export function runPrivacyExperiment(config: PrivacyExperimentConfig): PrivacyExperimentResult {
  assertPlainRecord(config.publicInputs, "publicInputs");

  if (!Array.isArray(config.proofSettings) || config.proofSettings.length === 0) {
    throw new Error("proofSettings must contain at least one setting");
  }

  const baselineUtilityScore = clampScore(config.baselineUtilityScore ?? 100, "baselineUtilityScore");

  const observations = config.proofSettings.map((setting, index) => {
    assertSetting(setting, index);

    const settingId = setting.id && setting.id.trim().length > 0
      ? setting.id
      : generateId("zk_privacy_setting");

    const informationLeakage = measureInformationLeakage(setting.proof, config.publicInputs);
    const privacyScore = calculatePrivacyScore(informationLeakage);
    const utilityScore = calculateUtilityScore(setting, informationLeakage, baselineUtilityScore);
    const tradeoffScore = roundTo(privacyScore * 0.6 + utilityScore * 0.4, 2);

    return {
      id: generateId("zk_privacy_observation"),
      settingId,
      settingName: setting.name,
      privacyLevel: setting.privacyLevel,
      informationLeakage,
      privacyScore,
      utilityScore,
      tradeoffScore,
    };
  });

  const bestObservation = selectBestObservation(observations);

  return {
    id: generateId("zk_privacy_experiment"),
    createdAt: Date.now(),
    baselineUtilityScore,
    settingsEvaluated: observations.length,
    bestSettingId: bestObservation?.settingId ?? null,
    bestSettingName: bestObservation?.settingName ?? null,
    observations,
    averageLeakage: roundTo(average(observations.map((entry) => entry.informationLeakage)), 4),
    averagePrivacyScore: roundTo(average(observations.map((entry) => entry.privacyScore)), 2),
    averageUtilityScore: roundTo(average(observations.map((entry) => entry.utilityScore)), 2),
  };
}

export function measureInformationLeakage(
  proof: Record<string, unknown> | string,
  publicInputs: Record<string, unknown>,
): number {
  assertPlainRecord(publicInputs, "publicInputs");

  if (typeof proof !== "string" && !isPlainRecord(proof)) {
    throw new Error("proof must be a string or object");
  }

  const serializedProof = stableStringify(proof).toLowerCase();
  const entries = Object.entries(publicInputs);
  const hintedPrivacyLevel = readPrivacyLevelHint(proof, serializedProof);

  let leakage = hintedPrivacyLevel ? BASE_LEAKAGE_BY_LEVEL[hintedPrivacyLevel] : 0.24;

  for (const [key, value] of entries) {
    const normalizedKey = key.toLowerCase();
    const normalizedValue = normalizeForComparison(value);

    if (normalizedKey.length > 0 && serializedProof.includes(normalizedKey)) {
      leakage += 0.06;
    }

    if (normalizedValue.length > 3 && serializedProof.includes(normalizedValue)) {
      leakage += 0.12;
    }
  }

  leakage += clamp01(entries.length / 12) * 0.18;
  leakage += clamp01(serializedProof.length / 2_048) * 0.06;

  if (LEAKAGE_MARKER_PATTERN.test(serializedProof)) {
    leakage += 0.28;
  }
  if (REDACTION_MARKER_PATTERN.test(serializedProof)) {
    leakage -= 0.08;
  }

  return roundTo(clamp01(leakage), 4);
}

export function calculatePrivacyScore(leakage: number): number {
  if (!Number.isFinite(leakage)) {
    throw new Error("leakage must be a finite number");
  }
  return roundTo((1 - clamp01(leakage)) * 100, 2);
}

function calculateUtilityScore(
  setting: PrivacyProofSetting,
  informationLeakage: number,
  baselineUtilityScore: number,
): number {
  const utilityRetention = clamp01(
    setting.utilityRetention ?? DEFAULT_UTILITY_RETENTION[setting.privacyLevel],
  );
  const verificationOverhead = clamp01(
    setting.verificationOverhead ?? DEFAULT_VERIFICATION_OVERHEAD[setting.privacyLevel],
  );
  const levelPenalty = DEFAULT_LEVEL_UTILITY_PENALTY[setting.privacyLevel];
  const transparencyBenefit = informationLeakage * 14;

  const utility =
    baselineUtilityScore * utilityRetention -
    verificationOverhead * 20 -
    levelPenalty +
    transparencyBenefit;

  return roundTo(clamp(utility, 0, 100), 2);
}

function selectBestObservation(
  observations: PrivacyExperimentObservation[],
): PrivacyExperimentObservation | undefined {
  return observations.slice().sort((left, right) => {
    if (left.tradeoffScore !== right.tradeoffScore) {
      return right.tradeoffScore - left.tradeoffScore;
    }
    if (left.privacyScore !== right.privacyScore) {
      return right.privacyScore - left.privacyScore;
    }
    if (left.utilityScore !== right.utilityScore) {
      return right.utilityScore - left.utilityScore;
    }
    return left.settingName.localeCompare(right.settingName);
  })[0];
}

function assertSetting(setting: PrivacyProofSetting, index: number): void {
  if (typeof setting.name !== "string" || setting.name.trim().length === 0) {
    throw new Error(`proofSettings[${index}].name must be a non-empty string`);
  }
  if (setting.id !== undefined && (typeof setting.id !== "string" || setting.id.trim().length === 0)) {
    throw new Error(`proofSettings[${index}].id must be a non-empty string when provided`);
  }
  if (setting.utilityRetention !== undefined && !isValidRatio(setting.utilityRetention)) {
    throw new Error(`proofSettings[${index}].utilityRetention must be within [0, 1]`);
  }
  if (setting.verificationOverhead !== undefined && !isValidRatio(setting.verificationOverhead)) {
    throw new Error(`proofSettings[${index}].verificationOverhead must be within [0, 1]`);
  }
}

function clampScore(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return roundTo(clamp(value, 0, 100), 2);
}

function isValidRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function readPrivacyLevelHint(
  proof: Record<string, unknown> | string,
  serializedProof: string,
): PrivacyLevel | undefined {
  if (isPlainRecord(proof)) {
    const value = proof.privacyLevel;
    if (value === "none" || value === "partial" || value === "full") {
      return value;
    }
  }

  if (serializedProof.includes("privacy:none") || serializedProof.includes("transparent")) {
    return "none";
  }
  if (serializedProof.includes("privacy:full") || serializedProof.includes("zero-knowledge")) {
    return "full";
  }
  if (serializedProof.includes("privacy:partial")) {
    return "partial";
  }

  return undefined;
}

function normalizeForComparison(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).toLowerCase();
  }
  return stableStringify(value).toLowerCase();
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${key}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return String(value);
}

function assertPlainRecord(value: unknown, name: string): void {
  if (!isPlainRecord(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function roundTo(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
