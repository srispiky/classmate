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

const STUDENTS = [
  {
    id: 1, name: "Alice Johnson", email: "alice@school.edu", grade: "9",
    enrolledCourseIds: [10, 11], avatarUrl: null,
    createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
    createdBy: 1, updatedBy: null,
  },
  {
    id: 2, name: "Bob Smith", email: "bob@school.edu", grade: "10",
    enrolledCourseIds: [10], avatarUrl: null,
    createdAt: "2024-01-02T00:00:00.000Z", updatedAt: "2024-01-02T00:00:00.000Z",
    createdBy: 1, updatedBy: null,
  },
  {
    id: 3, name: "Carol Doe", email: "carol@school.edu", grade: "11",
    enrolledCourseIds: [], avatarUrl: null,
    createdAt: "2024-01-03T00:00:00.000Z", updatedAt: "2024-01-03T00:00:00.000Z",
    createdBy: 1, updatedBy: null,
  },
];

type PaginationShape = { nextCursor: string | null; hasMore: boolean; limit: number };
const PAGINATION_DONE: PaginationShape = { nextCursor: null, hasMore: false, limit: 50 };
const PAGINATION_HAS_MORE: PaginationShape = { nextCursor: "cursor-abc", hasMore: true, limit: 50 };

let mockPageData: { items: typeof STUDENTS; pagination: PaginationShape } = {
  items: STUDENTS,
  pagination: PAGINATION_DONE,
};
let mockIsLoading = false;
let mockIsFetching = false;

vi.mock("@workspace/api-client-react", () => ({
  useListStudents: () => ({
    data: mockPageData,
    isLoading: mockIsLoading,
    isFetching: mockIsFetching,
  }),
  useCreateStudent: ({
    mutation,
  }: {
    mutation: { onSuccess?: () => void; onError?: (e: unknown) => void };
  }) => ({
    mutate: (args: unknown) => mockCreate(args, mutation),
    isPending: false,
  }),
  getListStudentsQueryKey: () => ["/api/students"],
}));

vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, formatDateTime: (d: string) => d };
});

// ── Wrapper ────────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Students list page", () => {
  let StudentsPage: React.ComponentType;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPageData = { items: STUDENTS, pagination: PAGINATION_DONE };
    mockIsLoading = false;
    mockIsFetching = false;
    const mod = await import("@/pages/students/index");
    StudentsPage = mod.default;
  });

  // ── First page render ──────────────────────────────────────────────────────

  it("renders page title and Add Student button", async () => {
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("Students")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /add student/i })).toBeInTheDocument();
  });

  it("renders all student cards after data loads", async () => {
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("Alice Johnson")).toBeInTheDocument());
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("Carol Doe")).toBeInTheDocument();
  });

  it("shows enrolled course count on each card", async () => {
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("2 Courses")).toBeInTheDocument());
    expect(screen.getByText("1 Courses")).toBeInTheDocument();
    // Carol has 0 courses
    expect(screen.getByText("0 Courses")).toBeInTheDocument();
  });

  it("shows student grade on each card", async () => {
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("9")).toBeInTheDocument());
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
  });

  it("shows skeleton loaders while loading first page", async () => {
    mockIsLoading = true;
    mockPageData = { items: [], pagination: PAGINATION_DONE };
    render(<StudentsPage />, { wrapper });
    const skeletons = document.querySelectorAll(".animate-pulse, [data-slot='skeleton']");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // ── Pagination — end of list ───────────────────────────────────────────────

  it("shows end-of-list text when hasMore is false", async () => {
    render(<StudentsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/all \d+ students? loaded/i)).toBeInTheDocument(),
    );
  });

  it("does NOT show the Load More button when hasMore is false", async () => {
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.queryByTestId("load-more-students")).not.toBeInTheDocument());
  });

  // ── Pagination — more pages available ─────────────────────────────────────

  it("shows Load More button when hasMore is true", async () => {
    mockPageData = { items: STUDENTS, pagination: PAGINATION_HAS_MORE };
    render(<StudentsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("load-more-students")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("load-more-students")).toHaveTextContent(/load more/i);
  });

  it("shows loading spinner while fetching next page", async () => {
    mockPageData = { items: STUDENTS, pagination: PAGINATION_HAS_MORE };
    mockIsFetching = true;
    render(<StudentsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("load-more-students")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("load-more-students")).toBeDisabled();
  });

  it("hides Load More and shows end-of-list when hasMore transitions to false", async () => {
    // Start with more pages
    mockPageData = { items: STUDENTS.slice(0, 2), pagination: PAGINATION_HAS_MORE };
    const { rerender } = render(<StudentsPage />, { wrapper });
    await waitFor(() =>
      expect(screen.getByTestId("load-more-students")).toBeInTheDocument(),
    );

    // Simulate fetching next page completing with no more pages
    mockPageData = { items: STUDENTS.slice(0, 2), pagination: PAGINATION_DONE };
    rerender(<StudentsPage />);
    await waitFor(() =>
      expect(screen.queryByTestId("load-more-students")).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/all \d+ students? loaded/i)).toBeInTheDocument();
  });

  // ── Search ────────────────────────────────────────────────────────────────

  it("filters student cards by name search term", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("Alice Johnson")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/search/i), "Bob");
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    expect(screen.queryByText("Alice Johnson")).not.toBeInTheDocument();
    expect(screen.queryByText("Carol Doe")).not.toBeInTheDocument();
  });

  it("filters student cards by email search term", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("Alice Johnson")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/search/i), "carol");
    expect(screen.getByText("Carol Doe")).toBeInTheDocument();
    expect(screen.queryByText("Alice Johnson")).not.toBeInTheDocument();
  });

  it("hides Load More while search is active", async () => {
    const user = userEvent.setup();
    mockPageData = { items: STUDENTS, pagination: PAGINATION_HAS_MORE };
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId("load-more-students")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/search/i), "Alice");
    expect(screen.queryByTestId("load-more-students")).not.toBeInTheDocument();
  });

  it("shows empty state when search yields no results", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText("Alice Johnson")).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText(/search/i), "zzz-no-match");
    expect(screen.getByText(/no students found/i)).toBeInTheDocument();
  });

  // ── Add Student dialog ─────────────────────────────────────────────────────

  it("opens the Add Student dialog when button clicked", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByRole("button", { name: /add student/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /add student/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows validation error when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByRole("button", { name: /add student/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /add student/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /add student/i }));
    const errors = await screen.findAllByText(/name, email, and grade are required/i);
    expect(errors.some(el => el.classList.contains("text-destructive"))).toBe(true);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("calls useCreateStudent with correct payload on valid submit", async () => {
    const user = userEvent.setup();
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByRole("button", { name: /add student/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /add student/i }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/full name/i), "New Student");
    await user.type(within(dialog).getByLabelText(/email/i), "new@school.edu");
    const gradeCombo = within(dialog).getByRole("combobox");
    await user.click(gradeCombo);
    await user.click(screen.getByRole("option", { name: /grade 9/i }));

    await user.click(within(dialog).getByRole("button", { name: /add student/i }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "New Student",
          email: "new@school.edu",
          grade: "9",
        }),
      }),
      expect.anything(),
    );
  });

  it("invalidates student list query on create success", async () => {
    const user = userEvent.setup();
    mockCreate.mockImplementationOnce((_args: unknown, m: { onSuccess?: () => void }) => {
      m.onSuccess?.();
    });
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByRole("button", { name: /add student/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /add student/i }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/full name/i), "New Student");
    await user.type(within(dialog).getByLabelText(/email/i), "new@school.edu");
    const gradeCombo = within(dialog).getByRole("combobox");
    await user.click(gradeCombo);
    await user.click(screen.getByRole("option", { name: /grade 9/i }));
    await user.click(within(dialog).getByRole("button", { name: /add student/i }));

    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/students"] }),
    );
  });

  it("shows inline error message when create fails", async () => {
    const user = userEvent.setup();
    mockCreate.mockImplementationOnce(
      (_args: unknown, m: { onError?: (e: unknown) => void }) => {
        m.onError?.({ message: "Email already exists" });
      },
    );
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByRole("button", { name: /add student/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /add student/i }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/full name/i), "New Student");
    await user.type(within(dialog).getByLabelText(/email/i), "new@school.edu");
    const gradeCombo = within(dialog).getByRole("combobox");
    await user.click(gradeCombo);
    await user.click(screen.getByRole("option", { name: /grade 9/i }));
    await user.click(within(dialog).getByRole("button", { name: /add student/i }));

    expect(await screen.findByText("Email already exists")).toBeInTheDocument();
  });

  it("closes dialog and resets form on successful create", async () => {
    const user = userEvent.setup();
    mockCreate.mockImplementationOnce((_args: unknown, m: { onSuccess?: () => void }) => {
      m.onSuccess?.();
    });
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByRole("button", { name: /add student/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /add student/i }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/full name/i), "New Student");
    await user.type(within(dialog).getByLabelText(/email/i), "new@school.edu");
    const gradeCombo = within(dialog).getByRole("combobox");
    await user.click(gradeCombo);
    await user.click(screen.getByRole("option", { name: /grade 9/i }));
    await user.click(within(dialog).getByRole("button", { name: /add student/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  it("shows empty state when no students exist", async () => {
    mockPageData = { items: [], pagination: PAGINATION_DONE };
    render(<StudentsPage />, { wrapper });
    await waitFor(() => expect(screen.getByText(/no students found/i)).toBeInTheDocument());
  });
});
