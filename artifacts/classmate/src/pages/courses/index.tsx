import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCourses,
  useCreateCourse,
  getListCoursesQueryKey,
  useGetMe,
} from "@workspace/api-client-react";
import type { Course } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, BookOpen, Users, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const EMPTY_FORM = {
  name: "",
  subject: "",
  grade: "",
  academicYear: "",
  description: "",
};

const PAGE_LIMIT = 50;

export default function Courses() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useGetMe();

  // ── Pagination state ─────────────────────────────────────────────────────────
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const appendModeRef = useRef(false);

  const { data: pageData, isLoading, isFetching } = useListCourses({ cursor, limit: PAGE_LIMIT });

  useEffect(() => {
    if (!pageData?.items) return;
    if (appendModeRef.current) {
      setAllCourses((prev) => [...prev, ...pageData.items]);
    } else {
      setAllCourses(pageData.items);
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

  // ── Search ───────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");

  const filteredCourses = allCourses.filter(
    (course) =>
      course.name.toLowerCase().includes(search.toLowerCase()) ||
      course.subject.toLowerCase().includes(search.toLowerCase()) ||
      course.teacherName.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Create dialog ────────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const { mutate: createCourse, isPending } = useCreateCourse({
    mutation: {
      onSuccess: () => {
        resetPagination();
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setOpen(false);
        setForm(EMPTY_FORM);
        setFormError(null);
        toast({ title: "Course created", description: "The course has been added successfully." });
      },
      onError: (err: unknown) => {
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: unknown }).message)
            : "Failed to create course. Please try again.";
        setFormError(msg);
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Course name is required.");
      return;
    }
    if (!form.subject.trim()) {
      setFormError("Subject is required.");
      return;
    }
    if (!form.grade.trim()) {
      setFormError("Grade level is required.");
      return;
    }
    if (!form.academicYear.trim()) {
      setFormError("Academic year is required.");
      return;
    }
    if (!me?.id) {
      setFormError("Could not determine your user account. Please refresh and try again.");
      return;
    }
    createCourse({
      data: {
        name: form.name.trim(),
        subject: form.subject.trim(),
        grade: form.grade.trim(),
        academicYear: form.academicYear.trim(),
        description: form.description.trim() || undefined,
        teacherId: me.id,
      },
    });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Courses</h1>
          <p className="text-muted-foreground mt-1">Manage classes and course materials.</p>
        </div>

        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setForm(EMPTY_FORM);
              setFormError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Course
            </Button>
          </DialogTrigger>

          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Course</DialogTitle>
              <DialogDescription>
                Enter the course details below. Name, subject, grade, and academic year are required.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="course-name">Course Name *</Label>
                <Input
                  id="course-name"
                  placeholder="e.g. Introduction to Algebra"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  disabled={isPending}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="course-subject">Subject *</Label>
                <Input
                  id="course-subject"
                  placeholder="e.g. Mathematics"
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  disabled={isPending}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="course-grade">Grade Level *</Label>
                  <Input
                    id="course-grade"
                    placeholder="e.g. Grade 9"
                    value={form.grade}
                    onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                    disabled={isPending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="course-year">Academic Year *</Label>
                  <Input
                    id="course-year"
                    placeholder="e.g. 2024–2025"
                    value={form.academicYear}
                    onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))}
                    disabled={isPending}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="course-description">Description (optional)</Label>
                <Textarea
                  id="course-description"
                  placeholder="Brief description of the course..."
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  disabled={isPending}
                />
              </div>

              {formError && (
                <p className="text-sm text-destructive">{formError}</p>
              )}

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending || !me?.id}>
                  {isPending ? "Creating…" : "Create Course"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search courses..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading && allCourses.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filteredCourses.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCourses.map(course => (
              <Link key={course.id} href={`/courses/${course.id}`}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full hover-elevate">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <BookOpen className="w-5 h-5 text-primary" />
                      </div>
                      <span className="text-xs font-semibold bg-secondary text-secondary-foreground px-2 py-1 rounded-md">
                        {course.subject}
                      </span>
                    </div>
                    <CardTitle className="mt-4 text-xl">{course.name}</CardTitle>
                    <CardDescription className="line-clamp-2">{course.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users className="w-4 h-4" />
                        <span>{course.studentCount} Students</span>
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        {course.teacherName}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
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
              allCourses.length > PAGE_LIMIT && (
                <p className="text-sm text-muted-foreground">
                  All {allCourses.length} course{allCourses.length !== 1 ? "s" : ""} loaded
                </p>
              )
            )}
          </div>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <BookOpen className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No courses found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your search or create a new course.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
