import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAssessment,
  useUpdateAssessment,
  useDeleteAssessment,
  getGetAssessmentQueryKey,
  getListAssessmentsQueryKey,
} from "@workspace/api-client-react";
import type { Assessment } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  ArrowLeft,
  Target,
  User,
  BookOpen,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
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

// ── Edit dialog ───────────────────────────────────────────────────────────────

interface EditForm {
  title: string;
  score: string;
  maxScore: string;
  strengths: string;
  weaknesses: string;
}

interface EditDialogProps {
  assessment: Assessment;
  onClose: () => void;
  onSubmit: (f: EditForm) => void;
  isPending: boolean;
  error: string;
}

function EditDialog({ assessment, onClose, onSubmit, isPending, error }: EditDialogProps) {
  const [form, setForm] = useState<EditForm>({
    title: assessment.title,
    score: String(assessment.score),
    maxScore: String(assessment.maxScore),
    strengths: toLines(assessment.strengths),
    weaknesses: toLines(assessment.weaknesses),
  });

  function set(key: keyof EditForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Assessment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="ed-title">Title</Label>
            <Input id="ed-title" value={form.title} onChange={set("title")} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ed-score">Score</Label>
              <Input
                id="ed-score"
                type="number"
                min={0}
                value={form.score}
                onChange={set("score")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-max">Max Score</Label>
              <Input
                id="ed-max"
                type="number"
                min={1}
                value={form.maxScore}
                onChange={set("maxScore")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-strengths">
              Strengths{" "}
              <span className="text-muted-foreground font-normal text-xs">(one per line)</span>
            </Label>
            <Textarea
              id="ed-strengths"
              rows={3}
              value={form.strengths}
              onChange={set("strengths")}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-weaknesses">
              Areas to Improve{" "}
              <span className="text-muted-foreground font-normal text-xs">(one per line)</span>
            </Label>
            <Textarea
              id="ed-weaknesses"
              rows={3}
              value={form.weaknesses}
              onChange={set("weaknesses")}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(form)} disabled={isPending}>
            {isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AssessmentDetail() {
  const { id: idStr } = useParams<{ id: string }>();
  const id = Number(idStr);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: assessment,
    isLoading,
    isError,
  } = useGetAssessment(id, {
    query: { enabled: id > 0, queryKey: getGetAssessmentQueryKey(id) },
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { mutate: updateAssessment, isPending: isUpdating } = useUpdateAssessment({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetAssessmentQueryKey(id), data);
        queryClient.setQueryData(
          getListAssessmentsQueryKey(),
          (old: Assessment[] | undefined) =>
            old ? old.map((a) => (a.id === data.id ? data : a)) : old,
        );
        setEditOpen(false);
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

  const { mutate: deleteAssessment } = useDeleteAssessment({
    mutation: {
      onSuccess: () => {
        queryClient.setQueryData(
          getListAssessmentsQueryKey(),
          (old: Assessment[] | undefined) =>
            old ? old.filter((a) => a.id !== id) : old,
        );
        toast({ title: "Assessment deleted" });
        setLocation("/assessments");
      },
    },
  });

  function handleEdit(f: EditForm) {
    setEditError("");
    if (!f.title.trim()) { setEditError("Title is required"); return; }
    const score = Number(f.score);
    const maxScore = Number(f.maxScore);
    if (isNaN(score)) { setEditError("Score is required"); return; }
    if (isNaN(maxScore) || maxScore < 1) { setEditError("Max score must be at least 1"); return; }
    if (score < 0 || score > maxScore) { setEditError(`Score must be between 0 and ${maxScore}`); return; }
    updateAssessment({
      id,
      data: {
        title: f.title.trim(),
        score,
        maxScore,
        strengths: fromLines(f.strengths),
        weaknesses: fromLines(f.weaknesses),
      },
    });
  }

  // ── Loading / error states ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="w-9 h-9 rounded-md" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (isError || !assessment) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4">
        <Target className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Assessment not found</h2>
        <p className="text-muted-foreground">
          This assessment may have been deleted or you don&apos;t have access to it.
        </p>
        <Button variant="outline" onClick={() => setLocation("/assessments")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Assessments
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setLocation("/assessments")}
            aria-label="Back to assessments"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate flex items-center gap-2">
              <Target className="w-6 h-6 text-primary shrink-0" />
              {assessment.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Completed {formatDate(assessment.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={() => { setEditError(""); setEditOpen(true); }}>
            <Pencil className="w-3.5 h-3.5 mr-2" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive border-destructive/30 hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <User className="w-4 h-4" />
              Student
            </div>
            <div className="font-semibold truncate">{assessment.studentName}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <BookOpen className="w-4 h-4" />
              Course
            </div>
            <div className="font-semibold truncate">{assessment.courseName}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground mb-1">Score</div>
            <div className="font-semibold">
              {assessment.score}/{assessment.maxScore}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground mb-1">Percentage</div>
            <div className={`text-2xl font-bold ${scoreColor(assessment.percentage)}`}>
              {assessment.percentage}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              Strengths
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assessment.strengths.length > 0 ? (
              <ul className="space-y-2">
                {assessment.strengths.map((s, i) => (
                  <li
                    key={i}
                    className="text-sm border-l-2 border-green-500 pl-3 py-1 bg-green-500/5 rounded-r-md"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">No strengths recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-orange-500" />
              Areas to Improve
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assessment.weaknesses.length > 0 ? (
              <ul className="space-y-2">
                {assessment.weaknesses.map((w, i) => (
                  <li
                    key={i}
                    className="text-sm border-l-2 border-orange-500 pl-3 py-1 bg-orange-500/5 rounded-r-md"
                  >
                    {w}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No improvement areas recorded.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit dialog */}
      {editOpen && (
        <EditDialog
          assessment={assessment}
          onClose={() => setEditOpen(false)}
          onSubmit={handleEdit}
          isPending={isUpdating}
          error={editError}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Assessment</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{assessment.title}&quot; for {assessment.studentName}? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteAssessment({ id })}
            >
              Delete Assessment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
