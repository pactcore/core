export interface NashEquilibriumState {
  players: string[];
  strategyProfile: Record<string, string>;
  payoffByPlayer: Record<string, number>;
  totalPayoff: number;
  profitableDeviations: string[];
  stable: boolean;
}

// Keys are serialized strategy profiles ordered by the `players` argument.
// Example for 2 players: "honest|dishonest".
export type PayoffMatrix = Record<string, number[]>;

const PAYOFF_EPSILON = 1e-9;

export function calculateNashEquilibrium(
  players: string[],
  strategies: string[],
  payoffs: PayoffMatrix,
): NashEquilibriumState | null {
  assertPlayers(players);
  assertStrategies(strategies);

  const profiles = generateProfiles(players.length, strategies);
  let bestState: NashEquilibriumState | null = null;
  let bestProfileKey: string | null = null;

  for (const profile of profiles) {
    const state = evaluateProfile(players, strategies, profile, payoffs);
    if (!state.stable) {
      continue;
    }

    const profileKey = serializeProfile(profile);
    if (
      bestState === null ||
      state.totalPayoff > bestState.totalPayoff ||
      (state.totalPayoff === bestState.totalPayoff &&
        (bestProfileKey === null || profileKey < bestProfileKey))
    ) {
      bestState = state;
      bestProfileKey = profileKey;
    }
  }

  return bestState;
}

export function isStableEquilibrium(state: NashEquilibriumState): boolean {
  return state.stable && state.profitableDeviations.length === 0;
}

function evaluateProfile(
  players: string[],
  strategies: string[],
  profile: string[],
  payoffs: PayoffMatrix,
): NashEquilibriumState {
  const profileKey = serializeProfile(profile);
  const currentPayoffs = getPayoffVector(payoffs, profileKey, players.length);
  const strategyProfile: Record<string, string> = {};
  const payoffByPlayer: Record<string, number> = {};
  const profitableDeviations: string[] = [];
  let totalPayoff = 0;

  for (let playerIndex = 0; playerIndex < players.length; playerIndex += 1) {
    const player = players[playerIndex];
    const currentStrategy = profile[playerIndex];
    const currentPayoff = currentPayoffs[playerIndex];

    if (player === undefined || currentStrategy === undefined || currentPayoff === undefined) {
      throw new Error("invalid profile while evaluating equilibrium state");
    }

    strategyProfile[player] = currentStrategy;
    payoffByPlayer[player] = currentPayoff;
    totalPayoff += currentPayoff;

    for (const candidateStrategy of strategies) {
      if (candidateStrategy === currentStrategy) {
        continue;
      }

      const deviatedProfile = profile.slice();
      deviatedProfile[playerIndex] = candidateStrategy;
      const deviatedKey = serializeProfile(deviatedProfile);
      const deviatedPayoff = getPayoffVector(payoffs, deviatedKey, players.length)[playerIndex];

      if (deviatedPayoff === undefined) {
        throw new Error(`missing payoff for player index ${playerIndex} in profile ${deviatedKey}`);
      }

      if (deviatedPayoff > currentPayoff + PAYOFF_EPSILON) {
        profitableDeviations.push(`${player}:${currentStrategy}->${candidateStrategy}`);
      }
    }
  }

  return {
    players: [...players],
    strategyProfile,
    payoffByPlayer,
    totalPayoff,
    profitableDeviations,
    stable: profitableDeviations.length === 0,
  };
}

function generateProfiles(playerCount: number, strategies: string[]): string[][] {
  const profiles: string[][] = [];
  const current: string[] = [];

  const walk = (depth: number): void => {
    if (depth === playerCount) {
      profiles.push([...current]);
      return;
    }

    for (const strategy of strategies) {
      current.push(strategy);
      walk(depth + 1);
      current.pop();
    }
  };

  walk(0);
  return profiles;
}

function getPayoffVector(
  payoffs: PayoffMatrix,
  profileKey: string,
  expectedPlayers: number,
): number[] {
  const payoffVector = payoffs[profileKey];
  if (payoffVector === undefined) {
    throw new Error(`missing payoff vector for strategy profile "${profileKey}"`);
  }
  if (payoffVector.length !== expectedPlayers) {
    throw new Error(
      `payoff vector for "${profileKey}" must have length ${expectedPlayers}, received ${payoffVector.length}`,
    );
  }

  for (let index = 0; index < payoffVector.length; index += 1) {
    const value = payoffVector[index];
    if (!Number.isFinite(value)) {
      throw new Error(`payoff for "${profileKey}" at index ${index} must be finite`);
    }
  }

  return payoffVector;
}

function assertPlayers(players: string[]): void {
  if (players.length === 0) {
    throw new Error("players must include at least one player");
  }

  const uniquePlayers = new Set(players);
  if (uniquePlayers.size !== players.length) {
    throw new Error("players must be unique");
  }

  for (const player of players) {
    if (player.trim().length === 0) {
      throw new Error("player identifiers must be non-empty");
    }
  }
}

function assertStrategies(strategies: string[]): void {
  if (strategies.length === 0) {
    throw new Error("strategies must include at least one strategy");
  }

  const uniqueStrategies = new Set(strategies);
  if (uniqueStrategies.size !== strategies.length) {
    throw new Error("strategies must be unique");
  }

  for (const strategy of strategies) {
    if (strategy.trim().length === 0) {
      throw new Error("strategy names must be non-empty");
    }
  }
}

function serializeProfile(profile: string[]): string {
  return profile.join("|");
}
