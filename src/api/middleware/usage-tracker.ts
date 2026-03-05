import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

export interface UsageRecord {
  apiKeyId: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  timestamp: number;
}

export interface UsageStats {
  apiKeyId: string;
  requestCount: number;
  errorCount: number;
  averageLatencyMs: number;
  lastRequestAt?: number;
}

export interface OverallUsageStats {
  requestCount: number;
  errorCount: number;
  averageLatencyMs: number;
  uniqueApiKeys: number;
}

export class UsageTracker {
  private readonly records: UsageRecord[] = [];
  private readonly recordsByKey = new Map<string, UsageRecord[]>();

  record(record: UsageRecord): void {
    this.records.push(record);
    const perKey = this.recordsByKey.get(record.apiKeyId) ?? [];
    perKey.push(record);
    this.recordsByKey.set(record.apiKeyId, perKey);
  }

  getStats(apiKeyId: string): UsageStats {
    const records = this.recordsByKey.get(apiKeyId) ?? [];
    const summary = summarize(records);
    const lastRecord = records[records.length - 1];

    return {
      apiKeyId,
      requestCount: summary.requestCount,
      errorCount: summary.errorCount,
      averageLatencyMs: summary.averageLatencyMs,
      lastRequestAt: lastRecord?.timestamp,
    };
  }

  getOverallStats(): OverallUsageStats {
    const summary = summarize(this.records);
    return {
      requestCount: summary.requestCount,
      errorCount: summary.errorCount,
      averageLatencyMs: summary.averageLatencyMs,
      uniqueApiKeys: this.recordsByKey.size,
    };
  }
}

export function createUsageTracker(tracker: UsageTracker): MiddlewareHandler {
  return async (c, next) => {
    const startedAt = Date.now();
    let requestError: unknown;

    try {
      await next();
    } catch (error) {
      requestError = error;
      throw error;
    } finally {
      const apiKeyInfo = c.get("apiKeyInfo");
      if (!apiKeyInfo?.id) {
        return;
      }

      tracker.record({
        apiKeyId: apiKeyInfo.id,
        method: c.req.method,
        path: c.req.path,
        statusCode:
          requestError instanceof HTTPException ? requestError.status : requestError ? 500 : c.res.status,
        latencyMs: Math.max(0, Date.now() - startedAt),
        timestamp: Date.now(),
      });
    }
  };
}

function summarize(records: UsageRecord[]): {
  requestCount: number;
  errorCount: number;
  averageLatencyMs: number;
} {
  if (records.length === 0) {
    return {
      requestCount: 0,
      errorCount: 0,
      averageLatencyMs: 0,
    };
  }

  let totalLatencyMs = 0;
  let errorCount = 0;
  for (const record of records) {
    totalLatencyMs += record.latencyMs;
    if (record.statusCode >= 400) {
      errorCount += 1;
    }
  }

  return {
    requestCount: records.length,
    errorCount,
    averageLatencyMs: totalLatencyMs / records.length,
  };
}
