import { useParams } from "wouter";
import { Link } from "wouter";
import { useGetStudent, getGetStudentQueryKey, useGetStudentProgress, getGetStudentProgressQueryKey, useListAssignments, useListAssessments, useGetStudentProgressTimeline, getGetStudentProgressTimelineQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainCircuit, BookOpen, CheckSquare, Target, ChevronRight, ArrowLeft, TrendingUp, TrendingDown, Minus, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default function StudentDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);

  const { data: student, isLoading: isLoadingStudent } = useGetStudent(id, {
    query: { enabled: !!id, queryKey: getGetStudentQueryKey(id) }
  });

  const { data: progress, isLoading: isLoadingProgress } = useGetStudentProgress(id, {
    query: { enabled: !!id, queryKey: getGetStudentProgressQueryKey(id) }
  });

  const { data: assignments, isLoading: isLoadingAssignments } = useListAssignments({ studentId: id });
  const { data: assessments, isLoading: isLoadingAssessments } = useListAssessments({ studentId: id });

  const {
    data: timeline,
    isLoading: isLoadingTimeline,
    isError: isTimelineError,
  } = useGetStudentProgressTimeline(id, {
    query: { enabled: !!id, queryKey: getGetStudentProgressTimelineQueryKey(id) },
  });

  if (isLoadingStudent) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 md:col-span-2" />
        </div>
      </div>
    );
  }

  if (!student) {
    return <div>Student not found</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/students">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{student.name}</h1>
          <p className="text-muted-foreground mt-1">{student.email} • Grade {student.grade}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Sidebar / Overview */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Joined</span>
                <span className="text-sm font-medium">{formatDate(student.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Enrolled Courses</span>
                <span className="text-sm font-medium">{student.enrolledCourseIds.length}</span>
              </div>
              
              {progress && (
                <>
                  <div className="pt-4 border-t border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Average Score</span>
                      <span className="font-bold text-lg text-primary">{progress.averageScore.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-muted-foreground">Completion Rate</span>
                      <span className="font-bold text-lg">{progress.completionRate.toFixed(1)}%</span>
                    </div>
                    {progress.riskLevel && progress.riskLevel !== "INSUFFICIENT_DATA" && (
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-muted-foreground">Risk</span>
                        <Badge variant={
                          progress.riskLevel === "HIGH" ? "destructive" :
                          progress.riskLevel === "MEDIUM" ? "secondary" : "outline"
                        } className={
                          progress.riskLevel === "LOW" ? "text-green-700 border-green-500/30 bg-green-500/10 dark:text-green-400" : ""
                        }>
                          {progress.riskLevel}
                        </Badge>
                      </div>
                    )}
                    {progress.trend && progress.trend !== "INSUFFICIENT_DATA" && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Trend</span>
                        <span className="flex items-center gap-1 text-sm font-medium">
                          {progress.trend === "IMPROVING" && <TrendingUp className="h-3.5 w-3.5 text-green-500" />}
                          {progress.trend === "DECLINING" && <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
                          {progress.trend === "STABLE" && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                          <span className={
                            progress.trend === "IMPROVING" ? "text-green-600 dark:text-green-400" :
                            progress.trend === "DECLINING" ? "text-red-600 dark:text-red-400" :
                            "text-muted-foreground"
                          }>
                            {progress.trend}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-5 w-5 text-primary" />
                <CardTitle className="text-primary">AI Insights</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                View personalized learning recommendations and focus areas based on recent performance.
              </p>
              <Link href={`/students/${student.id}/ai`}>
                <Button className="w-full" variant="default">
                  View Full Analysis
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <div className="md:col-span-3 space-y-6">
          <Tabs defaultValue="assignments" className="w-full">
            <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent">
              <TabsTrigger 
                value="assignments" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <CheckSquare className="mr-2 h-4 w-4" />
                Assignments
              </TabsTrigger>
              <TabsTrigger 
                value="assessments" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <Target className="mr-2 h-4 w-4" />
                Assessments
              </TabsTrigger>
              <TabsTrigger 
                value="progress" 
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <BookOpen className="mr-2 h-4 w-4" />
                Learning Progress
              </TabsTrigger>
              <TabsTrigger
                value="timeline"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
              >
                <Clock className="mr-2 h-4 w-4" />
                Timeline
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="assignments" className="pt-6">
              {isLoadingAssignments ? (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                </div>
              ) : assignments?.items && assignments.items.length > 0 ? (
                <div className="space-y-4">
                  {assignments.items.map(assignment => (
                    <Card key={assignment.id}>
                      <CardContent className="p-4 sm:p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-lg">{assignment.title}</h3>
                              <Badge variant={
                                assignment.status === "graded" ? "default" :
                                assignment.status === "submitted" ? "secondary" :
                                assignment.status === "late" ? "destructive" : "outline"
                              }>
                                {assignment.status}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                              <span>{assignment.courseName}</span>
                              <span>•</span>
                              <span>Due {formatDate(assignment.dueDate)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {assignment.score !== undefined && assignment.score !== null ? (
                              <div className="text-right">
                                <div className="font-bold text-2xl text-primary">
                                  {assignment.score}/{assignment.maxScore}
                                </div>
                                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                                  Score
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50">
                  <CheckSquare className="mx-auto h-8 w-8 mb-3 opacity-20" />
                  <p>No assignments found</p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="assessments" className="pt-6">
              {isLoadingAssessments ? (
                <div className="space-y-4">
                  {[1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}
                </div>
              ) : assessments?.items && assessments.items.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {assessments.items.map(assessment => (
                    <Card key={assessment.id} className="flex flex-col">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{assessment.title}</CardTitle>
                            <CardDescription>{assessment.courseName} • {formatDate(assessment.createdAt)}</CardDescription>
                          </div>
                          <Badge variant="secondary" className="text-base py-1 px-2">
                            {assessment.percentage}%
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="flex-1 mt-2">
                        <div className="space-y-4">
                          <div>
                            <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Strengths</h4>
                            <div className="flex flex-wrap gap-2">
                              {assessment.strengths.slice(0, 3).map((strength, i) => (
                                <Badge key={i} variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                                  {strength}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Areas for Improvement</h4>
                            <div className="flex flex-wrap gap-2">
                              {assessment.weaknesses.slice(0, 3).map((weakness, i) => (
                                <Badge key={i} variant="outline" className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20">
                                  {weakness}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50">
                  <Target className="mx-auto h-8 w-8 mb-3 opacity-20" />
                  <p>No assessments found</p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="progress" className="pt-6">
              {isLoadingProgress ? (
                <Skeleton className="h-64 w-full" />
              ) : progress ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base text-green-600 dark:text-green-400 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500" />
                        Mastered Topics
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {progress.topicsMastered.length > 0 ? (
                          progress.topicsMastered.map((topic, i) => (
                            <li key={i} className="text-sm font-medium p-2 rounded-md bg-muted/50 border">
                              {topic}
                            </li>
                          ))
                        ) : (
                          <li className="text-sm text-muted-foreground">No mastered topics yet.</li>
                        )}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base text-orange-600 dark:text-orange-400 flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-orange-500" />
                        Needs Work
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {progress.topicsNeedingWork.length > 0 ? (
                          progress.topicsNeedingWork.map((topic, i) => (
                            <li key={i} className="text-sm font-medium p-2 rounded-md bg-muted/50 border">
                              {topic}
                            </li>
                          ))
                        ) : (
                          <li className="text-sm text-muted-foreground">No topics needing work.</li>
                        )}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              ) : null}
            </TabsContent>

            <TabsContent value="timeline" className="pt-6">
              {isLoadingTimeline ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : isTimelineError ? (
                <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50">
                  <Clock className="mx-auto h-8 w-8 mb-3 opacity-20" />
                  <p className="font-medium">Could not load timeline</p>
                  <p className="text-sm mt-1">Please try again later.</p>
                </div>
              ) : timeline && timeline.events.length > 0 ? (
                <div className="relative">
                  <div className="absolute left-[19px] top-0 bottom-0 w-px bg-border" />
                  <ol className="space-y-4">
                    {[...timeline.events].reverse().map((event, i) => (
                      <li key={i} className="flex gap-4 relative">
                        <div className={`mt-1 flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border-2 bg-background z-10 ${
                          event.type === "ASSIGNMENT_GRADED"
                            ? "border-blue-500/40 text-blue-600 dark:text-blue-400"
                            : "border-purple-500/40 text-purple-600 dark:text-purple-400"
                        }`}>
                          {event.type === "ASSIGNMENT_GRADED"
                            ? <CheckSquare className="h-4 w-4" />
                            : <Target className="h-4 w-4" />}
                        </div>
                        <Card className="flex-1">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="space-y-1 min-w-0">
                                <p className="font-semibold truncate">{event.title}</p>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className={`text-xs ${
                                    event.type === "ASSIGNMENT_GRADED"
                                      ? "border-blue-500/30 text-blue-700 dark:text-blue-400"
                                      : "border-purple-500/30 text-purple-700 dark:text-purple-400"
                                  }`}>
                                    {event.type === "ASSIGNMENT_GRADED" ? "Assignment" : "Assessment"}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">{event.courseName}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {formatDate(event.date)}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <span className={`text-xl font-bold ${
                                  event.scorePercent >= 80 ? "text-green-600 dark:text-green-400" :
                                  event.scorePercent >= 60 ? "text-amber-600 dark:text-amber-400" :
                                  "text-red-600 dark:text-red-400"
                                }`}>
                                  {event.scorePercent}%
                                </span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50">
                  <Clock className="mx-auto h-8 w-8 mb-3 opacity-20" />
                  <p className="font-medium">No scored events yet</p>
                  <p className="text-sm mt-1">Timeline will populate as assignments are graded and assessments are recorded.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
