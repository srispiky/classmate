import { useState } from "react";
import { useListAlerts, useUpdateAlert, getListAlertsQueryKey } from "@workspace/api-client-react";
import type { Alert } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
  Bell,
  BellOff,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

type TabKey = "all" | "active" | "acknowledged" | "resolved";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "resolved", label: "Resolved" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: Alert["severity"] }) {
  const styles: Record<string, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-0",
    medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0",
    low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-0",
  };
  return (
    <Badge className={styles[severity] ?? ""}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </Badge>
  );
}

function StatusIcon({ status }: { status: Alert["status"] }) {
  if (status === "active") return <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />;
  if (status === "acknowledged") return <Eye className="w-4 h-4 text-blue-500 shrink-0" />;
  return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
}

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString();
}

// ── Alert Card ────────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  onAcknowledge,
  onResolve,
  isPending,
}: {
  alert: Alert;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  isPending: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 transition-colors ${
        alert.status === "active"
          ? "border-orange-200 bg-orange-50/30 dark:border-orange-800/30 dark:bg-orange-900/10"
          : alert.status === "acknowledged"
            ? "border-blue-200 bg-blue-50/20 dark:border-blue-800/30 dark:bg-blue-900/10"
            : "border-border bg-muted/20"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <StatusIcon status={alert.status} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{alert.title}</span>
            <SeverityBadge severity={alert.severity} />
            <Badge variant="secondary" className="text-xs">
              {alert.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{alert.type}</p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {expanded ? "Less" : "Details"}
        </button>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground pl-7">{alert.description}</p>

      {/* Expanded metadata */}
      {expanded && (
        <div className="pl-7 space-y-2">
          <Separator />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Created: </span>
              <span className="font-mono">{formatTs(alert.createdAt)}</span>
            </div>
            {alert.acknowledgedAt && (
              <div>
                <span className="text-muted-foreground">Acknowledged: </span>
                <span className="font-mono">{formatTs(alert.acknowledgedAt)}</span>
              </div>
            )}
            {alert.resolvedAt && (
              <div>
                <span className="text-muted-foreground">Resolved: </span>
                <span className="font-mono">{formatTs(alert.resolvedAt)}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">ID: </span>
              <span className="font-mono">{alert.id}</span>
            </div>
          </div>
          {Object.keys(alert.metadata).length > 0 && (
            <div className="bg-muted/50 rounded p-2 text-xs font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(alert.metadata, null, 2)}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {alert.status !== "resolved" && (
        <div className="flex gap-2 pl-7">
          {alert.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAcknowledge(alert.id)}
              disabled={isPending}
              className="text-xs h-7"
            >
              <Eye className="w-3 h-3 mr-1" />
              Acknowledge
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onResolve(alert.id)}
            disabled={isPending}
            className="text-xs h-7 text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800"
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Resolve
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AlertCenter() {
  const [tab, setTab] = useState<TabKey>("active");
  const qc = useQueryClient();

  const statusParam = tab === "all" ? undefined : tab;

  const {
    data: alerts,
    isLoading,
    refetch,
    dataUpdatedAt,
  } = useListAlerts(
    statusParam ? { status: statusParam } : {},
    { query: { queryKey: getListAlertsQueryKey(statusParam ? { status: statusParam } : {}), refetchInterval: 30_000 } },
  );

  const updateMutation = useUpdateAlert({
    mutation: {
      onSuccess: () => {
        // Invalidate all alert queries so every tab refreshes.
        void qc.invalidateQueries({ queryKey: ["monitoring", "alerts"] });
        void refetch();
      },
    },
  });

  function handleAcknowledge(id: string) {
    updateMutation.mutate({ id, data: { action: "acknowledge" } });
  }

  function handleResolve(id: string) {
    updateMutation.mutate({ id, data: { action: "resolve" } });
  }

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;
  const activeCount = alerts?.filter((a) => a.status === "active").length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Alert Center
          </h1>
          <p className="text-muted-foreground mt-1">
            Proactive alerts for authentication, database, backup, and performance issues
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">Updated {lastUpdated}</span>
          )}
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {/* Active alert banner */}
      {activeCount > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-orange-300/50 bg-orange-50/50 dark:bg-orange-900/10">
          <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0" />
          <span className="text-sm font-medium text-orange-800 dark:text-orange-300">
            {activeCount} active alert{activeCount !== 1 ? "s" : ""} require attention
          </span>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b pb-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="w-4 h-4" />
            {tab === "all" ? "All alerts" : `${tab.charAt(0).toUpperCase() + tab.slice(1)} alerts`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading alerts…</span>
            </div>
          ) : !alerts || alerts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <BellOff className="w-8 h-8" />
              <p className="text-sm">
                {tab === "active"
                  ? "No active alerts — system is healthy."
                  : tab === "acknowledged"
                    ? "No acknowledged alerts."
                    : tab === "resolved"
                      ? "No resolved alerts yet."
                      : "No alerts recorded."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  onAcknowledge={handleAcknowledge}
                  onResolve={handleResolve}
                  isPending={updateMutation.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-orange-500" /> Active
        </span>
        <span className="flex items-center gap-1">
          <Eye className="w-3 h-3 text-blue-500" /> Acknowledged
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-green-500" /> Resolved
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" /> Alerts auto-resolve when conditions clear
        </span>
        <span className="flex items-center gap-1">
          <ShieldAlert className="w-3 h-3" /> Admin only
        </span>
        <span className="flex items-center gap-1">
          <XCircle className="w-3 h-3" /> Metrics reset on server restart
        </span>
      </div>
    </div>
  );
}
