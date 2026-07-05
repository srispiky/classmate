import {
  useGetMonitoringSlo,
  useGetMonitoringAvailability,
  useGetMonitoringOperationsReport,
  getGetMonitoringSloQueryKey,
  getGetMonitoringAvailabilityQueryKey,
  getGetMonitoringOperationsReportQueryKey,
} from "@workspace/api-client-react";
import type { SloResult, OperationsReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Gauge,
  HardDrive,
  Loader2,
  RefreshCw,
  Shield,
  Target,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function BudgetBar({ pct, status }: { pct: number; status: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color =
    status === "exhausted"
      ? "bg-red-500"
      : status === "at_risk"
        ? "bg-amber-500"
        : "bg-green-500";
  return (
    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
      <div
        className={`h-1.5 rounded-full transition-all ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function SloCard({ slo }: { slo: SloResult }) {
  const [expanded, setExpanded] = useState(false);
  const budgetColor =
    slo.errorBudget.status === "exhausted"
      ? "text-red-600 dark:text-red-400"
      : slo.errorBudget.status === "at_risk"
        ? "text-amber-600 dark:text-amber-400"
        : "text-green-600 dark:text-green-400";

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        slo.compliant
          ? "border-border"
          : "border-red-300/60 bg-red-50/20 dark:border-red-800/40 dark:bg-red-900/10"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {slo.compliant ? (
            <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm">{slo.name}</span>
              <Badge
                className={
                  slo.compliant
                    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0 text-xs"
                    : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0 text-xs"
                }
              >
                {slo.compliant ? "Compliant" : "Breached"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{slo.description}</p>
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-3 pl-6">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Target</p>
          <p className="text-sm font-bold text-primary">{slo.targetLabel}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Current</p>
          <p
            className={`text-sm font-bold ${slo.compliant ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
          >
            {slo.currentLabel}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Burn Rate</p>
          <p className={`text-sm font-bold ${budgetColor}`}>{slo.errorBudget.burnRate}x</p>
        </div>
      </div>

      {/* Error budget bar */}
      <div className="pl-6 space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Error budget consumed</span>
          <span className={budgetColor}>{slo.errorBudget.consumedPercent.toFixed(1)}%</span>
        </div>
        <BudgetBar pct={slo.errorBudget.consumedPercent} status={slo.errorBudget.status} />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatSeconds(slo.errorBudget.consumedSeconds)} consumed</span>
          <span>{formatSeconds(slo.errorBudget.remainingSeconds)} remaining</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="pl-6 space-y-2">
          <Separator />
          <p className="text-xs text-muted-foreground italic">{slo.sampleBasis}</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Total budget (30d): </span>
              <span className="font-mono">{formatSeconds(slo.errorBudget.totalSeconds)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Budget status: </span>
              <span
                className={`font-medium ${budgetColor}`}
              >
                {slo.errorBudget.status.replace("_", " ")}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HealthLabel({ label }: { label: OperationsReport["slo"]["overallHealthLabel"] }) {
  const styles: Record<string, { cls: string; text: string }> = {
    excellent: { cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0", text: "Excellent" },
    good: { cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0", text: "Good" },
    at_risk: { cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0", text: "At Risk" },
    critical: { cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0", text: "Critical" },
  };
  const s = styles[label] ?? styles["good"]!;
  return <Badge className={s.cls}>{s.text}</Badge>;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SloDashboard() {
  const { data: slo, isLoading: sloLoading, refetch: refetchSlo } = useGetMonitoringSlo({
    query: { queryKey: getGetMonitoringSloQueryKey(), refetchInterval: 60_000 },
  });

  const { data: avail, isLoading: availLoading, refetch: refetchAvail } = useGetMonitoringAvailability({
    query: { queryKey: getGetMonitoringAvailabilityQueryKey(), refetchInterval: 60_000 },
  });

  const { data: report, isLoading: reportLoading, refetch: refetchReport } = useGetMonitoringOperationsReport({
    query: { queryKey: getGetMonitoringOperationsReportQueryKey(), refetchInterval: 60_000 },
  });

  const loading = sloLoading || availLoading || reportLoading;

  function refresh() {
    void refetchSlo();
    void refetchAvail();
    void refetchReport();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="w-6 h-6" />
            SLO & Operations
          </h1>
          <p className="text-muted-foreground mt-1">
            Service level objectives, error budgets, availability, and operational health
          </p>
        </div>
        <div className="flex items-center gap-3">
          {report && (
            <span className="text-xs text-muted-foreground">
              Report: {new Date(report.generatedAt).toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Overall Health + Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Shield className="w-4 h-4" /> Overall Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reportLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : report ? (
              <div className="space-y-1">
                <HealthLabel label={report.slo.overallHealthLabel} />
                <p className="text-xs text-muted-foreground mt-2">
                  {report.slo.compliant}/{report.slo.total} SLOs compliant
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" /> Availability
            </CardTitle>
          </CardHeader>
          <CardContent>
            {availLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : avail ? (
              <div className="space-y-1">
                <p className="text-2xl font-bold text-primary">
                  {avail.overall.availabilityPct.toFixed(3)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSeconds(avail.sessionUptimeSeconds)} uptime
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Gauge className="w-4 h-4" /> Request Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reportLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : report ? (
              <div className="space-y-1">
                <p className="text-2xl font-bold text-primary">
                  {report.requests.requestsPerMinute}
                </p>
                <p className="text-xs text-muted-foreground">
                  req/min · {report.capacity.estimatedDailyRequests.toLocaleString()} est/day
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Error Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reportLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : report ? (
              <div className="space-y-1">
                <p
                  className={`text-2xl font-bold ${report.requests.errorRatePct > 1 ? "text-red-600 dark:text-red-400" : "text-primary"}`}
                >
                  {report.requests.errorRatePct}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {report.requests.errors} / {report.requests.total} requests
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* SLO Grid */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="w-4 h-4" /> Service Level Objectives
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sloLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Evaluating SLOs…</span>
            </div>
          ) : slo ? (
            <div className="space-y-3">
              <div className="flex gap-4 text-xs text-muted-foreground pb-1">
                <span>Window: 30 days</span>
                <span>·</span>
                <span>Elapsed: {formatSeconds(slo.elapsedSeconds)}</span>
                <span>·</span>
                <span>Evaluated: {new Date(slo.evaluatedAt).toLocaleTimeString()}</span>
              </div>
              {slo.slos.map((s) => (
                <SloCard key={s.id} slo={s} />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Availability + Capacity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-4 h-4" /> Service Availability
            </CardTitle>
          </CardHeader>
          <CardContent>
            {availLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : avail ? (
              <div className="space-y-4">
                {[
                  { label: "Database", data: avail.database },
                  { label: "Overall", data: avail.overall },
                ].map(({ label, data }) => (
                  <div key={label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{label}</span>
                      <span
                        className={
                          data.status === "healthy"
                            ? "text-green-600 dark:text-green-400"
                            : data.status === "degraded"
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-red-600 dark:text-red-400"
                        }
                      >
                        {data.availabilityPct.toFixed(4)}%
                      </span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          data.status === "healthy"
                            ? "bg-green-500"
                            : data.status === "degraded"
                              ? "bg-amber-500"
                              : "bg-red-500"
                        }`}
                        style={{ width: `${Math.min(100, data.availabilityPct)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>↑ {formatSeconds(data.uptimeSeconds)} up</span>
                      <span>↓ {formatSeconds(data.downtimeSeconds)} down</span>
                    </div>
                  </div>
                ))}
                <Separator />
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Outages this session</span>
                    <span className="font-medium">{avail.outageCount}</span>
                  </div>
                  {avail.longestOutageSeconds > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Longest outage</span>
                      <span className="font-medium">{formatSeconds(avail.longestOutageSeconds)}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="w-4 h-4" /> Capacity Indicators
            </CardTitle>
          </CardHeader>
          <CardContent>
            {availLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : avail ? (
              <div className="space-y-3">
                {[
                  {
                    label: "Requests per minute",
                    value: avail.capacityIndicators.requestsPerMinute,
                    unit: "req/min",
                  },
                  {
                    label: "Estimated daily requests",
                    value: avail.capacityIndicators.estimatedDailyRequests.toLocaleString(),
                    unit: "req/day",
                  },
                  {
                    label: "Session uptime",
                    value: avail.capacityIndicators.sessionUptimeHours.toFixed(2),
                    unit: "hours",
                  },
                ].map(({ label, value, unit }) => (
                  <div key={label} className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-medium">
                      {value} <span className="text-xs text-muted-foreground">{unit}</span>
                    </span>
                  </div>
                ))}
                <Separator />
                {[
                  {
                    label: "DB query load",
                    value: avail.capacityIndicators.dbQueryLoad,
                    badgeColor:
                      avail.capacityIndicators.dbQueryLoad === "high"
                        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0"
                        : avail.capacityIndicators.dbQueryLoad === "medium"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0"
                          : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0",
                  },
                  {
                    label: "Backup storage",
                    value: avail.capacityIndicators.backupStorageIndicator,
                    badgeColor:
                      avail.capacityIndicators.backupStorageIndicator === "failing"
                        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0"
                        : avail.capacityIndicators.backupStorageIndicator === "active"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0"
                          : "bg-secondary text-secondary-foreground border-0",
                  },
                  {
                    label: "Request growth",
                    value: avail.capacityIndicators.requestGrowthTrend,
                    badgeColor:
                      avail.capacityIndicators.requestGrowthTrend === "growing"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0"
                        : "bg-secondary text-secondary-foreground border-0",
                  },
                ].map(({ label, value, badgeColor }) => (
                  <div key={label} className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <Badge className={`text-xs ${badgeColor}`}>{value}</Badge>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Operations Report: recommendations */}
      {report && report.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowRight className="w-4 h-4" /> Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {report.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 shrink-0 text-amber-500">•</span>
                  <span className="text-muted-foreground">{rec}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Detailed Operations Report */}
      {report && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="w-4 h-4" /> Operational Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              {/* Auth */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Authentication</p>
                <div className="flex justify-between"><span className="text-muted-foreground">Total attempts</span><span className="font-mono">{report.authentication.totalAttempts}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Failures</span><span className={`font-mono ${report.authentication.failures > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>{report.authentication.failures}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Failure rate</span><span className="font-mono">{report.authentication.failureRatePct}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Rate limit hits</span><span className={`font-mono ${report.authentication.rateLimitHits > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>{report.authentication.rateLimitHits}</span></div>
              </div>
              {/* Database */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Database</p>
                <div className="flex justify-between"><span className="text-muted-foreground">Queries</span><span className="font-mono">{report.database.queryCount}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Failures</span><span className={`font-mono ${report.database.queryFailures > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{report.database.queryFailures}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Avg query time</span><span className="font-mono">{report.database.avgQueryMs}ms</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Failure rate</span><span className="font-mono">{report.database.failureRatePct}%</span></div>
              </div>
              {/* Backup */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Backup</p>
                <div className="flex justify-between"><span className="text-muted-foreground">Runs</span><span className="font-mono">{report.backup.runs}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Failures</span><span className={`font-mono ${report.backup.failures > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{report.backup.failures}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Success rate</span><span className={`font-mono ${report.backup.successRatePct < 100 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>{report.backup.successRatePct}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Last run</span><span className="font-mono text-xs">{report.backup.lastRunAt ? new Date(report.backup.lastRunAt).toLocaleTimeString() : "Never"}</span></div>
              </div>
            </div>
            <Separator className="my-4" />
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Session started: {new Date(report.reportPeriod.startedAt).toLocaleString()}</span>
              <span>·</span>
              <span>Duration: {report.reportPeriod.durationLabel}</span>
              <span>·</span>
              <AlertTriangle className="w-3 h-3 text-amber-500 inline" />
              <span>Data resets on server restart</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
