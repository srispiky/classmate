import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import type { PaginatedStudentList } from "@workspace/api-client-react";
import {
  useGetCourse,
  getGetCourseQueryKey,
  useListStudents,
  getListStudentsQueryKey,
  useListAssignments,
  useListNotes,
  useUpdateCourse,
  useDeleteCourse,
  useEnrollStudent,
  useUnenrollStudent,
  getListCoursesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Users,
  FileText,
  CheckSquare,
  BookOpen,
  ArrowLeft,
  PlayCircle,
  Pencil,
  Archive,
  UserPlus,
  UserMinus,
  Search,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function CourseDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const id = parseInt(params.id || "0", 10);

  const { data: course, isLoading: isLoadingCourse } = useGetCourse(id, {
    query: { enabled: !!id, queryKey: getGetCourseQueryKey(id) },
  });
  const { data: allStudents, isLoading: isLoadingStudents } = useListStudents();
  const { data: assignments, isLoading: isLoadingAssignments } = useListAssignments({ courseId: id });
  const { data: notesPage, isLoading: isLoadingNotes } = useListNotes({ courseId: id, limit: 100 });
  const notes = notesPage?.items ?? [];

  const enrolledStudents = allStudents?.items?.filter(s => s.enrolledCourseIds.includes(id)) || [];
  const unenrolledStudents = allStudents?.items?.filter(s => !s.enrolledCourseIds.includes(id)) || [];

  // ── Edit dialog state ───────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", subject: "", grade: "", academicYear: "", description: "" });
  const [editError, setEditError] = useState<string | null>(null);

  function openEdit() {
    if (!course) return;
    setEditForm({
      name: course.name,
      subject: course.subject,
      grade: course.grade ?? "",
      academicYear: course.academicYear ?? "",
      description: course.description ?? "",
    });
    setEditError(null);
    setEditOpen(true);
  }

  const { mutate: updateCourse, isPending: isUpdating } = useUpdateCourse({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCourseQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setEditOpen(false);
        toast({ title: "Course updated", description: "Your changes have been saved." });
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to update course. Please try again.";
        setEditError(msg);
      },
    },
  });

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);
    if (!editForm.name.trim()) { setEditError("Course name is required."); return; }
    if (!editForm.subject.trim()) { setEditError("Subject is required."); return; }
    updateCourse({
      id,
      data: {
        name: editForm.name.trim(),
        subject: editForm.subject.trim(),
        grade: editForm.grade.trim() || undefined,
        academicYear: editForm.academicYear.trim() || undefined,
        description: editForm.description.trim() || undefined,
      },
    });
  }

  // ── Archive (soft-delete) state ─────────────────────────────────────────────
  const [archiveOpen, setArchiveOpen] = useState(false);

  const { mutate: deleteCourse, isPending: isArchiving } = useDeleteCourse({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        toast({ title: "Course archived", description: "The course has been archived." });
        setLocation("/courses");
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to archive course. Please try again.";
        toast({ title: "Archive failed", description: msg, variant: "destructive" });
      },
    },
  });

  // ── Enroll student state ────────────────────────────────────────────────────
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const { mutate: enrollStudent, isPending: isEnrolling } = useEnrollStudent({
    mutation: {
      onSuccess: (_data, variables) => {
        const enrolledStudentId = variables.data.studentId;
        queryClient.setQueryData(
          getListStudentsQueryKey(),
          (old: PaginatedStudentList | undefined) =>
            old
              ? {
                  ...old,
                  items: old.items.map(s =>
                    s.id === enrolledStudentId
                      ? { ...s, enrolledCourseIds: [...s.enrolledCourseIds, id] }
                      : s,
                  ),
                }
              : old,
        );
        queryClient.invalidateQueries({ queryKey: getGetCourseQueryKey(id) });
        setEnrollOpen(false);
        setEnrollSearch("");
        setEnrollError(null);
        toast({ title: "Student enrolled", description: "The student has been added to this course." });
      },
      onError: (err: unknown) => {
        const status =
          err && typeof err === "object" && "status" in err
            ? (err as { status: unknown }).status
            : null;
        if (status === 409) {
          setEnrollError("This student is already enrolled in this course.");
          return;
        }
        if (status === 422) {
          setEnrollError("Cannot enroll students in an archived course.");
          return;
        }
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to enroll student. Please try again.";
        setEnrollError(msg);
      },
    },
  });

  // ── Unenroll state ─────────────────────────────────────────────────────────
  const [unenrollTarget, setUnenrollTarget] = useState<{ id: number; name: string } | null>(null);

  const { mutate: unenrollStudent, isPending: isUnenrolling } = useUnenrollStudent({
    mutation: {
      onSuccess: (_data, variables) => {
        const removedStudentId = variables.studentId;
        queryClient.setQueryData(
          getListStudentsQueryKey(),
          (old: PaginatedStudentList | undefined) =>
            old
              ? {
                  ...old,
                  items: old.items.map(s =>
                    s.id === removedStudentId
                      ? { ...s, enrolledCourseIds: s.enrolledCourseIds.filter(cid => cid !== id) }
                      : s,
                  ),
                }
              : old,
        );
        queryClient.invalidateQueries({ queryKey: getGetCourseQueryKey(id) });
        setUnenrollTarget(null);
        toast({ title: "Student removed", description: "The student has been removed from this course." });
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to remove student. Please try again.";
        toast({ title: "Remove failed", description: msg, variant: "destructive" });
        setUnenrollTarget(null);
      },
    },
  });

  const filteredUnenrolled = unenrolledStudents.filter(s =>
    s.name.toLowerCase().includes(enrollSearch.toLowerCase()) ||
    s.email.toLowerCase().includes(enrollSearch.toLowerCase())
  );

  // ── Loading / not found ────────────────────────────────────────────────────
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
    return (
      <div className="space-y-4">
        <Link href="/courses">
          <Button variant="outline" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <BookOpen className="w-8 h-8 mb-3 opacity-20" />
            <p className="font-medium">Course not found</p>
            <p className="text-sm mt-1">This course may have been archived or does not exist.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Header ── */}
      <div className="flex items-start gap-4">
        <Link href="/courses">
          <Button variant="outline" size="icon" className="mt-1">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight truncate">{course.name}</h1>
            <Badge variant="secondary">{course.subject}</Badge>
            {course.status === "archived" && (
              <Badge variant="outline" className="text-muted-foreground">Archived</Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1">Taught by {course.teacherName}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={openEdit} disabled={isUpdating}>
            <Pencil className="mr-2 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setArchiveOpen(true)}
            disabled={isArchiving}
            className="text-destructive hover:text-destructive"
          >
            <Archive className="mr-2 h-3.5 w-3.5" />
            Archive
          </Button>
        </div>
      </div>

      {/* ── Course summary card ── */}
      <Card>
        <CardContent className="p-6">
          <p className="text-foreground leading-relaxed max-w-3xl">
            {course.description || <span className="text-muted-foreground italic">No description provided.</span>}
          </p>
          <div className="flex flex-wrap items-center gap-6 mt-6 pt-6 border-t border-border">
            <div className="flex items-center gap-2 text-sm">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">{course.studentCount} Students</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              <span className="font-medium">Created {formatDate(course.createdAt)}</span>
            </div>
            {course.grade && (
              <div className="text-sm">
                <span className="text-muted-foreground">Grade: </span>
                <span className="font-medium">{course.grade}</span>
              </div>
            )}
            {course.academicYear && (
              <div className="text-sm">
                <span className="text-muted-foreground">Year: </span>
                <span className="font-medium">{course.academicYear}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Tabs ── */}
      <Tabs defaultValue="students" className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-6">
          <TabsTrigger
            value="students"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 py-2"
          >
            <Users className="mr-2 h-4 w-4" />
            Students ({enrolledStudents.length})
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

        {/* ── Students tab ── */}
        <TabsContent value="students">
          <div className="flex justify-end mb-4">
            <Button size="sm" onClick={() => { setEnrollSearch(""); setEnrollError(null); setEnrollOpen(true); }}>
              <UserPlus className="mr-2 h-4 w-4" />
              Enroll Student
            </Button>
          </div>

          {isLoadingStudents ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : enrolledStudents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {enrolledStudents.map(student => (
                <Card key={student.id} className="hover:bg-muted/50 transition-colors h-full">
                  <CardHeader className="flex flex-row items-center gap-4 py-4">
                    <Link href={`/students/${student.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                        {student.avatarUrl ? (
                          <img src={student.avatarUrl} alt={student.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          student.name.charAt(0)
                        )}
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate">{student.name}</CardTitle>
                        <CardDescription className="truncate">{student.email}</CardDescription>
                      </div>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setUnenrollTarget({ id: student.id, name: student.name })}
                      disabled={isUnenrolling}
                      title="Remove from course"
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground border rounded-lg bg-card/50">
              <Users className="mx-auto h-8 w-8 mb-3 opacity-20" />
              <p>No students enrolled yet</p>
              <p className="text-sm mt-1">Click "Enroll Student" to add students to this course.</p>
            </div>
          )}
        </TabsContent>

        {/* ── Assignments tab ── */}
        <TabsContent value="assignments">
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

        {/* ── Notes tab ── */}
        <TabsContent value="notes">
          {isLoadingNotes ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : notes.length > 0 ? (
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

      {/* ── Edit Course dialog ── */}
      <Dialog
        open={editOpen}
        onOpenChange={(next) => {
          setEditOpen(next);
          if (!next) setEditError(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Course</DialogTitle>
            <DialogDescription>Update the course details below.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Course Name *</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                disabled={isUpdating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-subject">Subject *</Label>
              <Input
                id="edit-subject"
                value={editForm.subject}
                onChange={(e) => setEditForm((f) => ({ ...f, subject: e.target.value }))}
                disabled={isUpdating}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-grade">Grade Level</Label>
                <Input
                  id="edit-grade"
                  value={editForm.grade}
                  onChange={(e) => setEditForm((f) => ({ ...f, grade: e.target.value }))}
                  disabled={isUpdating}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-year">Academic Year</Label>
                <Input
                  id="edit-year"
                  value={editForm.academicYear}
                  onChange={(e) => setEditForm((f) => ({ ...f, academicYear: e.target.value }))}
                  disabled={isUpdating}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                disabled={isUpdating}
              />
            </div>

            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={isUpdating}>
                Cancel
              </Button>
              <Button type="submit" disabled={isUpdating}>
                {isUpdating ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Archive confirmation dialog ── */}
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this course?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{course.name}</strong> will be archived and hidden from active course lists.
              This action can be reviewed by an administrator.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCourse({ id })}
              disabled={isArchiving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isArchiving ? "Archiving…" : "Archive Course"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Enroll Student dialog ── */}
      <Dialog
        open={enrollOpen}
        onOpenChange={(next) => {
          setEnrollOpen(next);
          if (!next) { setEnrollSearch(""); setEnrollError(null); }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enroll Student</DialogTitle>
            <DialogDescription>
              Select a student to enroll in <strong>{course.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search students…"
                className="pl-8"
                value={enrollSearch}
                onChange={(e) => setEnrollSearch(e.target.value)}
                disabled={isEnrolling}
              />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2 rounded-md border bg-muted/20 p-1">
              {filteredUnenrolled.length > 0 ? (
                filteredUnenrolled.map(student => (
                  <button
                    key={student.id}
                    type="button"
                    disabled={isEnrolling}
                    onClick={() => {
                      setEnrollError(null);
                      enrollStudent({ courseId: id, data: { studentId: student.id } });
                    }}
                    className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted transition-colors text-left disabled:opacity-50"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {student.avatarUrl ? (
                        <img src={student.avatarUrl} alt={student.name} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        student.name.charAt(0)
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{student.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{student.email}</p>
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {enrollSearch ? "No students match your search." : "All students are already enrolled."}
                </div>
              )}
            </div>

            {enrollError && (
              <p className="text-sm text-destructive">{enrollError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollOpen(false)} disabled={isEnrolling}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Unenroll confirmation dialog ── */}
      <AlertDialog open={!!unenrollTarget} onOpenChange={(open) => { if (!open) setUnenrollTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove student from course?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{unenrollTarget?.name}</strong> will be removed from <strong>{course.name}</strong>.
              They will lose access to this course's materials and assignments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnenrolling}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (unenrollTarget) {
                  unenrollStudent({ courseId: id, studentId: unenrollTarget.id });
                }
              }}
              disabled={isUnenrolling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isUnenrolling ? "Removing…" : "Remove Student"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
