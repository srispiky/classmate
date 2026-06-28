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

// ── Fixture data ───────────────────────────────────────────────────────────────

const ANNOUNCEMENTS = [
  {
    id: 1,
    title: "Homework Due Friday",
    content: "Please submit your algebra homework by Friday.",
    courseId: 10,
    courseName: "Algebra I",
    authorName: "Ms. Smith",
    priority: "normal",
    createdAt: "2024-09-01T00:00:00.000Z",
    updatedAt: "2024-09-01T00:00:00.000Z",
    createdBy: 1,
    updatedBy: null,
  },
  {
    id: 2,
    title: "Test Rescheduled",
    content: "The upcoming test has been moved to next Wednesday.",
    courseId: 11,
    courseName: "English Lit",
    authorName: "Ms. Smith",
    priority: "urgent",
    createdAt: "2024-09-05T00:00:00.000Z",
    updatedAt: "2024-09-05T00:00:00.000Z",
    createdBy: 1,
    updatedBy: null,
  },
] as const;

const COURSES = [
  {
    id: 10,
    name: "Algebra I",
    subject: "Math",
    status: "active",
    teacherId: 1,
    teacherName: "Ms. Smith",
    grade: "9",
    academicYear: "2024-2025",
    studentCount: 2,
    description: "",
    createdAt: "",
    updatedAt: "",
    createdBy: null,
    updatedBy: null,
  },
  {
    id: 11,
    name: "English Lit",
    subject: "English",
    status: "active",
    teacherId: 1,
    teacherName: "Ms. Smith",
    grade: "10",
    academicYear: "2024-2025",
    studentCount: 1,
    description: "",
    createdAt: "",
    updatedAt: "",
    createdBy: null,
    updatedBy: null,
  },
] as const;

// ── Mutable state (prefixed with `mock` for Vitest hoisting) ──────────────────

type AnnouncementDetail = {
  id: number;
  title: string;
  content: string;
  courseId: number;
  courseName: string;
  authorName: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  createdBy: number | null;
  updatedBy: number | null;
};

const mockState: {
  announcements: typeof ANNOUNCEMENTS[number][];
  detail: AnnouncementDetail;
} = {
  announcements: [...ANNOUNCEMENTS],
  detail: { ...ANNOUNCEMENTS[0] },
};

// ── Stable paginated stubs ────────────────────────────────────────────────────
// Getter-based: wrapper object is always the same reference (prevents infinite
// useEffect loops), while items dynamically reflects the current mockState.
const ANN_PAGINATION = { nextCursor: null as null, hasMore: false, limit: 50 };
const announcementsPageStub = { get items() { return mockState.announcements; }, pagination: ANN_PAGINATION };
const coursesPageStubAnn = { items: COURSES as unknown[], pagination: ANN_PAGINATION };

vi.mock("@workspace/api-client-react", () => ({
  useListAnnouncements: () => ({ data: announcementsPageStub, isLoading: false, isFetching: false }),
  useGetAnnouncement: (id: number) => ({
    data: mockState.detail.id === id ? mockState.detail : undefined,
    isLoading: false,
    isError: false,
  }),
  useListCourses: () => ({ data: coursesPageStubAnn, isFetching: false }),
  useGetMe: () => ({
    data: { id: 1, username: "teacher1", role: "teacher", displayName: "Ms. Smith" },
  }),
  useCreateAnnouncement: ({
    mutation,
  }: {
    mutation: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void };
  }) => ({
    mutate: (args: unknown) => mockCreate(args, mutation),
    isPending: false,
  }),
  useUpdateAnnouncement: ({
    mutation,
  }: {
    mutation: {
      onSuccess?: (d: unknown, v: { id: number }) => void;
      onError?: (e: unknown) => void;
    };
  }) => ({
    mutate: (args: unknown) => mockUpdate(args, mutation),
    isPending: false,
  }),
  useDeleteAnnouncement: ({
    mutation,
  }: {
    mutation: {
      onSuccess?: (d: unknown, v: { id: number }) => void;
      onError?: (e: unknown) => void;
    };
  }) => ({
    mutate: (args: unknown) => mockDelete(args, mutation),
    isPending: false,
  }),
  getListAnnouncementsQueryKey: () => ["/api/announcements"],
  getGetAnnouncementQueryKey: (id: number) => [`/api/announcements/${id}`],
}));

vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/announcements/1", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, formatDate: (d: string) => d };
});

// ── Static imports (after mocks are hoisted) ───────────────────────────────────

import AnnouncementsPage from "@/pages/announcements/index";
import AnnouncementDetailPage from "@/pages/announcements/detail";

// ── Wrapper ────────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderAnnouncements() {
  render(<AnnouncementsPage />, { wrapper });
}

function renderDetail() {
  render(<AnnouncementDetailPage />, { wrapper });
}

// ── List page tests ────────────────────────────────────────────────────────────

describe("Announcements list page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.announcements = [...ANNOUNCEMENTS];
    mockState.detail = { ...ANNOUNCEMENTS[0] };
  });

  it("renders page title, Create Announcement button, and announcement cards", () => {
    renderAnnouncements();
    expect(screen.getByText("Announcements")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create announcement/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Homework Due Friday")).toBeInTheDocument();
    expect(screen.getByText("Test Rescheduled")).toBeInTheDocument();
  });

  it("shows priority badges on cards", () => {
    renderAnnouncements();
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });

  it("filters by search term", async () => {
    renderAnnouncements();
    await userEvent.type(screen.getByPlaceholderText(/search/i), "algebra");
    expect(screen.getByText("Homework Due Friday")).toBeInTheDocument();
    expect(screen.queryByText("Test Rescheduled")).not.toBeInTheDocument();
  });

  it("filters by priority", async () => {
    renderAnnouncements();
    const prioritySelect = screen.getByRole("combobox", { name: /priority filter/i });
    await userEvent.click(prioritySelect);
    await userEvent.click(screen.getByRole("option", { name: "Urgent" }));
    expect(screen.queryByText("Homework Due Friday")).not.toBeInTheDocument();
    expect(screen.getByText("Test Rescheduled")).toBeInTheDocument();
  });

  it("filters by course", async () => {
    renderAnnouncements();
    const courseSelect = screen.getByRole("combobox", { name: /course filter/i });
    await userEvent.click(courseSelect);
    await userEvent.click(screen.getByRole("option", { name: "Algebra I" }));
    expect(screen.getByText("Homework Due Friday")).toBeInTheDocument();
    expect(screen.queryByText("Test Rescheduled")).not.toBeInTheDocument();
  });

  it("shows empty state when no announcements exist", () => {
    mockState.announcements = [];
    renderAnnouncements();
    expect(screen.getByText(/no announcements yet/i)).toBeInTheDocument();
    expect(screen.getByText(/create your first announcement/i)).toBeInTheDocument();
  });

  // ── Create ───────────────────────────────────────────────────────────────────

  it("opens create dialog when Create Announcement is clicked", async () => {
    renderAnnouncements();
    await userEvent.click(screen.getByRole("button", { name: /create announcement/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows validation errors when required fields are empty on create", async () => {
    renderAnnouncements();
    await userEvent.click(screen.getByRole("button", { name: /create announcement/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /create announcement/i }),
    );
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(screen.getByText(/content is required/i)).toBeInTheDocument();
    expect(screen.getByText(/select a course/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("calls useCreateAnnouncement with correct payload on valid submit", async () => {
    renderAnnouncements();
    await userEvent.click(screen.getByRole("button", { name: /create announcement/i }));
    const dialog = screen.getByRole("dialog");

    await userEvent.type(within(dialog).getByLabelText(/title/i), "New Note");
    await userEvent.type(
      within(dialog).getByLabelText(/content/i),
      "Important message.",
    );
    const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
    await userEvent.click(courseCombo);
    await userEvent.click(screen.getByRole("option", { name: "Algebra I" }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: /create announcement/i }),
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "New Note",
          content: "Important message.",
          courseId: 10,
          authorName: "Ms. Smith",
        }),
      }),
      expect.anything(),
    );
  });

  it("invalidates list query on create success", async () => {
    mockCreate.mockImplementationOnce(
      (_args: unknown, m: { onSuccess?: () => void }) => {
        m.onSuccess?.();
      },
    );
    renderAnnouncements();
    await userEvent.click(screen.getByRole("button", { name: /create announcement/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/title/i), "X");
    await userEvent.type(within(dialog).getByLabelText(/content/i), "Y");
    const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
    await userEvent.click(courseCombo);
    await userEvent.click(screen.getByRole("option", { name: "Algebra I" }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: /create announcement/i }),
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/announcements"] }),
    );
  });

  it("shows inline error when create fails", async () => {
    mockCreate.mockImplementationOnce(
      (_args: unknown, m: { onError?: (e: unknown) => void }) => {
        m.onError?.({ message: "Server error" });
      },
    );
    renderAnnouncements();
    await userEvent.click(screen.getByRole("button", { name: /create announcement/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/title/i), "X");
    await userEvent.type(within(dialog).getByLabelText(/content/i), "Y");
    const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
    await userEvent.click(courseCombo);
    await userEvent.click(screen.getByRole("option", { name: "Algebra I" }));
    await userEvent.click(
      within(dialog).getByRole("button", { name: /create announcement/i }),
    );
    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });

  // ── Edit from list ────────────────────────────────────────────────────────────

  it("opens edit dialog pre-populated when pencil icon is clicked", async () => {
    renderAnnouncements();
    const editBtns = screen.getAllByRole("button", { name: /edit announcement/i });
    await userEvent.click(editBtns[0]);
    await screen.findByRole("dialog");
    expect(screen.getByDisplayValue("Homework Due Friday")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Please submit your algebra homework by Friday."),
    ).toBeInTheDocument();
  });

  it("calls useUpdateAnnouncement with correct payload from list edit", async () => {
    renderAnnouncements();
    const editBtns = screen.getAllByRole("button", { name: /edit announcement/i });
    await userEvent.click(editBtns[0]);
    await screen.findByRole("dialog");

    const titleInput = screen.getByDisplayValue("Homework Due Friday");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Updated Title");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        data: expect.objectContaining({ title: "Updated Title" }),
      }),
      expect.anything(),
    );
  });

  it("updates detail cache and local list on edit success", async () => {
    const updated = { ...ANNOUNCEMENTS[0], title: "Updated Title" };
    mockUpdate.mockImplementationOnce(
      (
        _args: unknown,
        m: { onSuccess?: (d: unknown, v: { id: number }) => void },
      ) => {
        m.onSuccess?.(updated, { id: 1 });
      },
    );
    renderAnnouncements();
    const editBtns = screen.getAllByRole("button", { name: /edit announcement/i });
    await userEvent.click(editBtns[0]);
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    // Detail cache updated with new data
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ["/api/announcements/1"],
      updated,
    );
    // Dialog dismissed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows validation error in edit dialog when title is cleared", async () => {
    renderAnnouncements();
    const editBtns = screen.getAllByRole("button", { name: /edit announcement/i });
    await userEvent.click(editBtns[0]);
    await screen.findByRole("dialog");

    const titleInput = screen.getByDisplayValue("Homework Due Friday");
    await userEvent.clear(titleInput);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── Delete from list ─────────────────────────────────────────────────────────

  it("opens delete confirmation when trash icon is clicked", async () => {
    renderAnnouncements();
    const deleteBtns = screen.getAllByRole("button", { name: /delete announcement/i });
    await userEvent.click(deleteBtns[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain("Homework Due Friday");
  });

  it("calls useDeleteAnnouncement when delete is confirmed", async () => {
    renderAnnouncements();
    await userEvent.click(
      screen.getAllByRole("button", { name: /delete announcement/i })[0],
    );
    await screen.findByRole("alertdialog");
    await userEvent.click(
      screen.getByRole("button", { name: /^delete announcement$/i }),
    );
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.anything(),
    );
  });

  it("removes announcement from local list after delete (no setQueryData)", async () => {
    mockDelete.mockImplementationOnce(
      (
        args: unknown,
        m: { onSuccess?: (d: unknown, v: { id: number }) => void },
      ) => {
        m.onSuccess?.(undefined, args as { id: number });
      },
    );
    renderAnnouncements();
    await userEvent.click(
      screen.getAllByRole("button", { name: /delete announcement/i })[0],
    );
    await screen.findByRole("alertdialog");
    await userEvent.click(
      screen.getByRole("button", { name: /^delete announcement$/i }),
    );
    expect(mockDelete).toHaveBeenCalledOnce();
    // Local state updated — no setQueryData on list cache needed
    expect(mockSetQueryData).not.toHaveBeenCalledWith(
      ["/api/announcements"],
      expect.any(Function),
    );
    // AlertDialog dismissed
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });
});

// ── Detail page tests ──────────────────────────────────────────────────────────

describe("Announcement detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.announcements = [...ANNOUNCEMENTS];
    mockState.detail = { ...ANNOUNCEMENTS[0] };
  });

  it("renders title, content, priority badge, course, and author", () => {
    renderDetail();
    expect(screen.getByText("Homework Due Friday")).toBeInTheDocument();
    expect(
      screen.getByText("Please submit your algebra homework by Friday."),
    ).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Algebra I")).toBeInTheDocument();
    expect(screen.getByText("Ms. Smith")).toBeInTheDocument();
  });

  it("renders urgent priority badge for urgent announcements", () => {
    mockState.detail = { ...ANNOUNCEMENTS[1], id: 1 };
    renderDetail();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });

  it("opens edit dialog pre-populated on Edit click", async () => {
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByRole("dialog");
    expect(screen.getByDisplayValue("Homework Due Friday")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Please submit your algebra homework by Friday."),
    ).toBeInTheDocument();
  });

  it("calls useUpdateAnnouncement with correct payload from detail edit", async () => {
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByRole("dialog");

    const titleInput = screen.getByDisplayValue("Homework Due Friday");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Updated Announcement");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        data: expect.objectContaining({ title: "Updated Announcement" }),
      }),
      expect.anything(),
    );
  });

  it("updates both detail and list cache on edit success", async () => {
    const updated = { ...ANNOUNCEMENTS[0], title: "Updated Announcement" };
    mockUpdate.mockImplementationOnce(
      (
        _args: unknown,
        m: { onSuccess?: (d: unknown, v: { id: number }) => void },
      ) => {
        m.onSuccess?.(updated, { id: 1 });
      },
    );
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => {
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ["/api/announcements/1"],
        updated,
      );
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ["/api/announcements"],
        expect.any(Function),
      );
    });
  });

  it("shows validation error when title is cleared in edit dialog", async () => {
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByRole("dialog");

    const titleInput = screen.getByDisplayValue("Homework Due Friday");
    await userEvent.clear(titleInput);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("opens delete AlertDialog on Delete click", async () => {
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain("Homework Due Friday");
  });

  it("calls useDeleteAnnouncement when deletion is confirmed", async () => {
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await screen.findByRole("alertdialog");
    await userEvent.click(
      screen.getByRole("button", { name: /^delete announcement$/i }),
    );
    expect(mockDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.anything(),
    );
  });

  it("removes announcement from list cache on delete success", async () => {
    mockDelete.mockImplementationOnce(
      (
        _args: unknown,
        m: { onSuccess?: (d: unknown, v: { id: number }) => void },
      ) => {
        m.onSuccess?.(undefined, { id: 1 });
      },
    );
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await screen.findByRole("alertdialog");
    await userEvent.click(
      screen.getByRole("button", { name: /^delete announcement$/i }),
    );
    await waitFor(() => {
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ["/api/announcements"],
        expect.any(Function),
      );
    });
  });

  // ── Authorization ─────────────────────────────────────────────────────────────

  it("displays error message when update is forbidden (403)", async () => {
    mockUpdate.mockImplementationOnce(
      (_args: unknown, m: { onError?: (e: unknown) => void }) => {
        m.onError?.({ message: "Access denied" });
      },
    );
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
  });

  it("shows not-found state when announcement is missing", () => {
    mockState.detail = { ...ANNOUNCEMENTS[0], id: 999 };
    renderDetail();
    expect(screen.getByText(/announcement not found/i)).toBeInTheDocument();
  });
});
