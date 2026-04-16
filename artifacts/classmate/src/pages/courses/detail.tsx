import { useParams, Link } from "wouter";
import { useGetCourse, getGetCourseQueryKey, useListStudents, useListAssignments, useListNotes } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, FileText, CheckSquare, BookOpen, ArrowLeft, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default function CourseDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);

  const { data: course, isLoading: isLoadingCourse } = useGetCourse(id, {
    query: { enabled: !!id, queryKey: getGetCourseQueryKey(id) }
  });

  const { data: allStudents, isLoading: isLoadingStudents } = useListStudents();
  const { data: assignments, isLoading: isLoadingAssignments } = useListAssignments({ courseId: id });
  const { data: notes, isLoading: isLoadingNotes } = useListNotes({ courseId: id });

  const enrolledStudents = allStudents?.filter(s => s.enrolledCourseIds.includes(id)) || [];

  if (isLoadingCourse) {
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

  if (!course) {
    return <div>Course not found</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <Link href="/courses">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">{course.name}</h1>
            <Badge variant="secondary">{course.subject}</Badge>
          </div>
          <p className="text-muted-foreground mt-1">Taught by {course.teacherName}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <p className="text-foreground leading-relaxed max-w-3xl">{course.description}</p>
          <div className="flex items-center gap-6 mt-6 pt-6 border-t border-border">
            <div className="flex items-center gap-2 text-sm">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{course.studentCount} Students</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">Created {formatDate(course.createdAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="students" className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-6">
          <TabsTrigger 
            value="students" 
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
          >
            <Users className="mr-2 h-4 w-4" />
            Students
          </TabsTrigger>
          <TabsTrigger 
            value="assignments" 
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
          >
            <CheckSquare className="mr-2 h-4 w-4" />
            Assignments
          </TabsTrigger>
          <TabsTrigger 
            value="notes" 
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
          >
            <FileText className="mr-2 h-4 w-4" />
            Lessons & Notes
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="students">
          {isLoadingStudents ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : enrolledStudents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {enrolledStudents.map(student => (
                <Link key={student.id} href={`/students/${student.id}`}>
                  <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full hover-elevate">
                    <CardHeader className="flex flex-row items-center gap-4 py-4">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {student.avatarUrl ? (
                          <img src={student.avatarUrl} alt={student.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          student.name.charAt(0)
                        )}
                      </div>
                      <div>
                        <CardTitle className="text-base">{student.name}</CardTitle>
                        <CardDescription>{student.email}</CardDescription>
                      </div>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50">
              <Users className="mx-auto h-8 w-8 mb-3 opacity-20" />
              <p>No students enrolled yet</p>
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="assignments">
          {isLoadingAssignments ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : assignments && assignments.length > 0 ? (
            <div className="space-y-4">
              {assignments.map(assignment => (
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
                          <span>{assignment.studentName}</span>
                          <span>•</span>
                          <span>Due {formatDate(assignment.dueDate)}</span>
                        </div>
                      </div>
                      {assignment.score !== undefined && assignment.score !== null && (
                        <div className="text-right">
                          <div className="font-bold text-2xl text-primary">
                            {assignment.score}/{assignment.maxScore}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50">
              <CheckSquare className="mx-auto h-8 w-8 mb-3 opacity-20" />
              <p>No assignments found for this course</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="notes">
          {isLoadingNotes ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : notes && notes.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {notes.map(note => (
                <Link key={note.id} href={`/notes/${note.id}`}>
                  <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full hover-elevate">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <Badge variant="outline" className="mb-2 bg-background">{note.topic}</Badge>
                          <CardTitle className="text-lg">{note.title}</CardTitle>
                        </div>
                        {note.videoUrl && (
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <PlayCircle className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <CardDescription className="line-clamp-2 mt-2">
                        {note.content.substring(0, 150)}...
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0 text-xs text-muted-foreground">
                      Added {formatDate(note.createdAt)}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50">
              <FileText className="mx-auto h-8 w-8 mb-3 opacity-20" />
              <p>No notes or lessons found for this course</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
