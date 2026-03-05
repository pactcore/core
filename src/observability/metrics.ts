export type MetricLabels = Record<string, string>;

type MetricType = "counter" | "gauge" | "histogram";

interface LabeledValue {
  labels: MetricLabels;
  value: number;
}

interface HistogramSeries {
  labels: MetricLabels;
  count: number;
  sum: number;
  min: number;
  max: number;
  bucketCounts: number[];
}

export interface CounterSnapshot {
  type: "counter";
  name: string;
  description?: string;
  values: LabeledValue[];
  total: number;
}

export interface GaugeSnapshot {
  type: "gauge";
  name: string;
  description?: string;
  values: LabeledValue[];
}

export interface HistogramBucketSnapshot {
  le: number | "+Inf";
  count: number;
}

export interface HistogramValueSnapshot {
  labels: MetricLabels;
  count: number;
  sum: number;
  min: number;
  max: number;
  average: number;
  buckets: HistogramBucketSnapshot[];
}

export interface HistogramSnapshot {
  type: "histogram";
  name: string;
  description?: string;
  buckets: number[];
  values: HistogramValueSnapshot[];
  count: number;
  sum: number;
}

export interface MetricsSnapshot {
  generatedAt: number;
  counters: CounterSnapshot[];
  gauges: GaugeSnapshot[];
  histograms: HistogramSnapshot[];
}

export interface HistogramOptions {
  description?: string;
  buckets?: number[];
}

const DEFAULT_HISTOGRAM_BUCKETS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];

export class InMemoryCounter {
  private readonly values = new Map<string, LabeledValue>();

  constructor(
    public readonly name: string,
    public readonly description?: string,
  ) {}

  inc(labels: MetricLabels = {}, by = 1): void {
    if (!Number.isFinite(by) || by <= 0) {
      return;
    }

    const { key, normalizedLabels } = normalizeLabels(labels);
    const current = this.values.get(key);
    if (!current) {
      this.values.set(key, {
        labels: normalizedLabels,
        value: by,
      });
      return;
    }

    current.value += by;
  }

  get(labels: MetricLabels = {}): number {
    const key = normalizeLabels(labels).key;
    return this.values.get(key)?.value ?? 0;
  }

  snapshot(): CounterSnapshot {
    const values = sortSeries(this.values);
    return {
      type: "counter",
      name: this.name,
      description: this.description,
      values,
      total: values.reduce((sum, entry) => sum + entry.value, 0),
    };
  }

  clear(): void {
    this.values.clear();
  }
}

export class InMemoryGauge {
  private readonly values = new Map<string, LabeledValue>();

  constructor(
    public readonly name: string,
    public readonly description?: string,
  ) {}

  set(labels: MetricLabels = {}, value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    const { key, normalizedLabels } = normalizeLabels(labels);
    this.values.set(key, {
      labels: normalizedLabels,
      value,
    });
  }

  inc(labels: MetricLabels = {}, by = 1): void {
    if (!Number.isFinite(by)) {
      return;
    }

    const { key, normalizedLabels } = normalizeLabels(labels);
    const current = this.values.get(key);
    if (!current) {
      this.values.set(key, {
        labels: normalizedLabels,
        value: by,
      });
      return;
    }
    current.value += by;
  }

  dec(labels: MetricLabels = {}, by = 1): void {
    this.inc(labels, -by);
  }

  get(labels: MetricLabels = {}): number {
    const key = normalizeLabels(labels).key;
    return this.values.get(key)?.value ?? 0;
  }

  snapshot(): GaugeSnapshot {
    return {
      type: "gauge",
      name: this.name,
      description: this.description,
      values: sortSeries(this.values),
    };
  }

  clear(): void {
    this.values.clear();
  }
}

export class InMemoryHistogram {
  private readonly values = new Map<string, HistogramSeries>();
  private readonly buckets: number[];

  constructor(
    public readonly name: string,
    public readonly description?: string,
    buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS,
  ) {
    this.buckets = normalizeBuckets(buckets);
  }

  observe(value: number, labels: MetricLabels = {}): void {
    if (!Number.isFinite(value)) {
      return;
    }

    const { key, normalizedLabels } = normalizeLabels(labels);
    const current =
      this.values.get(key) ??
      ({
        labels: normalizedLabels,
        count: 0,
        sum: 0,
        min: value,
        max: value,
        bucketCounts: new Array(this.buckets.length + 1).fill(0),
      } satisfies HistogramSeries);

    current.count += 1;
    current.sum += value;
    current.min = Math.min(current.min, value);
    current.max = Math.max(current.max, value);

    const bucketIndex = findBucketIndex(value, this.buckets);
    current.bucketCounts[bucketIndex] += 1;

    this.values.set(key, current);
  }

  snapshot(): HistogramSnapshot {
    const values = Array.from(this.values.values())
      .sort((a, b) => labelsSortKey(a.labels).localeCompare(labelsSortKey(b.labels)))
      .map((entry) => {
        let runningCount = 0;
        const buckets: HistogramBucketSnapshot[] = entry.bucketCounts.map((count, index) => {
          runningCount += count;
          return {
            le: index < this.buckets.length ? this.buckets[index] : "+Inf",
            count: runningCount,
          };
        });

        return {
          labels: { ...entry.labels },
          count: entry.count,
          sum: entry.sum,
          min: entry.min,
          max: entry.max,
          average: entry.count > 0 ? entry.sum / entry.count : 0,
          buckets,
        } satisfies HistogramValueSnapshot;
      });

    return {
      type: "histogram",
      name: this.name,
      description: this.description,
      buckets: [...this.buckets],
      values,
      count: values.reduce((sum, entry) => sum + entry.count, 0),
      sum: values.reduce((sum, entry) => sum + entry.sum, 0),
    };
  }

  clear(): void {
    this.values.clear();
  }
}

export class InMemoryMetricsRegistry {
  private readonly counters = new Map<string, InMemoryCounter>();
  private readonly gauges = new Map<string, InMemoryGauge>();
  private readonly histograms = new Map<string, InMemoryHistogram>();
  private readonly metricTypes = new Map<string, MetricType>();

  counter(name: string, description?: string): InMemoryCounter {
    this.assertMetricType(name, "counter");
    const existing = this.counters.get(name);
    if (existing) {
      return existing;
    }

    const metric = new InMemoryCounter(name, description);
    this.counters.set(name, metric);
    return metric;
  }

  gauge(name: string, description?: string): InMemoryGauge {
    this.assertMetricType(name, "gauge");
    const existing = this.gauges.get(name);
    if (existing) {
      return existing;
    }

    const metric = new InMemoryGauge(name, description);
    this.gauges.set(name, metric);
    return metric;
  }

  histogram(name: string, options: HistogramOptions = {}): InMemoryHistogram {
    this.assertMetricType(name, "histogram");
    const existing = this.histograms.get(name);
    if (existing) {
      return existing;
    }

    const metric = new InMemoryHistogram(name, options.description, options.buckets);
    this.histograms.set(name, metric);
    return metric;
  }

  snapshot(): MetricsSnapshot {
    return {
      generatedAt: Date.now(),
      counters: Array.from(this.counters.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((metric) => metric.snapshot()),
      gauges: Array.from(this.gauges.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((metric) => metric.snapshot()),
      histograms: Array.from(this.histograms.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((metric) => metric.snapshot()),
    };
  }

  clear(): void {
    for (const metric of this.counters.values()) {
      metric.clear();
    }
    for (const metric of this.gauges.values()) {
      metric.clear();
    }
    for (const metric of this.histograms.values()) {
      metric.clear();
    }
  }

  private assertMetricType(name: string, expectedType: MetricType): void {
    const currentType = this.metricTypes.get(name);
    if (currentType && currentType !== expectedType) {
      throw new Error(
        `Metric "${name}" already exists as type "${currentType}" and cannot be reused as "${expectedType}"`,
      );
    }
    this.metricTypes.set(name, expectedType);
  }
}

function normalizeLabels(labels: MetricLabels): {
  key: string;
  normalizedLabels: MetricLabels;
} {
  const entries = Object.entries(labels).filter((entry) => entry[1] !== undefined);
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  const normalizedLabels: MetricLabels = {};
  for (const [key, value] of entries) {
    normalizedLabels[key] = String(value);
  }

  const key = labelsSortKey(normalizedLabels);
  return {
    key,
    normalizedLabels,
  };
}

function labelsSortKey(labels: MetricLabels): string {
  const keys = Object.keys(labels).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) {
    return "__no_labels__";
  }

  return keys.map((key) => `${key}=${labels[key] ?? ""}`).join("|");
}

function sortSeries(values: Map<string, LabeledValue>): LabeledValue[] {
  return Array.from(values.values())
    .map((entry) => ({
      labels: { ...entry.labels },
      value: entry.value,
    }))
    .sort((a, b) => labelsSortKey(a.labels).localeCompare(labelsSortKey(b.labels)));
}

function normalizeBuckets(buckets: number[]): number[] {
  const values = buckets.filter((value) => Number.isFinite(value)).map((value) => Number(value));
  values.sort((a, b) => a - b);
  const deduped: number[] = [];

  for (const value of values) {
    if (deduped[deduped.length - 1] !== value) {
      deduped.push(value);
    }
  }

  return deduped.length > 0 ? deduped : [...DEFAULT_HISTOGRAM_BUCKETS];
}

function findBucketIndex(value: number, buckets: number[]): number {
  for (let index = 0; index < buckets.length; index += 1) {
    const bucketValue = buckets[index];
    if (bucketValue !== undefined && value <= bucketValue) {
      return index;
    }
  }

  return buckets.length;
}
