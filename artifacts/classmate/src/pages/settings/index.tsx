import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  ServerCrash,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

interface DbStatus {
  connected: boolean;
  version?: string;
  database?: string;
  host?: string;
  port?: string;
  user?: string;
  error?: string;
  tables?: {
    students: number;
    courses: number;
    assignments: number;
    notes: number;
    assessments: number;
  };
}

interface TestResult {
  success: boolean;
  version?: string;
  error?: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchDbStatus(): Promise<DbStatus> {
  const res = await fetch(`${BASE}/api/admin/db-status`);
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json() as Promise<DbStatus>;
}

async function testConnection(body: {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}): Promise<TestResult> {
  const res = await fetch(`${BASE}/api/admin/test-db`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Request failed");
  return res.json() as Promise<TestResult>;
}

export default function Settings() {
  const { toast } = useToast();

  const { data: status, isLoading, refetch } = useQuery<DbStatus>({
    queryKey: ["db-status"],
    queryFn: fetchDbStatus,
    refetchInterval: 30_000,
  });

  const [form, setForm] = useState({
    host: "localhost",
    port: "5432",
    database: "classmate_db",
    user: "classmate_user",
    password: "",
  });
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const testMutation = useMutation({
    mutationFn: testConnection,
    onSuccess: (data) => {
      setTestResult(data);
      if (data.success) {
        toast({ title: "Connection successful", description: "PostgreSQL responded correctly." });
      } else {
        toast({ title: "Connection failed", description: data.error, variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Request error", description: "Could not reach the API.", variant: "destructive" });
    },
  });

  const pgVersion = status?.version
    ? status.version.split(" ").slice(0, 2).join(" ")
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Database connection and diagnostics</p>
      </div>

      {/* Current connection status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-4 h-4" />
              Current Database Connection
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              Refresh
            </Button>
          </div>
          <CardDescription>Live status of the PostgreSQL connection used by the API server</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking connection...
            </div>
          ) : status?.connected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <span className="font-medium text-green-700 dark:text-green-400">Connected</span>
                {pgVersion && (
                  <Badge variant="secondary" className="ml-2">{pgVersion}</Badge>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Host</p>
                  <p className="font-mono font-medium">{status.host || "—"}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Port</p>
                  <p className="font-mono font-medium">{status.port || "5432"}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Database</p>
                  <p className="font-mono font-medium">{status.database || "—"}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">User</p>
                  <p className="font-mono font-medium">{status.user || "—"}</p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-medium mb-3">Table Row Counts</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {status.tables &&
                    Object.entries(status.tables).map(([table, count]) => (
                      <div key={table} className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-primary">{count}</p>
                        <p className="text-xs text-muted-foreground capitalize mt-1">{table}</p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 text-destructive">
              <ServerCrash className="w-5 h-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Not connected</p>
                {status?.error && (
                  <p className="text-sm mt-1 text-muted-foreground font-mono break-all">{status.error}</p>
                )}
                <p className="text-sm mt-2 text-muted-foreground">
                  Check that DATABASE_URL is set correctly and that your PostgreSQL server is running.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test a connection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="w-4 h-4" />
            Test a Connection
          </CardTitle>
          <CardDescription>
            Enter PostgreSQL credentials to verify connectivity before deploying
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="host">Host</Label>
              <Input
                id="host"
                placeholder="localhost"
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                placeholder="5432"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="database">Database Name</Label>
              <Input
                id="database"
                placeholder="classmate_db"
                value={form.database}
                onChange={(e) => setForm((f) => ({ ...f, database: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user">Username</Label>
              <Input
                id="user"
                placeholder="classmate_user"
                value={form.user}
                onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={() => testMutation.mutate(form)}
              disabled={testMutation.isPending}
            >
              {testMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FlaskConical className="w-4 h-4 mr-2" />
              )}
              Test Connection
            </Button>

            {testResult && (
              <div className="flex items-center gap-2 text-sm">
                {testResult.success ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="text-green-700 dark:text-green-400 font-medium">Connected successfully</span>
                    {testResult.version && (
                      <span className="text-muted-foreground">
                        — {testResult.version.split(" ").slice(0, 2).join(" ")}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-destructive" />
                    <span className="text-destructive font-medium">Failed</span>
                    <span className="text-muted-foreground">{testResult.error}</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="bg-muted/40 rounded-lg p-4 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">How to update the database connection</p>
            <p>
              The API server reads its connection string from the <code className="bg-muted px-1 rounded text-xs">DATABASE_URL</code> environment variable.
              To point to a different PostgreSQL server, update that variable and restart the API service.
            </p>
            <p className="mt-1 font-mono text-xs bg-muted rounded p-2 break-all">
              DATABASE_URL=postgresql://user:password@host:5432/classmate_db
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
