/**
 * AvailabilityService — session-scoped availability tracking.
 *
 * Records outage events (DB unavailability, detected via health checks)
 * and computes uptime statistics for the current server session.
 *
 * Outage history is capped at MAX_OUTAGES entries to bound memory usage.
 * All data resets on server restart.
 */

const MAX_OUTAGES = 50;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OutageEvent {
  id: string;
  service: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  resolved: boolean;
}

export interface AvailabilitySnapshot {
  sessionStartedAt: string;
  sessionUptimeSeconds: number;
  database: ServiceAvailability;
  overall: ServiceAvailability;
  outages: OutageEvent[];
  outageCount: number;
  longestOutageSeconds: number;
  capacityIndicators: CapacityIndicators;
}

export interface ServiceAvailability {
  uptimeSeconds: number;
  downtimeSeconds: number;
  availabilityPct: number;
  status: "healthy" | "degraded" | "down";
}

export interface CapacityIndicators {
  requestsPerMinute: number;
  requestGrowthTrend: "stable" | "growing" | "unknown";
  estimatedDailyRequests: number;
  backupStorageIndicator: "none" | "active" | "failing";
  dbQueryLoad: "low" | "medium" | "high";
  sessionUptimeHours: number;
}

// ── AvailabilityService ───────────────────────────────────────────────────────

export class AvailabilityService {
  private readonly sessionStart = new Date().toISOString();

  // Outage store: keyed by service name, value is current open outage.
  private activeOutages = new Map<string, { id: string; startedAt: string }>();
  private outageHistory: OutageEvent[] = [];

  // Running downtime accumulator per service (seconds).
  private downtimeTotals = new Map<string, number>();

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Called whenever the DB health check result is known.
   * Opens or closes the db outage window accordingly.
   */
  recordDbHealth(ok: boolean): void {
    const SERVICE = "database";
    if (!ok) {
      this.openOutage(SERVICE);
    } else {
      this.closeOutage(SERVICE);
    }
  }

  /**
   * Produce a full availability snapshot suitable for the API response.
   * Pass in the metrics snapshot for capacity indicator computation.
   */
  snapshot(
    uptimeSeconds: number,
    snap: {
      requests: { total: number; avgDurationMs: number };
      database: { queryCount: number; avgQueryMs: number };
      backup: { runs: number; failures: number };
    },
  ): AvailabilitySnapshot {
    const sessionElapsed = Math.max(uptimeSeconds, 1);

    // Close any open outages momentarily for snapshot calculation
    // but do NOT persist the close (we still don't know if they're resolved).
    const dbActive = this.activeOutages.get("database");
    const dbDowntime =
      (this.downtimeTotals.get("database") ?? 0) +
      (dbActive ? this.secondsSince(dbActive.startedAt) : 0);

    const dbAvailPct = Math.max(0, (sessionElapsed - dbDowntime) / sessionElapsed);

    const dbSvc: ServiceAvailability = {
      uptimeSeconds: Math.round(sessionElapsed - dbDowntime),
      downtimeSeconds: Math.round(dbDowntime),
      availabilityPct: parseFloat((dbAvailPct * 100).toFixed(4)),
      status: dbActive ? "down" : dbAvailPct >= 0.999 ? "healthy" : "degraded",
    };

    const overallDowntime = dbDowntime; // Extend as more services are tracked.
    const overallPct = Math.max(0, (sessionElapsed - overallDowntime) / sessionElapsed);
    const overall: ServiceAvailability = {
      uptimeSeconds: Math.round(sessionElapsed - overallDowntime),
      downtimeSeconds: Math.round(overallDowntime),
      availabilityPct: parseFloat((overallPct * 100).toFixed(4)),
      status: dbActive ? "degraded" : "healthy",
    };

    // All outage events merged and sorted newest-first.
    const allOutages: OutageEvent[] = [
      ...this.outageHistory,
      ...(dbActive
        ? [
            {
              id: dbActive.id,
              service: "database",
              startedAt: dbActive.startedAt,
              endedAt: null,
              durationSeconds: null,
              resolved: false,
            } satisfies OutageEvent,
          ]
        : []),
    ]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, MAX_OUTAGES);

    const longestOutage = Math.max(
      0,
      ...this.outageHistory
        .filter((o) => o.durationSeconds !== null)
        .map((o) => o.durationSeconds!),
    );

    return {
      sessionStartedAt: this.sessionStart,
      sessionUptimeSeconds: sessionElapsed,
      database: dbSvc,
      overall,
      outages: allOutages,
      outageCount: allOutages.length,
      longestOutageSeconds: longestOutage,
      capacityIndicators: this.capacityIndicators(sessionElapsed, snap),
    };
  }

  // ── Outage tracking helpers ───────────────────────────────────────────────

  private openOutage(service: string): void {
    if (this.activeOutages.has(service)) return; // Already open.
    const id = `${service}-${Date.now()}`;
    this.activeOutages.set(service, { id, startedAt: new Date().toISOString() });
  }

  private closeOutage(service: string): void {
    const active = this.activeOutages.get(service);
    if (!active) return;

    const endedAt = new Date().toISOString();
    const durationSeconds = this.secondsSince(active.startedAt);

    // Accumulate downtime.
    this.downtimeTotals.set(
      service,
      (this.downtimeTotals.get(service) ?? 0) + durationSeconds,
    );

    const event: OutageEvent = {
      id: active.id,
      service,
      startedAt: active.startedAt,
      endedAt,
      durationSeconds,
      resolved: true,
    };

    // Cap history.
    if (this.outageHistory.length >= MAX_OUTAGES) {
      this.outageHistory.shift();
    }
    this.outageHistory.push(event);
    this.activeOutages.delete(service);
  }

  // ── Capacity indicators ───────────────────────────────────────────────────

  private capacityIndicators(
    sessionElapsed: number,
    snap: {
      requests: { total: number; avgDurationMs: number };
      database: { queryCount: number; avgQueryMs: number };
      backup: { runs: number; failures: number };
    },
  ): CapacityIndicators {
    const elapsedMinutes = sessionElapsed / 60;
    const requestsPerMinute =
      elapsedMinutes > 0 ? parseFloat((snap.requests.total / elapsedMinutes).toFixed(2)) : 0;

    const estimatedDailyRequests = Math.round(requestsPerMinute * 60 * 24);

    // Growth trend: simple heuristic (if RPM is above historical baseline this would
    // use time-buckets; in session-only mode we just report as "stable").
    const requestGrowthTrend: CapacityIndicators["requestGrowthTrend"] =
      requestsPerMinute > 0 ? "stable" : "unknown";

    const backupStorageIndicator: CapacityIndicators["backupStorageIndicator"] =
      snap.backup.runs === 0 ? "none" : snap.backup.failures > 0 ? "failing" : "active";

    // DB query load: average query time heuristic.
    const dbQueryLoad: CapacityIndicators["dbQueryLoad"] =
      snap.database.avgQueryMs > 200 ? "high" : snap.database.avgQueryMs > 50 ? "medium" : "low";

    return {
      requestsPerMinute,
      requestGrowthTrend,
      estimatedDailyRequests,
      backupStorageIndicator,
      dbQueryLoad,
      sessionUptimeHours: parseFloat((sessionElapsed / 3600).toFixed(2)),
    };
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  private secondsSince(isoTs: string): number {
    return Math.round((Date.now() - new Date(isoTs).getTime()) / 1000);
  }
}

export const availabilityService = new AvailabilityService();
