import {
  useGetMonitoringStatus,
  useGetMonitoringSummary,
  getGetMonitoringStatusQueryKey,
  getGetMonitoringSummaryQueryKey,
} from "@workspace/api-client-react";
import type { MonitoringSummarySlowestEndpointsItem } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  Loader2,
  RefreshCw,
  Server,
  ShieldAlert,
  TrendingUp,
  XCircle,
  Cloud,
  CloudOff,
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Healthy
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0">
      <XCircle className="w-3 h-3 mr-1" />
      {status === "degraded" ? "Degraded" : "Error"}
    </Badge>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

function MetricTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-muted/50 rounded-lg p-3 text-center">
      <p className="text-2xl font-bold text-primary">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      {sub && <p className="text-xs text-muted-foreground/70 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Monitoring() {
  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
    dataUpdatedAt: statusUpdatedAt,
  } = useGetMonitoringStatus({
    query: { queryKey: getGetMonitoringStatusQueryKey(), refetchInterval: 30_000 },
  });

  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
  } = useGetMonitoringSummary({
    query: { queryKey: getGetMonitoringSummaryQueryKey(), refetchInterval: 30_000 },
  });

  const loading = statusLoading || summaryLoading;
  const lastUpdated = statusUpdatedAt ? new Date(statusUpdatedAt).toLocaleTimeString() : null;

  function refresh() {
    void refetchStatus();
    void refetchSummary();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations</h1>
          <p className="text-muted-foreground mt-1">
            Real-time system health and performance metrics
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">Updated {lastUpdated}</span>
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

      {/* System Status Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Server className="w-4 h-4" /> Application
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : status ? (
              <div className="space-y-1">
                <StatusBadge status={status.status} />
                <p className="text-xs text-muted-foreground mt-2">
                  v{status.version} · up {formatUptime(status.uptime)}
                </p>
              </div>
            ) : (
              <Badge variant="destructive">Unavailable</Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Database className="w-4 h-4" /> Database
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : status ? (
              <div className="space-y-1">
                <StatusBadge status={status.database.status} />
                <p className="text-xs text-muted-foreground mt-2">
                  {status.database.queryCount} queries · {status.database.avgQueryMs}ms avg
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HardDrive className="w-4 h-4" /> Backups
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : status ? (
              <div className="space-y-1">
                {status.backup.configured ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Configured
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not configured</Badge>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {status.backup.runs} runs · {status.backup.failures} failures
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Cloud className="w-4 h-4" /> Replication
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : status ? (
              <div className="space-y-1">
                {status.replication.configured ? (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0">
                    <Cloud className="w-3 h-3 mr-1" /> Active
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <CloudOff className="w-3 h-3 mr-1" /> Inactive
                  </Badge>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {status.replication.configured
                    ? "Offsite S3 replication enabled"
                    : "Set S3_BUCKET to activate"}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Request Volume */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-4 h-4" /> Request Volume
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading...
            </div>
          ) : summary ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricTile label="Total requests" value={summary.requests.total.toLocaleString()} />
                <MetricTile label="5xx errors" value={summary.requests.errors} />
                <MetricTile
                  label="Avg response time"
                  value={`${summary.requests.avgDurationMs}ms`}
                />
                <MetricTile
                  label="Error rate"
                  value={
                    summary.requests.total > 0
                      ? `${((summary.requests.errors / summary.requests.total) * 100).toFixed(1)}%`
                      : "0%"
                  }
                />
              </div>
              {summary.requests.byStatus && Object.keys(summary.requests.byStatus).length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                      By Status Code
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(summary.requests.byStatus)
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([code, count]) => (
                          <div
                            key={code}
                            className="bg-muted/50 rounded px-2 py-1 text-xs font-mono"
                          >
                            <span className="font-semibold">{code}</span>
                            <span className="text-muted-foreground ml-1.5">{Number(count)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Latency + Slowest Endpoints */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4" /> Latency Percentiles
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : summary ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <MetricTile label="p50 (median)" value={`${summary.latency.p50}ms`} />
                  <MetricTile label="p95" value={`${summary.latency.p95}ms`} />
                  <MetricTile label="p99" value={`${summary.latency.p99}ms`} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Sample: {summary.latency.sampleSize.toLocaleString()} requests (last 1,000 tracked)
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-4 h-4" /> Slowest Endpoints
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : summary && summary.slowestEndpoints.length > 0 ? (
              <div className="space-y-2">
                {summary.slowestEndpoints.map((ep: MonitoringSummarySlowestEndpointsItem) => (
                  <div key={ep.path} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs truncate max-w-[180px]" title={ep.path}>
                      {ep.path}
                    </span>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <span className="text-muted-foreground text-xs">
                        p95 <span className="font-medium text-foreground">{ep.p95}ms</span>
                      </span>
                      <span className="text-muted-foreground text-xs">
                        p99 <span className="font-medium text-foreground">{ep.p99}ms</span>
                      </span>
                      <span className="text-muted-foreground text-xs">{ep.count} req</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No data yet — metrics accumulate as requests come in.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Auth + Database */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="w-4 h-4" /> Authentication
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : summary ? (
              <div className="grid grid-cols-3 gap-3">
                <MetricTile label="Login attempts" value={summary.auth.loginAttempts} />
                <MetricTile label="Failures" value={summary.auth.loginFailures} />
                <MetricTile label="Rate limited" value={summary.auth.rateLimitHits} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-4 h-4" /> Database Queries
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : summary ? (
              <div className="grid grid-cols-3 gap-3">
                <MetricTile label="Total queries" value={summary.database.queryCount} />
                <MetricTile label="Failures" value={summary.database.queryFailures} />
                <MetricTile label="Avg duration" value={`${summary.database.avgQueryMs}ms`} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {summary && (
        <>
          {summary.requests.errors > 0 && (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  {summary.requests.errors} server error
                  {summary.requests.errors !== 1 ? "s" : ""} recorded
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Review server logs and filter by the request IDs shown in error responses.
                </p>
              </div>
            </div>
          )}
          {summary.auth.loginFailures > 10 && (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-300/40 bg-amber-50/50 dark:bg-amber-900/10">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  High login failure count: {summary.auth.loginFailures}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This may indicate a credential-stuffing attempt. Review auth logs for patterns.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* Process info footer */}
      {summary && (
        <div className="text-xs text-muted-foreground flex flex-wrap gap-4 pt-2">
          <span>
            Started:{" "}
            <span className="font-mono">
              {new Date(summary.process.startedAt).toLocaleString()}
            </span>
          </span>
          <span>
            Uptime: <span className="font-mono">{formatUptime(summary.process.uptimeSeconds)}</span>
          </span>
          <span className="text-muted-foreground/50">Metrics reset on restart</span>
        </div>
      )}
    </div>
  );
}
