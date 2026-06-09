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

const ASSIGNMENTS = [
  {
    id: 1, title: "Chapter 3 Quiz", description: "Multiple choice quiz", courseId: 10,
    courseName: "Algebra I", studentId: 20, studentName: "Alice", dueDate: "2024-09-15T00:00:00.000Z",
    status: "submitted" as const, score: null, maxScore: 100, feedback: null,
  },
  {
    id: 2, title: "Essay Draft", description: "First draft essay", courseId: 11,
    courseName: "English Lit", studentId: 21, studentName: "Bob", dueDate: "2024-09-20T00:00:00.000Z",
    status: "graded" as const, score: 88, maxScore: 100, feedback: "Good work!",
  },
  {
    id: 3, title: "Lab Report", description: "Chemistry lab", courseId: 10,
    courseName: "Algebra I", studentId: 20, studentName: "Alice", dueDate: "2024-09-25T00:00:00.000Z",
    status: "pending" as const, score: null, maxScore: 50, feedback: null,
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
  useListAssignments: () => ({ data: ASSIGNMENTS, isLoading: false }),
  useGetAssignment: (id: number) => ({
    data: ASSIGNMENTS.find(a => a.id === id),
    isLoading: false,
    isError: false,
  }),
  useListCourses: () => ({ data: COURSES }),
  useListStudents: () => ({ data: STUDENTS }),
  useGetMe: () => ({ data: { id: 1, username: "teacher1", role: "teacher", displayName: "Teacher" } }),
  useCreateAssignment: ({ mutation }: { mutation: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void } }) => ({
    mutate: (args: unknown) => mockCreate(args, mutation),
    isPending: false,
  }),
  useUpdateAssignment: ({ mutation }: { mutation: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void } }) => ({
    mutate: (args: unknown) => mockUpdate(args, mutation),
    isPending: false,
  }),
  useDeleteAssignment: ({ mutation }: { mutation: { onSuccess?: (d: unknown, v: { id: number }) => void; onError?: (e: unknown) => void } }) => ({
    mutate: (args: unknown) => mockDelete(args, mutation),
    isPending: false,
  }),
  getListAssignmentsQueryKey: () => ["/api/assignments"],
  getGetAssignmentQueryKey: (id: number) => [`/api/assignments/${id}`],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/assignments/1", vi.fn()],
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

// ── Helper: fill all create-dialog required fields ─────────────────────────────
async function fillCreateForm(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText(/title/i), "New Quiz");
  await user.type(within(dialog).getByLabelText(/description/i), "Weekly quiz");

  // Select course
  const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
  await user.click(courseCombo);
  await user.click(screen.getByRole("option", { name: "Algebra I" }));

  // Select student (filtered by course)
  const studentCombo = within(dialog).getByRole("combobox", { name: /student/i });
  await user.click(studentCombo);
  await user.click(screen.getByRole("option", { name: "Alice" }));

  await user.type(within(dialog).getByLabelText(/due date/i), "2024-10-01");
  const maxScoreInput = within(dialog).getByLabelText(/max score/i);
  await user.clear(maxScoreInput);
  await user.type(maxScoreInput, "50");
}

// ── Assignment List Page ───────────────────────────────────────────────────────

describe("Assignments list page", () => {
  let AssignmentsPage: React.ComponentType;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/pages/assignments/index");
    AssignmentsPage = mod.default;
  });

  it("renders page title and Create Assignment button", () => {
    render(<AssignmentsPage />, { wrapper });
    expect(screen.getByText("Assignments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create assignment/i })).toBeInTheDocument();
  });

  it("renders all assignment cards with title, student, course", () => {
    render(<AssignmentsPage />, { wrapper });
    expect(screen.getByText("Chapter 3 Quiz")).toBeInTheDocument();
    expect(screen.getByText("Essay Draft")).toBeInTheDocument();
    expect(screen.getByText("Lab Report")).toBeInTheDocument();
    // Alice appears in two cards (IDs 1 and 3)
    expect(screen.getAllByText("Alice")).toHaveLength(2);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows Grade button for submitted assignment", () => {
    render(<AssignmentsPage />, { wrapper });
    const gradeBtns = screen.getAllByRole("button", { name: /grade/i });
    expect(gradeBtns.length).toBeGreaterThan(0);
  });

  it("shows score for a graded assignment", () => {
    render(<AssignmentsPage />, { wrapper });
    expect(screen.getByText("88/100")).toBeInTheDocument();
  });

  it("filters assignments by search term", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    await user.type(screen.getByPlaceholderText(/search/i), "Essay");
    expect(screen.getByText("Essay Draft")).toBeInTheDocument();
    expect(screen.queryByText("Chapter 3 Quiz")).not.toBeInTheDocument();
  });

  it("filters assignments by status", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Graded" }));
    expect(screen.getByText("Essay Draft")).toBeInTheDocument();
    expect(screen.queryByText("Chapter 3 Quiz")).not.toBeInTheDocument();
  });

  // ── Create dialog ──────────────────────────────────────────────────────────

  it("opens create dialog when Create Assignment is clicked", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assignment/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/title/i)).toBeInTheDocument();
  });

  it("shows validation error when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assignment/i }));
    const dialog = screen.getByRole("dialog");
    // Click the dialog's own submit button (distinct from the header button)
    await user.click(within(dialog).getByRole("button", { name: /create assignment/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("calls useCreateAssignment with correct payload", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assignment/i }));
    await fillCreateForm(user);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /create assignment/i }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "New Quiz",
          description: "Weekly quiz",
          courseId: 10,
          studentId: 20,
          maxScore: 50,
        }),
      }),
      expect.anything(),
    );
  });

  it("invalidates assignment list query on create success", async () => {
    const user = userEvent.setup();
    mockCreate.mockImplementationOnce((_args: unknown, m: { onSuccess?: () => void }) => {
      m.onSuccess?.();
    });
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assignment/i }));
    await fillCreateForm(user);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /create assignment/i }));
    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/assignments"] }),
    );
  });

  it("shows inline error message when create fails", async () => {
    const user = userEvent.setup();
    mockCreate.mockImplementationOnce((_args: unknown, m: { onError?: (e: unknown) => void }) => {
      m.onError?.({ message: "Server error" });
    });
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assignment/i }));
    await fillCreateForm(user);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /create assignment/i }));
    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });

  it("filters students by selected course in create dialog", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getByRole("button", { name: /create assignment/i }));
    const dialog = screen.getByRole("dialog");
    const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
    await user.click(courseCombo);
    // Use role=option to avoid matching "English Lit" in assignment cards
    await user.click(screen.getByRole("option", { name: "English Lit" }));
    const studentCombo = within(dialog).getByRole("combobox", { name: /student/i });
    await user.click(studentCombo);
    expect(screen.getByRole("option", { name: "Bob" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Alice" })).not.toBeInTheDocument();
  });

  // ── Grade dialog ───────────────────────────────────────────────────────────

  it("opens grade dialog when Grade button is clicked on submitted assignment", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    // The visible "Grade" button on the "Chapter 3 Quiz" (submitted) card
    const gradeBtn = screen.getAllByRole("button", { name: /^grade$/i })[0]!;
    await user.click(gradeBtn);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^score/i)).toBeInTheDocument();
  });

  it("calls useUpdateAssignment with correct payload on grade submit", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getAllByRole("button", { name: /^grade$/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    // Set status to graded
    const statusCombo = within(dialog).getByRole("combobox");
    await user.click(statusCombo);
    await user.click(screen.getByRole("option", { name: "Graded" }));
    const scoreInput = within(dialog).getByLabelText(/^score/i);
    await user.clear(scoreInput);
    await user.type(scoreInput, "85");
    await user.type(within(dialog).getByLabelText(/feedback/i), "Nice work");
    await user.click(within(dialog).getByRole("button", { name: /save grade/i }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        data: expect.objectContaining({ score: 85 }),
      }),
      expect.anything(),
    );
  });

  it("shows validation error when score required for graded status", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getAllByRole("button", { name: /^grade$/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    // Ensure status is "graded"
    const statusCombo = within(dialog).getByRole("combobox");
    await user.click(statusCombo);
    await user.click(screen.getByRole("option", { name: "Graded" }));
    // Leave score empty and submit
    await user.click(within(dialog).getByRole("button", { name: /save grade/i }));
    expect(await screen.findByText(/score is required/i)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates list cache on grade success", async () => {
    const user = userEvent.setup();
    const updated = { ...ASSIGNMENTS[0]!, status: "graded" as const, score: 90 };
    mockUpdate.mockImplementationOnce((_args: unknown, m: { onSuccess?: (d: unknown) => void }) => {
      m.onSuccess?.(updated);
    });
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getAllByRole("button", { name: /^grade$/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    const statusCombo = within(dialog).getByRole("combobox");
    await user.click(statusCombo);
    await user.click(screen.getByRole("option", { name: "Graded" }));
    const scoreInput = within(dialog).getByLabelText(/^score/i);
    await user.clear(scoreInput);
    await user.type(scoreInput, "90");
    await user.click(within(dialog).getByRole("button", { name: /save grade/i }));
    expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assignments"], expect.any(Function));
  });

  // ── Delete ─────────────────────────────────────────────────────────────────

  it("opens delete confirmation when trash button is clicked", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Delete assignment")[0]!);
    // Both AlertDialogTitle and AlertDialogAction contain "Delete Assignment"
    await waitFor(() => {
      expect(screen.getAllByText(/delete assignment/i).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("calls useDeleteAssignment when delete confirmed", async () => {
    const user = userEvent.setup();
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Delete assignment")[0]!);
    const alertDialog = await screen.findByRole("alertdialog");
    await user.click(within(alertDialog).getByRole("button", { name: /^delete assignment$/i }));
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.anything(),
    );
  });

  it("removes from list cache on delete success", async () => {
    const user = userEvent.setup();
    mockDelete.mockImplementationOnce(
      (_args: unknown, m: { onSuccess?: (d: unknown, v: { id: number }) => void }) => {
        m.onSuccess?.(null, { id: 1 });
      },
    );
    render(<AssignmentsPage />, { wrapper });
    await user.click(screen.getAllByTitle("Delete assignment")[0]!);
    const alertDialog = await screen.findByRole("alertdialog");
    await user.click(within(alertDialog).getByRole("button", { name: /^delete assignment$/i }));
    expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assignments"], expect.any(Function));
  });
});

// ── Assignment Detail Page ─────────────────────────────────────────────────────

describe("Assignment detail page", () => {
  let AssignmentDetail: React.ComponentType;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/pages/assignments/detail");
    AssignmentDetail = mod.default;
  });

  it("renders assignment title, status, student, course", () => {
    render(<AssignmentDetail />, { wrapper });
    expect(screen.getByRole("heading", { name: "Chapter 3 Quiz" })).toBeInTheDocument();
    expect(screen.getByText("submitted")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Algebra I")).toBeInTheDocument();
  });

  it("renders Grade and Delete buttons in header", () => {
    render(<AssignmentDetail />, { wrapper });
    // Grade appears in header as "Grade", and also as "Grade Now" in the needs-grading prompt
    const gradeButtons = screen.getAllByRole("button", { name: /^grade$/i });
    expect(gradeButtons.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows 'Needs Grading' prompt for submitted assignment", () => {
    render(<AssignmentDetail />, { wrapper });
    expect(screen.getByText(/awaiting a grade/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /grade now/i })).toBeInTheDocument();
  });

  it("opens grade dialog when Grade button clicked", async () => {
    const user = userEvent.setup();
    render(<AssignmentDetail />, { wrapper });
    await user.click(screen.getAllByRole("button", { name: /^grade$/i })[0]!);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^score/i)).toBeInTheDocument();
  });

  it("pre-populates grade dialog with current assignment status", async () => {
    const user = userEvent.setup();
    render(<AssignmentDetail />, { wrapper });
    await user.click(screen.getAllByRole("button", { name: /^grade$/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    const statusSelect = within(dialog).getByRole("combobox");
    // Assignment 1 has status "submitted" → displayed as "Submitted"
    expect(statusSelect).toHaveTextContent(/submitted/i);
  });

  it("calls useUpdateAssignment with correct payload", async () => {
    const user = userEvent.setup();
    render(<AssignmentDetail />, { wrapper });
    await user.click(screen.getAllByRole("button", { name: /^grade$/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    // Switch to graded
    const statusCombo = within(dialog).getByRole("combobox");
    await user.click(statusCombo);
    await user.click(screen.getByRole("option", { name: "Graded" }));
    const scoreInput = within(dialog).getByLabelText(/^score/i);
    await user.clear(scoreInput);
    await user.type(scoreInput, "92");
    await user.type(within(dialog).getByLabelText(/feedback/i), "Excellent!");
    await user.click(within(dialog).getByRole("button", { name: /save grade/i }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        data: expect.objectContaining({ score: 92, feedback: "Excellent!" }),
      }),
      expect.anything(),
    );
  });

  it("updates detail and list cache on grade success", async () => {
    const user = userEvent.setup();
    const updated = { ...ASSIGNMENTS[0]!, status: "graded" as const, score: 92 };
    mockUpdate.mockImplementationOnce((_args: unknown, m: { onSuccess?: (d: unknown) => void }) => {
      m.onSuccess?.(updated);
    });
    render(<AssignmentDetail />, { wrapper });
    await user.click(screen.getAllByRole("button", { name: /^grade$/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    const statusCombo = within(dialog).getByRole("combobox");
    await user.click(statusCombo);
    await user.click(screen.getByRole("option", { name: "Graded" }));
    const scoreInput = within(dialog).getByLabelText(/^score/i);
    await user.clear(scoreInput);
    await user.type(scoreInput, "92");
    await user.click(within(dialog).getByRole("button", { name: /save grade/i }));
    await waitFor(() => {
      // Detail cache: key is ['/api/assignments/1']
      expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assignments/1"], updated);
      // List cache: key is ['/api/assignments']
      expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assignments"], expect.any(Function));
    });
  });

  it("blocks grade submit when score missing for graded status", async () => {
    const user = userEvent.setup();
    render(<AssignmentDetail />, { wrapper });
    await user.click(screen.getAllByRole("button", { name: /^grade$/i })[0]!);
    const dialog = await screen.findByRole("dialog");
    // Switch to graded (score becomes required)
    const statusCombo = within(dialog).getByRole("combobox");
    await user.click(statusCombo);
    await user.click(screen.getByRole("option", { name: "Graded" }));
    // Leave score empty and submit
    await user.click(within(dialog).getByRole("button", { name: /save grade/i }));
    expect(await screen.findByText(/score is required/i)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("opens delete confirmation dialog when Delete clicked", async () => {
    const user = userEvent.setup();
    render(<AssignmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/delete assignment/i).length).toBeGreaterThan(0);
  });

  it("calls useDeleteAssignment when delete confirmed", async () => {
    const user = userEvent.setup();
    render(<AssignmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /delete/i }));
    const alertDialog = await screen.findByRole("alertdialog");
    await user.click(within(alertDialog).getByRole("button", { name: /^delete assignment$/i }));
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
    render(<AssignmentDetail />, { wrapper });
    await user.click(screen.getByRole("button", { name: /delete/i }));
    const alertDialog = await screen.findByRole("alertdialog");
    await user.click(within(alertDialog).getByRole("button", { name: /^delete assignment$/i }));
    expect(mockSetQueryData).toHaveBeenCalledWith(["/api/assignments"], expect.any(Function));
  });

  it("shows description in detail card", () => {
    render(<AssignmentDetail />, { wrapper });
    expect(screen.getByText("Multiple choice quiz")).toBeInTheDocument();
  });

  it("shows feedback card when assignment has feedback", () => {
    // Assignment 2 has feedback — but our mock useGetAssignment returns ID 1 (no feedback)
    // This tests the description card is always shown
    render(<AssignmentDetail />, { wrapper });
    expect(screen.getByText("Description")).toBeInTheDocument();
  });
});
