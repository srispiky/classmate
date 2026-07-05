// Singleton in-memory metrics store.
// Counters reset on server restart — this is intentional for operational
// visibility (current-session health), not long-term time-series storage.
// For persistent metrics, export these snapshots to an external system.

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
    queryFailures: number;
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
}

export class MetricsStore {
  private requestTotal = 0;
  private requestErrors = 0;
  private requestByStatus: Record<string, number> = {};
  private requestDurationSum = 0;

  private authLoginAttempts = 0;
  private authLoginFailures = 0;
  private authRateLimitHits = 0;

  private dbQueryFailures = 0;

  private backupRuns = 0;
  private backupFailures = 0;
  private backupLastRunAt: string | null = null;

  private readonly startedAt = new Date().toISOString();

  recordRequest(statusCode: number, durationMs: number): void {
    this.requestTotal++;
    this.requestDurationSum += durationMs;
    const key = String(statusCode);
    this.requestByStatus[key] = (this.requestByStatus[key] ?? 0) + 1;
    if (statusCode >= 500) this.requestErrors++;
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

  recordDbFailure(): void {
    this.dbQueryFailures++;
  }

  recordBackupRun(success: boolean): void {
    this.backupRuns++;
    this.backupLastRunAt = new Date().toISOString();
    if (!success) this.backupFailures++;
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
        queryFailures: this.dbQueryFailures,
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
    };
  }

  reset(): void {
    this.requestTotal = 0;
    this.requestErrors = 0;
    this.requestByStatus = {};
    this.requestDurationSum = 0;
    this.authLoginAttempts = 0;
    this.authLoginFailures = 0;
    this.authRateLimitHits = 0;
    this.dbQueryFailures = 0;
    this.backupRuns = 0;
    this.backupFailures = 0;
    this.backupLastRunAt = null;
  }
}

export const metrics = new MetricsStore();
