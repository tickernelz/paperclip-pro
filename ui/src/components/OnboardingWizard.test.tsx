// @vitest-environment jsdom

import { act } from "react";
import type { LocalAiLoginStatus } from "@tickernelz/paperclip-pro-shared";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (hoisted so vi.mock factories can close over them) ----------------

// The company list is keyed by account, so it holds until the session query
// *succeeds*. A seeded entry is stale under the test client and refetches, so
// the refetch has to answer too — otherwise the identity errors and the list
// never runs.
const mockAuthApi = vi.hoisted(() => ({ getSession: vi.fn() }));
const localHealth = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/health", () => ({ healthApi: localHealth }));
const managedApi = vi.hoisted(() => ({
  list: vi.fn(async () => ({ currentUserId: "user-1", connections: [] })),
  startLocalLogin: vi.fn(async () => ({ sessionId: "local-attempt", expiresAt: "2099-01-01T00:00:00Z" })),
  submitLocalLoginCode: vi.fn(async () => ({ ok: true })),
  checkLocalLogin: vi.fn(async (): Promise<LocalAiLoginStatus> => ({ status: "sign_in_required" })),
  cancelLocalLogin: vi.fn(async () => ({})),
  connectLocal: vi.fn(async () => ({ connectionId: "local-connection", grantId: "local-grant" })),
  create: vi.fn(async () => ({ connectionId: "managed-connection", grantId: "managed-grant" })),
}));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: managedApi }));
vi.mock("../api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/auth")>();
  return { ...actual, authApi: { ...actual.authApi, getSession: mockAuthApi.getSession } };
});

const mockDialog = vi.hoisted(() => ({
  onboardingOpen: true,
  onboardingOptions: {} as { initialStep?: number; companyId?: string },
  closeOnboarding: vi.fn(),
  onboardingRouteDismissed: false,
  setOnboardingRouteDismissed: vi.fn(),
}));

const mockCompany = vi.hoisted(() => ({
  companies: [] as Array<{ id: string; name: string; issuePrefix: string }>,
  setSelectedCompanyId: vi.fn(),
  loading: false,
  error: null as Error | null,
}));

const mockCompaniesApi = vi.hoisted(() => ({
  detachInflightList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  // The gate fetches the list itself now, rather than reading the shared
  // cache, so ownership cases are driven from here. `mockCompany.companies`
  // below still feeds the *inner* wizard, which is a different question.
  list: vi.fn(),
}));
const mockGoalsApi = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(async () => []),
}));
const mockAgentsApi = vi.hoisted(() => ({
  adapterModels: vi.fn(async () => [] as Array<{ id: string; label: string }>),
  testEnvironment: vi.fn(
    async (): Promise<import("@tickernelz/paperclip-pro-shared").AdapterEnvironmentTestResult> => ({
      adapterType: "claude_local",
      status: "pass",
      checks: [],
      testedAt: new Date().toISOString(),
    }),
  ),
  hire: vi.fn(async () => ({ agent: { id: "agent-1" }, approval: null })),
  // The hire step lists the company's agents first and adopts one that already
  // carries the typed name on the same source, so a wizard that reopens on the
  // agent step cannot hire "Ada 2". Empty by default: the company is new.
  list: vi.fn(async () => [] as Array<{ id: string; name: string; adapterType: string }>),
  instructionsBundle: vi.fn(async () => ({ entryFile: "AGENTS.md" })),
  saveInstructionsFile: vi.fn(async () => ({})),
  // No default implementation: the top-level `beforeEach` sets the "no
  // stored value" 404 rejection, using the real `ApiError` class the code
  // under test checks with `instanceof`.
  getClaudeOAuthTokenStatus: vi.fn(),
  getAdapterAuthSignal: vi.fn(
    async (): Promise<import("@tickernelz/paperclip-pro-shared").AdapterAuthSignalResponse> => ({
      status: "present",
    }),
  ),
  // The sign-in routes. The connect step's Connect button starts a login rather
  // than hiring when the signal says the source has no credential, so the two
  // login shapes need enough of a server to reach the state the step is about:
  // a session that is running, and a prompt to show for it.
  startClaudeSetupTokenLogin: vi.fn(async () => ({
    sessionId: "claude-session-1",
    status: "pending",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  })),
  getClaudeSetupTokenLoginStatus: vi.fn(async () => ({
    sessionId: "claude-session-1",
    status: "pending",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  })),
  getClaudeSetupTokenLoginPrompt: vi.fn(async () => ({
    authorizationUrl: "https://claude.ai/oauth/authorize?code=true",
    transportAdvisory: null,
  })),
  cancelClaudeSetupTokenLogin: vi.fn(async () => ({})),
  submitClaudeSetupTokenBrowserCode: vi.fn(async () => ({})),
  completeClaudeSetupTokenLogin: vi.fn(async () => ({ storedSessionId: "stored-1" })),
  startAdapterAuthLogin: vi.fn(async () => ({
    sessionId: "codex-session-1",
    status: "pending",
  })),
  getAdapterAuthLoginStatus: vi.fn(async () => ({
    sessionId: "codex-session-1",
    status: "pending",
    prompt: { url: "https://auth.openai.com/codex/device", code: "Q2RJ-E1YIF" },
  })),
  cancelAdapterAuthLogin: vi.fn(async () => ({})),
  // No default implementation: the top-level `beforeEach` sets the "no active
  // session" 404 rejection, matching the real route.
  getActiveAdapterAuthLoginSession: vi.fn(),
  getActiveClaudeSetupTokenLoginSession: vi.fn(),
}));
// The adapter registry mock below always returns this function, so a test
// can shape the built adapter config (e.g. a configured ANTHROPIC_API_KEY)
// without a real adapter package.
const mockAdapterBuild = vi.hoisted(() => ({
  buildAdapterConfig: vi.fn(() => ({}) as Record<string, unknown>),
}));
// The Connect path loads environment settings before probing; without these
// the probe dies on "Could not load environment settings" and the hire never
// runs — which reads as a mysterious 0-call assertion, not an error.
const mockEnvironmentsApi = vi.hoisted(() => ({
  list: vi.fn(async () => [] as Array<Record<string, unknown>>),
  capabilities: vi.fn(
    async (): Promise<import("@tickernelz/paperclip-pro-shared").EnvironmentCapabilities> =>
      (await import("@tickernelz/paperclip-pro-shared")).getEnvironmentCapabilities([]),
  ),
}));
const mockInstanceSettingsApi = vi.hoisted(() => ({
  get: vi.fn(async () => ({ defaultEnvironmentId: null as string | null })),
  getExperimental: vi.fn(async () => ({ enableManagedSandboxOnly: false })),
}));
const mockApprovalsApi = vi.hoisted(() => ({
  create: vi.fn(),
}));
const mockSecretsApi = vi.hoisted(() => ({
  list: vi.fn(),
  removeUserSecretDefinition: vi.fn(),
  listMyUserSecrets: vi.fn(),
  createUserSecretDefinition: vi.fn(),
  createMyUserSecret: vi.fn(),
  rotateMyUserSecret: vi.fn(),
}));
const mockIssuesApi = vi.hoisted(() => ({
  create: vi.fn(),
}));
const mockProjectsApi = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(async () => []),
}));

// The real adapter registry eagerly imports every adapter package. The
// model/harness picker internals are out of scope here, so stub the adapter
// layer entirely and drive it through this knob.
const mockAdapterRegistry = vi.hoisted(() => ({
  list: [] as Array<{ type: string; recommended?: boolean }>,
  disabled: new Set<string>(),
}));

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: "/", search: "", hash: "", state: null }),
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));
vi.mock("../context/DialogContext", () => ({
  useDialog: () => mockDialog,
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompany,
}));
vi.mock("../api/companies", () => ({ companiesApi: mockCompaniesApi }));
vi.mock("../api/goals", () => ({ goalsApi: mockGoalsApi }));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/approvals", () => ({ approvalsApi: mockApprovalsApi }));
vi.mock("../api/secrets", () => ({ secretsApi: mockSecretsApi }));
vi.mock("../api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("../api/projects", () => ({ projectsApi: mockProjectsApi }));
vi.mock("../api/environments", () => ({ environmentsApi: mockEnvironmentsApi }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));
vi.mock("../adapters", () => ({
  listUIAdapters: () => mockAdapterRegistry.list,
  getUIAdapter: () => ({ buildAdapterConfig: mockAdapterBuild.buildAdapterConfig }),
}));
vi.mock("../adapters/metadata", () => ({ isVisualAdapterChoice: () => true }));
vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterDisplay: (type: string) => ({
    type,
    // Mirrors the real registry, where these two and only these two are
    // `recommended`. A blanket `false` used to be harmless because every adapter
    // then sat in the "Advanced settings" disclosure and was reachable anyway;
    // with the step down to a tile row built from this flag, it made that row
    // empty in every test and hid the surface under it.
    recommended: type === "claude_local" || type === "codex_local" || mockAdapterRegistry.list.some(entry => entry.type === type && entry.recommended),
    label: type,
    description: "",
    icon: () => null,
  }),
  getAdapterLabel: (type: string) => type,
  getAdapterLabels: () => ({}) as Record<string, string>,
  isKnownAdapterType: () => true,
}));
vi.mock("../adapters/use-disabled-adapters", () => ({
  useDisabledAdaptersSync: () => mockAdapterRegistry.disabled,
  // Added by #11371's adapter snap. A module mock replaces the whole module,
  // so every export the component reaches for has to be here — omitting one
  // makes it undefined and the call throws.
  useAdapterRegistryLoaded: () => true,
}));
// Adapters with a declared login capability, mirroring the real registry:
// `claude_local` and `codex_local` both support a sandbox login, and every
// other type has none, matching the real `useAdapterCapabilities` fallback for
// an unlisted type.
//
// The panel modes are the real ones rather than one mode for both. They used to
// be, back when nothing outside the panel dispatcher read them. The connect
// step reads them now — the two logins end in different places, so its button
// waits differently for each — and a mock that called Claude's login
// `displayed_code` would have the step testing the wrong half of that.
// Reconcile with KNOWN_DEFAULTS in `adapters/use-adapter-capabilities.ts`.
const ADAPTER_LOGIN_MODES: Record<string, "displayed_code" | "submitted_browser_code"> = {
  claude_local: "submitted_browser_code",
  codex_local: "displayed_code",
};
vi.mock("../adapters/use-adapter-capabilities", () => ({
  useAdapterCapabilities: () => (type: string) => ({
    supportsInstructionsBundle: false,
    supportsSkills: false,
    supportsLocalAgentJwt: false,
    requiresMaterializedRuntimeSkills: false,
    login: ADAPTER_LOGIN_MODES[type]
      ? { panelMode: ADAPTER_LOGIN_MODES[type]!, timeoutPolicy: "fixed" as const }
      : undefined,
  }),
}));
// Animation / canvas-ish children that add nothing to the logic under test.
vi.mock("./AsciiArtAnimation", () => ({ AsciiArtAnimation: () => null }));
vi.mock("./AgentCapsule", () => ({ AgentCapsule: () => null }));

import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { ADAPTER_AUTH_MISSING_CHECK_CODE, getEnvironmentCapabilities } from "@tickernelz/paperclip-pro-shared";
import { CLAUDE_OAUTH_TOKEN_ENV_KEY } from "./environment-variables-editor/model";
import { ONBOARDING_STORAGE_KEY, OnboardingWizard } from "./OnboardingWizard";
import { CONNECTED_HOLD_MS } from "./onboarding/onboarding-motion";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** React tracks input value on the DOM node; set it the way React will see. */
function setControlledValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

const SESSION_USER_ID = "user-b";

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The company list is keyed by account, so it stays disabled until the
  // session is known. Seeding it is how these tests say "signed in as B".
  queryClient.setQueryData(queryKeys.auth.session, {
    session: { id: "session-b", userId: SESSION_USER_ID },
    user: { id: SESSION_USER_ID, name: "B", email: "b@example.com", image: null },
  });
  return { container, root, queryClient };
}

/**
 * Press the first model-source tile.
 *
 * By `aria-checked` rather than by label: the display registry is mocked in this
 * suite, so a tile reads "claude_localSubscription" rather than "Claude Code",
 * and a test that selected on the visible name would be asserting the mock.
 *
 * The connect step arrives with nothing chosen, so this is what opens the input
 * surface and lets the step advance.
 */
async function pickFirstSource(
  click: (match: (text: string) => boolean) => Promise<void>,
): Promise<void> {
  const tile = [...document.body.querySelectorAll("button[aria-checked]")][0];
  const label = tile?.textContent?.trim() ?? "";
  await click((text) => text === label);
}

/**
 * The arc footer's primary button, whatever this step calls it.
 *
 * Step 4 calls it "Connect", because there it starts a sign-in rather than
 * simply advancing; every other arc step calls it "Next". These tests are about
 * what the press does, not what it reads, so they match either — restating the
 * label at twenty call sites would make a copy change look like a behaviour
 * regression. The label itself is pinned once, in the step test that is about
 * the label.
 */
function isArcPrimary(text: string): boolean {
  return text.startsWith("Next") || text.startsWith("Connect");
}

describe("OnboardingWizard restore-gate (stale localStorage across accounts)", () => {
  beforeEach(() => {
    localHealth.get.mockResolvedValue({ deploymentMode: "authenticated" });
    managedApi.checkLocalLogin.mockReset().mockResolvedValue({
      status: "sign_in_required",
      authorizationUrl: "https://claude.ai/oauth/authorize?code=true",
      code: "TEST-CODE",
    });
    managedApi.connectLocal.mockReset().mockResolvedValue({ connectionId: "local-connection", grantId: "local-grant" });
    mockAuthApi.getSession.mockResolvedValue({
      session: { id: "session-b", userId: SESSION_USER_ID },
      user: { id: SESSION_USER_ID, name: "B", email: "b@example.com", image: null },
    });
    mockSecretsApi.list.mockResolvedValue([]);
    mockSecretsApi.listMyUserSecrets.mockResolvedValue([]);
    mockSecretsApi.removeUserSecretDefinition.mockResolvedValue({ ok: true });
    window.localStorage.clear();
    mockDialog.onboardingOpen = true;
    mockDialog.onboardingOptions = {};
    mockDialog.onboardingRouteDismissed = false;
    mockCompany.companies = [];
    mockCompany.loading = false;
    mockCompany.error = null;
    mockCompaniesApi.list.mockResolvedValue([]);
    mockAdapterRegistry.list = [];
    mockAdapterRegistry.disabled = new Set<string>();
    mockAdapterBuild.buildAdapterConfig.mockReset();
    mockAdapterBuild.buildAdapterConfig.mockReturnValue({});
    // Default: no stored Claude login for the owner. The route returns a
    // fixed 404 for a missing value, so the client treats a real `ApiError`
    // with that status as "no stored value" rather than a hard failure.
    mockAgentsApi.getClaudeOAuthTokenStatus.mockReset();
    mockAgentsApi.getClaudeOAuthTokenStatus.mockRejectedValue(
      new ApiError("Not found", 404, null),
    );
    // Default: no active login session for the caller. A resume test
    // overrides this with a resolved session body.
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockReset();
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockRejectedValue(
      new ApiError("Not found", 404, null),
    );
    mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockReset();
    mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockRejectedValue(
      new ApiError("Not found", 404, null),
    );
    // Reset to each mock's original default. `mockResolvedValue` /
    // `mockReturnValue` overrides a mock's implementation permanently — it
    // is not undone by `afterEach`'s `vi.clearAllMocks()`, which only clears
    // call history — so a test that customizes one of these must not leak
    // its override into the next test.
    mockAgentsApi.testEnvironment.mockReset();
    mockAgentsApi.testEnvironment.mockResolvedValue({
      adapterType: "claude_local",
      status: "pass" as const,
      checks: [],
      testedAt: new Date().toISOString(),
    });
    mockAgentsApi.hire.mockReset();
    mockAgentsApi.hire.mockResolvedValue({ agent: { id: "agent-1" }, approval: null });
    mockCompaniesApi.create.mockResolvedValue({
      id: "created",
      name: "Created Co",
      issuePrefix: "CRE",
    });
    mockCompaniesApi.update.mockResolvedValue({
      id: "c1",
      name: "Acme Rockets",
      issuePrefix: "PAP",
    });
    mockGoalsApi.create.mockResolvedValue({ id: "goal-1" });
    mockGoalsApi.list.mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  describe("step 1 leads straight to the agent — there is no mission step 2", () => {
    // One path now: Name your organization → Name your agent → Connect → Get
    // started. The Build / Grow front door and both mission screens are gone,
    // so "Continue" on step 1 creates the organization and lands on the agent
    // step with no mission question in between.

    async function openStepOne() {
      window.localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({ step: 1, companyName: "Initech" }),
      );
      mockDialog.onboardingOptions = {};
      mockCompany.companies = [];
      mockCompany.loading = false;
      mockCompaniesApi.list.mockResolvedValue([]);

      // The model step needs tiles to pick from, and this suite's default
      // registry is empty.
      mockAdapterRegistry.list = [{ type: "claude_local" }, { type: "codex_local" }];
      const { root, queryClient } = render();
      const renderTree = () =>
        act(async () => {
          root.render(
            <QueryClientProvider client={queryClient}>
              <OnboardingWizard />
            </QueryClientProvider>,
          );
        });
      await renderTree();
      await flushReact();
      return { root, renderTree };
    }

    async function clickByText(match: (text: string) => boolean) {
      const el = [...document.body.querySelectorAll("button")].find((b) =>
        match(b.getAttribute("aria-label")?.startsWith("Use ") ? b.getAttribute("aria-label")! : b.textContent?.trim() ?? ""),
      )!;
      await act(async () => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flushReact();
    }

    it("creates the organization on Continue and lands on the agent step, no mission", async () => {
      mockCompaniesApi.create.mockResolvedValue({ id: "company-new", issuePrefix: "INI" });
      const { root } = await openStepOne();
      await clickByText((t) => t.startsWith("Continue"));

      expect(mockCompaniesApi.create).toHaveBeenCalledWith({ name: "Initech" });
      expect(document.body.textContent).toContain("Create your first agent");
      expect(document.body.textContent).not.toContain("Define your mission");
      expect(document.body.textContent).not.toContain("Tell us about your team");

      await act(async () => root.unmount());
    });

    it("shows no environment-check card on the model step, and no Mission row on review", async () => {
      // Round-3 walk feedback: the adapter environment check still runs —
      // Connect probes before hiring and blocks on a fail — but its idle card
      // (explainer plus "Test now") is gone. And the review checklist lost its
      // "Mission" row: onboarding stopped asking, so the row could only ever
      // render unchecked. Both asserted against positive anchors so an
      // unrendered step cannot pass as an absence.
      mockCompaniesApi.create.mockResolvedValue({ id: "company-new", issuePrefix: "INI" });
      const { root } = await openStepOne();
      await clickByText((t) => t.startsWith("Continue"));
      expect(document.body.textContent).toContain("Create your first agent");

      // Step 3 → 4 needs an agent name — the one field the step has now.
      const agentField = document.body.querySelector(
        "#onboarding-agent-name",
      ) as HTMLInputElement;
      await act(async () => {
        setControlledValue(agentField, "Ada");
      });
      await flushReact();
      await clickByText((t) => isArcPrimary(t));

      expect(document.body.textContent).toContain("Connect a model");
      await pickFirstSource(clickByText);
      expect(document.body.textContent).not.toContain("Adapter environment check");
      expect(document.body.textContent).not.toContain("Test now");

      // Through Connect to Review, so the Mission-row assertion runs against
      // the checklist that actually renders it — stopping at the model step
      // would let a Mission regression pass unseen.
      await clickByText((t) => isArcPrimary(t));
      // The review step is the heading and the woken agent, nothing else: the
      // checklist that restated the walk in three rows is gone, and with it
      // the Mission row that could only render unchecked.
      expect(document.body.textContent).toContain("Let's get started...");
      expect(document.body.textContent).toContain("Ada is ready to work!");
      expect(document.body.textContent).not.toContain("Organization name");
      expect(document.body.textContent).not.toContain("Model connected");
      expect(document.body.textContent).not.toContain("Mission");

      await act(async () => root.unmount());
    });

    it("adopts an agent the company already has under that name instead of hiring it twice", async () => {
      // The wizard can reopen on the agent step for a company that just got
      // its first agent — the dashboard's agentless offer on a stale list is
      // one way — with nothing in its state to say the hire happened. The
      // server numbers a repeat name, so without this the walk produced
      // "Ada" and "Ada 2". Same name on the same source is the same agent.
      mockDialog.onboardingOptions = {};
      mockCompany.companies = [];
      mockCompany.loading = false;
      mockCompaniesApi.list.mockResolvedValue([]);
      mockCompaniesApi.create.mockResolvedValue({ id: "company-new", issuePrefix: "INI" });
      mockAgentsApi.list.mockResolvedValueOnce([
        { id: "agent-existing", name: "Ada", adapterType: "claude_local" },
      ]);
      mockAdapterRegistry.list = [{ type: "claude_local" }, { type: "codex_local" }];
      const { root, queryClient } = render();
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <OnboardingWizard />
          </QueryClientProvider>,
        );
      });
      await flushReact();

      const clickText = async (match: (t: string) => boolean) => {
        const el = [...document.body.querySelectorAll("button")].find((b) =>
          match(b.getAttribute("aria-label")?.startsWith("Use ") ? b.getAttribute("aria-label")! : b.textContent?.trim() ?? ""),
        )!;
        await act(async () => {
          el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        await flushReact();
      };

      const nameField = document.body.querySelector(
        "#onboarding-company-name",
      ) as HTMLInputElement | null;
      if (nameField) {
        await act(async () => {
          setControlledValue(nameField, "Initech");
        });
        await flushReact();
      } else {
        const anyName = document.body.querySelector(
          'input[placeholder="e.g. Northwind Labs"]',
        ) as HTMLInputElement;
        await act(async () => {
          setControlledValue(anyName, "Initech");
        });
        await flushReact();
      }
      await clickText((t) => t.startsWith("Continue"));
      const agentField = document.body.querySelector(
        "#onboarding-agent-name",
      ) as HTMLInputElement;
      await act(async () => {
        setControlledValue(agentField, "ada ");
      });
      await flushReact();
      await clickText((t) => isArcPrimary(t));
      await pickFirstSource(clickText);
      await clickText((t) => isArcPrimary(t));

      expect(mockAgentsApi.list).toHaveBeenCalledWith("company-new");
      expect(mockAgentsApi.hire).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("ada is ready to work!");

      await act(async () => root.unmount());
    });

    it("hires from a legacy draft that saved an empty role", async () => {
      // `agentRole: ""` was this field's default before the arc stopped asking
      // for a role, so every draft saved by an earlier build carries it. `??`
      // would pass the empty string straight through to the hire's silent
      // return — the same no-op the default exists to prevent, arriving
      // through a restored draft instead of a fresh one.
      window.localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({ step: 1, companyName: "Initech", agentRole: "" }),
      );
      mockDialog.onboardingOptions = {};
      mockCompany.companies = [];
      mockCompany.loading = false;
      mockCompaniesApi.list.mockResolvedValue([]);
      mockCompaniesApi.create.mockResolvedValue({ id: "company-new", issuePrefix: "INI" });

      // The model step needs tiles to pick from, and this suite's default
      // registry is empty.
      mockAdapterRegistry.list = [{ type: "claude_local" }, { type: "codex_local" }];
      const { root, queryClient } = render();
      const renderTree = () =>
        act(async () => {
          root.render(
            <QueryClientProvider client={queryClient}>
              <OnboardingWizard />
            </QueryClientProvider>,
          );
        });
      await renderTree();
      await flushReact();

      const clickText = async (match: (t: string) => boolean) => {
        const el = [...document.body.querySelectorAll("button")].find((b) =>
          match(b.getAttribute("aria-label")?.startsWith("Use ") ? b.getAttribute("aria-label")! : b.textContent?.trim() ?? ""),
        )!;
        await act(async () => {
          el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        await flushReact();
      };

      await clickText((t) => t.startsWith("Continue"));
      const agentField = document.body.querySelector(
        "#onboarding-agent-name",
      ) as HTMLInputElement;
      await act(async () => {
        setControlledValue(agentField, "Ada");
      });
      await flushReact();
      await clickText((t) => isArcPrimary(t));
      await pickFirstSource(clickText);
      await clickText((t) => isArcPrimary(t));

      expect(mockAgentsApi.hire).toHaveBeenCalled();
      // The mock is declared with no parameters, so index the call rather than
      // destructuring a zero-length tuple type.
      const hireArgs = mockAgentsApi.hire.mock.calls.at(-1) as unknown[];
      expect((hireArgs[1] as { role: string }).role).toBe("general");

      await act(async () => root.unmount());
    });

    it("hires one agent when Connect fires twice in one breath", async () => {
      // The Connect handler re-runs a cached failed probe now that "Test now"
      // is gone — so two overlapping submissions could both pass the fresh
      // probe and both hire. `loading` cannot stop the second caller: it is
      // state, unwritten while the first call is still awaiting. The ref
      // guard must make the second submission a no-op.
      let resolveHire: (v: { agent: { id: string }; approval: null }) => void = () => {};
      mockAgentsApi.hire.mockReturnValue(
        new Promise((resolve) => {
          resolveHire = resolve;
        }),
      );
      mockCompaniesApi.create.mockResolvedValue({ id: "company-new", issuePrefix: "INI" });
      const { root } = await openStepOne();
      await clickByText((t) => t.startsWith("Continue"));
      const agentField = document.body.querySelector(
        "#onboarding-agent-name",
      ) as HTMLInputElement;
      await act(async () => {
        setControlledValue(agentField, "Ada");
      });
      await flushReact();
      await clickByText((t) => isArcPrimary(t));
      expect(document.body.textContent).toContain("Connect a model");
      await pickFirstSource(clickByText);

      const connect = [...document.body.querySelectorAll("button")].find((b) =>
        isArcPrimary(b.textContent?.trim() ?? ""),
      )!;
      await act(async () => {
        connect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        connect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flushReact();
      await act(async () => resolveHire({ agent: { id: "agent-1" }, approval: null }));
      await flushReact();

      expect(mockAgentsApi.hire).toHaveBeenCalledTimes(1);

      await act(async () => root.unmount());
    });

    it("creates one company for one keystroke, modifier or not", async () => {
      // The name field handles Enter itself and does not check for a modifier,
      // so Cmd+Enter in that field reaches the field's handler *and* the
      // wizard's step-level one. Both would start creating. The step-level
      // `loading` guard cannot stop it — `setLoading(true)` has not landed
      // while the same event is still bubbling — so the second caller reads a
      // value the first has not written. Two companies, one keystroke.
      mockCompaniesApi.create.mockResolvedValue({ id: "company-new", issuePrefix: "INI" });
      const { root } = await openStepOne();

      const nameInput = document.body.querySelector(
        'input[placeholder="e.g. Northwind Labs"]',
      ) as HTMLInputElement;
      await act(async () => {
        nameInput.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
        );
      });
      await flushReact();

      expect(mockCompaniesApi.create).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain("Create your first agent");

      await act(async () => root.unmount());
    });

    it("creates one company however many times Enter repeats", async () => {
      // Holding Enter down fires keydown repeatedly. Each one is a separate
      // event, so `defaultPrevented` says nothing about the others, and neither
      // `loading` nor `createdCompanyId` has been written by the time the next
      // arrives — the first is state, the second is not set until the request
      // it guards resolves. Only a ref written before the request goes out is
      // visible to the caller behind it.
      let resolveCreate: (c: { id: string; issuePrefix: string }) => void = () => {};
      mockCompaniesApi.create.mockReturnValue(
        new Promise<{ id: string; issuePrefix: string }>((resolve) => {
          resolveCreate = resolve;
        }),
      );
      const { root } = await openStepOne();

      const nameInput = document.body.querySelector(
        'input[placeholder="e.g. Northwind Labs"]',
      ) as HTMLInputElement;
      await act(async () => {
        for (let i = 0; i < 4; i++) {
          nameInput.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
        }
      });

      expect(mockCompaniesApi.create).toHaveBeenCalledTimes(1);

      await act(async () => resolveCreate({ id: "company-new", issuePrefix: "INI" }));
      await flushReact();
      expect(document.body.textContent).toContain("Create your first agent");

      await act(async () => root.unmount());
    });

    it("sends Back to the screen the run actually came from", async () => {
      // A create run reached the agent step from step 1, so Back owes it step 1 —
      // not the mission screen it never saw.
      mockCompaniesApi.create.mockResolvedValue({ id: "company-new", issuePrefix: "INI" });
      const { root } = await openStepOne();
      await clickByText((t) => t.startsWith("Continue"));
      expect(document.body.textContent).toContain("Create your first agent");

      await clickByText((t) => t.includes("Back"));

      expect(document.body.textContent).toContain("What is the name of your organization?");
      expect(document.body.textContent).not.toContain("Define your mission");

      await act(async () => root.unmount());
    });
  });

  it("re-syncs a restored draft once companies resolve asynchronously (companies start empty/loading)", async () => {
    // Regression for the initializer-only restore bug: the inner wizard's
    // ~20 useState(saved?.x ?? default) initializers only read `saved` on
    // their very first render. useCompany() starts with companies=[] and
    // loading=true and resolves later; if the inner component mounted before
    // that resolution, restoreOnboardingState would see an empty companies
    // list and the whole draft would lock to defaults forever, even after
    // companies arrive. The fix defers mounting the inner wizard until
    // companies settle.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 3,
        companyName: "Saved Co",
        agentName: "Ops Lead",
        createdCompanyId: "c1",
      }),
    );
    mockDialog.onboardingOptions = {};
    mockCompany.companies = [];
    mockCompany.loading = true;
    // Deferred rather than swapped later: the gate's fetch fires on the first
    // render, so replacing the mock afterwards would never reach it.
    let resolveList: (companies: Array<{ id: string; name: string; issuePrefix: string }>) => void =
      () => {};
    mockCompaniesApi.list.mockReturnValue(
      new Promise<Array<{ id: string; name: string; issuePrefix: string }>>((resolve) => {
        resolveList = resolve;
      }),
    );

    const { container, root, queryClient } = render();
    const renderTree = () =>
      act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <OnboardingWizard />
          </QueryClientProvider>,
        );
      });

    await renderTree();
    await flushReact();

    // Nothing mounts yet: no premature guess, and the draft is not touched.
    expect(container.textContent).toBe("");
    expect(document.body.textContent).toBe("");
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).not.toBeNull();

    // Companies resolve asynchronously, owning the saved company.
    mockCompany.companies = [{ id: "c1", name: "Saved Co", issuePrefix: "SC" }];
    mockCompany.loading = false;
    await act(async () => {
      resolveList([{ id: "c1", name: "Saved Co", issuePrefix: "SC" }]);
    });

    await renderTree();
    await flushReact();

    // The draft is restored once companies settle: step 3 (Create your first
    // agent) with the saved agent name in the input, not the defaults
    // (step 0, "Chief of staff").
    expect(document.body.textContent).toContain("Create your first agent");
    const nameInput = document.body.querySelector(
      "#onboarding-agent-name",
    ) as HTMLInputElement | null;
    expect(nameInput?.value).toBe("Ops Lead");
    // The run entered on the agent arc, so the arc strip is the progress
    // indicator and counts 1-3 over the wizard's steps 3-5. Segments are
    // labelled by destination: the wizard has its own numbering, and two
    // controls both announcing "Step 1" would mean different things.
    const currentStep = document.body.querySelector('[aria-current="step"]');
    expect(currentStep?.getAttribute("aria-label")).toBe("Create your first agent");
    expect(document.body.textContent).toContain("Step 1 of 3");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the live wizard mounted while a post-create company-list refetch runs", async () => {
    // The authorization fetch needs to delay the first mount when a draft
    // exists. Once the customer has typed, though, invalidating that query is
    // normal background work. Unmounting for the refetch remounted the wizard
    // from this page-load draft and made a successful create look like a reset.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ step: 1, companyName: "", createdCompanyId: null }),
    );
    let resolveRefetch: (companies: Array<{ id: string; name: string; issuePrefix: string }>) => void =
      () => {};
    mockCompaniesApi.list
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise<Array<{ id: string; name: string; issuePrefix: string }>>((resolve) => {
            resolveRefetch = resolve;
          }),
      );
    mockCompaniesApi.create.mockResolvedValue({
      id: "created",
      name: "Created Co",
      issuePrefix: "CRE",
    });

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    const companyNameInput = document.querySelector("input") as HTMLInputElement;
    setControlledValue(companyNameInput, "Created Co");
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Continue")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    expect(mockCompaniesApi.create).toHaveBeenCalledWith({ name: "Created Co" });
    expect(mockCompaniesApi.list).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#onboarding-agent-name")).not.toBeNull();

    await act(async () => {
      resolveRefetch([{ id: "created", name: "Created Co", issuePrefix: "CRE" }]);
    });
    await act(async () => {
      root.unmount();
    });
  });

  it("restores a draft after its initial ownership check fails and a retry succeeds", async () => {
    // A failed first request cannot authorize the draft, so the wizard opens
    // with safe defaults. The original gate remounted on a later successful
    // retry so the now-verified draft could be restored; keep that recovery
    // while preserving the post-create refetch fix above.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 3,
        companyName: "Saved Co",
        agentName: "Ops Lead",
        createdCompanyId: "c1",
      }),
    );
    const company = { id: "c1", name: "Saved Co", issuePrefix: "SC" };
    let resolveRetry: (companies: Array<{ id: string; name: string; issuePrefix: string }>) => void =
      () => {};
    mockCompaniesApi.list
      .mockRejectedValueOnce(new Error("company list unavailable"))
      .mockImplementationOnce(
        () =>
          new Promise<Array<{ id: string; name: string; issuePrefix: string }>>((resolve) => {
            resolveRetry = resolve;
          }),
      );

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(document.querySelector("#onboarding-agent-name")).toBeNull();

    mockCompany.companies = [company];
    await act(async () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.companies.list(SESSION_USER_ID),
      });
    });
    await flushReact();

    // The retry is intentionally still in flight. The wrapper removes the
    // safe-default wizard so a completed validation can mount the saved draft.
    expect(document.body.textContent).toBe("");

    await act(async () => {
      resolveRetry([company]);
    });
    await flushReact();

    expect(mockCompaniesApi.list).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(queryKeys.companies.list(SESSION_USER_ID))).toEqual({
      companies: [company],
      unauthorized: false,
    });
    const agentNameInput = document.querySelector(
      "#onboarding-agent-name",
    ) as HTMLInputElement | null;
    expect(agentNameInput?.value).toBe("Ops Lead");

    await act(async () => {
      root.unmount();
    });
  });

  it("discards a saved draft for a company the signed-in account does not own, and wipes the stale blob", async () => {
    // The actual vulnerability this fix closes: localStorage is per-origin,
    // not per-account, so a browser that already onboarded "company-old" for
    // a different account hands its id straight to a brand-new session.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 4,
        companyName: "Someone Else's Co",
        createdCompanyId: "company-old",
      }),
    );
    mockCompany.companies = [{ id: "company-new", name: "My Co", issuePrefix: "MC" }];
    mockCompany.loading = false;
    mockCompaniesApi.list.mockResolvedValue([
      { id: "company-new", name: "My Co", issuePrefix: "MC" },
    ]);

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    // Falls back to the wizard's default first step, not the stale step 4
    // draft for a company this account does not own.
    expect(document.body.textContent).not.toContain("Someone Else's Co");
    // The stale blob must not linger to confuse the next onboarding attempt.
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
  it("opens, and keeps the draft, when the initial company query fails", async () => {
    // React Query reports a failed list as `isLoading === false` with `data`
    // defaulted to `[]`, which is indistinguishable from "settled, and this
    // account owns nothing" — the verdict that wipes the blob. Deleting a
    // customer's onboarding because their company request timed out is the one
    // outcome here that cannot be undone.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 3,
        companyName: "Saved Co",
        agentName: "Ops Lead",
        createdCompanyId: "c1",
      }),
    );
    mockCompany.companies = [];
    mockCompany.loading = false;
    mockCompany.error = new Error("company list unavailable");
    mockCompaniesApi.list.mockRejectedValue(new Error("company list unavailable"));

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    // It mounts: the companies query sets `retry: false`, and with no
    // companies the dashboard's "Get Started" button opens onboarding — a gate
    // that rendered nothing here would make that button dead.
    expect(document.querySelector('[data-testid="onboarding-wizard"]')).not.toBeNull();
    // The draft is not restored, because ownership cannot be verified...
    const nameInput = document.body.querySelector(
      "#onboarding-agent-name",
    ) as HTMLInputElement | null;
    expect(nameInput?.value ?? "").not.toBe("Ops Lead");
    // ...and not deleted either. The wizard is open in this harness, so the
    // persist effect does supersede it - the point is that the ownership check
    // did not *discard* it. The closed case below is where it survives intact.
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("renders instead of throwing when the browser denies storage access", async () => {
    // Safari's private mode and blocked third-party contexts make getItem
    // throw outright. This runs during render, so an escaping exception takes
    // the whole app down rather than just losing a draft.
    // A browser that refuses the read refuses the write too, so deny both —
    // otherwise the cleanup effect's removeItem is never exercised.
    const deny = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    // Deny the browser boundary itself. Spying on a Storage object or
    // prototype is not portable: DOM implementations may return a fresh
    // wrapper and Node exposes a separate experimental Storage global.
    const localStorage = vi.spyOn(window, "localStorage", "get").mockImplementation(deny);
    mockCompany.companies = [{ id: "c1", name: "My Co", issuePrefix: "MC" }];
    mockCompany.loading = false;

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(localStorage).toHaveBeenCalled();
    // It mounted: the wizard is open with no draft, rather than the render
    // throwing on the way in.
    expect(document.querySelector('[data-testid="onboarding-wizard"]')).not.toBeNull();

    localStorage.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it("opens but does not restore when a refetch fails over a cached list", async () => {
    // The companies cache is not account-scoped and survives sign-out, so a
    // failed refetch after an account switch can leave the *previous*
    // account's companies in hand. Trusting a non-empty list there would find
    // the old company id in it and hand that draft to the new account — the
    // leak this whole change closes, through a different door.
    //
    // So: mount (no dead end), do not restore, do not delete.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 3,
        companyName: "Saved Co",
        agentName: "Ops Lead",
        createdCompanyId: "c1",
      }),
    );
    mockCompany.companies = [{ id: "c1", name: "Saved Co", issuePrefix: "SC" }];
    mockCompany.loading = false;
    mockCompany.error = new Error("refetch failed");
    mockCompaniesApi.list.mockRejectedValue(new Error("refetch failed"));

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    // Mounted rather than blank...
    expect(document.querySelector('[data-testid="onboarding-wizard"]')).not.toBeNull();
    // ...but the draft was not restored, because the list cannot be trusted.
    const nameInput = document.body.querySelector(
      "#onboarding-agent-name",
    ) as HTMLInputElement | null;
    expect(nameInput?.value ?? "").not.toBe("Ops Lead");

    await act(async () => {
      root.unmount();
    });
  });
  // The close-on-storage-denial case is gone with the control that reached it.
  // Onboarding is a gate now, not a dialog: there is no X, Escape does not
  // dismiss it, and nothing in the wizard calls `handleClose`. A test that
  // clicked Close was asserting a path a customer no longer has.
  //
  // The open side of the same hazard is still covered by "renders instead of
  // throwing when the browser denies storage access" directly above, which is
  // the half that can still happen.
  it("leaves the draft untouched when the company query fails and onboarding is closed", async () => {
    // Mounting is safe for the draft precisely because the persist effect is
    // gated on the wizard being open. A closed wizard writes nothing, so the
    // blob survives for a later load that can actually verify ownership.
    const draft = JSON.stringify({
      step: 3,
      companyName: "Saved Co",
      agentName: "Ops Lead",
      createdCompanyId: "c1",
    });
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, draft);
    mockDialog.onboardingOpen = false;
    mockDialog.onboardingRouteDismissed = true;
    mockCompany.companies = [];
    mockCompany.loading = false;
    mockCompany.error = new Error("company list unavailable");
    mockCompaniesApi.list.mockRejectedValue(new Error("company list unavailable"));

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe(draft);

    await act(async () => {
      root.unmount();
    });
  });
  it("does not hand one account's draft to the next when a refetch fails after a switch", async () => {
    // The attack path in full. Account A onboards and leaves a draft naming
    // its company. The account then changes without this component's company
    // cache being cleared, and the refetch fails, so A's list is still in
    // hand. A list that still contains A's company must not be read as proof
    // that B owns it.
    //
    // `useSignOut` now resets account-scoped caches, which closes the
    // sign-out-button route into this state (see its own regression test). The
    // gate is asserted here independently of that: it must hold for any route
    // that leaves a stale list behind, not only the one that has been fixed.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        // Step 3 so the agent-name input renders and can be asserted on —
        // step 4 has no such field, which would make this pass for the wrong
        // reason whether or not the draft was restored.
        step: 3,
        companyName: "Account A Co",
        agentName: "A's Lead",
        createdCompanyId: "company-a",
      }),
    );
    mockCompany.companies = [{ id: "company-a", name: "Account A Co", issuePrefix: "AAC" }];
    mockCompany.loading = false;
    mockCompany.error = new Error("refetch failed for the new account");
    mockCompaniesApi.list.mockRejectedValue(new Error("refetch failed for the new account"));

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    // Account A's agent name must not appear in account B's wizard.
    expect(document.body.textContent).not.toContain("A's Lead");
    const nameInput = document.body.querySelector(
      "#onboarding-agent-name",
    ) as HTMLInputElement | null;
    expect(nameInput?.value ?? "").not.toBe("A's Lead");

    await act(async () => {
      root.unmount();
    });
  });
  it("does not judge ownership against a warm cache that never refetched", async () => {
    // The door this whole change exists to shut, and the one the previous
    // version missed. `main.tsx` sets `staleTime: 30_000`, so for thirty
    // seconds after a sign-in the company list is served straight from cache
    // with no request — and `Auth.tsx` invalidates on sign-in but invalidation
    // keeps serving the old data while refetching. Either way account A's
    // companies arrive with *no loading state and no error*, so a gate keyed
    // on "not loading, no error" reads them as authoritative.
    //
    // Here the context reports exactly that healthy-looking stale state, and
    // the fetch for this session has not answered. A's draft must not be
    // restored on the strength of A's cached list.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 3,
        companyName: "Account A Co",
        agentName: "A's Lead",
        createdCompanyId: "company-a",
      }),
    );
    // The shared cache still holds A's list, and looks entirely healthy.
    mockCompany.companies = [{ id: "company-a", name: "Account A Co", issuePrefix: "AAC" }];
    mockCompany.loading = false;
    mockCompany.error = null;
    // The list fetched for *this* session answers with B's companies, which
    // do not include A's. Note the fetch must actually complete: leaving it
    // pending would keep the wizard unmounted and the assertion below would
    // hold for the wrong reason.
    mockCompaniesApi.list.mockResolvedValue([
      { id: "company-b", name: "Account B Co", issuePrefix: "BBC" },
    ]);

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    // Mounted — so this is a real observation, not an unmounted false pass.
    expect(document.querySelector('[data-testid="onboarding-wizard"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("A's Lead");
    const nameInput = document.body.querySelector(
      "#onboarding-agent-name",
    ) as HTMLInputElement | null;
    expect(nameInput?.value ?? "").not.toBe("A's Lead");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not delete a draft when the company list comes back unauthorized", async () => {
    // `companiesListQueryOptions` folds 401/403 into
    // `{ companies: [], unauthorized: true }` rather than throwing, so an auth
    // blip arrives as a successful fetch of an empty list — which reads as
    // "this account owns nothing" and would delete the draft.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({ step: 3, companyName: "Saved Co", createdCompanyId: "c1" }),
    );
    mockCompaniesApi.list.mockRejectedValue(
      new ApiError("forbidden", 403, null),
    );

    const { root, queryClient } = render();
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
  it("does not restore against data retained from a failed post-mount refetch", async () => {
    // The gate's weak point if it only asks "was there a fetch after mount,
    // and is there data". React Query keeps the last successful `data` when a
    // refetch fails — so after an account switch the retained value is the
    // *previous* account's list, and accepting it restores their draft.
    window.localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        step: 3,
        companyName: "Account A Co",
        agentName: "A's Lead",
        createdCompanyId: "company-a",
      }),
    );
    const { root, queryClient } = render();
    // A's list, already in the cache from their session.
    queryClient.setQueryData(queryKeys.companies.list(SESSION_USER_ID), {
      companies: [{ id: "company-a", name: "Account A Co", issuePrefix: "AAC" }],
      unauthorized: false,
    });
    // B's session: the refetch fails, so A's data is retained.
    mockCompaniesApi.list.mockRejectedValue(new Error("refetch failed"));

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    // Mounted, so this observes the real thing rather than an empty document.
    expect(document.querySelector('[data-testid="onboarding-wizard"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("A's Lead");
    const nameInput = document.body.querySelector(
      "#onboarding-agent-name",
    ) as HTMLInputElement | null;
    expect(nameInput?.value ?? "").not.toBe("A's Lead");

    await act(async () => {
      root.unmount();
    });
  });
  it("does not mount undecided over a warm cache, which would overwrite the draft", async () => {
    // The customer's own draft, their own companies already cached, and a
    // refetch in flight. `isLoading` is false whenever retained data exists,
    // so a gate keyed on it would mount the wizard while ownership was still
    // undecidable — and with the wizard open, the persist effect writes the
    // wizard's state back on every change, overwriting their draft with
    // defaults before the answer arrives.
    const draft = JSON.stringify({
      step: 3,
      companyName: "Saved Co",
      agentName: "Ops Lead",
      createdCompanyId: "c1",
    });
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, draft);
    const { root, queryClient } = render();
    queryClient.setQueryData(queryKeys.companies.list(SESSION_USER_ID), {
      companies: [{ id: "c1", name: "Saved Co", issuePrefix: "SC" }],
      unauthorized: false,
    });
    mockCompaniesApi.list.mockReturnValue(new Promise(() => {}));

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    // Nothing mounted, so nothing could have written over the draft.
    expect(document.body.textContent).toBe("");
    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe(draft);

    await act(async () => {
      root.unmount();
    });
  });
  it("clears an unreadable draft without waiting on the company endpoint", async () => {
    // Junk is junk whoever owns what, so judging it must not queue behind a
    // request that cannot change the answer — nor issue one at all.
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "{not json");
    const { root, queryClient } = render();
    mockCompaniesApi.list.mockReturnValue(new Promise(() => {}));

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OnboardingWizard />
        </QueryClientProvider>,
      );
    });
    await flushReact();

    expect(window.localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBeNull();
    expect(mockCompaniesApi.list).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  describe("the connect step steers new installs to OMP", () => {
    const OMP_MISSING = {
      adapterType: "omp_local",
      status: "fail" as const,
      checks: [
        { code: "omp_cwd_valid", level: "info" as const, message: "Working directory is valid: /srv" },
        {
          code: "omp_command_unresolvable",
          level: "error" as const,
          message: "The configured OMP command is not executable in this environment.",
        },
      ],
      testedAt: new Date().toISOString(),
    };
    const OMP_INSTALLED = {
      adapterType: "omp_local",
      status: "pass" as const,
      checks: [{ code: "omp_version_ok", level: "info" as const, message: "OMP command is ready: omp/18.9.0" }],
      testedAt: new Date().toISOString(),
    };
    const OMP_MODELS = [
      { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "anthropic" },
      { id: "openai-codex/gpt-5.5", label: "GPT-5.5", provider: "openai-codex" },
    ];
    let ompProbe: typeof OMP_MISSING | typeof OMP_INSTALLED = OMP_INSTALLED;
    let ompModels: typeof OMP_MODELS = OMP_MODELS;

    beforeEach(() => {
      ompProbe = OMP_INSTALLED;
      ompModels = OMP_MODELS;
      mockEnvironmentsApi.list.mockReset();
      mockEnvironmentsApi.list.mockResolvedValue([
        { id: "env-sandbox-1", driver: "sandbox", status: "active", config: { provider: "daytona" }, metadata: {} },
      ]);
      mockEnvironmentsApi.capabilities.mockReset();
      mockEnvironmentsApi.capabilities.mockResolvedValue(
        getEnvironmentCapabilities([], { sandboxProviders: { daytona: { supportsLoginPty: true } } }),
      );
      mockInstanceSettingsApi.get.mockReset();
      mockInstanceSettingsApi.get.mockResolvedValue({ defaultEnvironmentId: "env-sandbox-1" });
      mockAgentsApi.getAdapterAuthSignal.mockReset();
      mockAgentsApi.getAdapterAuthSignal.mockResolvedValue({ status: "present" });
      mockAgentsApi.testEnvironment.mockImplementation((async (_companyId: string, type: string) =>
        type === "omp_local"
          ? ompProbe
          : { adapterType: type, status: "pass", checks: [], testedAt: new Date().toISOString() }) as never);
      mockAgentsApi.adapterModels.mockReset();
      mockAgentsApi.adapterModels.mockImplementation((async (_companyId: string, type: string) =>
        type === "omp_local" ? ompModels : []) as never);
      mockAdapterRegistry.list = [{ type: "claude_local" }, { type: "codex_local" }, { type: "omp_local" }];
    });

    async function openConnectStep(overrides: Record<string, unknown> = {}) {
      mockCompany.companies = [{ id: "company-new", name: "Initech", issuePrefix: "INI" }];
      mockCompany.loading = false;
      mockCompaniesApi.list.mockResolvedValue(mockCompany.companies);
      window.localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({
          step: 4,
          companyName: "Initech",
          agentName: "Ada",
          createdCompanyId: "company-new",
          adapterType: "claude_local",
          ...overrides,
        }),
      );
      mockDialog.onboardingOptions = {};
      const { root, queryClient } = render();
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <OnboardingWizard />
          </QueryClientProvider>,
        );
      });
      for (let i = 0; i < 8; i++) await flushReact();
      expect(document.body.textContent).toContain("Connect a model");
      return { root };
    }

    const ompCard = () => document.body.querySelector<HTMLElement>('[data-testid="omp-setup"]');
    const buttonNamed = (name: string) =>
      [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
    const ompProbeCalls = () =>
      mockAgentsApi.testEnvironment.mock.calls.filter((call) => (call as unknown[])[1] === "omp_local");

    async function click(el: Element) {
      await act(async () => {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      for (let i = 0; i < 8; i++) await flushReact();
    }

    it("offers OMP as the one recommended choice and hides every other adapter behind a disclosure", async () => {
      const { root } = await openConnectStep();

      const card = ompCard();
      expect(card, "the OMP card should lead the step").toBeTruthy();
      expect(card!.textContent).toContain("Recommended");
      expect(card!.textContent).toContain("Paperclip Pro is tuned for OMP");
      expect(card!.querySelector('button[aria-pressed="true"]'), "OMP should be the selected choice").toBeTruthy();
      expect(document.body.querySelectorAll('[role="radio"]').length, "other adapters stay collapsed").toBe(0);
      expect(JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}").adapterType).toBe("omp_local");

      const toggle = buttonNamed("Use another adapter");
      expect(toggle, "the disclosure should be offered").toBeTruthy();
      expect(toggle!.getAttribute("aria-expanded")).toBe("false");
      await click(toggle!);
      expect(toggle!.getAttribute("aria-expanded")).toBe("true");
      const tiles = [...document.body.querySelectorAll('[role="radio"]')].map((t) => t.textContent ?? "");
      expect(tiles.length).toBe(2);
      expect(tiles.some((label) => label.includes("Claude"))).toBe(true);
      expect(tiles.some((label) => label.includes("OpenAI"))).toBe(true);

      await act(async () => root.unmount());
    });

    it("shows the install guide when OMP is missing, and Check again re-detects without leaving the step", async () => {
      ompProbe = OMP_MISSING;
      const { root } = await openConnectStep();

      const guide = document.body.querySelector('[data-testid="omp-setup-install-guide"]');
      expect(guide, "a missing omp should show the install guide").toBeTruthy();
      expect(guide!.textContent).toContain("curl -fsSL https://omp.sh/install | sh");
      expect(guide!.textContent).toContain("bun install -g @oh-my-pi/pi-coding-agent");
      expect(guide!.textContent).toContain("irm https://omp.sh/install.ps1 | iex");
      expect(guide!.textContent).toContain("~/.omp/agent");
      expect(guide!.querySelectorAll('button[aria-label^="Copy command"]').length).toBe(3);
      expect(guide!.querySelector('a[href="https://omp.sh"]')).toBeTruthy();
      expect(buttonNamed("Continue")?.disabled).toBe(true);
      expect(ompProbeCalls()).toHaveLength(1);
      expect((ompProbeCalls()[0] as unknown[])[2]).toEqual({ adapterConfig: {}, environmentId: null });

      ompProbe = OMP_INSTALLED;
      await click(buttonNamed("Check again")!);
      for (let i = 0; i < 6; i++) await flushReact();

      expect(ompProbeCalls()).toHaveLength(2);
      expect(mockAgentsApi.adapterModels).toHaveBeenCalledWith("company-new", "omp_local", {
        environmentId: null,
        refresh: true,
      });
      expect(document.body.querySelector('[data-testid="omp-setup-install-guide"]')).toBeNull();
      expect(document.body.querySelector('[data-testid="omp-setup-installed"]')?.textContent).toContain(
        "OMP 18.9.0 installed",
      );
      expect(document.body.querySelector('[data-testid="omp-setup-model-trigger"]')).toBeTruthy();
      expect(document.body.textContent).toContain("Connect a model");
      expect(mockAgentsApi.hire).not.toHaveBeenCalled();

      await act(async () => root.unmount());
    });

    it("shows the provider guide when OMP is installed but lists no models", async () => {
      ompModels = [];
      const { root } = await openConnectStep();

      const guide = document.body.querySelector('[data-testid="omp-setup-provider-guide"]');
      expect(guide, "an empty model list should show the provider guide").toBeTruthy();
      expect(guide!.textContent).toContain("Configure a provider in OMP");
      expect(guide!.textContent).toContain("omp setup");
      expect(guide!.textContent).toContain("OMP 18.9.0 installed");
      expect(buttonNamed("Check again")).toBeTruthy();
      expect(document.body.querySelector('[data-testid="omp-setup-model-trigger"]')).toBeNull();
      expect(buttonNamed("Continue")?.disabled).toBe(true);

      await act(async () => root.unmount());
    });

    it("keeps Continue disabled until a model is picked, then hires OMP with that model", async () => {
      const user = userEvent.setup();
      const { root } = await openConnectStep();

      expect(buttonNamed("Continue")?.disabled, "no silent default model").toBe(true);
      await act(async () => {
        await user.click(document.body.querySelector('[data-testid="omp-setup-model-trigger"]')!);
      });
      const options = [...document.body.querySelectorAll('[data-testid="omp-setup-model-option"]')];
      expect(options.map((option) => option.getAttribute("data-value"))).toEqual([
        "anthropic/claude-sonnet-4-5",
        "openai-codex/gpt-5.5",
      ]);
      await act(async () => {
        await user.click(options[0]!);
      });
      for (let i = 0; i < 4; i++) await flushReact();
      expect(document.body.querySelector('[data-testid="omp-setup-model-value"]')?.textContent).toContain(
        "Claude Sonnet 4.5",
      );
      expect(buttonNamed("Continue")?.disabled).toBe(false);

      await click(buttonNamed("Continue")!);
      for (let i = 0; i < 6; i++) await flushReact();

      expect(mockAdapterBuild.buildAdapterConfig).toHaveBeenCalledWith(
        expect.objectContaining({ adapterType: "omp_local", model: "anthropic/claude-sonnet-4-5" }),
      );
      expect(mockAgentsApi.hire).toHaveBeenCalledTimes(1);
      const hire = (mockAgentsApi.hire.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      expect(hire.adapterType).toBe("omp_local");
      expect((hire.runtimeConfig as Record<string, unknown>).aiConnection).toBeUndefined();

      await act(async () => root.unmount());
    });

    it("resumes a running sign-in for an adapter picked under 'Use another adapter' after a reload", async () => {
      mockAgentsApi.getAdapterAuthSignal.mockResolvedValue({ status: "absent" });
      mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockResolvedValue({
        sessionId: "claude-session-1",
        environmentId: "env-sandbox-1",
        status: "waiting_for_user",
        expiresAt: null,
        failure: null,
        panelMode: "submitted_browser_code",
        prompt: { authorizationUrl: "https://claude.ai/oauth/authorize?code=true" },
      });
      const { root } = await openConnectStep({ otherAdapterChosen: true });
      for (let i = 0; i < 10; i++) await flushReact();

      expect(JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}").adapterType).toBe("claude_local");
      expect(buttonNamed("Use another adapter")?.getAttribute("aria-expanded")).toBe("true");
      expect(ompCard()!.querySelector('button[aria-pressed="false"]')).toBeTruthy();
      expect(mockAgentsApi.startClaudeSetupTokenLogin).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain("Sign in to Claude then come back and enter authorization code");

      await act(async () => root.unmount());
    });

    it("keeps today's flow for an adapter picked under 'Use another adapter'", async () => {
      const { root } = await openConnectStep();

      await click(buttonNamed("Use another adapter")!);
      const claude = [...document.body.querySelectorAll('[role="radio"]')].find((t) =>
        /Claude/.test(t.textContent ?? ""),
      );
      await click(claude!);
      for (let i = 0; i < 6; i++) await flushReact();

      expect(ompCard()!.querySelector('button[aria-pressed="false"]'), "OMP should step aside").toBeTruthy();
      expect(document.body.querySelector('[data-testid="omp-setup-model-choice"]')).toBeNull();
      const connect = buttonNamed("Connect");
      expect(connect, "the other source keeps its Connect action").toBeTruthy();
      await click(connect!);
      for (let i = 0; i < 6; i++) await flushReact();

      expect(mockAgentsApi.hire).toHaveBeenCalledTimes(1);
      expect(((mockAgentsApi.hire.mock.calls[0] as unknown[])[1] as Record<string, unknown>).adapterType).toBe(
        "claude_local",
      );
      expect(JSON.parse(window.localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? "{}").otherAdapterChosen).toBe(true);
      expect(mockAgentsApi.startClaudeSetupTokenLogin).not.toHaveBeenCalled();

      await act(async () => root.unmount());
    });
  });
});
