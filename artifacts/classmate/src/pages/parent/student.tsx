import { useParams } from "wouter";
import { Link } from "wouter";
import {
  useGetParentStudentProgress,
  getGetParentStudentProgressQueryKey,
  useListParentStudentAssignments,
  getListParentStudentAssignmentsQueryKey,
  useListParentStudentAssessments,
  getListParentStudentAssessmentsQueryKey,
  useListParentStudents,
  getListParentStudentsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckSquare,
  BrainCircuit,
  BarChart3,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

function RiskBadge({ level }: { level: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    LOW: { label: "Low Risk", variant: "secondary" },
    MEDIUM: { label: "Medium Risk", variant: "default" },
    HIGH: { label: "High Risk", variant: "destructive" },
    INSUFFICIENT_DATA: { label: "Not enough data", variant: "secondary" },
  };
  const config = map[level] ?? { label: level, variant: "secondary" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "IMPROVING") return <TrendingUp className="w-4 h-4 text-green-500" />;
  if (trend === "DECLINING") return <TrendingDown className="w-4 h-4 text-red-500" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "secondary" | "destructive"> = {
    graded: "default",
    submitted: "secondary",
    pending: "secondary",
    overdue: "destructive",
  };
  return <Badge variant={map[status] ?? "secondary"} className="capitalize text-xs">{status}</Badge>;
}

export default function ParentStudentDetail() {
  const params = useParams();
  const studentId = parseInt(params.studentId || "0", 10);

  const { data: studentsList } = useListParentStudents({
    query: { queryKey: getListParentStudentsQueryKey() },
  });

  const student = studentsList?.items.find((s) => s.id === studentId);

  const { data: progress, isLoading: isLoadingProgress } = useGetParentStudentProgress(
    studentId,
    { query: { enabled: !!studentId, queryKey: getGetParentStudentProgressQueryKey(studentId) } },
  );

  const { data: assignmentsData, isLoading: isLoadingAssignments } = useListParentStudentAssignments(
    studentId,
    { query: { enabled: !!studentId, queryKey: getListParentStudentAssignmentsQueryKey(studentId) } },
  );

  const { data: assessmentsData, isLoading: isLoadingAssessments } = useListParentStudentAssessments(
    studentId,
    { query: { enabled: !!studentId, queryKey: getListParentStudentAssessmentsQueryKey(studentId) } },
  );

  const assignments = assignmentsData?.items ?? [];
  const assessments = assessmentsData?.items ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/parent/students">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {student?.name ?? "Student"}
          </h1>
          {student && (
            <p className="text-sm text-muted-foreground">
              Grade {student.grade} · <span className="capitalize">{student.relationship}</span>
            </p>
          )}
        </div>
      </div>

      {/* Progress summary cards */}
      {isLoadingProgress ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : progress ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Avg Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{progress.averageScore.toFixed(1)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Completion
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {(progress.completionRate * 100).toFixed(0)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {progress.completedAssignments}/{progress.totalAssignments} assignments
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Risk Level
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <RiskBadge level={progress.riskLevel ?? "INSUFFICIENT_DATA"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2 pt-2">
              <TrendIcon trend={progress.trend ?? "STABLE"} />
              <span className="text-sm capitalize">
                {(progress.trend ?? "STABLE").toLowerCase().replace("_", " ")}
              </span>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <BarChart3 className="w-4 h-4 mr-1.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="assignments">
            <CheckSquare className="w-4 h-4 mr-1.5" />
            Assignments
          </TabsTrigger>
          <TabsTrigger value="assessments">
            <BrainCircuit className="w-4 h-4 mr-1.5" />
            Assessments
          </TabsTrigger>
        </TabsList>

        {/* ── Overview tab ── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {isLoadingProgress ? (
            <Skeleton className="h-40" />
          ) : progress ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Topics Mastered</CardTitle>
                </CardHeader>
                <CardContent>
                  {progress.topicsMastered.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No data yet</p>
                  ) : (
                    <ul className="space-y-1">
                      {progress.topicsMastered.map((t, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Topics Needing Work</CardTitle>
                </CardHeader>
                <CardContent>
                  {progress.topicsNeedingWork.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No data yet</p>
                  ) : (
                    <ul className="space-y-1">
                      {progress.topicsNeedingWork.map((t, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No progress data available.</p>
          )}
        </TabsContent>

        {/* ── Assignments tab ── */}
        <TabsContent value="assignments" className="mt-4">
          {isLoadingAssignments ? (
            <Skeleton className="h-64" />
          ) : assignments.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12 text-muted-foreground">
                No assignments yet.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground">Title</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Due</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {assignments.map((a) => (
                      <tr key={a.assignmentId} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{a.title}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(a.dueDate)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={a.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {a.score != null
                            ? `${a.score} / ${a.maxScore}`
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Assessments tab ── */}
        <TabsContent value="assessments" className="mt-4">
          {isLoadingAssessments ? (
            <Skeleton className="h-64" />
          ) : assessments.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12 text-muted-foreground">
                No assessments yet.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr className="text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground">Title</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {assessments.map((a) => (
                      <tr key={a.assessmentId} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{a.title}</td>
                        <td className="px-4 py-3 text-right">
                          {a.score} / {a.maxScore}
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({((a.score / a.maxScore) * 100).toFixed(0)}%)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
