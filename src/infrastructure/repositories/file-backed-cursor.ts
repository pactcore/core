export interface DeterministicCursorPayload {
  position: number;
  id: string;
}

interface SerializedDeterministicCursorPayload {
  v: 1;
  p: number;
  i: string;
}

export function encodeDeterministicCursor(payload: DeterministicCursorPayload): string {
  assertCursorPayload(payload, "cursor payload");

  const serialized: SerializedDeterministicCursorPayload = {
    v: 1,
    p: payload.position,
    i: payload.id,
  };

  return Buffer.from(JSON.stringify(serialized), "utf8").toString("base64url");
}

export function decodeDeterministicCursor(
  cursor: string | undefined,
  label = "cursor",
): DeterministicCursorPayload | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<SerializedDeterministicCursorPayload>;

    if (parsed.v !== 1 || !Number.isInteger(parsed.p) || parsed.p < 0 || typeof parsed.i !== "string" || parsed.i.length === 0) {
      throw new Error();
    }

    return {
      position: parsed.p,
      id: parsed.i,
    };
  } catch {
    throw new Error(`invalid ${label}: ${cursor}`);
  }
}

export function compareDeterministicCursor(
  left: DeterministicCursorPayload,
  right: DeterministicCursorPayload,
): number {
  if (left.position !== right.position) {
    return left.position - right.position;
  }

  return left.id.localeCompare(right.id);
}

export function normalizePositiveLimit(
  value: number | undefined,
  fallback: number,
  max: number,
  label = "limit",
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid ${label}: ${value}`);
  }

  return Math.min(value, max);
}

function assertCursorPayload(payload: DeterministicCursorPayload, label: string): void {
  if (!Number.isInteger(payload.position) || payload.position < 0 || typeof payload.id !== "string" || payload.id.length === 0) {
    throw new Error(`invalid ${label}`);
  }
}
