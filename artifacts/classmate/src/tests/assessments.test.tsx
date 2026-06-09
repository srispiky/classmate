import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn();
const mockSetQueryData = vi.fn();
const mockQueryClient = {
  invalidateQueries: mockInvalidateQueries,
  setQueryData: mockSetQueryData,
};

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQueryClient: () => mockQueryClient };
});

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

const ASSESSMENTS = [
  {
    id: 1,
    title: "Mid-term Assessment",
    studentId: 20,
    studentName: "Alice",
    courseId: 10,
    courseName: "Algebra I",
    score: 88,
    maxScore: 100,
    percentage: 88,
    strengths: ["Problem solving", "Attention to detail"],
    weaknesses: ["Algebra fundamentals"],
    createdAt: "2024-09-10T00:00:00.000Z",
    updatedAt: "2024-09-10T00:00:00.000Z",
    createdBy: 1,
    updatedBy: null,
  },
  {
    id: 2,
    title: "Lab Practical",
    studentId: 21,
    studentName: "Bob",
    courseId: 11,
    courseName: "English Lit",
    score: 72,
    maxScore: 100,
    percentage: 72,
    strengths: ["Creativity"],
    weaknesses: ["Grammar", "Structure"],
    createdAt: "2024-09-15T00:00:00.000Z",
    updatedAt: "2024-09-15T00:00:00.000Z",
    createdBy: 1,
    updatedBy: null,
  },
];

const COURSES = [
  { id: 10, name: "Algebra I", subject: "Math", status: "active", teacherId: 1, teacherName: "Ms. Smith", grade: "9", academicYear: "2024-2025", studentCount: 2, description: "", createdAt: "", updatedAt: "", createdBy: null, updatedBy: null },
  { id: 11, name: "English Lit", subject: "English", status: "active", teacherId: 1, teacherName: "Ms. Smith", grade: "10", academicYear: "2024-2025", studentCount: 1, description: "", createdAt: "", updatedAt: "", createdBy: null, updatedBy: null },
];

const STUDENTS = [
  { id: 20, name: "Alice", email: "alice@school.edu", grade: "9", enrolledCourseIds: [10], avatarUrl: null, createdAt: "", updatedAt: "", createdBy: null, updatedBy: null },
  { id: 21, name: "Bob", email: "bob@school.edu", grade: "10", enrolledCourseIds: [11], avatarUrl: null, createdAt: "", updatedAt: "", createdBy: null, updatedBy: null },
];

vi.mock("@workspace/api-client-react", () => ({
  useListAssessments: () => ({ data: ASSESSMENTS, isLoading: false }),
  useGetAssessment: (id: number) => ({
    data: ASSESSMENTS.find((a) => a.id === id),
    isLoading: false,
    isError: false,
  }),
  useListCourses: () => ({ data: COURSES }),
  useListStudents: () => ({ data: STUDENTS }),
  useGetMe: () => ({
    data: { id: 1, username: "teacher1", role: "teacher", displayName: "Teacher" },
  }),
  useCreateAssessment: ({
    mutation,
  }: {
    mutation: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void };
  }) => ({
    mutate: (args: unknown) => mockCreate(args, mutation),
    isPending: false,
  }),
  useUpdateAssessment: ({
    mutation,
  }: {
    mutation: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void };
  }) => ({
    mutate: (args: unknown) => mockUpdate(args, mutation),
    isPending: false,
  }),
  useDeleteAssessment: ({
    mutation,
  }: {
    mutation: { onSuccess?: (d: unknown, v: { id: number }) => void };
  }) => ({
    mutate: (args: unknown) => mockDelete(args, mutation),
    isPending: false,
  }),
  getListAssessmentsQueryKey: () => ["/api/assessments"],
  getGetAssessmentQueryKey: (id: number) => [`/api/assessments/${id}`],
}));

vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
    className,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    onClick?: React.MouseEventHandler;
  }) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/assessments/1", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, formatDate: (d: string) => d };
});

// ── Wrapper ────────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ── Assessment List Page ───────────────────────────────────────────────────────

describe("Assessments list page", () => {
  let AssessmentsPage: React.ComponentType;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/pages/assessments/index");
    AssessmentsPage = mod.default;
  });

  it("renders page title, Create Assessment button, and assessment cards", () => {
    render(<AssessmentsPage />, { wrapper });
    expect(screen.getByText("Assessments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create assessment/i })).toBeInTheDocument();
    expect(screen.getByText("Mid-term Assessment")).toBeInTheDocument();
    expect(screen.getByText("Lab Practical")).toBeInTheDocument();
  });

  it("shows percentage and score for each assessment", () => {
    render(<AssessmentsPage />, { wrapper });
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.getByText("88/100")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("72/100")).toBeInTheDocument();
  });

  it("shows strengths and weaknesses on cards", () => {
    render(<AssessmentsPage />, { wrapper });
    expect(screen.getByText("Problem solving")).toBeInTheDocument();
    expect(screen.getByText("Algebra fundamentals")).toBeInTheDocument();
    expect(screen.getByText("Creativity")).toBeInTheDocument();
  });

  it("filters assessments by search term", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.type(screen.getByPlaceholderText(/search/i), "Algebra");
    expect(screen.getByText("Mid-term Assessment")).toBeInTheDocument();
    expect(screen.queryByText("Lab Practical")).not.toBeInTheDocument();
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  it("opens create dialog when Create Assessment is clicked", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assessment/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows validation error when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assessment/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /create assessment/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("shows validation error when course not selected", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assessment/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/title/i), "Test");
    await user.click(within(dialog).getByRole("button", { name: /create assessment/i }));
    expect(await screen.findByText(/select a course/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("calls useCreateAssessment with correct payload on valid submit", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assessment/i }));
    const dialog = screen.getByRole("dialog");

    // Course
    const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
    await user.click(courseCombo);
    await user.click(screen.getByRole("option", { name: "Algebra I" }));

    // Student
    const studentCombo = within(dialog).getByRole("combobox", { name: /student/i });
    await user.click(studentCombo);
    await user.click(screen.getByRole("option", { name: "Alice" }));

    await user.type(within(dialog).getByLabelText(/title/i), "Final Exam");
    const scoreInput = within(dialog).getByLabelText(/^score/i);
    await user.clear(scoreInput);
    await user.type(scoreInput, "90");

    await user.click(within(dialog).getByRole("button", { name: /create assessment/i }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Final Exam",
          courseId: 10,
          studentId: 20,
          score: 90,
        }),
      }),
      expect.anything(),
    );
  });

  it("invalidates assessment list query on create success", async () => {
    const user = userEvent.setup();
    mockCreate.mockImplementationOnce((_args: unknown, m: { onSuccess?: () => void }) => {
      m.onSuccess?.();
    });
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assessment/i }));
    const dialog = screen.getByRole("dialog");

    const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
    await user.click(courseCombo);
    await user.click(screen.getByRole("option", { name: "Algebra I" }));
    const studentCombo = within(dialog).getByRole("combobox", { name: /student/i });
    await user.click(studentCombo);
    await user.click(screen.getByRole("option", { name: "Alice" }));
    await user.type(within(dialog).getByLabelText(/title/i), "Final Exam");
    const scoreInput = within(dialog).getByLabelText(/^score/i);
    await user.clear(scoreInput);
    await user.type(scoreInput, "90");
    await user.click(within(dialog).getByRole("button", { name: /create assessment/i }));

    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/assessments"] }),
    );
  });

  it("shows inline error when create fails", async () => {
    const user = userEvent.setup();
    mockCreate.mockImplementationOnce(
      (_args: unknown, m: { onError?: (e: unknown) => void }) => {
        m.onError?.({ message: "Server error" });
      },
    );
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assessment/i }));
    const dialog = screen.getByRole("dialog");

    const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
    await user.click(courseCombo);
    await user.click(screen.getByRole("option", { name: "Algebra I" }));
    const studentCombo = within(dialog).getByRole("combobox", { name: /student/i });
    await user.click(studentCombo);
    await user.click(screen.getByRole("option", { name: "Alice" }));
    await user.type(within(dialog).getByLabelText(/title/i), "Final Exam");
    const scoreInput = within(dialog).getByLabelText(/^score/i);
    await user.clear(scoreInput);
    await user.type(scoreInput, "90");
    await user.click(within(dialog).getByRole("button", { name: /create assessment/i }));

    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });

  it("filters students by selected course in create dialog", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assessment/i }));
    const dialog = screen.getByRole("dialog");
    const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
    await user.click(courseCombo);
    await user.click(screen.getByRole("option", { name: "English Lit" }));
    const studentCombo = within(dialog).getByRole("combobox", { name: /student/i });
    await user.click(studentCombo);
    expect(screen.getByRole("option", { name: "Bob" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Alice" })).not.toBeInTheDocument();
  });

  // ── Edit ────────────────────────────────────────────────────────────────────

  it("opens edit dialog when pencil button is clicked", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    const editBtns = screen.getAllByTitle("Edit assessment");
    await user.click(editBtns[0]!);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/edit assessment/i)).toBeInTheDocument();
  });

  it("pre-populates edit dialog with current assessment values", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Edit assessment")[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/title/i)).toHaveValue("Mid-term Assessment");
    expect(within(dialog).getByLabelText(/^score/i)).toHaveValue(88);
    expect(within(dialog).getByLabelText(/strengths/i)).toHaveValue(
      "Problem solving\nAttention to detail",
    );
  });

  it("calls useUpdateAssessment with correct payload on edit submit", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Edit assessment")[0]!);
    const dialog = await screen.findByRole("dialog");
    const titleInput = within(dialog).getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Updated Assessment");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        data: expect.objectContaining({ title: "Updated Assessment" }),
      }),
      expect.anything(),
    );
  });

  it("updates list cache on edit success (setQueryData)", async () => {
    const user = userEvent.setup();
    const updated = { ...ASSESSMENTS[0]!, title: "Updated" };
    mockUpdate.mockImplementationOnce(
      (_args: unknown, m: { onSuccess?: (d: unknown) => void }) => {
        m.onSuccess?.(updated);
      },
    );
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Edit assessment")[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
    expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assessments"], expect.any(Function));
  });

  it("shows validation error when title cleared in edit dialog", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Edit assessment")[0]!);
    const dialog = await screen.findByRole("dialog");
    const titleInput = within(dialog).getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── Delete ──────────────────────────────────────────────────────────────────

  it("opens delete confirmation when trash button is clicked", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Delete assessment")[0]!);
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/delete assessment/i).length).toBeGreaterThan(0);
  });

  it("calls useDeleteAssessment when delete confirmed", async () => {
    const user = userEvent.setup();
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Delete assessment")[0]!);
    const alertDialog = await screen.findByRole("alertdialog");
    await user.click(within(alertDialog).getByRole("button", { name: /^delete assessment$/i }));
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.anything(),
    );
  });

  it("removes assessment from list cache on delete success", async () => {
    const user = userEvent.setup();
    mockDelete.mockImplementationOnce(
      (_args: unknown, m: { onSuccess?: (d: unknown, v: { id: number }) => void }) => {
        m.onSuccess?.(null, { id: 1 });
      },
    );
    render(<AssessmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Delete assessment")[0]!);
    const alertDialog = await screen.findByRole("alertdialog");
    await user.click(within(alertDialog).getByRole("button", { name: /^delete assessment$/i }));
    expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assessments"], expect.any(Function));
  });
});

// ── Assessment Detail Page ─────────────────────────────────────────────────────

describe("Assessment detail page", () => {
  let AssessmentDetail: React.ComponentType;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/pages/assessments/detail");
    AssessmentDetail = mod.default;
  });

  it("renders assessment title, student, course, score, percentage", () => {
    render(<AssessmentDetail />, { wrapper });
    expect(screen.getByRole("heading", { name: "Mid-term Assessment" })).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Algebra I")).toBeInTheDocument();
    expect(screen.getByText("88/100")).toBeInTheDocument();
    expect(screen.getByText("88%")).toBeInTheDocument();
  });

  it("renders strengths and weaknesses sections", () => {
    render(<AssessmentDetail />, { wrapper });
    expect(screen.getByText("Strengths")).toBeInTheDocument();
    expect(screen.getByText("Problem solving")).toBeInTheDocument();
    expect(screen.getByText("Areas to Improve")).toBeInTheDocument();
    expect(screen.getByText("Algebra fundamentals")).toBeInTheDocument();
  });

  it("renders Edit and Delete buttons in header", () => {
    render(<AssessmentDetail />, { wrapper });
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("opens edit dialog when Edit button clicked", async () => {
    const user = userEvent.setup();
    render(<AssessmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/title/i)).toHaveValue("Mid-term Assessment");
  });

  it("calls useUpdateAssessment with correct payload", async () => {
    const user = userEvent.setup();
    render(<AssessmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = await screen.findByRole("dialog");
    const titleInput = within(dialog).getByLabelText(/title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Revised Assessment");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        data: expect.objectContaining({ title: "Revised Assessment" }),
      }),
      expect.anything(),
    );
  });

  it("updates both detail and list cache on edit success", async () => {
    const user = userEvent.setup();
    const updated = { ...ASSESSMENTS[0]!, score: 95, percentage: 95 };
    mockUpdate.mockImplementationOnce(
      (_args: unknown, m: { onSuccess?: (d: unknown) => void }) => {
        m.onSuccess?.(updated);
      },
    );
    render(<AssessmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
    await waitFor(() => {
      expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assessments/1"], updated);
      expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assessments"], expect.any(Function));
    });
  });

  it("blocks edit submit when title is cleared", async () => {
    const user = userEvent.setup();
    render(<AssessmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText(/title/i));
    await user.click(within(dialog).getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("opens delete confirmation when Delete clicked", async () => {
    const user = userEvent.setup();
    render(<AssessmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/delete assessment/i).length).toBeGreaterThan(0);
  });

  it("calls useDeleteAssessment when delete confirmed", async () => {
    const user = userEvent.setup();
    render(<AssessmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /delete/i }));
    const alertDialog = await screen.findByRole("alertdialog");
    await user.click(within(alertDialog).getByRole("button", { name: /^delete assessment$/i }));
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.anything(),
    );
  });

  it("removes from list cache on delete success", async () => {
    const user = userEvent.setup();
    mockDelete.mockImplementationOnce((_args: unknown, m: { onSuccess?: () => void }) => {
      m.onSuccess?.();
    });
    render(<AssessmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /delete/i }));
    const alertDialog = await screen.findByRole("alertdialog");
    await user.click(within(alertDialog).getByRole("button", { name: /^delete assessment$/i }));
    expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assessments"], expect.any(Function));
  });
});
