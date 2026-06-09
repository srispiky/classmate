import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, BookOpen, User } from "lucide-react";
import {
  useGetAnnouncement,
  useUpdateAnnouncement,
  useDeleteAnnouncement,
  getGetAnnouncementQueryKey,
  getListAnnouncementsQueryKey,
} from "@workspace/api-client-react";
import type { Announcement } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
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
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type EditFormState = {
  title: string;
  content: string;
  priority: "normal" | "urgent";
};

type EditErrors = Partial<Record<keyof EditFormState, string>>;

function validateEdit(form: EditFormState): EditErrors {
  const errs: EditErrors = {};
  if (!form.title.trim()) errs.title = "Title is required";
  if (!form.content.trim()) errs.content = "Content is required";
  return errs;
}

// ── EditAnnouncementDialog ────────────────────────────────────────────────────

type EditDialogProps = {
  open: boolean;
  onClose: () => void;
  initial: EditFormState;
  onSubmit: (form: EditFormState) => void;
  isPending: boolean;
  error: string;
};

function EditAnnouncementDialog({
  open,
  onClose,
  initial,
  onSubmit,
  isPending,
  error,
}: EditDialogProps) {
  const [form, setForm] = useState<EditFormState>(initial);
  const [errors, setErrors] = useState<EditErrors>({});

  const field = (key: keyof EditFormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = () => {
    const errs = validateEdit(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Announcement</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-ann-title">Title</Label>
            <Input
              id="edit-ann-title"
              value={form.title}
              onChange={(e) => field("title", e.target.value)}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-ann-content">Content</Label>
            <Textarea
              id="edit-ann-content"
              rows={5}
              value={form.content}
              onChange={(e) => field("content", e.target.value)}
            />
            {errors.content && (
              <p className="text-sm text-destructive">{errors.content}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-ann-priority">Priority</Label>
            <Select
              value={form.priority}
              onValueChange={(v) => field("priority", v as "normal" | "urgent")}
            >
              <SelectTrigger id="edit-ann-priority" aria-label="Priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Priority badge ────────────────────────────────────────────────────────────

function priorityBadge(priority: string) {
  return priority === "urgent" ? (
    <Badge variant="destructive">Urgent</Badge>
  ) : (
    <Badge variant="secondary">Normal</Badge>
  );
}

// ── AnnouncementDetail ────────────────────────────────────────────────────────

export default function AnnouncementDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: announcement, isLoading } = useGetAnnouncement(id, {
    query: { enabled: !!id, queryKey: getGetAnnouncementQueryKey(id) },
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  // ── Update ────────────────────────────────────────────────────────────────────

  const { mutate: doUpdate, isPending: isUpdating } = useUpdateAnnouncement({
    mutation: {
      onSuccess: (updated, vars) => {
        queryClient.setQueryData(getGetAnnouncementQueryKey(vars.id), updated);
        queryClient.setQueryData(
          getListAnnouncementsQueryKey(),
          (prev: Announcement[] | undefined) =>
            prev?.map((a) => (a.id === vars.id ? updated : a)) ?? prev,
        );
        toast({ title: "Announcement updated" });
        setEditOpen(false);
        setEditError("");
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: unknown }).message)
              : "Failed to update announcement";
        setEditError(msg);
      },
    },
  });

  // ── Delete ────────────────────────────────────────────────────────────────────

  const { mutate: doDelete, isPending: isDeleting } = useDeleteAnnouncement({
    mutation: {
      onSuccess: (_data, vars) => {
        queryClient.setQueryData(
          getListAnnouncementsQueryKey(),
          (prev: Announcement[] | undefined) =>
            prev?.filter((a) => a.id !== vars.id) ?? prev,
        );
        toast({ title: "Announcement deleted" });
        navigate("/announcements");
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: unknown }).message)
              : "Failed to delete announcement";
        toast({
          title: "Error",
          description: msg,
          variant: "destructive",
        });
      },
    },
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!announcement) {
    return (
      <div className="max-w-4xl mx-auto">
        <p className="text-muted-foreground">Announcement not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      {/* Header row */}
      <div className="flex items-start gap-4">
        <button
          aria-label="Back to announcements"
          onClick={() => navigate("/announcements")}
          className="mt-1 p-2 rounded-md border hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {priorityBadge(announcement.priority)}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{announcement.title}</h1>
          <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" />
              <span>{announcement.courseName}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <User className="w-4 h-4" />
              <span>{announcement.authorName}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              <span>Posted {formatDate(announcement.createdAt)}</span>
            </div>
            {announcement.updatedAt && announcement.updatedAt !== announcement.createdAt && (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                <span>Updated {formatDate(announcement.updatedAt)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditError("");
              setEditOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
            disabled={isDeleting}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Content */}
      <Card>
        <CardHeader>
          <CardTitle>Announcement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
            {announcement.content.split("\n\n").map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      {editOpen && (
        <EditAnnouncementDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          initial={{
            title: announcement.title,
            content: announcement.content,
            priority: announcement.priority as "normal" | "urgent",
          }}
          onSubmit={(form) =>
            doUpdate({
              id,
              data: {
                title: form.title,
                content: form.content,
                priority: form.priority,
              },
            })
          }
          isPending={isUpdating}
          error={editError}
        />
      )}

      {/* Delete AlertDialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Announcement</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium">"{announcement.title}"</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => doDelete({ id })}
            >
              Delete Announcement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
