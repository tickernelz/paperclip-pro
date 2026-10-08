// @vitest-environment jsdom

import { act, forwardRef, useImperativeHandle, type ForwardedRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueAttachment } from "@tickernelz/paperclip-pro-shared";
import { issuesApi } from "@/api/issues";
import { ThemeProvider } from "@/context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  genericPendingRequestConfirmationInteraction,
  pendingAskUserQuestionsInteraction,
  pendingRequestCheckboxConfirmationInteraction,
  pendingToolActionWriteInteraction,
} from "@/fixtures/issueThreadInteractionFixtures";
import type {
  AskUserQuestionsInteraction,
  IssueThreadInteraction,
  RequestConfirmationInteraction,
} from "@/lib/issue-thread-interactions";
import { IssueThreadInteractionCard } from "./IssueThreadInteractionCard";
import { TaskChatCompactInteractionCard } from "./task-chat/TaskChatCompactInteractionCard";
import { TaskChatInteractionCard } from "./task-chat/TaskChatInteractionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  postForm: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  api: mockApi,
}));

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useCaseHref: () => () => "",
}));

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: forwardRef(function MockMarkdownEditor(
    {
      value,
      onChange,
      placeholder,
    }: {
      value: string;
      onChange: (value: string) => void;
      placeholder?: string;
    },
    ref: ForwardedRef<unknown>,
  ) {
    useImperativeHandle(ref, () => ({
      insertMarkdown: (markdown: string) => onChange(`${value}${markdown}`),
      focus: () => {},
    }));
    return (
      <textarea
        data-testid="mock-markdown-editor"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }),
}));

const ATTACHMENT_PATH = "/api/attachments/att-1/content";
const MARKDOWN_PROMPT = "Ship **bold** and `code` now?";

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  mockApi.post.mockReset();
  mockApi.post.mockImplementation(async () => ({}));
  vi.spyOn(issuesApi, "uploadAttachment").mockResolvedValue({
    id: "att-1",
    contentPath: ATTACHMENT_PATH,
  } as IssueAttachment);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  vi.restoreAllMocks();
});

function uploadHandler(interaction: IssueThreadInteraction) {
  return async (file: File) =>
    (await issuesApi.uploadAttachment(interaction.companyId, interaction.issueId, file)).contentPath;
}

function callbacks(interaction: IssueThreadInteraction) {
  return {
    onUploadImage: uploadHandler(interaction),
    onAcceptInteraction: async (
      target: IssueThreadInteraction,
      selectedClientKeys?: string[],
      selectedOptionIds?: string[],
      rememberAction?: boolean,
      note?: string,
    ) => {
      await issuesApi.acceptInteraction(target.issueId, target.id, {
        selectedClientKeys,
        selectedOptionIds,
        rememberAction,
        note,
      });
    },
    onRejectInteraction: async (target: IssueThreadInteraction, reason?: string, note?: string) => {
      await issuesApi.rejectInteraction(target.issueId, target.id, reason, note);
    },
    onSubmitInteractionAnswers: async (
      target: AskUserQuestionsInteraction,
      answers: Parameters<typeof issuesApi.respondToInteraction>[2]["answers"],
    ) => {
      await issuesApi.respondToInteraction(target.issueId, target.id, { answers });
    },
    onCancelInteraction: vi.fn(),
  };
}

async function render(ui: ReactNode) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeProvider>{ui}</ThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
}

function buttonByText(text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === text,
  );
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
  });
}

async function typeInto(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function writeNoteWithFile() {
  await click(container.querySelector('[data-testid="interaction-note-toggle"]'));
  const editor = container.querySelector<HTMLTextAreaElement>(
    '[data-testid="interaction-note-editor"] textarea',
  )!;
  await typeInto(editor, "See **this** first.");
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Attach file to note"]')!;
  expect(input.getAttribute("accept")).toBeNull();
  const file = new File(["%PDF"], "report.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(issuesApi.uploadAttachment).toHaveBeenCalledWith("company-1", expect.any(String), file);
}

function postedBody(pathSuffix: string) {
  const call = mockApi.post.mock.calls.find(([path]) => String(path).endsWith(pathSuffix));
  expect(call).toBeTruthy();
  return call![1] as Record<string, unknown>;
}

function expectNoteWithFile(note: unknown) {
  expect(note).toEqual(expect.stringContaining("See **this** first."));
  expect(note).toEqual(expect.stringContaining(`[report.pdf](${ATTACHMENT_PATH})`));
}

const markdownQuestion: AskUserQuestionsInteraction = {
  ...pendingAskUserQuestionsInteraction,
  id: "interaction-markdown-question",
  companyId: "company-1",
  payload: {
    version: 1,
    title: "Markdown question",
    submitLabel: "Send answers",
    questions: [
      {
        id: "q1",
        prompt: MARKDOWN_PROMPT,
        helpText: "Read `docs/plan.md` first.",
        selectionMode: "single",
        required: true,
        options: [
          { id: "yes", label: "**Yes**", description: "Use `main`." },
          { id: "no", label: "No" },
        ],
      },
    ],
  },
};

const markdownConfirmation: RequestConfirmationInteraction = {
  ...genericPendingRequestConfirmationInteraction,
  id: "interaction-markdown-confirmation",
  companyId: "company-1",
  payload: { version: 1, prompt: MARKDOWN_PROMPT },
};

function expectMarkdownPrompt() {
  const strong = Array.from(container.querySelectorAll("strong")).find(
    (element) => element.textContent === "bold",
  );
  const code = Array.from(container.querySelectorAll("code")).find(
    (element) => element.textContent === "code",
  );
  expect(strong).toBeTruthy();
  expect(code).toBeTruthy();
  expect(container.textContent).not.toContain("**bold**");
  expect(container.textContent).not.toContain("`code`");
}

describe("interaction card Markdown", () => {
  it("renders dock question prompts, help text and option labels as Markdown", async () => {
    await render(<TaskChatCompactInteractionCard interaction={markdownQuestion} {...callbacks(markdownQuestion)} />);
    expectMarkdownPrompt();
    expect(container.querySelector("#interaction-markdown-question-q1-yes strong")?.textContent).toBe("Yes");
    expect(container.textContent).not.toContain("`docs/plan.md`");
  });

  it("renders the dock confirmation prompt as Markdown", async () => {
    await render(
      <TaskChatCompactInteractionCard interaction={markdownConfirmation} {...callbacks(markdownConfirmation)} />,
    );
    expectMarkdownPrompt();
  });

  it("renders the unanswered question row as one line of Markdown", async () => {
    const multiParagraph = {
      ...markdownQuestion,
      payload: { ...markdownQuestion.payload, questions: [{ ...markdownQuestion.payload.questions[0]!, prompt: `${MARKDOWN_PROMPT}\n\nSecond paragraph.` }] },
    };
    await render(
      <TaskChatInteractionCard
        item={{ kind: "interaction", id: multiParagraph.id, interaction: multiParagraph }}
        showUnansweredQuestion
        onReviewRequest={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="task-chat-unanswered-question"]')).not.toBeNull();
    expectMarkdownPrompt();
    expect(container.textContent).not.toContain("Second paragraph.");
  });

  it("renders thread question prompts and option labels as Markdown", async () => {
    await render(<IssueThreadInteractionCard interaction={markdownQuestion} {...callbacks(markdownQuestion)} />);
    expectMarkdownPrompt();
    expect(container.querySelector("#interaction-markdown-question-q1-yes strong")?.textContent).toBe("Yes");
  });

  it("renders the thread confirmation prompt as Markdown", async () => {
    await render(
      <IssueThreadInteractionCard interaction={markdownConfirmation} {...callbacks(markdownConfirmation)} />,
    );
    expectMarkdownPrompt();
  });

  it("renders submitted answers and notes as Markdown in the dock receipt", async () => {
    const answered: AskUserQuestionsInteraction = {
      ...markdownQuestion,
      status: "answered",
      result: {
        version: 1,
        answers: [{ questionId: "q1", optionIds: ["yes"], note: "Ship it with `flag`." }],
      },
    };
    await render(
      <TaskChatCompactInteractionCard interaction={answered} presentation="takeover" {...callbacks(answered)} />,
    );
    expect(container.querySelector('[data-testid="interaction-note-receipt"] code')?.textContent).toBe("flag");
  });
});

describe("interaction card notes", () => {
  it("sends a dock question note with an uploaded file as answers[].note", async () => {
    await render(<TaskChatCompactInteractionCard interaction={markdownQuestion} {...callbacks(markdownQuestion)} />);
    expect(container.querySelector('[data-testid="interaction-note-toggle"]')).toBeNull();
    await click(container.querySelector("#interaction-markdown-question-q1-yes"));
    await writeNoteWithFile();
    await click(buttonByText("Send answers"));
    const body = postedBody("/interactions/interaction-markdown-question/respond");
    const answers = body.answers as Array<Record<string, unknown>>;
    expect(answers[0]).toMatchObject({ questionId: "q1", optionIds: ["yes"] });
    expectNoteWithFile(answers[0]?.note);
  });

  it("sends a thread question note with an uploaded file as answers[].note", async () => {
    await render(<IssueThreadInteractionCard interaction={markdownQuestion} {...callbacks(markdownQuestion)} />);
    expect(container.querySelector('[data-testid="interaction-note-toggle"]')).toBeNull();
    await click(container.querySelector("#interaction-markdown-question-q1-yes"));
    await writeNoteWithFile();
    await click(buttonByText("Send answers"));
    const answers = postedBody("/interactions/interaction-markdown-question/respond").answers as Array<
      Record<string, unknown>
    >;
    expectNoteWithFile(answers[0]?.note);
  });

  it("sends the dock confirmation note on accept", async () => {
    await render(
      <TaskChatCompactInteractionCard interaction={markdownConfirmation} {...callbacks(markdownConfirmation)} />,
    );
    await writeNoteWithFile();
    await click(buttonByText("Approve"));
    const body = postedBody("/interactions/interaction-markdown-confirmation/accept");
    expectNoteWithFile(body.note);
  });

  it("sends the dock checkbox confirmation note on reject", async () => {
    const checkbox = { ...pendingRequestCheckboxConfirmationInteraction, companyId: "company-1" };
    await render(<TaskChatCompactInteractionCard interaction={checkbox} {...callbacks(checkbox)} />);
    await writeNoteWithFile();
    await click(buttonByText("Reject"));
    const body = postedBody(`/interactions/${checkbox.id}/reject`);
    expect(body.reason).toBeUndefined();
    expectNoteWithFile(body.note);
  });

  it("keeps the thread decline reason and note separate on reject", async () => {
    await render(
      <IssueThreadInteractionCard interaction={markdownConfirmation} {...callbacks(markdownConfirmation)} />,
    );
    await writeNoteWithFile();
    await click(buttonByText("Revise…"));
    const reason = container.querySelector<HTMLTextAreaElement>(
      'textarea:not([data-testid="mock-markdown-editor"])',
    )!;
    await typeInto(reason, "Narrow the scope.");
    await click(buttonByText("Send revision"));
    const body = postedBody("/interactions/interaction-markdown-confirmation/reject");
    expect(body.reason).toBe("Narrow the scope.");
    expectNoteWithFile(body.note);
  });

  it("sends the thread checkbox confirmation note on accept", async () => {
    const checkbox = { ...pendingRequestCheckboxConfirmationInteraction, companyId: "company-1" };
    await render(<IssueThreadInteractionCard interaction={checkbox} {...callbacks(checkbox)} />);
    await writeNoteWithFile();
    await click(buttonByText("Delete selected"));
    const body = postedBody(`/interactions/${checkbox.id}/accept`);
    expect(body.selectedOptionIds).toEqual([]);
    expectNoteWithFile(body.note);
  });

  it("omits an empty note from the request body", async () => {
    await render(
      <TaskChatCompactInteractionCard interaction={markdownConfirmation} {...callbacks(markdownConfirmation)} />,
    );
    await click(container.querySelector('[data-testid="interaction-note-toggle"]'));
    await click(buttonByText("Approve"));
    expect(postedBody("/interactions/interaction-markdown-confirmation/accept")).not.toHaveProperty("note");
  });

  it("offers no note on tool reviews or chat approvals", async () => {
    const openwa: RequestConfirmationInteraction = {
      ...markdownConfirmation,
      payload: { ...markdownConfirmation.payload, openwaApprovalRequestId: "11111111-1111-4111-8111-111111111111" },
    };
    for (const interaction of [pendingToolActionWriteInteraction, openwa]) {
      await render(<TaskChatCompactInteractionCard interaction={interaction} {...callbacks(interaction)} />);
      expect(container.querySelector('[data-testid="interaction-note-toggle"]')).toBeNull();
      await render(<IssueThreadInteractionCard interaction={interaction} {...callbacks(interaction)} />);
      expect(container.querySelector('[data-testid="interaction-note-toggle"]')).toBeNull();
    }
  });
});

describe("thread interaction card Hide", () => {
  it("hides the body per interaction without cancelling and survives a re-render", async () => {
    const props = callbacks(markdownQuestion);
    await render(<IssueThreadInteractionCard interaction={markdownQuestion} {...props} />);
    const body = () => container.querySelector<HTMLElement>('[data-testid="interaction-card-body"]')!;
    await click(container.querySelector("#interaction-markdown-question-q1-yes"));
    await click(container.querySelector('button[aria-label="Hide"]'));
    expect(body().hidden).toBe(true);
    expect(props.onCancelInteraction).not.toHaveBeenCalled();
    expect(mockApi.post).not.toHaveBeenCalled();
    expect(container.querySelector("#interaction-markdown-question-q1-yes")?.getAttribute("aria-checked")).toBe("true");

    act(() => root.unmount());
    root = createRoot(container);
    await render(<IssueThreadInteractionCard interaction={markdownQuestion} {...props} />);
    expect(body().hidden).toBe(true);
    expect(container.querySelector('button[aria-label="Show"]')).not.toBeNull();

    const other = { ...markdownQuestion, id: "interaction-markdown-question-2" };
    await render(<IssueThreadInteractionCard interaction={other} {...callbacks(other)} />);
    expect(body().hidden).toBe(false);
    expect(container.querySelector('button[aria-label="Hide"]')).not.toBeNull();

    await render(<IssueThreadInteractionCard interaction={markdownQuestion} {...props} />);
    await click(container.querySelector('button[aria-label="Show"]'));
    expect(body().hidden).toBe(false);
  });
});
