import { useListStudents, useListCourses } from "@workspace/api-client-react";
import type { Student, Course } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { BarChart3, Users, BookOpen, AlertCircle, ArrowRight } from "lucide-react";

export default function Reports() {
  const { data: students, isLoading: isLoadingStudents } = useListStudents();
  const { data: courses, isLoading: isLoadingCourses } = useListCourses();

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground mt-1">
          Generate progress reports for students and courses you manage.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Student Reports */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle>Student Reports</CardTitle>
                <CardDescription>Individual student progress summaries</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingStudents ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : students && students.length > 0 ? (
              <div className="space-y-2">
                {students.map((student: Student) => (
                  <Link key={student.id} href={`/reports/student/${student.id}`}>
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer group">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary shrink-0">
                          {student.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{student.name}</p>
                          {student.grade && (
                            <p className="text-xs text-muted-foreground">Grade {student.grade}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
                        <span className="text-xs">View report</span>
                        <ArrowRight className="w-3 h-3" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground space-y-2">
                <Users className="w-8 h-8 opacity-20" />
                <p className="text-sm">No students available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Course Reports */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <CardTitle>Course Reports</CardTitle>
                <CardDescription>Course-level analytics and student breakdowns</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingCourses ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : courses && courses.length > 0 ? (
              <div className="space-y-2">
                {courses.map((course: Course) => (
                  <Link key={course.id} href={`/reports/course/${course.id}`}>
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-md border hover:bg-muted/50 transition-colors cursor-pointer group">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                          <BookOpen className="w-3 h-3 text-blue-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{course.name}</p>
                          <p className="text-xs text-muted-foreground">{course.teacherName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
                        <span className="text-xs">View report</span>
                        <ArrowRight className="w-3 h-3" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground space-y-2">
                <BookOpen className="w-8 h-8 opacity-20" />
                <p className="text-sm">No courses available</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Help card */}
      <Card className="border-muted bg-muted/30">
        <CardContent className="p-5 flex items-start gap-3">
          <BarChart3 className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">About Reports</p>
            <p className="text-xs text-muted-foreground mt-1">
              Reports are generated in real-time from assignment grades and assessment scores.
              Each report includes risk classification, score trends, and topic mastery data.
              CSV and PDF export will be available in a future update.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
