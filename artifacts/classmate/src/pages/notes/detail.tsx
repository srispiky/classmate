import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetNote,
  useUpdateNote,
  useDeleteNote,
  getGetNoteQueryKey,
  getListNotesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  BookOpen,
  Clock,
  PlayCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err)
    return String((err as { message: unknown }).message);
  return fallback;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type EditFormState = {
  title: string;
  content: string;
  topic: string;
  videoUrl: string;
};

type NoteItem = {
  id: number;
  title: string;
  content: string;
  courseId: number;
  courseName: string;
  topic: string;
  videoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NoteDetail() {
  const params = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const id = parseInt(params.id || "0", 10);

  const { data: note, isLoading } = useGetNote(id, {
    query: { enabled: !!id, queryKey: getGetNoteQueryKey(id) },
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>({
    title: "",
    content: "",
    topic: "",
    videoUrl: "",
  });
  const [editError, setEditError] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const { mutate: updateMutate, isPending: isUpdating } = useUpdateNote({
    mutation: {
      onSuccess: (updated) => {
        qc.setQueryData(getGetNoteQueryKey(updated.id), updated);
        qc.setQueryData(
          getListNotesQueryKey(),
          (old: NoteItem[] | undefined) =>
            old?.map((n) => (n.id === updated.id ? updated : n)),
        );
        toast({ title: "Note updated" });
        setEditOpen(false);
        setEditError("");
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: unknown }).message)
              : "Failed to update note";
        setEditError(msg);
      },
    },
  });

  const { mutate: deleteMutate, isPending: isDeleting } = useDeleteNote({
    mutation: {
      onSuccess: (_data, vars) => {
        qc.setQueryData(
          getListNotesQueryKey(),
          (old: NoteItem[] | undefined) =>
            old?.filter((n) => n.id !== vars.id),
        );
        toast({ title: "Note deleted" });
        navigate("/notes");
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: unknown }).message)
              : "Failed to delete note";
        toast({
          title: "Error",
          description: msg,
          variant: "destructive",
        });
      },
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function openEdit() {
    if (!note) return;
    setEditForm({
      title: note.title,
      content: note.content,
      topic: note.topic,
      videoUrl: note.videoUrl ?? "",
    });
    setEditError("");
    setEditOpen(true);
  }

  function handleEdit() {
    if (!note) return;
    if (!editForm.title.trim()) { setEditError("Title is required"); return; }
    if (!editForm.content.trim()) { setEditError("Content is required"); return; }
    if (!editForm.topic.trim()) { setEditError("Topic is required"); return; }
    setEditError("");
    updateMutate({
      id: note.id,
      data: {
        title: editForm.title.trim(),
        content: editForm.content.trim(),
        topic: editForm.topic.trim(),
        videoUrl: editForm.videoUrl.trim() || undefined,
      },
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!note) {
    return <div>Note not found</div>;
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate("/notes")}
            aria-label="Back to notes"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <Badge variant="secondary" className="mb-1">
              {note.topic}
            </Badge>
            <h1 className="text-3xl font-bold tracking-tight">{note.title}</h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <BookOpen className="w-4 h-4" />
                <span>{note.courseName}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                <span>Added {formatDate(note.createdAt)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={openEdit}>
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        </div>
      </div>

      {/* Video player */}
      {note.videoUrl && (
        <Card className="overflow-hidden border-primary/20">
          <CardHeader className="bg-primary/5 pb-4">
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <PlayCircle className="w-5 h-5" />
              Lesson Replay
            </CardTitle>
            <CardDescription>
              Watch the recorded lesson for this topic.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 aspect-video bg-black flex items-center justify-center group relative cursor-pointer">
            <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors" />
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform z-10">
              <PlayCircle className="w-8 h-8 text-white fill-white/20" />
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-white/80 text-xs">
              <span>0:00 / 45:00</span>
              <span className="font-mono">{note.videoUrl}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      <Card>
        <CardHeader>
          <CardTitle>Lesson Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
            {note.content.split("\n\n").map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => { if (!open) setEditOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Note</DialogTitle>
            <DialogDescription>Update the lesson note details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {editError && (
              <p role="alert" className="text-sm text-destructive">
                {editError}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="detail-note-title">Title *</Label>
              <Input
                id="detail-note-title"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="detail-note-topic">Topic *</Label>
              <Input
                id="detail-note-topic"
                value={editForm.topic}
                onChange={(e) => setEditForm((f) => ({ ...f, topic: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="detail-note-content">Content *</Label>
              <Textarea
                id="detail-note-content"
                rows={5}
                value={editForm.content}
                onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="detail-note-video">Video URL (optional)</Label>
              <Input
                id="detail-note-video"
                value={editForm.videoUrl}
                onChange={(e) => setEditForm((f) => ({ ...f, videoUrl: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={isUpdating}>
              {isUpdating ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{note.title}&quot;? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={() => deleteMutate({ id: note.id })}
            >
              Delete Note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
