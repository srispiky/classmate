import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAssignment,
  useUpdateAssignment,
  useDeleteAssignment,
  getListAssignmentsQueryKey,
  getGetAssignmentQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Star, Trash2, User, BookOpen, Calendar, Hash, CheckCircle2, Clock, CheckSquare, AlertCircle, MessageSquare } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function AssignmentDetail() {
  const params = useParams();
  const id = parseInt(params.id ?? "0");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: assignment, isLoading, isError } = useGetAssignment(id, {
    query: { enabled: id > 0, queryKey: getGetAssignmentQueryKey(id) },
  });

  // ── Grade dialog state ──────────────────────────────────────────────────────
  const [gradeOpen, setGradeOpen] = useState(false);
  const [gradeStatus, setGradeStatus] = useState<string>("graded");
  const [gradeScore, setGradeScore] = useState("");
  const [gradeFeedback, setGradeFeedback] = useState("");
  const [gradeError, setGradeError] = useState<string | null>(null);

  // ── Delete dialog state ─────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const { mutate: updateAssignment, isPending: isGrading } = useUpdateAssignment({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetAssignmentQueryKey(id), data);
        queryClient.setQueryData(
          getListAssignmentsQueryKey(),
          (old: Array<{ id: number }> | undefined) =>
            old?.map(a => (a.id === id ? { ...a, ...data } : a)),
        );
        setGradeOpen(false);
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
      onSuccess: () => {
        queryClient.setQueryData(
          getListAssignmentsQueryKey(),
          (old: Array<{ id: number }> | undefined) => old?.filter(a => a.id !== id),
        );
        toast({ title: "Assignment deleted", description: "The assignment has been removed." });
        setLocation("/assignments");
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to delete assignment. Please try again.";
        toast({ title: "Delete failed", description: msg, variant: "destructive" });
        setDeleteOpen(false);
      },
    },
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function resetGrade() {
    setGradeStatus("graded");
    setGradeScore("");
    setGradeFeedback("");
    setGradeError(null);
  }

  function openGrade() {
    if (!assignment) return;
    setGradeStatus(assignment.status);
    setGradeScore(assignment.score != null ? String(assignment.score) : "");
    setGradeFeedback(assignment.feedback ?? "");
    setGradeError(null);
    setGradeOpen(true);
  }

  function handleGrade() {
    if (!assignment) return;
    const scoreNum = gradeScore.trim() === "" ? undefined : Number(gradeScore);
    if (gradeStatus === "graded") {
      if (gradeScore.trim() === "") { setGradeError("Score is required when marking as graded."); return; }
      if (isNaN(scoreNum!)) { setGradeError("Score must be a number."); return; }
      if (scoreNum! < 0 || scoreNum! > assignment.maxScore) {
        setGradeError(`Score must be between 0 and ${assignment.maxScore}.`);
        return;
      }
    }
    setGradeError(null);
    updateAssignment({
      id,
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

  // ── Loading / error states ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !assignment) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <Link href="/assignments">
          <Button variant="outline" size="icon" className="mt-1">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center justify-center h-48 space-y-3">
            <AlertCircle className="w-10 h-10 text-destructive" />
            <div className="text-center">
              <h3 className="font-semibold text-lg">Assignment not found</h3>
              <p className="text-muted-foreground text-sm mt-1">This assignment may have been deleted or you don't have access.</p>
            </div>
            <Button variant="outline" onClick={() => setLocation("/assignments")}>Back to Assignments</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const needsGrading = (assignment.status === "submitted" || assignment.status === "late") && assignment.score == null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-4">
        <Link href="/assignments">
          <Button variant="outline" size="icon" className="mt-1">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight truncate">{assignment.title}</h1>
            <div className="flex items-center gap-1.5">
              {getStatusIcon(assignment.status)}
              <Badge variant={getStatusBadgeVariant(assignment.status)}>
                {assignment.status}
              </Badge>
            </div>
            {needsGrading && (
              <span className="text-sm font-medium text-amber-600 dark:text-amber-500 bg-amber-500/10 px-2.5 py-0.5 rounded-md">
                Needs Grading
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={openGrade}>
            <Star className="mr-2 h-3.5 w-3.5" />
            {assignment.status === "graded" ? "Update Grade" : "Grade"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      {/* ── Info grid ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <User className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Student</p>
              <p className="font-medium text-sm truncate">{assignment.studentName}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Course</p>
              <p className="font-medium text-sm truncate">{assignment.courseName}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Calendar className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Due Date</p>
              <p className="font-medium text-sm">{formatDate(assignment.dueDate)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Hash className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Score</p>
              {assignment.score != null ? (
                <p className="font-bold text-primary">
                  {assignment.score}/{assignment.maxScore}
                </p>
              ) : (
                <p className="font-medium text-sm text-muted-foreground">—/{assignment.maxScore}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Description ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {assignment.description || "No description provided."}
          </p>
        </CardContent>
      </Card>

      {/* ── Feedback ────────────────────────────────────────────────────────── */}
      {assignment.feedback && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Feedback
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{assignment.feedback}</p>
          </CardContent>
        </Card>
      )}

      {/* ── Needs grading prompt ─────────────────────────────────────────────── */}
      {needsGrading && (
        <Card className="border-amber-300/50 bg-amber-500/5">
          <CardContent className="p-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-400">This assignment is awaiting a grade.</p>
              <p className="text-sm text-muted-foreground mt-0.5">Enter a score and optional feedback to mark it as graded.</p>
            </div>
            <Button onClick={openGrade} className="shrink-0">
              <Star className="mr-2 h-4 w-4" />
              Grade Now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Grade / Update Dialog ────────────────────────────────────────────── */}
      <Dialog open={gradeOpen} onOpenChange={(open) => { if (!open) { setGradeOpen(false); resetGrade(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{assignment.status === "graded" ? "Update Grade" : "Grade Assignment"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span className="font-medium">{assignment.title}</span>
              <span className="text-muted-foreground"> — {assignment.studentName}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="detail-grade-status">Status</Label>
              <Select value={gradeStatus} onValueChange={setGradeStatus}>
                <SelectTrigger id="detail-grade-status">
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
              <Label htmlFor="detail-grade-score">
                Score
                <span className="text-muted-foreground font-normal ml-1">/ {assignment.maxScore}</span>
                {gradeStatus !== "graded" && <span className="text-muted-foreground font-normal ml-1">(optional)</span>}
              </Label>
              <Input
                id="detail-grade-score"
                type="number"
                min="0"
                max={assignment.maxScore}
                placeholder={`0–${assignment.maxScore}`}
                value={gradeScore}
                onChange={(e) => setGradeScore(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="detail-grade-feedback">Feedback <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                id="detail-grade-feedback"
                placeholder="Leave feedback for the student..."
                value={gradeFeedback}
                onChange={(e) => setGradeFeedback(e.target.value)}
                rows={3}
              />
            </div>
            {gradeError && <p className="text-sm text-destructive">{gradeError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGradeOpen(false); resetGrade(); }}>
              Cancel
            </Button>
            <Button onClick={handleGrade} disabled={isGrading}>
              {isGrading ? "Saving..." : "Save Grade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ──────────────────────────────────────────────── */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Assignment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{assignment.title}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteAssignment({ id })}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Assignment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
