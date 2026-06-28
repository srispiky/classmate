import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAssignments,
  useCreateAssignment,
  useUpdateAssignment,
  useDeleteAssignment,
  useListCourses,
  useListStudents,
  useGetMe,
  getListAssignmentsQueryKey,
} from "@workspace/api-client-react";
import type { Assignment, PaginatedAssignmentList } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, CheckSquare, Clock, CheckCircle2, AlertCircle, Plus, Trash2, Star, ChevronRight, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const PAGE_LIMIT = 50;

export default function Assignments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetMe();

  // ── Pagination state ─────────────────────────────────────────────────────────
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const appendModeRef = useRef(false);

  const { data: pageData, isLoading, isFetching } = useListAssignments({ cursor, limit: PAGE_LIMIT });
  const { data: coursesPageData } = useListCourses({ limit: 100 });
  const allCourses = coursesPageData?.items ?? [];
  const { data: allStudentsData } = useListStudents();

  useEffect(() => {
    if (!pageData?.items) return;
    if (appendModeRef.current) {
      setAllAssignments((prev) => [...prev, ...pageData.items]);
    } else {
      setAllAssignments(pageData.items);
    }
    appendModeRef.current = false;
  }, [pageData]);

  function handleLoadMore() {
    const next = pageData?.pagination?.nextCursor;
    if (!next) return;
    appendModeRef.current = true;
    setCursor(next);
  }

  function resetPagination() {
    appendModeRef.current = false;
    setCursor(undefined);
  }

  const hasMore = pageData?.pagination?.hasMore ?? false;

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredAssignments = useMemo(() => {
    return allAssignments.filter((a) => {
      const matchesSearch =
        a.title.toLowerCase().includes(search.toLowerCase()) ||
        a.studentName.toLowerCase().includes(search.toLowerCase()) ||
        a.courseName.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || a.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [allAssignments, search, statusFilter]);

  // ── Create dialog state ─────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createCourseId, setCreateCourseId] = useState("");
  const [createStudentId, setCreateStudentId] = useState("");
  const [createDueDate, setCreateDueDate] = useState("");
  const [createMaxScore, setCreateMaxScore] = useState("100");
  const [createError, setCreateError] = useState<string | null>(null);

  const courseStudents = useMemo(() => {
    if (!createCourseId || !allStudentsData?.items) return [];
    const cid = parseInt(createCourseId);
    return allStudentsData.items.filter((s) => s.enrolledCourseIds.includes(cid));
  }, [createCourseId, allStudentsData]);

  // ── Grade dialog state ──────────────────────────────────────────────────────
  const [gradeTarget, setGradeTarget] = useState<Assignment | null>(null);
  const [gradeStatus, setGradeStatus] = useState<string>("graded");
  const [gradeScore, setGradeScore] = useState("");
  const [gradeFeedback, setGradeFeedback] = useState("");
  const [gradeError, setGradeError] = useState<string | null>(null);

  // ── Delete dialog state ─────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const { mutate: createAssignment, isPending: isCreating } = useCreateAssignment({
    mutation: {
      onSuccess: () => {
        resetPagination();
        queryClient.invalidateQueries({ queryKey: getListAssignmentsQueryKey() });
        setCreateOpen(false);
        resetCreate();
        toast({ title: "Assignment created", description: "The assignment has been added." });
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to create assignment. Please try again.";
        setCreateError(msg);
      },
    },
  });

  const { mutate: updateAssignment, isPending: isGrading } = useUpdateAssignment({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(
          getListAssignmentsQueryKey(),
          (old: PaginatedAssignmentList | undefined) =>
            old ? { ...old, items: old.items.map((a) => (a.id === data.id ? { ...a, ...data } : a)) } : old,
        );
        setAllAssignments((prev) => prev.map((a) => (a.id === data.id ? { ...a, ...data } : a)));
        setGradeTarget(null);
        resetGrade();
        toast({ title: "Assignment updated", description: "Changes have been saved." });
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to update assignment. Please try again.";
        setGradeError(msg);
      },
    },
  });

  const { mutate: deleteAssignment, isPending: isDeleting } = useDeleteAssignment({
    mutation: {
      onSuccess: (_data, variables) => {
        queryClient.setQueryData(
          getListAssignmentsQueryKey(),
          (old: PaginatedAssignmentList | undefined) =>
            old ? { ...old, items: old.items.filter((a) => a.id !== variables.id) } : old,
        );
        setAllAssignments((prev) => prev.filter((a) => a.id !== variables.id));
        setDeleteTarget(null);
        toast({ title: "Assignment deleted", description: "The assignment has been removed." });
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to delete assignment. Please try again.";
        toast({ title: "Delete failed", description: msg, variant: "destructive" });
        setDeleteTarget(null);
      },
    },
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function resetCreate() {
    setCreateTitle("");
    setCreateDescription("");
    setCreateCourseId("");
    setCreateStudentId("");
    setCreateDueDate("");
    setCreateMaxScore("100");
    setCreateError(null);
  }

  function resetGrade() {
    setGradeStatus("graded");
    setGradeScore("");
    setGradeFeedback("");
    setGradeError(null);
  }

  function openGrade(a: Assignment) {
    setGradeTarget(a);
    setGradeStatus(a.status);
    setGradeScore(a.score != null ? String(a.score) : "");
    setGradeFeedback(a.feedback ?? "");
    setGradeError(null);
  }

  function handleCreate() {
    if (!createTitle.trim()) { setCreateError("Title is required."); return; }
    if (!createDescription.trim()) { setCreateError("Description is required."); return; }
    if (!createCourseId) { setCreateError("Please select a course."); return; }
    if (!createStudentId) { setCreateError("Please select a student."); return; }
    if (!createDueDate) { setCreateError("Due date is required."); return; }
    const maxScore = parseInt(createMaxScore);
    if (isNaN(maxScore) || maxScore <= 0) { setCreateError("Max score must be a positive number."); return; }
    setCreateError(null);
    createAssignment({
      data: {
        title: createTitle.trim(),
        description: createDescription.trim(),
        courseId: parseInt(createCourseId),
        studentId: parseInt(createStudentId),
        dueDate: createDueDate + "T00:00:00.000Z",
        maxScore,
      },
    });
  }

  function handleGrade() {
    if (!gradeTarget) return;
    const scoreNum = gradeScore.trim() === "" ? undefined : Number(gradeScore);
    if (gradeStatus === "graded") {
      if (gradeScore.trim() === "") { setGradeError("Score is required when marking as graded."); return; }
      if (isNaN(scoreNum!)) { setGradeError("Score must be a number."); return; }
      if (scoreNum! < 0 || scoreNum! > gradeTarget.maxScore) {
        setGradeError(`Score must be between 0 and ${gradeTarget.maxScore}.`);
        return;
      }
    }
    setGradeError(null);
    updateAssignment({
      id: gradeTarget.id,
      data: {
        status: gradeStatus as "pending" | "submitted" | "graded" | "late",
        ...(scoreNum !== undefined ? { score: scoreNum } : {}),
        ...(gradeFeedback.trim() ? { feedback: gradeFeedback.trim() } : {}),
      },
    });
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case "graded": return <CheckCircle2 className="w-4 h-4 text-primary" />;
      case "submitted": return <CheckSquare className="w-4 h-4 text-secondary-foreground" />;
      case "late": return <AlertCircle className="w-4 h-4 text-destructive" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  }

  function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
    switch (status) {
      case "graded": return "default";
      case "submitted": return "secondary";
      case "late": return "destructive";
      default: return "outline";
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Assignments</h1>
          <p className="text-muted-foreground mt-1">Track and grade student submissions across all courses.</p>
        </div>
        {(me?.role === "admin" || me?.role === "teacher") && (
          <Button onClick={() => { resetCreate(); setCreateOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Create Assignment
          </Button>
        )}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="relative flex-1 w-full max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search assignments, students, courses..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="graded">Graded</SelectItem>
            <SelectItem value="late">Late</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── List ────────────────────────────────────────────────────────────── */}
      {isLoading && allAssignments.length === 0 ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : filteredAssignments.length > 0 ? (
        <>
          <div className="space-y-4">
            {filteredAssignments.map((assignment) => (
              <Card key={assignment.id} className="hover:bg-muted/50 transition-colors group">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <Link href={`/assignments/${assignment.id}`} className="flex-1 min-w-0">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {getStatusIcon(assignment.status)}
                          <h3 className="font-semibold text-lg group-hover:underline">{assignment.title}</h3>
                          <Badge variant={getStatusBadgeVariant(assignment.status)}>
                            {assignment.status}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-foreground">{assignment.studentName}</span>
                          <span>•</span>
                          <span>{assignment.courseName}</span>
                          <span>•</span>
                          <span>Due {formatDate(assignment.dueDate)}</span>
                        </div>
                      </div>
                    </Link>

                    <div className="flex items-center gap-2 sm:w-auto shrink-0">
                      {assignment.score != null ? (
                        <div className="font-bold text-xl text-primary mr-2">
                          {assignment.score}/{assignment.maxScore}
                        </div>
                      ) : (assignment.status === "submitted" || assignment.status === "late") ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-amber-600 border-amber-300 hover:bg-amber-50"
                          onClick={(e) => { e.preventDefault(); openGrade(assignment); }}
                        >
                          <Star className="mr-1.5 h-3.5 w-3.5" />
                          Grade
                        </Button>
                      ) : null}

                      <Button
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Grade / update"
                        onClick={(e) => { e.preventDefault(); openGrade(assignment); }}
                      >
                        <Star className="h-4 w-4" />
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                        title="Delete assignment"
                        onClick={(e) => { e.preventDefault(); setDeleteTarget({ id: assignment.id, title: assignment.title }); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>

                      <Link href={`/assignments/${assignment.id}`}>
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Load More / end-of-list (only shown when no filters active) */}
          {!search && statusFilter === "all" && (
            <div className="flex justify-center pt-2">
              {hasMore ? (
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={isFetching}
                  data-testid="load-more-assignments"
                >
                  {isFetching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading…
                    </>
                  ) : (
                    "Load More"
                  )}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All {allAssignments.length} assignment{allAssignments.length !== 1 ? "s" : ""} loaded
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckSquare className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No assignments found</h3>
              <p className="text-muted-foreground mt-1">
                {search || statusFilter !== "all"
                  ? "Try adjusting your filters or search query."
                  : "Create your first assignment to get started."}
              </p>
            </div>
            {!search && statusFilter === "all" && (me?.role === "admin" || me?.role === "teacher") && (
              <Button onClick={() => { resetCreate(); setCreateOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" />
                Create Assignment
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Create Assignment Dialog ─────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) { setCreateOpen(false); resetCreate(); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Assignment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-title">Title</Label>
              <Input
                id="create-title"
                placeholder="e.g. Chapter 3 Quiz"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-description">Description</Label>
              <Textarea
                id="create-description"
                placeholder="Describe the assignment..."
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-course">Course</Label>
              <Select
                value={createCourseId}
                onValueChange={(v) => { setCreateCourseId(v); setCreateStudentId(""); }}
              >
                <SelectTrigger id="create-course">
                  <SelectValue placeholder="Select a course..." />
                </SelectTrigger>
                <SelectContent>
                  {allCourses
                    .filter((c) => c.status === "active")
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-student">Student</Label>
              <Select
                value={createStudentId}
                onValueChange={setCreateStudentId}
                disabled={!createCourseId}
              >
                <SelectTrigger id="create-student">
                  <SelectValue placeholder={createCourseId ? "Select a student..." : "Select a course first"} />
                </SelectTrigger>
                <SelectContent>
                  {courseStudents.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                  ))}
                  {createCourseId && courseStudents.length === 0 && (
                    <div className="py-2 px-3 text-sm text-muted-foreground">No students enrolled in this course.</div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="create-due-date">Due Date</Label>
                <Input
                  id="create-due-date"
                  type="date"
                  value={createDueDate}
                  onChange={(e) => setCreateDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-max-score">Max Score</Label>
                <Input
                  id="create-max-score"
                  type="number"
                  min="1"
                  placeholder="100"
                  value={createMaxScore}
                  onChange={(e) => setCreateMaxScore(e.target.value)}
                />
              </div>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreate(); }}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating ? "Creating..." : "Create Assignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Grade / Update Dialog ────────────────────────────────────────────── */}
      <Dialog open={gradeTarget !== null} onOpenChange={(open) => { if (!open) { setGradeTarget(null); resetGrade(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Grade Assignment</DialogTitle>
          </DialogHeader>
          {gradeTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="font-medium">{gradeTarget.title}</span>
                <span className="text-muted-foreground"> — {gradeTarget.studentName}</span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grade-status">Status</Label>
                <Select value={gradeStatus} onValueChange={setGradeStatus}>
                  <SelectTrigger id="grade-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="graded">Graded</SelectItem>
                    <SelectItem value="late">Late</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grade-score">
                  Score
                  <span className="text-muted-foreground font-normal ml-1">/ {gradeTarget.maxScore}</span>
                </Label>
                <Input
                  id="grade-score"
                  type="number"
                  min={0}
                  max={gradeTarget.maxScore}
                  placeholder="e.g. 85"
                  value={gradeScore}
                  onChange={(e) => setGradeScore(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grade-feedback">Feedback</Label>
                <Textarea
                  id="grade-feedback"
                  placeholder="Optional feedback for the student..."
                  value={gradeFeedback}
                  onChange={(e) => setGradeFeedback(e.target.value)}
                  rows={3}
                />
              </div>
              {gradeError && <p className="text-sm text-destructive">{gradeError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGradeTarget(null); resetGrade(); }}>
              Cancel
            </Button>
            <Button onClick={handleGrade} disabled={isGrading}>
              {isGrading ? "Saving…" : "Save Grade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ─────────────────────────────────────────────── */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Assignment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium">{deleteTarget?.title}</span>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteAssignment({ id: deleteTarget.id })}
              disabled={isDeleting}
            >
              Delete Assignment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
