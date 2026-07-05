// Singleton in-memory metrics store.
// Counters reset on server restart — intentional for operational visibility
// (current-session health), not long-term time-series storage.

export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  sampleSize: number;
}

export interface SlowEndpoint {
  path: string;
  p95: number;
  p99: number;
  count: number;
}

export interface MetricsSnapshot {
  requests: {
    total: number;
    errors: number;
    byStatus: Record<string, number>;
    avgDurationMs: number;
  };
  auth: {
    loginAttempts: number;
    loginFailures: number;
    rateLimitHits: number;
  };
  database: {
    queryCount: number;
    queryFailures: number;
    avgQueryMs: number;
  };
  backup: {
    runs: number;
    failures: number;
    lastRunAt: string | null;
  };
  process: {
    startedAt: string;
    uptimeSeconds: number;
  };
  latency: LatencyPercentiles;
  slowestEndpoints: SlowEndpoint[];
}

// Maximum durations kept in the sliding window for percentile computation.
const WINDOW_SIZE = 1000;
// Maximum duration entries tracked per endpoint.
const ENDPOINT_WINDOW = 200;

/** Replace numeric path segments and UUIDs with placeholders. */
function normalizePath(raw: string): string {
  return raw
    .split("?")[0]!
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "/:uuid",
    )
    .replace(/\/\d+/g, "/:id");
}

/** Compute the p-th percentile of a pre-sorted numeric array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

export class MetricsStore {
  // ── Request counters ──────────────────────────────────────────────────────
  private requestTotal = 0;
  private requestErrors = 0;
  private requestByStatus: Record<string, number> = {};
  private requestDurationSum = 0;

  // ── Sliding window for global percentiles ─────────────────────────────────
  private durationWindow: number[] = [];

  // ── Per-endpoint sliding windows ──────────────────────────────────────────
  private endpointDurations: Map<string, number[]> = new Map();

  // ── Auth counters ─────────────────────────────────────────────────────────
  private authLoginAttempts = 0;
  private authLoginFailures = 0;
  private authRateLimitHits = 0;

  // ── Database counters ─────────────────────────────────────────────────────
  private dbQueryCount = 0;
  private dbQueryFailures = 0;
  private dbDurationSum = 0;

  // ── Backup counters ───────────────────────────────────────────────────────
  private backupRuns = 0;
  private backupFailures = 0;
  private backupLastRunAt: string | null = null;

  private readonly startedAt = new Date().toISOString();

  // ── Public record methods ─────────────────────────────────────────────────

  recordRequest(statusCode: number, durationMs: number, path?: string): void {
    this.requestTotal++;
    this.requestDurationSum += durationMs;

    const key = String(statusCode);
    this.requestByStatus[key] = (this.requestByStatus[key] ?? 0) + 1;
    if (statusCode >= 500) this.requestErrors++;

    // Global latency window.
    if (this.durationWindow.length >= WINDOW_SIZE) this.durationWindow.shift();
    this.durationWindow.push(durationMs);

    // Per-endpoint window (normalized path).
    if (path) {
      const normalized = normalizePath(path);
      const arr = this.endpointDurations.get(normalized) ?? [];
      if (arr.length >= ENDPOINT_WINDOW) arr.shift();
      arr.push(durationMs);
      this.endpointDurations.set(normalized, arr);
    }
  }

  recordAuthAttempt(): void {
    this.authLoginAttempts++;
  }

  recordAuthFailure(): void {
    this.authLoginFailures++;
  }

  recordAuthRateLimit(): void {
    this.authRateLimitHits++;
  }

  recordDbQuery(durationMs: number): void {
    this.dbQueryCount++;
    this.dbDurationSum += durationMs;
  }

  recordDbFailure(): void {
    this.dbQueryFailures++;
  }

  recordBackupRun(success: boolean): void {
    this.backupRuns++;
    this.backupLastRunAt = new Date().toISOString();
    if (!success) this.backupFailures++;
  }

  // ── Computed views ────────────────────────────────────────────────────────

  latencyPercentiles(): LatencyPercentiles {
    const sorted = [...this.durationWindow].sort((a, b) => a - b);
    return {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      sampleSize: sorted.length,
    };
  }

  slowestEndpoints(n = 5): SlowEndpoint[] {
    return [...this.endpointDurations.entries()]
      .map(([path, durations]) => {
        const sorted = [...durations].sort((a, b) => a - b);
        return {
          path,
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
          count: durations.length,
        };
      })
      .sort((a, b) => b.p95 - a.p95)
      .slice(0, n);
  }

  snapshot(): MetricsSnapshot {
    return {
      requests: {
        total: this.requestTotal,
        errors: this.requestErrors,
        byStatus: { ...this.requestByStatus },
        avgDurationMs:
          this.requestTotal > 0
            ? Math.round(this.requestDurationSum / this.requestTotal)
            : 0,
      },
      auth: {
        loginAttempts: this.authLoginAttempts,
        loginFailures: this.authLoginFailures,
        rateLimitHits: this.authRateLimitHits,
      },
      database: {
        queryCount: this.dbQueryCount,
        queryFailures: this.dbQueryFailures,
        avgQueryMs:
          this.dbQueryCount > 0
            ? Math.round(this.dbDurationSum / this.dbQueryCount)
            : 0,
      },
      backup: {
        runs: this.backupRuns,
        failures: this.backupFailures,
        lastRunAt: this.backupLastRunAt,
      },
      process: {
        startedAt: this.startedAt,
        uptimeSeconds: Math.floor(process.uptime()),
      },
      latency: this.latencyPercentiles(),
      slowestEndpoints: this.slowestEndpoints(),
    };
  }

  reset(): void {
    this.requestTotal = 0;
    this.requestErrors = 0;
    this.requestByStatus = {};
    this.requestDurationSum = 0;
    this.durationWindow = [];
    this.endpointDurations = new Map();
    this.authLoginAttempts = 0;
    this.authLoginFailures = 0;
    this.authRateLimitHits = 0;
    this.dbQueryCount = 0;
    this.dbQueryFailures = 0;
    this.dbDurationSum = 0;
    this.backupRuns = 0;
    this.backupFailures = 0;
    this.backupLastRunAt = null;
  }
}

export const metrics = new MetricsStore();
