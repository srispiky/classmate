import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Megaphone, Search, Pencil, Trash2, Plus, Bell } from "lucide-react";
import {
  useListAnnouncements,
  useCreateAnnouncement,
  useUpdateAnnouncement,
  useDeleteAnnouncement,
  useListCourses,
  useGetMe,
  getListAnnouncementsQueryKey,
  getGetAnnouncementQueryKey,
} from "@workspace/api-client-react";
import type { Announcement } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err)
    return String((err as { message: unknown }).message);
  return fallback;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type AnnouncementFormState = {
  title: string;
  content: string;
  courseId: string;
  priority: "normal" | "urgent";
};

type FormErrors = Partial<Record<keyof AnnouncementFormState, string>>;

const EMPTY_FORM: AnnouncementFormState = {
  title: "",
  content: "",
  courseId: "none",
  priority: "normal",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function priorityBadge(priority: string) {
  return priority === "urgent" ? (
    <Badge variant="destructive">Urgent</Badge>
  ) : (
    <Badge variant="secondary">Normal</Badge>
  );
}

function validate(
  form: AnnouncementFormState,
  mode: "create" | "edit",
): FormErrors {
  const errs: FormErrors = {};
  if (!form.title.trim()) errs.title = "Title is required";
  if (!form.content.trim()) errs.content = "Content is required";
  if (mode === "create" && form.courseId === "none") errs.courseId = "Select a course";
  return errs;
}

// ── AnnouncementDialog ────────────────────────────────────────────────────────

type CourseOption = { id: number; name: string };

type AnnouncementDialogProps = {
  mode: "create" | "edit";
  open: boolean;
  onClose: () => void;
  initial: AnnouncementFormState;
  courses: CourseOption[];
  onSubmit: (form: AnnouncementFormState) => void;
  isPending: boolean;
  error: string;
};

function AnnouncementDialog({
  mode,
  open,
  onClose,
  initial,
  courses,
  onSubmit,
  isPending,
  error,
}: AnnouncementDialogProps) {
  const [form, setForm] = useState<AnnouncementFormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});

  const handleSubmit = () => {
    const errs = validate(form, mode);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    onSubmit(form);
  };

  const field = (key: keyof AnnouncementFormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isCreate = mode === "create";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isCreate ? "New Announcement" : "Edit Announcement"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="ann-title">Title</Label>
            <Input
              id="ann-title"
              placeholder="e.g. Homework due Friday"
              value={form.title}
              onChange={(e) => field("title", e.target.value)}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title}</p>
            )}
          </div>

          {/* Content */}
          <div className="space-y-1.5">
            <Label htmlFor="ann-content">Content</Label>
            <Textarea
              id="ann-content"
              placeholder="Announcement details..."
              rows={4}
              value={form.content}
              onChange={(e) => field("content", e.target.value)}
            />
            {errors.content && (
              <p className="text-sm text-destructive">{errors.content}</p>
            )}
          </div>

          {/* Course — create only */}
          {isCreate && (
            <div className="space-y-1.5">
              <Label htmlFor="ann-course">Course</Label>
              <Select
                value={form.courseId}
                onValueChange={(v) => field("courseId", v)}
              >
                <SelectTrigger id="ann-course" aria-label="Course">
                  <SelectValue placeholder="Select a course" />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.courseId && (
                <p className="text-sm text-destructive">{errors.courseId}</p>
              )}
            </div>
          )}

          {/* Priority */}
          <div className="space-y-1.5">
            <Label htmlFor="ann-priority">Priority</Label>
            <Select
              value={form.priority}
              onValueChange={(v) => field("priority", v as "normal" | "urgent")}
            >
              <SelectTrigger id="ann-priority" aria-label="Priority">
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
            {isPending
              ? isCreate ? "Creating…" : "Saving…"
              : isCreate ? "Create Announcement" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Announcements list ────────────────────────────────────────────────────────

export default function Announcements() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: announcements, isLoading } = useListAnnouncements();
  const { data: courses } = useListCourses();
  const { data: me } = useGetMe();

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "normal" | "urgent">("all");
  const [courseFilter, setCourseFilter] = useState("all");

  // ── Dialog state ─────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [editAnnouncement, setEditAnnouncement] = useState<Announcement | null>(null);
  const [editError, setEditError] = useState("");
  const [deleteAnnouncement, setDeleteAnnouncement] = useState<Announcement | null>(null);

  // ── Filtered list ────────────────────────────────────────────────────────────
  const filtered = (announcements ?? []).filter((a) => {
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      a.title.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q) ||
      a.courseName.toLowerCase().includes(q);
    const matchPriority = priorityFilter === "all" || a.priority === priorityFilter;
    const matchCourse = courseFilter === "all" || String(a.courseId) === courseFilter;
    return matchSearch && matchPriority && matchCourse;
  });

  // ── Create ───────────────────────────────────────────────────────────────────
  const { mutate: doCreate, isPending: isCreating } = useCreateAnnouncement({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnnouncementsQueryKey() });
        toast({ title: "Announcement created" });
        setCreateOpen(false);
        setCreateError("");
      },
      onError: (err: unknown) => {
        setCreateError(extractMessage(err, "Failed to create announcement"));
      },
    },
  });

  function handleCreate(form: AnnouncementFormState) {
    doCreate({
      data: {
        title: form.title,
        content: form.content,
        courseId: Number(form.courseId),
        authorName: me?.displayName ?? "Teacher",
        priority: form.priority,
      },
    });
  }

  // ── Edit ─────────────────────────────────────────────────────────────────────
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
        setEditAnnouncement(null);
        setEditError("");
      },
      onError: (err: unknown) => {
        setEditError(extractMessage(err, "Failed to update announcement"));
      },
    },
  });

  function handleEdit(form: AnnouncementFormState) {
    if (!editAnnouncement) return;
    doUpdate({
      id: editAnnouncement.id,
      data: {
        title: form.title,
        content: form.content,
        priority: form.priority,
      },
    });
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const { mutate: doDelete, isPending: isDeleting } = useDeleteAnnouncement({
    mutation: {
      onSuccess: (_data, vars) => {
        queryClient.setQueryData(
          getListAnnouncementsQueryKey(),
          (prev: Announcement[] | undefined) =>
            prev?.filter((a) => a.id !== vars.id) ?? prev,
        );
        toast({ title: "Announcement deleted" });
        setDeleteAnnouncement(null);
      },
      onError: (err: unknown) => {
        toast({
          title: "Error",
          description: extractMessage(err, "Failed to delete announcement"),
          variant: "destructive",
        });
        setDeleteAnnouncement(null);
      },
    },
  });

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Announcements</h1>
          <p className="text-muted-foreground mt-1">
            Post updates, reminders, and notices to your classes.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreateError("");
            setCreateOpen(true);
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Announcement
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search announcements..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={priorityFilter}
          onValueChange={(v) => setPriorityFilter(v as "all" | "normal" | "urgent")}
        >
          <SelectTrigger className="w-44" aria-label="Priority filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="w-48" aria-label="Course filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Courses</SelectItem>
            {(courses ?? []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((ann) => (
            <Link key={ann.id} href={`/announcements/${ann.id}`}>
              <Card className="hover:bg-muted/50 transition-colors cursor-pointer hover-elevate group">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {priorityBadge(ann.priority)}
                      <CardTitle className="text-base leading-tight line-clamp-1">
                        {ann.title}
                      </CardTitle>
                    </div>
                    {/* Action buttons revealed on hover */}
                    <div
                      className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => e.preventDefault()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit announcement"
                        aria-label="Edit announcement"
                        onClick={(e) => {
                          e.preventDefault();
                          setEditError("");
                          setEditAnnouncement(ann);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Delete announcement"
                        aria-label="Delete announcement"
                        disabled={isDeleting}
                        onClick={(e) => {
                          e.preventDefault();
                          setDeleteAnnouncement(ann);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="text-xs">
                    {ann.courseName} · {ann.authorName}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {ann.content}
                  </p>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                    {formatDate(ann.createdAt)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Bell className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No announcements yet</h3>
              <p className="text-muted-foreground mt-1">
                {search || priorityFilter !== "all" || courseFilter !== "all"
                  ? "Try adjusting your search or filters."
                  : "Create your first announcement to get started."}
              </p>
            </div>
            {!search && priorityFilter === "all" && courseFilter === "all" && (
              <Button
                onClick={() => {
                  setCreateError("");
                  setCreateOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Announcement
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <AnnouncementDialog
        mode="create"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initial={EMPTY_FORM}
        courses={courses ?? []}
        onSubmit={handleCreate}
        isPending={isCreating}
        error={createError}
      />

      {/* Edit dialog — key forces remount so useState(initial) picks up new values */}
      <AnnouncementDialog
        key={editAnnouncement?.id ?? "edit-none"}
        mode="edit"
        open={!!editAnnouncement}
        onClose={() => setEditAnnouncement(null)}
        initial={
          editAnnouncement
            ? {
                title: editAnnouncement.title,
                content: editAnnouncement.content,
                courseId: String(editAnnouncement.courseId),
                priority: editAnnouncement.priority as "normal" | "urgent",
              }
            : EMPTY_FORM
        }
        courses={courses ?? []}
        onSubmit={handleEdit}
        isPending={isUpdating}
        error={editError}
      />

      {/* Delete AlertDialog */}
      <AlertDialog
        open={!!deleteAnnouncement}
        onOpenChange={(o) => { if (!o) setDeleteAnnouncement(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Announcement</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium">"{deleteAnnouncement?.title}"</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteAnnouncement) doDelete({ id: deleteAnnouncement.id });
              }}
            >
              Delete Announcement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
