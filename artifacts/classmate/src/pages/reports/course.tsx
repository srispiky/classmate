import { useParams, Link } from "wouter";
import { useGetCourseReportSummary } from "@workspace/api-client-react";
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
  Calendar,
  Users,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function RiskChip({ level }: { level: string }) {
  const config: Record<string, { label: string; className: string }> = {
    HIGH:              { label: "High Risk",  className: "bg-destructive/10 text-destructive border-destructive/20" },
    MEDIUM:            { label: "Medium",     className: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20" },
    LOW:               { label: "Low Risk",   className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20" },
    INSUFFICIENT_DATA: { label: "No Data",    className: "bg-muted text-muted-foreground border-border" },
  };
  const c = config[level] ?? config["INSUFFICIENT_DATA"];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "IMPROVING") return <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />;
  if (trend === "DECLINING") return <TrendingDown className="w-4 h-4 text-orange-500" />;
  if (trend === "STABLE") return <Minus className="w-4 h-4 text-blue-500" />;
  return <HelpCircle className="w-4 h-4 text-muted-foreground" />;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CourseReport() {
  const params = useParams<{ id: string }>();
  const courseId = parseInt(params.id ?? "0", 10);

  const {
    data: report,
    isLoading,
    isError,
  } = useGetCourseReportSummary({ courseId });

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-80 rounded-xl" />
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
              This course report could not be loaded. You may not have access to this course.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { riskDistribution: rd } = report;
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
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{report.courseName}</h1>
          <p className="text-muted-foreground mt-1">Taught by {report.teacherName}</p>
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
            <p className="text-xs font-medium text-muted-foreground">Enrolled Students</p>
            <p className="text-3xl font-bold tracking-tight mt-2">{report.totalStudents}</p>
          </CardContent>
        </Card>
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
            <p className="text-xs font-medium text-muted-foreground">At-Risk Students</p>
            <p className="text-3xl font-bold tracking-tight mt-2 text-destructive">
              {rd.high}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Risk Distribution</CardTitle>
            <CardDescription>Student health breakdown</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <RiskBar
              icon={<ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-400" />}
              label="Low Risk"
              count={rd.low}
              total={report.totalStudents}
              colorClass="bg-green-500"
            />
            <RiskBar
              icon={<Shield className="w-4 h-4 text-orange-500" />}
              label="Medium Risk"
              count={rd.medium}
              total={report.totalStudents}
              colorClass="bg-orange-400"
            />
            <RiskBar
              icon={<ShieldAlert className="w-4 h-4 text-destructive" />}
              label="High Risk"
              count={rd.high}
              total={report.totalStudents}
              colorClass="bg-destructive"
            />
            <RiskBar
              icon={<HelpCircle className="w-4 h-4 text-muted-foreground" />}
              label="No Data"
              count={rd.insufficientData}
              total={report.totalStudents}
              colorClass="bg-muted-foreground/40"
            />
          </CardContent>
        </Card>

        {/* Top Performers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Performers</CardTitle>
            <CardDescription>Students averaging ≥ 80%</CardDescription>
          </CardHeader>
          <CardContent>
            {report.topPerformers.length > 0 ? (
              <div className="space-y-2">
                {report.topPerformers.map(student => (
                  <div key={student.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                    <Link href={`/reports/student/${student.id}`}>
                      <span className="text-sm font-medium hover:underline cursor-pointer text-foreground">
                        {student.name}
                      </span>
                    </Link>
                    <span className="text-sm font-bold text-green-600 dark:text-green-400">
                      {student.averageScore.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground space-y-2">
                <Users className="w-6 h-6 opacity-20" />
                <p className="text-sm">No students at 80%+ yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick links */}
        <Card className="border-muted bg-muted/30 flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="text-base">Quick Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href={`/courses/${report.courseId}`}>
              <button className="w-full text-left flex items-center gap-2 text-sm font-medium text-primary hover:underline py-1">
                View Course Details
              </button>
            </Link>
            <Link href="/reports">
              <button className="w-full text-left flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground py-1">
                All Reports
              </button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* All Students Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Students</CardTitle>
          <CardDescription>
            Per-student analytics for {report.courseName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {report.students.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground space-y-2">
              <Users className="w-8 h-8 opacity-20" />
              <p className="text-sm">No enrolled students</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Student</th>
                    <th className="text-right py-2 px-4 font-medium">Avg Score</th>
                    <th className="text-right py-2 px-4 font-medium">Completion</th>
                    <th className="text-center py-2 px-4 font-medium">Risk</th>
                    <th className="text-center py-2 pl-4 font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {report.students.map(student => (
                    <tr key={student.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pr-4">
                        <Link href={`/reports/student/${student.id}`}>
                          <span className="font-medium hover:underline cursor-pointer">
                            {student.name}
                          </span>
                        </Link>
                      </td>
                      <td className="text-right py-2.5 px-4 tabular-nums">
                        {student.averageScore.toFixed(1)}%
                      </td>
                      <td className="text-right py-2.5 px-4 tabular-nums">
                        {Math.round(student.completionRate * 100)}%
                      </td>
                      <td className="text-center py-2.5 px-4">
                        <RiskChip level={student.riskLevel} />
                      </td>
                      <td className="py-2.5 pl-4 flex justify-center">
                        <TrendIcon trend={student.trend} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── RiskBar sub-component ─────────────────────────────────────────────────────

interface RiskBarProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  total: number;
  colorClass: string;
}

function RiskBar({ icon, label, count, total, colorClass }: RiskBarProps) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-muted-foreground">{label}</span>
        </div>
        <span className="font-medium tabular-nums">{count}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
