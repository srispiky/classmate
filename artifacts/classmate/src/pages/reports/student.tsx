import { useParams, Link } from "wouter";
import { useGetStudentReportSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldAlert,
  ShieldCheck,
  Shield,
  HelpCircle,
  BookOpen,
  CheckSquare,
  FileText,
  Calendar,
} from "lucide-react";

// ── Risk / Trend helpers ──────────────────────────────────────────────────────

function RiskBadge({ level }: { level: string }) {
  const config: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    HIGH:              { label: "High Risk",  className: "bg-destructive/10 text-destructive border-destructive/20",                 icon: <ShieldAlert className="w-3 h-3" /> },
    MEDIUM:            { label: "Medium Risk", className: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20", icon: <Shield className="w-3 h-3" /> },
    LOW:               { label: "Low Risk",   className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",   icon: <ShieldCheck className="w-3 h-3" /> },
    INSUFFICIENT_DATA: { label: "No Data",    className: "bg-muted text-muted-foreground border-border",                             icon: <HelpCircle className="w-3 h-3" /> },
  };
  const c = config[level] ?? config["INSUFFICIENT_DATA"];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${c.className}`}>
      {c.icon} {c.label}
    </span>
  );
}

function TrendBadge({ trend }: { trend: string }) {
  const config: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
    IMPROVING:         { label: "Improving",  className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",   icon: <TrendingUp className="w-3 h-3" /> },
    DECLINING:         { label: "Declining",  className: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20", icon: <TrendingDown className="w-3 h-3" /> },
    STABLE:            { label: "Stable",     className: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",       icon: <Minus className="w-3 h-3" /> },
    INSUFFICIENT_DATA: { label: "No Data",    className: "bg-muted text-muted-foreground border-border",                             icon: <HelpCircle className="w-3 h-3" /> },
  };
  const c = config[trend] ?? config["INSUFFICIENT_DATA"];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${c.className}`}>
      {c.icon} {c.label}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StudentReport() {
  const params = useParams<{ id: string }>();
  const studentId = parseInt(params.id ?? "0", 10);

  const {
    data: report,
    isLoading,
    isError,
  } = useGetStudentReportSummary({ studentId });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (isError || !report) {
    return (
      <div className="space-y-6">
        <Link href="/reports">
          <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Reports
          </button>
        </Link>
        <Card className="border-destructive/40">
          <CardContent className="p-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="font-medium">Report unavailable</p>
            <p className="text-sm text-muted-foreground">
              This student report could not be loaded. You may not have access to this student.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const completionPct = Math.round(report.completionRate * 100);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link href="/reports">
          <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
            <ArrowLeft className="w-4 h-4" /> Back to Reports
          </button>
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{report.studentName}</h1>
            {report.grade && (
              <p className="text-muted-foreground mt-1">Grade {report.grade}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge level={report.riskLevel} />
            <TrendBadge trend={report.trend} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Calendar className="w-3 h-3" />
          Report generated {new Date(report.generatedAt).toLocaleString()}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Average Score</p>
            <p className="text-3xl font-bold tracking-tight mt-2">
              {report.averageScore.toFixed(1)}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Completion Rate</p>
            <p className="text-3xl font-bold tracking-tight mt-2">{completionPct}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Assignments</p>
            <p className="text-3xl font-bold tracking-tight mt-2">
              {report.completedAssignments}
              <span className="text-lg text-muted-foreground font-normal">
                /{report.totalAssignments}
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">Assessments</p>
            <p className="text-3xl font-bold tracking-tight mt-2">{report.totalAssessments}</p>
          </CardContent>
        </Card>
      </div>

      {/* Topics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
              Topics Mastered
            </CardTitle>
            <CardDescription>Consistent strengths across assessments</CardDescription>
          </CardHeader>
          <CardContent>
            {report.topicsMastered.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {report.topicsMastered.map((topic, i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No mastery data yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              Topics Needing Work
            </CardTitle>
            <CardDescription>Areas flagged across assessments</CardDescription>
          </CardHeader>
          <CardContent>
            {report.topicsNeedingWork.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {report.topicsNeedingWork.map((topic, i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-700 dark:text-orange-400 border border-orange-500/20"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No weaknesses flagged yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Navigation to detail pages */}
      <Card className="border-muted bg-muted/30">
        <CardContent className="p-5 flex flex-wrap gap-4">
          <Link href={`/students/${report.studentId}`}>
            <button className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              <FileText className="w-4 h-4" /> View Full Student Profile
            </button>
          </Link>
          <Link href={`/students/${report.studentId}/ai`}>
            <button className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              <BookOpen className="w-4 h-4" /> AI Improvement Suggestions
            </button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
