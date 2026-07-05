import {
  useGetParentDashboard,
  getGetParentDashboardQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  GraduationCap,
  ChevronRight,
} from "lucide-react";

type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "INSUFFICIENT_DATA";
type Trend = "IMPROVING" | "STABLE" | "DECLINING" | "INSUFFICIENT_DATA";

function RiskBadge({ level }: { level: string }) {
  const config: Record<RiskLevel, { label: string; variant: "default" | "secondary" | "destructive"; icon: React.ReactNode }> = {
    LOW: { label: "Low Risk", variant: "secondary", icon: <CheckCircle2 className="w-3 h-3" /> },
    MEDIUM: { label: "Medium Risk", variant: "default", icon: <AlertTriangle className="w-3 h-3" /> },
    HIGH: { label: "High Risk", variant: "destructive", icon: <AlertTriangle className="w-3 h-3" /> },
    INSUFFICIENT_DATA: { label: "Not enough data", variant: "secondary", icon: null },
  };
  const c = config[level as RiskLevel] ?? config.INSUFFICIENT_DATA;
  return (
    <Badge variant={c.variant} className="flex items-center gap-1 text-xs">
      {c.icon}
      {c.label}
    </Badge>
  );
}

function TrendChip({ trend }: { trend: string }) {
  if (trend === "IMPROVING") {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
        <TrendingUp className="w-3.5 h-3.5" /> Improving
      </span>
    );
  }
  if (trend === "DECLINING") {
    return (
      <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
        <TrendingDown className="w-3.5 h-3.5" /> Declining
      </span>
    );
  }
  if (trend === "STABLE") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="w-3.5 h-3.5" /> Stable
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">Not enough data</span>
  );
}

function ScoreArc({ score }: { score: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(score / 100, 1);
  const offset = circumference * (1 - pct);
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg width="64" height="64" className="-rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle
          cx="32" cy="32" r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <span className="absolute text-xs font-bold" style={{ color }}>
        {score.toFixed(0)}%
      </span>
    </div>
  );
}

export default function ParentDashboard() {
  const { data, isLoading, isError } = useGetParentDashboard({
    query: { queryKey: getGetParentDashboardQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Failed to load dashboard. Please try again.
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6 text-primary" />
          Parent Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          At-a-glance progress for your linked students
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <GraduationCap className="w-12 h-12 text-muted-foreground/40" />
            <p className="font-medium">No students linked</p>
            <p className="text-sm text-muted-foreground">
              Contact your school administrator to link student accounts to your profile.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {items.map((student) => (
            <Link key={student.id} href={`/parent/students/${student.id}`}>
              <Card className="cursor-pointer hover:shadow-md transition-all group border-l-4"
                style={{
                  borderLeftColor:
                    student.riskLevel === "HIGH" ? "#ef4444"
                    : student.riskLevel === "MEDIUM" ? "#f59e0b"
                    : "#22c55e",
                }}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                        {student.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <CardTitle className="text-base leading-tight">{student.name}</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                          Grade {student.grade} · {student.relationship}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ScoreArc score={student.averageScore} />
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors mt-1" />
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RiskBadge level={student.riskLevel} />
                      <TrendChip trend={student.trend} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-muted/50 rounded-lg py-2 px-3">
                      <p className="text-lg font-bold">
                        {(student.completionRate * 100).toFixed(0)}%
                      </p>
                      <p className="text-xs text-muted-foreground">Completion</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg py-2 px-3">
                      <div className="flex items-center justify-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-amber-500" />
                        <p className="text-lg font-bold">{student.pendingAssignments}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">Pending</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
