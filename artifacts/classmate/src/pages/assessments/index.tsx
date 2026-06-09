import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  useListAssessments,
  useCreateAssessment,
  useUpdateAssessment,
  useDeleteAssessment,
  useListCourses,
  useListStudents,
  useGetMe,
  getListAssessmentsQueryKey,
} from "@workspace/api-client-react";
import type { Assessment } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Target, BookOpen, Plus, Pencil, Trash2, BrainCircuit, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function scoreColor(pct: number) {
  if (pct >= 90) return "text-emerald-600";
  if (pct >= 75) return "text-blue-600";
  if (pct >= 60) return "text-amber-600";
  return "text-red-500";
}

function toLines(arr: string[]) {
  return arr.join("\n");
}
function fromLines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Create / Edit dialog ──────────────────────────────────────────────────────

interface AssessmentFormState {
  courseId: string;
  studentId: string;
  title: string;
  score: string;
  maxScore: string;
  strengths: string;
  weaknesses: string;
}

const EMPTY_FORM: AssessmentFormState = {
  courseId: "",
  studentId: "",
  title: "",
  score: "",
  maxScore: "100",
  strengths: "",
  weaknesses: "",
};

interface AssessmentDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onClose: () => void;
  initial?: AssessmentFormState;
  onSubmit: (f: AssessmentFormState) => void;
  isPending: boolean;
  error: string;
}

function AssessmentDialog({
  mode,
  open,
  onClose,
  initial = EMPTY_FORM,
  onSubmit,
  isPending,
  error,
}: AssessmentDialogProps) {
  const { data: courses } = useListCourses();
  const { data: students } = useListStudents();
  const [form, setForm] = useState<AssessmentFormState>(initial);

  // Reset when dialog opens
  const handleOpen = (isOpen: boolean) => {
    if (isOpen) setForm(initial);
  };

  const enrolled =
    form.courseId && students
      ? students.filter((s) =>
          (s.enrolledCourseIds ?? []).includes(Number(form.courseId)),
        )
      : [];
  // Fall back to all students if enrollment data is stale/empty
  const filteredStudents = enrolled.length > 0 ? enrolled : (students ?? []);

  function set(key: keyof AssessmentFormState) {
    return (val: string) => setForm((f) => ({ ...f, [key]: val }));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { handleOpen(v); if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create Assessment" : "Edit Assessment"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {mode === "create" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="a-course">Course</Label>
                <Select
                  value={form.courseId}
                  onValueChange={(v) => {
                    setForm((f) => ({ ...f, courseId: v, studentId: "" }));
                  }}
                >
                  <SelectTrigger id="a-course">
                    <SelectValue placeholder="Select course" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="a-student">Student</Label>
                <Select value={form.studentId} onValueChange={set("studentId")}>
                  <SelectTrigger id="a-student">
                    <SelectValue placeholder="Select student" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredStudents.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="a-title">Title</Label>
            <Input
              id="a-title"
              placeholder="e.g. Mid-term Assessment"
              value={form.title}
              onChange={(e) => set("title")(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="a-score">Score</Label>
              <Input
                id="a-score"
                type="number"
                min={0}
                placeholder="85"
                value={form.score}
                onChange={(e) => set("score")(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-max">Max Score</Label>
              <Input
                id="a-max"
                type="number"
                min={1}
                placeholder="100"
                value={form.maxScore}
                onChange={(e) => set("maxScore")(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-strengths">
              Strengths{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (one per line)
              </span>
            </Label>
            <Textarea
              id="a-strengths"
              placeholder={"Problem solving\nCritical thinking"}
              rows={3}
              value={form.strengths}
              onChange={(e) => set("strengths")(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="a-weaknesses">
              Areas to Improve{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (one per line)
              </span>
            </Label>
            <Textarea
              id="a-weaknesses"
              placeholder={"Time management\nAlgebra fundamentals"}
              rows={3}
              value={form.weaknesses}
              onChange={(e) => set("weaknesses")(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(form)} disabled={isPending}>
            {isPending
              ? mode === "create"
                ? "Creating…"
                : "Saving…"
              : mode === "create"
                ? "Create Assessment"
                : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Assessments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: me } = useGetMe();
  const canWrite = me?.role === "admin" || me?.role === "teacher";

  const { data: assessments, isLoading } = useListAssessments();
  const [search, setSearch] = useState("");

  // ── Create state ────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");

  const { mutate: createAssessment, isPending: isCreating } = useCreateAssessment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAssessmentsQueryKey() });
        setCreateOpen(false);
        toast({ title: "Assessment created" });
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string }; message?: string })?.data?.error ??
          (err as { message?: string })?.message ??
          "Failed to create assessment";
        setCreateError(msg);
      },
    },
  });

  // ── Edit state ──────────────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<Assessment | null>(null);
  const [editError, setEditError] = useState("");

  const { mutate: updateAssessment, isPending: isUpdating } = useUpdateAssessment({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(
          getListAssessmentsQueryKey(),
          (old: Assessment[] | undefined) =>
            old ? old.map((a) => (a.id === data.id ? data : a)) : old,
        );
        setEditTarget(null);
        toast({ title: "Assessment updated" });
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string }; message?: string })?.data?.error ??
          (err as { message?: string })?.message ??
          "Failed to update assessment";
        setEditError(msg);
      },
    },
  });

  // ── Delete state ─────────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<Assessment | null>(null);

  const { mutate: deleteAssessment } = useDeleteAssessment({
    mutation: {
      onSuccess: (_data, { id }) => {
        queryClient.setQueryData(
          getListAssessmentsQueryKey(),
          (old: Assessment[] | undefined) =>
            old ? old.filter((a) => a.id !== id) : old,
        );
        toast({ title: "Assessment deleted" });
      },
    },
  });

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filtered = (assessments ?? []).filter(
    (a) =>
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.studentName.toLowerCase().includes(search.toLowerCase()) ||
      a.courseName.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Handlers ─────────────────────────────────────────────────────────────────
  function handleCreate(f: AssessmentFormState) {
    setCreateError("");
    if (!f.title.trim()) { setCreateError("Title is required"); return; }
    if (!f.courseId) { setCreateError("Please select a course"); return; }
    if (!f.studentId) { setCreateError("Please select a student"); return; }
    const score = Number(f.score);
    const maxScore = Number(f.maxScore);
    if (!f.score || isNaN(score)) { setCreateError("Score is required"); return; }
    if (!f.maxScore || isNaN(maxScore) || maxScore < 1) { setCreateError("Max score must be at least 1"); return; }
    if (score < 0 || score > maxScore) { setCreateError(`Score must be between 0 and ${maxScore}`); return; }
    createAssessment({
      data: {
        title: f.title.trim(),
        courseId: Number(f.courseId),
        studentId: Number(f.studentId),
        score,
        maxScore,
        strengths: fromLines(f.strengths),
        weaknesses: fromLines(f.weaknesses),
      },
    });
  }

  function handleEdit(f: AssessmentFormState) {
    if (!editTarget) return;
    setEditError("");
    if (!f.title.trim()) { setEditError("Title is required"); return; }
    const score = Number(f.score);
    const maxScore = Number(f.maxScore);
    if (!f.score || isNaN(score)) { setEditError("Score is required"); return; }
    if (!f.maxScore || isNaN(maxScore) || maxScore < 1) { setEditError("Max score must be at least 1"); return; }
    if (score < 0 || score > maxScore) { setEditError(`Score must be between 0 and ${maxScore}`); return; }
    updateAssessment({
      id: editTarget.id,
      data: {
        title: f.title.trim(),
        score,
        maxScore,
        strengths: fromLines(f.strengths),
        weaknesses: fromLines(f.weaknesses),
      },
    });
  }

  function openEdit(a: Assessment, e: React.MouseEvent) {
    e.stopPropagation();
    setEditError("");
    setEditTarget(a);
  }

  function openDelete(a: Assessment, e: React.MouseEvent) {
    e.stopPropagation();
    setDeleteTarget(a);
  }

  const editInitial: AssessmentFormState | undefined = editTarget
    ? {
        courseId: String(editTarget.courseId),
        studentId: String(editTarget.studentId),
        title: editTarget.title,
        score: String(editTarget.score),
        maxScore: String(editTarget.maxScore),
        strengths: toLines(editTarget.strengths),
        weaknesses: toLines(editTarget.weaknesses),
      }
    : undefined;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Assessments</h1>
          <p className="text-muted-foreground mt-1">
            Review student performance and AI-generated insights.
          </p>
        </div>
        {canWrite && (
          <Button
            onClick={() => { setCreateError(""); setCreateOpen(true); }}
            className="shrink-0"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Assessment
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search students, courses, or titles…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((a) => (
            <Card
              key={a.id}
              className="flex flex-col hover:bg-muted/50 transition-colors cursor-pointer group relative"
              onClick={() => setLocation(`/assessments/${a.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-lg flex items-center gap-2 leading-tight">
                      <Target className="w-4 h-4 text-primary shrink-0" />
                      <span className="truncate">{a.title}</span>
                    </CardTitle>
                    <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={`/students/${a.studentId}`}
                        className="font-medium text-foreground hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.studentName}
                      </Link>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <BookOpen className="w-3.5 h-3.5" />
                        {a.courseName}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${scoreColor(a.percentage)}`}>
                        {a.percentage}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.score}/{a.maxScore}
                      </div>
                    </div>
                    {canWrite && (
                      <div
                        className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Edit assessment"
                          onClick={(e) => openEdit(a, e)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          title="Delete assessment"
                          onClick={(e) => openDelete(a, e)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex-1 mt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      Strengths
                    </h4>
                    <ul className="space-y-1.5">
                      {a.strengths.slice(0, 3).map((s, i) => (
                        <li
                          key={i}
                          className="text-sm border-l-2 border-green-500 pl-2.5 py-0.5 bg-green-500/5 rounded-r"
                        >
                          {s}
                        </li>
                      ))}
                      {a.strengths.length === 0 && (
                        <li className="text-sm text-muted-foreground italic">None recorded</li>
                      )}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-orange-500" />
                      Areas to Improve
                    </h4>
                    <ul className="space-y-1.5">
                      {a.weaknesses.slice(0, 3).map((w, i) => (
                        <li
                          key={i}
                          className="text-sm border-l-2 border-orange-500 pl-2.5 py-0.5 bg-orange-500/5 rounded-r"
                        >
                          {w}
                        </li>
                      ))}
                      {a.weaknesses.length === 0 && (
                        <li className="text-sm text-muted-foreground italic">None recorded</li>
                      )}
                    </ul>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    Completed {formatDate(a.createdAt)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/students/${a.studentId}/ai`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Badge
                        variant="outline"
                        className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors border-primary/30 text-primary"
                      >
                        <BrainCircuit className="w-3.5 h-3.5 mr-1" />
                        AI Insights
                      </Badge>
                    </Link>
                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Target className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No assessments found</h3>
              <p className="text-muted-foreground mt-1">
                {search
                  ? "Try adjusting your search query."
                  : "Create the first assessment to get started."}
              </p>
            </div>
            {canWrite && !search && (
              <Button onClick={() => { setCreateError(""); setCreateOpen(true); }}>
                <Plus className="w-4 h-4 mr-2" />
                Create Assessment
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <AssessmentDialog
        mode="create"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        isPending={isCreating}
        error={createError}
      />

      {/* Edit dialog */}
      {editTarget && editInitial && (
        <AssessmentDialog
          key={editTarget.id}
          mode="edit"
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          initial={editInitial}
          onSubmit={handleEdit}
          isPending={isUpdating}
          error={editError}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Assessment</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deleteTarget?.title}&quot; for {deleteTarget?.studentName}? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  deleteAssessment({ id: deleteTarget.id });
                  setDeleteTarget(null);
                }
              }}
            >
              Delete Assessment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
