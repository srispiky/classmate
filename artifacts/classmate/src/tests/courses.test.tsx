import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn();
const mockSetQueryData = vi.fn();
const mockQueryClient = {
  invalidateQueries: mockInvalidateQueries,
  setQueryData: mockSetQueryData,
};

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => mockQueryClient,
  };
});

const mockCreateCourse = vi.fn();
const mockUpdateCourse = vi.fn();
const mockDeleteCourse = vi.fn();
const mockEnrollStudent = vi.fn();
const mockUnenrollStudent = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListCourses: () => ({
    data: [
      {
        id: 1,
        name: "Existing Course",
        subject: "Science",
        teacherName: "Ms. Smith",
        description: "A science course",
        studentCount: 2,
        status: "active",
        grade: "Grade 10",
        academicYear: "2024-2025",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        createdBy: null,
        updatedBy: null,
        teacherId: 1,
      },
    ],
    isLoading: false,
  }),
  useGetCourse: (_id: number) => ({
    data: {
      id: 1,
      name: "Existing Course",
      subject: "Science",
      teacherName: "Ms. Smith",
      description: "A science course",
      studentCount: 2,
      status: "active",
      grade: "Grade 10",
      academicYear: "2024-2025",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      createdBy: null,
      updatedBy: null,
      teacherId: 1,
    },
    isLoading: false,
  }),
  useListStudents: () => ({
    data: [
      { id: 10, name: "Alice", email: "alice@school.edu", grade: "9", enrolledCourseIds: [1], avatarUrl: null, createdAt: "", updatedAt: "", createdBy: null, updatedBy: null },
      { id: 11, name: "Bob", email: "bob@school.edu", grade: "9", enrolledCourseIds: [], avatarUrl: null, createdAt: "", updatedAt: "", createdBy: null, updatedBy: null },
    ],
    isLoading: false,
  }),
  useListAssignments: () => ({ data: [], isLoading: false }),
  useListNotes: () => ({ data: [], isLoading: false }),
  useGetMe: () => ({ data: { id: 1, username: "teacher1", role: "teacher", displayName: "Teacher" } }),
  useCreateCourse: ({ mutation }: { mutation: { onSuccess?: () => void; onError?: (e: unknown) => void } }) => ({
    mutate: (args: unknown) => mockCreateCourse(args, mutation),
    isPending: false,
  }),
  useUpdateCourse: ({ mutation }: { mutation: { onSuccess?: () => void; onError?: (e: unknown) => void } }) => ({
    mutate: (args: unknown) => mockUpdateCourse(args, mutation),
    isPending: false,
  }),
  useDeleteCourse: ({ mutation }: { mutation: { onSuccess?: () => void; onError?: (e: unknown) => void } }) => ({
    mutate: (args: unknown) => mockDeleteCourse(args, mutation),
    isPending: false,
  }),
  useEnrollStudent: ({ mutation }: { mutation: { onSuccess?: (data: unknown, vars: unknown) => void; onError?: (e: unknown) => void } }) => ({
    mutate: (args: unknown) => mockEnrollStudent(args, mutation),
    isPending: false,
  }),
  useUnenrollStudent: ({ mutation }: { mutation: { onSuccess?: (data: unknown, vars: unknown) => void; onError?: (e: unknown) => void } }) => ({
    mutate: (args: unknown) => mockUnenrollStudent(args, mutation),
    isPending: false,
  }),
  getListCoursesQueryKey: () => ["/api/courses"],
  getGetCourseQueryKey: (id: number) => [`/api/courses/${id}`],
  getListStudentsQueryKey: () => ["/api/students"],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/courses/1", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    formatDate: (d: string) => d,
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────────

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ── Courses list page tests ────────────────────────────────────────────────────

describe("Courses list page", () => {
  let CoursesPage: React.ComponentType;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/pages/courses/index");
    CoursesPage = mod.default;
  });

  it("renders existing courses and the Add Course button", () => {
    render(<CoursesPage />, { wrapper });
    expect(screen.getByText("Courses")).toBeInTheDocument();
    expect(screen.getByText("Existing Course")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add course/i })).toBeInTheDocument();
  });

  it("opens create dialog when Add Course is clicked", async () => {
    const user = userEvent.setup();
    render(<CoursesPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /add course/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/course name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/subject/i)).toBeInTheDocument();
  });

  it("shows validation error when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<CoursesPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /add course/i }));
    await user.click(screen.getByRole("button", { name: /create course/i }));
    expect(await screen.findByText(/course name is required/i)).toBeInTheDocument();
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it("calls useCreateCourse with correct payload when form is valid", async () => {
    const user = userEvent.setup();
    render(<CoursesPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /add course/i }));
    await user.type(screen.getByLabelText(/course name/i), "New Course");
    await user.type(screen.getByLabelText(/subject/i), "Biology");
    await user.type(screen.getByLabelText(/grade level/i), "Grade 11");
    await user.type(screen.getByLabelText(/academic year/i), "2024-2025");
    await user.click(screen.getByRole("button", { name: /create course/i }));
    expect(mockCreateCourse).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "New Course",
          subject: "Biology",
          grade: "Grade 11",
          academicYear: "2024-2025",
          teacherId: 1,
        }),
      }),
      expect.anything(),
    );
  });

  it("invalidates course list query on create success", async () => {
    const user = userEvent.setup();
    mockCreateCourse.mockImplementationOnce((_args: unknown, mutation: { onSuccess?: () => void }) => {
      mutation.onSuccess?.();
    });
    render(<CoursesPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /add course/i }));
    await user.type(screen.getByLabelText(/course name/i), "New Course");
    await user.type(screen.getByLabelText(/subject/i), "Biology");
    await user.type(screen.getByLabelText(/grade level/i), "Grade 11");
    await user.type(screen.getByLabelText(/academic year/i), "2024-2025");
    await user.click(screen.getByRole("button", { name: /create course/i }));
    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/courses"] }),
    );
  });

  it("shows error message when create fails", async () => {
    const user = userEvent.setup();
    mockCreateCourse.mockImplementationOnce((_args: unknown, mutation: { onError?: (e: unknown) => void }) => {
      mutation.onError?.({ message: "Server error occurred" });
    });
    render(<CoursesPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /add course/i }));
    await user.type(screen.getByLabelText(/course name/i), "New Course");
    await user.type(screen.getByLabelText(/subject/i), "Biology");
    await user.type(screen.getByLabelText(/grade level/i), "Grade 11");
    await user.type(screen.getByLabelText(/academic year/i), "2024-2025");
    await user.click(screen.getByRole("button", { name: /create course/i }));
    expect(await screen.findByText("Server error occurred")).toBeInTheDocument();
  });

  it("closes dialog and resets form on cancel", async () => {
    const user = userEvent.setup();
    render(<CoursesPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /add course/i }));
    await user.type(screen.getByLabelText(/course name/i), "Temp Course");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ── Course detail page tests ───────────────────────────────────────────────────

describe("Course detail page", () => {
  let CourseDetail: React.ComponentType;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/pages/courses/detail");
    CourseDetail = mod.default;
  });

  it("renders course name, Edit, and Archive buttons", () => {
    render(<CourseDetail />, { wrapper });
    expect(screen.getByText("Existing Course")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
  });

  it("opens edit dialog pre-populated with current course data", async () => {
    const user = userEvent.setup();
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const nameInput = screen.getByLabelText(/course name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Existing Course");
  });

  it("calls useUpdateCourse on edit submit", async () => {
    const user = userEvent.setup();
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const nameInput = screen.getByLabelText(/course name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Updated Course Name");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(mockUpdateCourse).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        data: expect.objectContaining({ name: "Updated Course Name" }),
      }),
      expect.anything(),
    );
  });

  it("invalidates course queries on edit success", async () => {
    const user = userEvent.setup();
    mockUpdateCourse.mockImplementationOnce((_args: unknown, mutation: { onSuccess?: () => void }) => {
      mutation.onSuccess?.();
    });
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/courses/1"] }),
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/courses"] }),
    );
  });

  it("shows validation error when editing with empty course name", async () => {
    const user = userEvent.setup();
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const nameInput = screen.getByLabelText(/course name/i);
    await user.clear(nameInput);
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/course name is required/i)).toBeInTheDocument();
    expect(mockUpdateCourse).not.toHaveBeenCalled();
  });

  it("opens archive confirmation dialog", async () => {
    const user = userEvent.setup();
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /archive/i }));
    expect(screen.getByText(/archive this course/i)).toBeInTheDocument();
    expect(screen.getAllByText(/existing course/i).length).toBeGreaterThan(0);
  });

  it("calls useDeleteCourse when archive is confirmed", async () => {
    const user = userEvent.setup();
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /archive/i }));
    await user.click(screen.getByRole("button", { name: /archive course/i }));
    expect(mockDeleteCourse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.anything(),
    );
  });

  it("shows Enroll Student button in students tab", () => {
    render(<CourseDetail />, { wrapper });
    expect(screen.getByRole("button", { name: /enroll student/i })).toBeInTheDocument();
  });

  it("opens enroll dialog with student search when Enroll Student is clicked", async () => {
    const user = userEvent.setup();
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /enroll student/i }));
    expect(await screen.findByPlaceholderText(/search students/i)).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("calls useEnrollStudent when a student is selected in the dialog", async () => {
    const user = userEvent.setup();
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /enroll student/i }));
    const bobButton = screen.getByText("Bob").closest("button")!;
    await user.click(bobButton);
    expect(mockEnrollStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        courseId: 1,
        data: { studentId: 11 },
      }),
      expect.anything(),
    );
  });

  it("updates student list cache on enroll success", async () => {
    const user = userEvent.setup();
    mockEnrollStudent.mockImplementationOnce(
      (_args: unknown, mutation: { onSuccess?: (d: unknown, v: { data: { studentId: number } }) => void }) => {
        mutation.onSuccess?.(null, { data: { studentId: 11 } });
      },
    );
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /enroll student/i }));
    const bobButton = screen.getByText("Bob").closest("button")!;
    await user.click(bobButton);
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ["/api/students"],
      expect.any(Function),
    );
  });

  it("shows 409 duplicate-enrollment error in dialog", async () => {
    const user = userEvent.setup();
    mockEnrollStudent.mockImplementationOnce(
      (_args: unknown, mutation: { onError?: (e: unknown) => void }) => {
        mutation.onError?.({ status: 409 });
      },
    );
    render(<CourseDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /enroll student/i }));
    const bobButton = screen.getByText("Bob").closest("button")!;
    await user.click(bobButton);
    expect(await screen.findByText(/already enrolled/i)).toBeInTheDocument();
  });

  it("renders enrolled student with remove button", () => {
    render(<CourseDetail />, { wrapper });
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("calls useUnenrollStudent when remove is confirmed", async () => {
    const user = userEvent.setup();
    render(<CourseDetail />, { wrapper });
    const removeButtons = screen.getAllByTitle("Remove from course");
    await user.click(removeButtons[0]!);
    expect(await screen.findByText(/remove student from course/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /remove student/i }));
    expect(mockUnenrollStudent).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 1, studentId: 10 }),
      expect.anything(),
    );
  });

  it("updates student list cache on unenroll success", async () => {
    const user = userEvent.setup();
    mockUnenrollStudent.mockImplementationOnce(
      (_args: unknown, mutation: { onSuccess?: (d: unknown, v: { studentId: number }) => void }) => {
        mutation.onSuccess?.(null, { studentId: 10 });
      },
    );
    render(<CourseDetail />, { wrapper });
    const removeButtons = screen.getAllByTitle("Remove from course");
    await user.click(removeButtons[0]!);
    await user.click(screen.getByRole("button", { name: /remove student/i }));
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ["/api/students"],
      expect.any(Function),
    );
  });

  it("invalidates course query on unenroll success", async () => {
    const user = userEvent.setup();
    mockUnenrollStudent.mockImplementationOnce(
      (_args: unknown, mutation: { onSuccess?: (d: unknown, v: { studentId: number }) => void }) => {
        mutation.onSuccess?.(null, { studentId: 10 });
      },
    );
    render(<CourseDetail />, { wrapper });
    const removeButtons = screen.getAllByTitle("Remove from course");
    await user.click(removeButtons[0]!);
    await user.click(screen.getByRole("button", { name: /remove student/i }));
    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["/api/courses/1"] }),
      );
    });
  });
});
