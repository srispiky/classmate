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

const NOTES = [
  {
    id: 1,
    title: "Intro to Algebra",
    content: "Today we covered variables and expressions.",
    courseId: 10,
    courseName: "Algebra I",
    topic: "Algebra Basics",
    videoUrl: null,
    createdAt: "2024-09-01T00:00:00.000Z",
    updatedAt: "2024-09-01T00:00:00.000Z",
  },
  {
    id: 2,
    title: "Shakespearean Sonnets",
    content: "We read Sonnet 18 and discussed meter.",
    courseId: 11,
    courseName: "English Lit",
    topic: "Poetry",
    videoUrl: "https://example.com/video2",
    createdAt: "2024-09-05T00:00:00.000Z",
    updatedAt: "2024-09-05T00:00:00.000Z",
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

// ── Mutable state ─────────────────────────────────────────────────────────────

type NoteDetail = {
  id: number;
  title: string;
  content: string;
  courseId: number;
  courseName: string;
  topic: string;
  videoUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

const mockState: {
  notes: typeof NOTES[number][];
  detail: NoteDetail;
} = {
  notes: [...NOTES],
  detail: { ...NOTES[0] },
};

// ── Stable paginated stubs ────────────────────────────────────────────────────
// Getter-based: wrapper object is always the same reference (prevents infinite
// useEffect loops), while items dynamically reflects the current mockState.
const NOTES_PAGINATION = { nextCursor: null as null, hasMore: false, limit: 50 };
const notesPageStub = { get items() { return mockState.notes; }, pagination: NOTES_PAGINATION };
const coursesPageStub = { items: COURSES as unknown[], pagination: NOTES_PAGINATION };

vi.mock("@workspace/api-client-react", () => ({
  useListNotes: () => ({ data: notesPageStub, isLoading: false, isFetching: false }),
  useGetNote: (id: number) => ({
    data: mockState.detail.id === id ? mockState.detail : undefined,
    isLoading: false,
    isError: false,
  }),
  useListCourses: () => ({ data: coursesPageStub, isFetching: false }),
  useCreateNote: ({
    mutation,
  }: {
    mutation: { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void };
  }) => ({
    mutate: (args: unknown) => mockCreate(args, mutation),
    isPending: false,
  }),
  useUpdateNote: ({
    mutation,
  }: {
    mutation: {
      onSuccess?: (d: unknown) => void;
      onError?: (e: unknown) => void;
    };
  }) => ({
    mutate: (args: unknown) => mockUpdate(args, mutation),
    isPending: false,
  }),
  useDeleteNote: ({
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
  getListNotesQueryKey: () => ["/api/notes"],
  getGetNoteQueryKey: (id: number) => [`/api/notes/${id}`],
}));

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => <a href={href} className={className}>{children}</a>,
  useParams: () => ({ id: "1" }),
  useLocation: () => ["/notes/1", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return { ...actual, formatDate: (d: string) => d };
});

// ── Static imports ─────────────────────────────────────────────────────────────

import NotesPage from "@/pages/notes/index";
import NoteDetailPage from "@/pages/notes/detail";

// ── Wrapper ───────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderNotes() {
  render(<NotesPage />, { wrapper });
}

function renderDetail() {
  render(<NoteDetailPage />, { wrapper });
}

// ── Tests: Notes list page ────────────────────────────────────────────────────

describe("Notes list page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.notes = [...NOTES];
    mockState.detail = { ...NOTES[0] };
  });

  it("renders existing notes and the Add Note button", () => {
    renderNotes();
    expect(screen.getByText("Intro to Algebra")).toBeInTheDocument();
    expect(screen.getByText("Shakespearean Sonnets")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add note/i })).toBeInTheDocument();
  });

  it("shows video-available indicator on notes that have a video URL", () => {
    renderNotes();
    const card2 = screen.getByText("Shakespearean Sonnets").closest("a")!;
    expect(within(card2).getByLabelText("Video available")).toBeInTheDocument();
  });

  it("does not show video-available indicator on notes without a video URL", () => {
    renderNotes();
    const card1 = screen.getByText("Intro to Algebra").closest("a")!;
    expect(within(card1).queryByLabelText("Video available")).not.toBeInTheDocument();
  });

  it("filters notes by search query", async () => {
    renderNotes();
    await userEvent.type(screen.getByPlaceholderText(/search/i), "Algebra");
    expect(screen.getByText("Intro to Algebra")).toBeInTheDocument();
    expect(screen.queryByText("Shakespearean Sonnets")).not.toBeInTheDocument();
  });

  it("shows empty state when no notes match search", async () => {
    renderNotes();
    await userEvent.type(screen.getByPlaceholderText(/search/i), "zzznomatch");
    expect(screen.getByText("No notes found")).toBeInTheDocument();
  });

  // ── Create ───────────────────────────────────────────────────────────────────

  it("opens create dialog when Add Note is clicked", async () => {
    renderNotes();
    await userEvent.click(screen.getByRole("button", { name: /add note/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("Add Note")).toBeInTheDocument();
  });

  it("shows validation error when title is empty on create", async () => {
    renderNotes();
    await userEvent.click(screen.getByRole("button", { name: /add note/i }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^create note$/i }),
    );
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("shows validation error when content is empty on create", async () => {
    renderNotes();
    await userEvent.click(screen.getByRole("button", { name: /add note/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/^title/i), "My Note");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create note$/i }));
    expect(await screen.findByText(/content is required/i)).toBeInTheDocument();
  });

  it("shows validation error when course not selected on create", async () => {
    renderNotes();
    await userEvent.click(screen.getByRole("button", { name: /add note/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/^title/i), "My Note");
    await userEvent.type(within(dialog).getByLabelText(/content/i), "Some content here");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create note$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/select a course/i);
  });

  it("calls useCreateNote with correct payload on valid submit", async () => {
    mockCreate.mockImplementationOnce(
      (args: unknown, m: { onSuccess?: (d: unknown) => void }) => {
        m.onSuccess?.({ id: 99, ...(args as { data: Record<string, unknown> }).data });
      },
    );
    renderNotes();
    await userEvent.click(screen.getByRole("button", { name: /add note/i }));
    const dialog = screen.getByRole("dialog");

    await userEvent.type(within(dialog).getByLabelText(/^title/i), "New Lesson");
    await userEvent.type(within(dialog).getByLabelText(/^topic/i), "Functions");

    const courseCombo = within(dialog).getByRole("combobox", { name: /course/i });
    await userEvent.click(courseCombo);
    await userEvent.click(screen.getByRole("option", { name: "Algebra I" }));

    await userEvent.type(within(dialog).getByLabelText(/content/i), "Lesson content here.");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create note$/i }));

    expect(mockCreate).toHaveBeenCalledOnce();
    const [payload] = mockCreate.mock.calls[0];
    expect((payload as { data: { title: string } }).data.title).toBe("New Lesson");
    expect((payload as { data: { content: string } }).data.content).toBe("Lesson content here.");
    expect((payload as { data: { courseId: number } }).data.courseId).toBe(10);
    expect((payload as { data: { topic: string } }).data.topic).toBe("Functions");
  });

  it("invalidates note list query on create success", async () => {
    mockCreate.mockImplementationOnce(
      (args: unknown, m: { onSuccess?: (d: unknown) => void }) => {
        m.onSuccess?.({ id: 99 });
      },
    );
    renderNotes();
    await userEvent.click(screen.getByRole("button", { name: /add note/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/^title/i), "X");
    await userEvent.type(within(dialog).getByLabelText(/^topic/i), "T");
    const combo = within(dialog).getByRole("combobox", { name: /course/i });
    await userEvent.click(combo);
    await userEvent.click(screen.getByRole("option", { name: "Algebra I" }));
    await userEvent.type(within(dialog).getByLabelText(/content/i), "Y");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create note$/i }));

    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["/api/notes"] }),
    );
  });

  it("shows inline error when create fails", async () => {
    mockCreate.mockImplementationOnce(
      (_args: unknown, m: { onError?: (e: unknown) => void }) => {
        m.onError?.({ message: "Server error" });
      },
    );
    renderNotes();
    await userEvent.click(screen.getByRole("button", { name: /add note/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/^title/i), "X");
    await userEvent.type(within(dialog).getByLabelText(/^topic/i), "T");
    const combo = within(dialog).getByRole("combobox", { name: /course/i });
    await userEvent.click(combo);
    await userEvent.click(screen.getByRole("option", { name: "Algebra I" }));
    await userEvent.type(within(dialog).getByLabelText(/content/i), "Y");
    await userEvent.click(within(dialog).getByRole("button", { name: /^create note$/i }));

    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });

  // ── Edit from list ────────────────────────────────────────────────────────────

  it("opens edit dialog pre-populated when pencil icon is clicked", async () => {
    renderNotes();
    const editBtns = screen.getAllByRole("button", { name: /edit note/i });
    await userEvent.click(editBtns[0]);
    await screen.findByRole("dialog");
    expect(screen.getByDisplayValue("Intro to Algebra")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Algebra Basics")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Today we covered variables and expressions."),
    ).toBeInTheDocument();
  });

  it("calls useUpdateNote with correct payload from list edit", async () => {
    mockUpdate.mockImplementationOnce(
      (args: unknown, m: { onSuccess?: (d: unknown) => void }) => {
        m.onSuccess?.({ id: 1, ...(args as { data: Record<string, unknown> }).data });
      },
    );
    renderNotes();
    const editBtns = screen.getAllByRole("button", { name: /edit note/i });
    await userEvent.click(editBtns[0]);
    await screen.findByRole("dialog");

    const titleInput = screen.getByDisplayValue("Intro to Algebra");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Updated Title");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(mockUpdate).toHaveBeenCalledOnce();
    const [payload] = mockUpdate.mock.calls[0];
    expect((payload as { id: number }).id).toBe(1);
    expect((payload as { data: { title: string } }).data.title).toBe("Updated Title");
  });

  it("updates detail cache and local list on edit success", async () => {
    const updated = { ...NOTES[0], title: "Updated Title" };
    mockUpdate.mockImplementationOnce(
      (_args: unknown, m: { onSuccess?: (d: unknown, v: { id: number }) => void }) => {
        m.onSuccess?.(updated, { id: updated.id });
      },
    );
    renderNotes();
    await userEvent.click(screen.getAllByRole("button", { name: /edit note/i })[0]);
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    // Detail cache updated, dialog closed
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ["/api/notes/1"],
      updated,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows validation error in edit dialog when title is cleared", async () => {
    renderNotes();
    await userEvent.click(screen.getAllByRole("button", { name: /edit note/i })[0]);
    await screen.findByRole("dialog");
    const titleInput = screen.getByDisplayValue("Intro to Algebra");
    await userEvent.clear(titleInput);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("shows inline error when update fails from list", async () => {
    mockUpdate.mockImplementationOnce(
      (_args: unknown, m: { onError?: (e: unknown) => void }) => {
        m.onError?.({ message: "Update failed" });
      },
    );
    renderNotes();
    await userEvent.click(screen.getAllByRole("button", { name: /edit note/i })[0]);
    await screen.findByRole("dialog");
    const titleInput = screen.getByDisplayValue("Intro to Algebra");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "X");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Update failed")).toBeInTheDocument();
  });

  // ── Delete from list ──────────────────────────────────────────────────────────

  it("opens delete confirmation when trash icon is clicked", async () => {
    renderNotes();
    await userEvent.click(screen.getAllByRole("button", { name: /delete note/i })[0]);
    const alertDialog = screen.getByRole("alertdialog");
    expect(alertDialog).toBeInTheDocument();
    expect(within(alertDialog).getByRole("heading", { name: "Delete Note" })).toBeInTheDocument();
  });

  it("calls useDeleteNote and removes item from local list on confirm", async () => {
    mockDelete.mockImplementationOnce(
      (args: unknown, m: { onSuccess?: (d: unknown, v: { id: number }) => void }) => {
        m.onSuccess?.({}, args as { id: number });
      },
    );
    renderNotes();
    await userEvent.click(screen.getAllByRole("button", { name: /delete note/i })[0]);
    const dialog = screen.getByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /delete note/i }));

    expect(mockDelete).toHaveBeenCalledOnce();
    expect((mockDelete.mock.calls[0][0] as { id: number }).id).toBe(1);
    // Local state updated — no setQueryData needed for list (detail cache untouched)
    expect(mockSetQueryData).not.toHaveBeenCalledWith(["/api/notes"], expect.any(Function));
    // Dialog dismissed
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

// ── Tests: Note detail page ───────────────────────────────────────────────────

describe("Note detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.notes = [...NOTES];
    mockState.detail = { ...NOTES[0] };
  });

  it("renders note title, topic, course, and content", () => {
    renderDetail();
    expect(screen.getByText("Intro to Algebra")).toBeInTheDocument();
    expect(screen.getByText("Algebra Basics")).toBeInTheDocument();
    expect(screen.getByText("Algebra I")).toBeInTheDocument();
    expect(screen.getByText(/Today we covered variables/)).toBeInTheDocument();
  });

  it("renders Edit and Delete buttons", () => {
    renderDetail();
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("shows video section when videoUrl is set", () => {
    mockState.detail = { ...NOTES[1], id: 1 };
    renderDetail();
    expect(screen.getByText("Lesson Replay")).toBeInTheDocument();
  });

  it("does not show video section when videoUrl is null", () => {
    renderDetail();
    expect(screen.queryByText("Lesson Replay")).not.toBeInTheDocument();
  });

  it("opens edit dialog pre-populated when Edit is clicked", async () => {
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("Intro to Algebra")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Algebra Basics")).toBeInTheDocument();
  });

  it("calls useUpdateNote with correct payload from detail edit", async () => {
    mockUpdate.mockImplementationOnce(
      (args: unknown, m: { onSuccess?: (d: unknown) => void }) => {
        m.onSuccess?.({ id: 1, ...(args as { data: Record<string, unknown> }).data });
      },
    );
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = screen.getByRole("dialog");
    const contentInput = within(dialog).getByLabelText(/content/i);
    await userEvent.clear(contentInput);
    await userEvent.type(contentInput, "Updated content for the lesson.");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    expect(mockUpdate).toHaveBeenCalledOnce();
    const [payload] = mockUpdate.mock.calls[0];
    expect((payload as { id: number }).id).toBe(1);
    expect((payload as { data: { content: string } }).data.content).toBe(
      "Updated content for the lesson.",
    );
  });

  it("updates both detail and list cache on edit success from detail", async () => {
    const updated = { ...NOTES[0], content: "Updated content." };
    mockUpdate.mockImplementationOnce(
      (_args: unknown, m: { onSuccess?: (d: unknown) => void }) => {
        m.onSuccess?.(updated);
      },
    );
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(mockSetQueryData).toHaveBeenCalledWith(
      ["/api/notes/1"],
      updated,
    );
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ["/api/notes"],
      expect.any(Function),
    );
  });

  it("shows edit error when update fails from detail", async () => {
    mockUpdate.mockImplementationOnce(
      (_args: unknown, m: { onError?: (e: unknown) => void }) => {
        m.onError?.({ message: "Detail update failed" });
      },
    );
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = screen.getByRole("dialog");
    const titleInput = within(dialog).getByLabelText(/^title/i);
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "X");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("Detail update failed")).toBeInTheDocument();
  });

  it("opens delete confirmation when Delete is clicked", async () => {
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("calls useDeleteNote on confirm from detail page", async () => {
    mockDelete.mockImplementationOnce(
      (args: unknown, m: { onSuccess?: (d: unknown, v: { id: number }) => void }) => {
        m.onSuccess?.({}, args as { id: number });
      },
    );
    renderDetail();
    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    const dialog = screen.getByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /delete note/i }));

    expect(mockDelete).toHaveBeenCalledOnce();
    expect((mockDelete.mock.calls[0][0] as { id: number }).id).toBe(1);
  });
});
