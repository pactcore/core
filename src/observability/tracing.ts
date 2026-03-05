export type SpanStatus = "ok" | "error";
export type SpanAttributeValue = string | number | boolean | null;
export type SpanAttributes = Record<string, SpanAttributeValue>;

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface SpanRecord extends TraceContext {
  name: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: SpanStatus;
  attributes: SpanAttributes;
  errorMessage?: string;
}

export interface TraceRecord {
  traceId: string;
  rootSpanId: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: SpanStatus;
  spans: SpanRecord[];
}

export interface StartSpanOptions {
  context?: {
    traceId: string;
    spanId?: string;
  };
  attributes?: SpanAttributes;
  startTime?: number;
}

export interface EndSpanOptions {
  status?: SpanStatus;
  error?: unknown;
  attributes?: SpanAttributes;
  endTime?: number;
}

interface MutableTrace {
  traceId: string;
  rootSpanId: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: SpanStatus;
  spans: SpanRecord[];
}

const DEFAULT_MAX_TRACES = 200;

export class ActiveSpan {
  private ended = false;

  constructor(
    private readonly tracer: InMemoryTracer,
    private readonly record: SpanRecord,
  ) {}

  get context(): TraceContext {
    return {
      traceId: this.record.traceId,
      spanId: this.record.spanId,
      parentSpanId: this.record.parentSpanId,
    };
  }

  setAttribute(key: string, value: SpanAttributeValue): void {
    if (this.ended) {
      return;
    }
    this.record.attributes[key] = value;
  }

  setAttributes(attributes: SpanAttributes): void {
    if (this.ended) {
      return;
    }
    Object.assign(this.record.attributes, attributes);
  }

  recordError(error: unknown): void {
    if (this.ended) {
      return;
    }

    this.record.status = "error";
    this.record.errorMessage = formatError(error);
  }

  child(name: string, options: Omit<StartSpanOptions, "context"> = {}): ActiveSpan {
    return this.tracer.startSpan(name, {
      ...options,
      context: {
        traceId: this.record.traceId,
        spanId: this.record.spanId,
      },
    });
  }

  end(options: EndSpanOptions = {}): void {
    if (this.ended) {
      return;
    }

    this.ended = true;
    this.tracer.endSpan(this.record, options);
  }
}

export class InMemoryTracer {
  private readonly traces = new Map<string, MutableTrace>();
  private readonly traceOrder: string[] = [];

  constructor(private readonly maxTraces = DEFAULT_MAX_TRACES) {}

  startSpan(name: string, options: StartSpanOptions = {}): ActiveSpan {
    const startedAt = options.startTime ?? Date.now();
    const traceId = options.context?.traceId ?? contextId("trace");
    const spanId = contextId("span");
    const parentSpanId = options.context?.spanId;

    let trace = this.traces.get(traceId);
    if (!trace) {
      trace = {
        traceId,
        rootSpanId: spanId,
        startedAt,
        status: "ok",
        spans: [],
      };
      this.traces.set(traceId, trace);
      this.traceOrder.push(traceId);
      this.trimTraceCapacity();
    }

    trace.startedAt = Math.min(trace.startedAt, startedAt);
    if (!parentSpanId && trace.spans.length === 0) {
      trace.rootSpanId = spanId;
    }

    const record: SpanRecord = {
      traceId,
      spanId,
      parentSpanId,
      name,
      startedAt,
      status: "ok",
      attributes: { ...(options.attributes ?? {}) },
    };
    trace.spans.push(record);

    return new ActiveSpan(this, record);
  }

  getTraces(limit = 50): TraceRecord[] {
    const normalizedLimit = normalizeLimit(limit, 50);
    const selectedTraceIds = this.traceOrder.slice(-normalizedLimit).reverse();

    return selectedTraceIds
      .map((traceId) => this.traces.get(traceId))
      .filter((trace): trace is MutableTrace => trace !== undefined)
      .map((trace) => ({
        traceId: trace.traceId,
        rootSpanId: trace.rootSpanId,
        startedAt: trace.startedAt,
        endedAt: trace.endedAt,
        durationMs: trace.durationMs,
        status: trace.status,
        spans: trace.spans.map((span) => ({
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          name: span.name,
          startedAt: span.startedAt,
          endedAt: span.endedAt,
          durationMs: span.durationMs,
          status: span.status,
          attributes: { ...span.attributes },
          errorMessage: span.errorMessage,
        })),
      }));
  }

  size(): number {
    return this.traces.size;
  }

  clear(): void {
    this.traces.clear();
    this.traceOrder.length = 0;
  }

  endSpan(record: SpanRecord, options: EndSpanOptions): void {
    const trace = this.traces.get(record.traceId);
    if (!trace || record.endedAt !== undefined) {
      return;
    }

    if (options.attributes) {
      Object.assign(record.attributes, options.attributes);
    }

    if (options.error !== undefined) {
      record.status = "error";
      record.errorMessage = formatError(options.error);
    } else if (options.status) {
      record.status = options.status;
    }

    const endedAt = options.endTime ?? Date.now();
    record.endedAt = endedAt;
    record.durationMs = Math.max(0, endedAt - record.startedAt);

    if (record.status === "error") {
      trace.status = "error";
    }

    const nextTraceEnd = trace.endedAt === undefined ? endedAt : Math.max(trace.endedAt, endedAt);
    trace.endedAt = nextTraceEnd;
    trace.durationMs = Math.max(0, nextTraceEnd - trace.startedAt);
  }

  private trimTraceCapacity(): void {
    while (this.traceOrder.length > this.maxTraces) {
      const oldestTraceId = this.traceOrder.shift();
      if (!oldestTraceId) {
        return;
      }
      this.traces.delete(oldestTraceId);
    }
  }
}

function contextId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function normalizeLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
