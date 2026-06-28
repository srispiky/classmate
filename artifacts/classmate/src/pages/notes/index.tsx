import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  useListNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useListCourses,
  getListNotesQueryKey,
  getGetNoteQueryKey,
} from "@workspace/api-client-react";
import type { Note } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Search, FileText, PlayCircle, BookOpen, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

type NoteFormState = {
  title: string;
  content: string;
  courseId: string;
  topic: string;
  videoUrl: string;
};

const EMPTY_FORM: NoteFormState = {
  title: "",
  content: "",
  courseId: "",
  topic: "",
  videoUrl: "",
};

const PAGE_LIMIT = 50;

// ── Form ──────────────────────────────────────────────────────────────────────

type NoteFormProps = {
  value: NoteFormState;
  onChange: (next: NoteFormState) => void;
  courses: { id: number; name: string }[];
  showCourse: boolean;
  error: string;
};

function NoteForm({ value, onChange, courses, showCourse, error }: NoteFormProps) {
  function set(key: keyof NoteFormState, val: string) {
    onChange({ ...value, [key]: val });
  }
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="note-title">Title *</Label>
        <Input
          id="note-title"
          placeholder="Lesson title"
          value={value.title}
          onChange={(e) => set("title", e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="note-topic">Topic *</Label>
        <Input
          id="note-topic"
          placeholder="e.g. Quadratic Equations"
          value={value.topic}
          onChange={(e) => set("topic", e.target.value)}
        />
      </div>
      {showCourse && (
        <div className="space-y-2">
          <Label htmlFor="note-course">Course *</Label>
          <Select value={value.courseId} onValueChange={(v) => set("courseId", v)}>
            <SelectTrigger id="note-course">
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
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="note-content">Content *</Label>
        <Textarea
          id="note-content"
          placeholder="Lesson notes and content..."
          rows={5}
          value={value.content}
          onChange={(e) => set("content", e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="note-video">Video URL (optional)</Label>
        <Input
          id="note-video"
          placeholder="https://..."
          value={value.videoUrl}
          onChange={(e) => set("videoUrl", e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Notes() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Pagination state ─────────────────────────────────────────────────────────
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const appendModeRef = useRef(false);

  const { data: pageData, isLoading, isFetching } = useListNotes({ cursor, limit: PAGE_LIMIT });

  useEffect(() => {
    if (!pageData?.items) return;
    if (appendModeRef.current) {
      setAllNotes((prev) => [...prev, ...pageData.items]);
    } else {
      setAllNotes(pageData.items);
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

  // ── Courses for dropdown (large first page — teachers rarely have 50+ courses) ──
  const { data: coursesData } = useListCourses({ limit: 100 });
  const courses = coursesData?.items ?? [];

  // ── Filters ───────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");

  const filtered = allNotes.filter((n) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      n.title.toLowerCase().includes(q) ||
      n.courseName.toLowerCase().includes(q) ||
      n.topic.toLowerCase().includes(q);
    const matchesCourse =
      courseFilter === "all" || String(n.courseId) === courseFilter;
    return matchesSearch && matchesCourse;
  });

  // ── Create dialog ─────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<NoteFormState>(EMPTY_FORM);
  const [createError, setCreateError] = useState("");

  // ── Edit dialog ───────────────────────────────────────────────────────────────
  const [editNote, setEditNote] = useState<Note | null>(null);
  const [editForm, setEditForm] = useState<NoteFormState>(EMPTY_FORM);
  const [editError, setEditError] = useState("");

  // ── Delete dialog ─────────────────────────────────────────────────────────────
  const [deleteNote, setDeleteNote] = useState<Note | null>(null);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const { mutate: createMutate, isPending: isCreating } = useCreateNote({
    mutation: {
      onSuccess: () => {
        resetPagination();
        qc.invalidateQueries({ queryKey: getListNotesQueryKey() });
        toast({ title: "Note created" });
        setCreateOpen(false);
        setCreateForm(EMPTY_FORM);
        setCreateError("");
      },
      onError: (err: unknown) => {
        setCreateError(extractMessage(err, "Failed to create note"));
      },
    },
  });

  const { mutate: updateMutate, isPending: isUpdating } = useUpdateNote({
    mutation: {
      onSuccess: (updated) => {
        qc.setQueryData(getGetNoteQueryKey(updated.id), updated);
        setAllNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        toast({ title: "Note updated" });
        setEditNote(null);
        setEditError("");
      },
      onError: (err: unknown) => {
        setEditError(extractMessage(err, "Failed to update note"));
      },
    },
  });

  const { mutate: deleteMutate, isPending: isDeleting } = useDeleteNote({
    mutation: {
      onSuccess: (_data, vars) => {
        setAllNotes((prev) => prev.filter((n) => n.id !== vars.id));
        toast({ title: "Note deleted" });
        setDeleteNote(null);
      },
      onError: (err: unknown) => {
        toast({
          title: "Error",
          description: extractMessage(err, "Failed to delete note"),
          variant: "destructive",
        });
        setDeleteNote(null);
      },
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleCreate(form: NoteFormState) {
    if (!form.title.trim()) { setCreateError("Title is required"); return; }
    if (!form.content.trim()) { setCreateError("Content is required"); return; }
    if (!form.courseId) { setCreateError("Select a course"); return; }
    if (!form.topic.trim()) { setCreateError("Topic is required"); return; }
    setCreateError("");
    createMutate({
      data: {
        title: form.title.trim(),
        content: form.content.trim(),
        courseId: parseInt(form.courseId, 10),
        topic: form.topic.trim(),
        videoUrl: form.videoUrl.trim() || null,
      },
    });
  }

  function handleEdit(form: NoteFormState) {
    if (!editNote) return;
    if (!form.title.trim()) { setEditError("Title is required"); return; }
    if (!form.content.trim()) { setEditError("Content is required"); return; }
    if (!form.topic.trim()) { setEditError("Topic is required"); return; }
    setEditError("");
    updateMutate({
      id: editNote.id,
      data: {
        title: form.title.trim(),
        content: form.content.trim(),
        topic: form.topic.trim(),
        videoUrl: form.videoUrl.trim() || undefined,
      },
    });
  }

  function openEdit(note: Note) {
    setEditNote(note);
    setEditForm({
      title: note.title,
      content: note.content,
      courseId: String(note.courseId),
      topic: note.topic,
      videoUrl: note.videoUrl ?? "",
    });
    setEditError("");
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lesson Library</h1>
          <p className="text-muted-foreground mt-1">
            Browse notes, materials, and lesson replays.
          </p>
        </div>
        <Button onClick={() => { setCreateForm(EMPTY_FORM); setCreateError(""); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Note
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search topics, titles, or courses..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Courses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Courses</SelectItem>
            {courses.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading && allNotes.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((note) => (
              <Card
                key={note.id}
                className="hover:bg-muted/50 transition-colors overflow-hidden flex flex-col group relative"
              >
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Edit note"
                    onClick={(e) => { e.preventDefault(); openEdit(note); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    aria-label="Delete note"
                    onClick={(e) => { e.preventDefault(); setDeleteNote(note); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Link href={`/notes/${note.id}`} className="flex flex-col h-full">
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between pr-14">
                      <div className="min-w-0">
                        <Badge variant="secondary" className="mb-2">{note.topic}</Badge>
                        <CardTitle className="text-xl line-clamp-1">{note.title}</CardTitle>
                      </div>
                      {note.videoUrl && (
                        <div
                          className="w-10 h-10 shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-primary ml-2"
                          aria-label="Video available"
                        >
                          <PlayCircle className="w-5 h-5 fill-primary/20" />
                        </div>
                      )}
                    </div>
                    <CardDescription className="flex items-center gap-2 mt-2">
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>{note.courseName}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col justify-end">
                    <div className="text-sm text-muted-foreground/80 line-clamp-2 mb-4">
                      {note.content}
                    </div>
                    <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-auto">
                      Added {formatDate(note.createdAt)}
                    </div>
                  </CardContent>
                </Link>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-center pt-2">
            {hasMore ? (
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={isFetching}
                className="min-w-[160px]"
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
              allNotes.length > PAGE_LIMIT && (
                <p className="text-sm text-muted-foreground">
                  All {allNotes.length} note{allNotes.length !== 1 ? "s" : ""} loaded
                </p>
              )
            )}
          </div>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <FileText className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No notes found</h3>
              <p className="text-muted-foreground mt-1">
                {search || courseFilter !== "all"
                  ? "Try adjusting your search or course filter."
                  : "Add your first lesson note to get started."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
            <DialogDescription>Create a new lesson note for your class.</DialogDescription>
          </DialogHeader>
          <NoteForm
            value={createForm}
            onChange={setCreateForm}
            courses={courses}
            showCourse
            error={createError}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleCreate(createForm)} disabled={isCreating}>
              {isCreating ? "Creating..." : "Create Note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={!!editNote}
        onOpenChange={(open) => { if (!open) setEditNote(null); }}
        key={editNote?.id ?? "edit-none"}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Note</DialogTitle>
            <DialogDescription>Update the lesson note details.</DialogDescription>
          </DialogHeader>
          <NoteForm
            value={editForm}
            onChange={setEditForm}
            courses={courses}
            showCourse={false}
            error={editError}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditNote(null)}>
              Cancel
            </Button>
            <Button onClick={() => handleEdit(editForm)} disabled={isUpdating}>
              {isUpdating ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <AlertDialog open={!!deleteNote} onOpenChange={(open) => { if (!open) setDeleteNote(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteNote?.title}&quot;? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={() => deleteNote && deleteMutate({ id: deleteNote.id })}
            >
              Delete Note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
