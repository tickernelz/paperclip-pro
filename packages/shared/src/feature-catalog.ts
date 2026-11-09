import { z } from "zod";
import { instanceExperimentalSettingsSchema } from "./validators/instance.js";

type ExperimentalSettings = z.infer<typeof instanceExperimentalSettingsSchema>;

/**
 * The boolean flag keys of the experimental settings schema. Non-flag keys
 * (activation timestamps, numeric tuning values) are excluded.
 */
export type InstanceFeatureKey = {
  [K in keyof ExperimentalSettings]: ExperimentalSettings[K] extends boolean ? K : never;
}[keyof ExperimentalSettings];

export interface FeatureCatalogEntry {
  title: string;
  description: string;
  /** Must match the schema default; enforced by test. */
  selfHostedDefault: boolean;
}

export const INSTANCE_FEATURE_CATALOG: Record<InstanceFeatureKey, FeatureCatalogEntry> = {
  enableEnvironments: {
    title: "Environments",
    description:
      "Show environment management in company settings and allow project and agent environment assignment controls.",
    selfHostedDefault: false,
  },
  enableAiConnectionRouters: {
    title: "AI connection routers",
    description: "Allow experimental plugin connections to choose task-pinned accounts and harnesses.", selfHostedDefault: false,
  },
  enableNativeRunner: {
    title: "Wardmote Runner",
    description:
      "Allow explicitly configured local Codex, OpenCode, and qualified ACPX agents to use the experimental Rust Wardmote Runner, including authenticated sandbox ingress when required. Onboarding remains on legacy adapters.",
    // On by default for self-hosted instances. Requires a Rust toolchain (or
    // PAPERCLIP_RUNNER_BINARY) for `pnpm dev`, which builds runnerd whenever
    // this is on.
    selfHostedDefault: true,
  },
  enableManagedSandboxOnly: {
    title: "Managed Environment Only",
    description:
      "Hide the local environment and run all agents in the platform-managed environment.",
    selfHostedDefault: false,
  },
  enableIsolatedWorkspaces: {
    title: "Isolated Workspaces",
    description:
      "Show execution workspace controls in project configuration and allow isolated workspace behavior for task runs.",
    selfHostedDefault: false,
  },
  enableIsolatedWorkspacesByDefault: {
    title: "Isolated Workspaces By Default",
    description:
      "Treat a project that has no execution workspace policy of its own as if it selected isolated workspaces, so its tasks get a per-task worktree instead of sharing the project checkout. Requires Isolated Workspaces. A project that carries its own policy keeps it.",
    selfHostedDefault: false,
  },
  enableStreamlinedLeftNavigation: {
    title: "Streamlined Left Navigation",
    description: "Use the streamlined main sidebar navigation layout.",
    selfHostedDefault: true,
  },
  enableStreamlinedUi: {
    title: "Streamlined UI",
    description:
      "Use the streamlined application shell, shared task collections, focused task detail layout, contextual navigation, and simplified main sidebar.",
    selfHostedDefault: true,
  },
  enableApps: {
    title: "Apps (compatibility)",
    description:
      "Deprecated compatibility key. Apps is always enabled; stored and managed values are ignored.",
    selfHostedDefault: true,
  },
  enablePublicMcp: {
    title: "Assistant connections (MCP)",
    description: "Let external assistants connect as a person to review work, delegate tasks, add feedback, and follow results.",
    selfHostedDefault: false,
  },
  enableGitHubReviewBots: {
    title: "GitHub review bots",
    description: "Show GitHub review bot setup and management independently of chat connectors. Existing bots keep running when hidden; GitHub tool connections are unaffected.",
    selfHostedDefault: false,
  },
  enableOpenAiDot: {
    title: "OpenAI Dot",
    description: "Add OpenAI Dot as a standalone agent choice with its own experimental opt-in. Requires Assistant connections (MCP) and an authenticated instance with a public HTTPS URL.",
    selfHostedDefault: false,
  },
  enableChatConnectors: {
    title: "Chat connectors",
    description:
      "Show experimental chat connector setup and Board surfaces. Existing connections keep running when hidden; AgentMail, GitHub review bots, and tool connectors are unaffected.",
    selfHostedDefault: false,
  },
  enableMemoryConnectors: {
    title: "Memory connectors",
    description: "Show experimental Mem0, Zep, Supermemory, Cognee, and Honcho setup. Existing connections keep running when hidden.",
    selfHostedDefault: false,
  },
  enableMcpAggregators: {
    title: "MCP aggregators (compatibility)",
    description: "Deprecated compatibility key. MCP aggregators are always enabled; stored and managed values are ignored.",
    selfHostedDefault: true,
  },
  enablePipelines: {
    title: "Pipelines",
    description: "Enable pipeline definitions and pipeline-driven case production surfaces.",
    selfHostedDefault: false,
  },
  enableCases: {
    title: "Cases",
    description:
      "Durable work products that tasks create and iterate on. Adds the Cases tab and the agent case API.",
    selfHostedDefault: false,
  },
  enableAgentChat: {
    title: "Agent Chat",
    description:
      "Persistent task-backed conversations that clarify goals and hand work off to tasks. Chat leads the Work group with an agent rail, and each chat's side panel shows the agent's tasks and artifacts as cards.",
    selfHostedDefault: false,
  },
  enableCombinedInboxTasks: {
    title: "Combined Inbox + Task List",
    description:
      "Inbox becomes a set of views inside Tasks: one Tasks row in the nav carries the unread badge, and a Views menu reaches every inbox and task view.",
    selfHostedDefault: false,
  },
  enableConferenceRoomChat: {
    title: "Conference Room Chat",
    description:
      "Add the Conference Room team chat, the live activity feed, and the redesigned onboarding; restyles task threads as chat bubbles.",
    selfHostedDefault: false,
  },
  enableClassicTaskInterface: {
    title: "Classic Task Interface",
    description:
      "Restore the pre-chat task detail page: the page-level header with inline description editor, the plain comment thread, and the fixed Properties sidebar. Chat-only features (streaming activity folding, inline plan/question cards, the three-mode composer) are unavailable in the classic view.",
    selfHostedDefault: false,
  },
  enableIssuePlanDecompositions: {
    title: "Task Plan Decomposition",
    description: "Show accepted-plan decomposition history on task detail pages.",
    selfHostedDefault: false,
  },
  enableExperimentalFileViewer: {
    title: "Experimental File Viewer",
    description:
      "Show task detail controls for browsing and previewing workspace files relative to a task.",
    selfHostedDefault: false,
  },
  enableStatusCards: {
    title: "Status Cards",
    description:
      "Enable the experimental shared status-card board, update engine, and gated API.",
    selfHostedDefault: false,
  },
  enableExternalObjects: {
    title: "External Objects",
    description:
      "Detect external URLs in issues and show resolved status for pull requests, tickets, and other referenced work objects.",
    selfHostedDefault: false,
  },
  enableSmokeLab: {
    title: "Smoke Lab",
    description:
      "Add the Smoke Lab tab and dashboard card for exercising integration paths against deterministic local fixtures. Private deployments only.",
    selfHostedDefault: false,
  },
  enableBuiltInAgents: {
    title: "Built-in Agents",
    description:
      "Show Wardmote-managed built-in agent surfaces, including roster badges, the Built-in agents tab, and setup controls.",
    selfHostedDefault: false,
  },
  enableBetaSkills: {
    title: "Beta skills",
    description: "Allow agents to pin beta releases of the core paperclip skill.",
    selfHostedDefault: false,
  },
  enableSummaries: {
    title: "Summaries",
    description:
      "Show Summarizer-generated status slots on project and workspace pages, with on-demand refresh and revision history.",
    selfHostedDefault: false,
  },
  enableDecisions: {
    title: "Decisions",
    description:
      "Show the Decisions item in the main sidebar — the attention home that surfaces tasks awaiting input.",
    selfHostedDefault: false,
  },
  enableFastResponses: {
    title: "Experimental fast responses",
    description:
      "Show Connections in company settings and allow short acknowledgements while agents begin work.",
    selfHostedDefault: false,
  },
  enableGoalsSidebarLink: {
    title: "Goals Sidebar Link",
    description: "Restore the Goals item in the main sidebar while the goals surface is being evaluated.",
    selfHostedDefault: false,
  },
  enableSimplifiedEnglishInteractions: {
    title: "Simplified English Interactions",
    description:
      "Instruct agents to write user interactions (confirmations, questions, suggested tasks) in ASD-STE100 Simplified Technical English with brief decision context.",
    selfHostedDefault: false,
  },
  enableServerInfoDebugView: {
    title: "Server Info Debug View",
    description:
      "Show a Server section in the account drawer with the current server restart time and running commit.",
    selfHostedDefault: false,
  },
  enablePaperclipDeveloperMode: {
    title: "Wardmote Developer Mode",
    description:
      "Show internal Wardmote maintainer tools and observability links, including Honeycomb trace queries on run pages.",
    selfHostedDefault: false,
  },
  autoRestartDevServerWhenIdle: {
    title: "Auto-Restart Dev Server When Idle",
    description:
      "In local development, wait for queued and running agent runs to finish, then restart the server automatically when backend changes make the current boot stale.",
    selfHostedDefault: false,
  },
  enableWorkspaceBranchReconcileForward: {
    title: "Workspace Branch Reconcile Forward",
    description:
      "Let execution workspaces reconcile a diverged recorded branch forward instead of failing branch containment.",
    selfHostedDefault: true,
  },
  enableWorkspaceDirtyQuarantineRepair: {
    title: "Workspace Dirty Quarantine Repair",
    description:
      "Let workspace runtime recovery quarantine and repair dirty execution workspaces before runs.",
    selfHostedDefault: true,
  },
  enableOwnerInstanceAdmin: {
    title: "Owner Instance Admin",
    description:
      "On cloud-managed instances, grant the stack owner instance-admin access to their own dedicated instance. Elevation is computed at the trusted-header auth boundary; no instance admin role rows are created. Inert on self-hosted instances.",
    selfHostedDefault: false,
  },
  enableSandboxDuplexBridge: {
    title: "Sandbox Duplex Bridge",
    description:
      "Let a run open the sandbox duplex command-stream bridge when the provider grants the capability. The host reads this per run before it selects the transport. Off keeps the file bridge for every run.",
    selfHostedDefault: false,
  },
  enableRunnerPreviewIngress: {
    title: "Runner Preview Ingress (Deprecated)",
    description:
      "Compatibility-only key retained for older managed configs. Runner ingress follows the Wardmote Runner setting.",
    selfHostedDefault: false,
  },
  enableWorktreeRunExecution: {
    title: "Worktree Run Execution",
    description:
      "Let the scheduler execute runs inside an isolated git-worktree preview instance for tasks created after activation.",
    selfHostedDefault: false,
  },
  enableFirstTaskPlanProposal: {
    title: "First task: propose with a plan document",
    description:
      "When the user's first request is a single task, the chief of staff writes a short plan document and a checkbox card instead of a one-card confirmation. Applies to organizations created after the toggle is flipped.",
    selfHostedDefault: false,
  },
  enablePixelsOffice: {
    title: "Pixels Office",
    description:
      "Show a live pixel-art office floor plan where each agent is a character and each character shows how many tasks that agent is holding.",
    selfHostedDefault: false,
  },
};

export const INSTANCE_FEATURE_KEYS = Object.keys(INSTANCE_FEATURE_CATALOG).sort() as InstanceFeatureKey[];

export const FEATURE_GROUPS = ["collaboration", "automation", "integrations", "workspace", "display"] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export const ADVANCED_GROUPS = ["developer", "runtime"] as const;
export type AdvancedGroup = (typeof ADVANCED_GROUPS)[number];

export const FEATURE_DESTINATIONS = ["features", "advanced", "permanent", "removed", "merged"] as const;
export type FeatureDestination = (typeof FEATURE_DESTINATIONS)[number];

export type FeaturePlacement =
  | {
      destination: "features";
      group: FeatureGroup;
      name: string;
      summary: string;
      whenOn: string;
      whenOff: string;
      requires: readonly InstanceFeatureKey[];
      finished: boolean;
    }
  | {
      destination: "advanced";
      group: AdvancedGroup;
      name: string;
      summary: string;
      requires: readonly InstanceFeatureKey[];
    }
  | { destination: "permanent"; name: string; summary: string }
  | { destination: "removed"; name: string; summary: string }
  | { destination: "merged"; into: InstanceFeatureKey; name: string; summary: string };

export const INSTANCE_FEATURE_PLACEMENT: Record<InstanceFeatureKey, FeaturePlacement> = {
  enableDecisions: {
    destination: "features",
    group: "collaboration",
    name: "Decisions",
    summary: "One place for every task that is waiting on your answer.",
    whenOn: "Decisions appears in the sidebar.",
    whenOff: "The Decisions item hides; questions stay on their tasks.",
    requires: [],
    finished: true,
  },
  enableAgentChat: {
    destination: "features",
    group: "collaboration",
    name: "Agent chat",
    summary: "Talk to each agent in one ongoing conversation next to its tasks and artifacts.",
    whenOn: "Chat leads the Work group with an agent rail.",
    whenOff: "Chat leaves the navigation; conversations are kept and active runs finish.",
    requires: [],
    finished: true,
  },
  enableConferenceRoomChat: {
    destination: "features",
    group: "collaboration",
    name: "Conference room",
    summary: "A shared team chat with a live activity feed, and task threads shown as chat.",
    whenOn: "The team chat and activity feed open; task threads use chat bubbles.",
    whenOff: "The room and feed hide; messages stay stored.",
    requires: [],
    finished: true,
  },
  enablePixelsOffice: {
    destination: "features",
    group: "collaboration",
    name: "Pixels office",
    summary: "A pixel-art office where each agent shows how many tasks it holds.",
    whenOn: "The Pixels office view is available.",
    whenOff: "The view hides; no data is involved.",
    requires: [],
    finished: true,
  },
  enableStatusCards: {
    destination: "features",
    group: "collaboration",
    name: "Status cards",
    summary: "A shared board of status cards that agents keep up to date.",
    whenOn: "The status card board and its API turn on.",
    whenOff: "The board and API turn off; card history stays.",
    requires: ["enableSummaries"],
    finished: true,
  },
  enableSummaries: {
    destination: "features",
    group: "collaboration",
    name: "Summaries",
    summary: "Agent-written status summaries on project and workspace pages.",
    whenOn: "Summary slots appear with refresh and revision history.",
    whenOff: "The slots hide; stored summaries stay.",
    requires: [],
    finished: true,
  },
  enableCombinedInboxTasks: {
    destination: "features",
    group: "collaboration",
    name: "Inbox inside Tasks",
    summary: "Inbox and task lists become views of one Tasks page.",
    whenOn: "One Tasks row carries the unread badge and a Views menu.",
    whenOff: "Inbox and Tasks stay separate pages.",
    requires: [],
    finished: true,
  },
  enablePipelines: {
    destination: "features",
    group: "automation",
    name: "Pipelines",
    summary: "Multi-stage pipelines that produce cases step by step.",
    whenOn: "Pipelines appears in the sidebar.",
    whenOff: "Pipelines hides; definitions stay stored.",
    requires: ["enableCases"],
    finished: true,
  },
  enableCases: {
    destination: "features",
    group: "automation",
    name: "Cases",
    summary: "Durable work products that tasks create and refine.",
    whenOn: "The Cases tab and the agent case API turn on.",
    whenOff: "The tab and API turn off; cases stay stored.",
    requires: [],
    finished: true,
  },
  enableIssuePlanDecompositions: {
    destination: "features",
    group: "automation",
    name: "Plan breakdown history",
    summary: "See how an accepted plan was split into subtasks.",
    whenOn: "Task pages show plan breakdown history.",
    whenOff: "The history hides; created subtasks stay.",
    requires: [],
    finished: true,
  },
  enableFirstTaskPlanProposal: {
    destination: "features",
    group: "automation",
    name: "Plan before first task",
    summary: "For a new company's first single task, the chief of staff proposes a short plan first.",
    whenOn: "The first task opens with a plan document and a checkbox card.",
    whenOff: "The first task asks for one confirmation.",
    requires: [],
    finished: false,
  },
  enableBuiltInAgents: {
    destination: "features",
    group: "automation",
    name: "Built-in agents",
    summary: "Ready-made agents that the app manages for you.",
    whenOn: "The Built-in agents tab, roster badges, and setup controls appear.",
    whenOff: "These surfaces hide; hired agents keep running.",
    requires: [],
    finished: true,
  },
  enableFastResponses: {
    destination: "features",
    group: "automation",
    name: "Fast replies",
    summary: "A short acknowledgement while an agent starts working.",
    whenOn: "Agents may post a short receipt before the full reply.",
    whenOff: "Agents post only full replies.",
    requires: [],
    finished: false,
  },
  enableChatConnectors: {
    destination: "features",
    group: "integrations",
    name: "Chat channels",
    summary: "Reach your agents from chat apps and email.",
    whenOn: "Chat channel setup and Board surfaces appear.",
    whenOff: "Setup hides; existing connections keep running.",
    requires: [],
    finished: true,
  },
  enableMemoryConnectors: {
    destination: "features",
    group: "integrations",
    name: "Memory connectors",
    summary: "Connect agents to Mem0, Zep, Supermemory, Cognee, or Honcho.",
    whenOn: "Memory connector setup appears.",
    whenOff: "Setup hides; existing connections keep running.",
    requires: [],
    finished: false,
  },
  enablePublicMcp: {
    destination: "features",
    group: "integrations",
    name: "Assistant connections",
    summary: "Let outside assistants review work and delegate tasks over MCP.",
    whenOn: "Outside assistants can connect as a person.",
    whenOff: "Outside assistants cannot connect.",
    requires: [],
    finished: true,
  },
  enableGitHubReviewBots: {
    destination: "features",
    group: "integrations",
    name: "GitHub review bots",
    summary: "Set up bots that review pull requests on GitHub.",
    whenOn: "Review bot setup appears.",
    whenOff: "Setup hides; existing bots keep running.",
    requires: [],
    finished: false,
  },
  enableOpenAiDot: {
    destination: "features",
    group: "integrations",
    name: "OpenAI Dot",
    summary: "Offer OpenAI Dot as an agent choice on an instance with a public HTTPS URL.",
    whenOn: "OpenAI Dot appears when you hire an agent.",
    whenOff: "The choice hides.",
    requires: ["enablePublicMcp"],
    finished: true,
  },
  enableExternalObjects: {
    destination: "features",
    group: "integrations",
    name: "Linked objects",
    summary: "Show the live status of pull requests and tickets linked in tasks.",
    whenOn: "Linked URLs show their resolved status.",
    whenOff: "Links show as plain URLs.",
    requires: [],
    finished: true,
  },
  enableBetaSkills: {
    destination: "features",
    group: "integrations",
    name: "Beta skills",
    summary: "Let agents pin beta releases of the core skill.",
    whenOn: "Agents may pin a beta core skill.",
    whenOff: "Agents use the stable core skill.",
    requires: [],
    finished: true,
  },
  enableEnvironments: {
    destination: "features",
    group: "workspace",
    name: "Environments",
    summary: "Manage environments and assign them to projects and agents.",
    whenOn: "Environments appear in company settings.",
    whenOff: "Management hides; existing assignments keep working.",
    requires: [],
    finished: true,
  },
  enableIsolatedWorkspaces: {
    destination: "features",
    group: "workspace",
    name: "Isolated workspaces",
    summary: "Give each task its own git worktree instead of the shared checkout.",
    whenOn: "Workspace controls appear in project settings.",
    whenOff: "Tasks share the project checkout.",
    requires: [],
    finished: true,
  },
  enableGoalsSidebarLink: {
    destination: "features",
    group: "display",
    name: "Goals in sidebar",
    summary: "Show Goals in the main sidebar.",
    whenOn: "Goals appears in the sidebar.",
    whenOff: "Goals stays reachable by its URL.",
    requires: [],
    finished: true,
  },
  enableSimplifiedEnglishInteractions: {
    destination: "features",
    group: "display",
    name: "Plain-English cards",
    summary: "Agents write questions and confirmations in Simplified Technical English.",
    whenOn: "New cards use simplified wording with short decision context.",
    whenOff: "Cards use the default wording.",
    requires: [],
    finished: false,
  },
  enablePaperclipDeveloperMode: {
    destination: "advanced",
    group: "developer",
    name: "Developer mode",
    summary: "Show maintainer tools and observability links, including trace queries on run pages.",
    requires: [],
  },
  enableServerInfoDebugView: {
    destination: "advanced",
    group: "developer",
    name: "Server info",
    summary: "Show a Server section in the account drawer with restart time and running commit.",
    requires: [],
  },
  autoRestartDevServerWhenIdle: {
    destination: "advanced",
    group: "developer",
    name: "Restart dev server when idle",
    summary: "In pnpm dev:once, wait for runs to finish, then restart when the boot is stale.",
    requires: [],
  },
  enableSmokeLab: {
    destination: "advanced",
    group: "developer",
    name: "Smoke lab",
    summary: "Add the Smoke Lab tab and dashboard card for testing integrations against local fixtures.",
    requires: [],
  },
  enableNativeRunner: {
    destination: "advanced",
    group: "runtime",
    name: "Native runner",
    summary: "Allow the Rust runner for configured agents. Frozen: kept as it is.",
    requires: [],
  },
  enableManagedSandboxOnly: {
    destination: "advanced",
    group: "runtime",
    name: "Managed environments only",
    summary: "Hide the local environment and run every agent in the managed environment.",
    requires: [],
  },
  enableSandboxDuplexBridge: {
    destination: "advanced",
    group: "runtime",
    name: "Sandbox duplex bridge",
    summary: "Use the sandbox command-stream bridge when the provider supports it; off keeps the file bridge.",
    requires: [],
  },
  enableWorktreeRunExecution: {
    destination: "advanced",
    group: "runtime",
    name: "Worktree run execution",
    summary: "In a git-worktree preview instance, run tasks created after this is turned on.",
    requires: [],
  },
  enableWorkspaceBranchReconcileForward: {
    destination: "advanced",
    group: "runtime",
    name: "Branch reconcile forward",
    summary: "Move a diverged workspace branch forward instead of failing containment.",
    requires: [],
  },
  enableWorkspaceDirtyQuarantineRepair: {
    destination: "advanced",
    group: "runtime",
    name: "Dirty workspace repair",
    summary: "Quarantine and repair dirty execution workspaces before runs.",
    requires: [],
  },
  enableOwnerInstanceAdmin: {
    destination: "advanced",
    group: "runtime",
    name: "Owner is instance admin",
    summary: "On cloud-managed instances, give the stack owner instance-admin access. No effect when self-hosted.",
    requires: [],
  },
  enableExperimentalFileViewer: {
    destination: "permanent",
    name: "File viewer",
    summary: "Task file browsing is always on.",
  },
  enableStreamlinedLeftNavigation: {
    destination: "permanent",
    name: "Streamlined navigation",
    summary: "The streamlined sidebar is the only navigation.",
  },
  enableStreamlinedUi: {
    destination: "permanent",
    name: "Streamlined interface",
    summary: "The streamlined shell is the only interface.",
  },
  enableApps: {
    destination: "permanent",
    name: "Apps",
    summary: "Apps are always on.",
  },
  enableMcpAggregators: {
    destination: "permanent",
    name: "MCP aggregators",
    summary: "MCP aggregators are always on.",
  },
  enableClassicTaskInterface: {
    destination: "removed",
    name: "Classic task interface",
    summary: "Removed with the classic task screen.",
  },
  enableRunnerPreviewIngress: {
    destination: "removed",
    name: "Runner preview ingress",
    summary: "Removed; runner ingress follows the native runner setting.",
  },
  enableAiConnectionRouters: {
    destination: "removed",
    name: "AI connection routers",
    summary: "Removed; there is one runtime and nothing to route.",
  },
  enableIsolatedWorkspacesByDefault: {
    destination: "merged",
    into: "enableIsolatedWorkspaces",
    name: "Use for new projects",
    summary: "Projects without their own workspace policy get isolated workspaces.",
  },
};

type FeaturePlacementOf<D extends FeatureDestination> = Extract<FeaturePlacement, { destination: D }>;

export function featureKeysWithDestination<D extends FeatureDestination>(destination: D): InstanceFeatureKey[] {
  return (Object.keys(INSTANCE_FEATURE_PLACEMENT) as InstanceFeatureKey[]).filter(
    (key) => INSTANCE_FEATURE_PLACEMENT[key].destination === destination,
  );
}

export function featurePlacement<D extends FeatureDestination>(
  key: InstanceFeatureKey,
  destination: D,
): FeaturePlacementOf<D> | null {
  const placement = INSTANCE_FEATURE_PLACEMENT[key];
  return placement.destination === destination ? (placement as FeaturePlacementOf<D>) : null;
}

export const PERMANENT_FEATURE_KEYS = featureKeysWithDestination("permanent");
export const REMOVED_FEATURE_KEYS = featureKeysWithDestination("removed");

export const FEATURE_PRESET_IDS = ["minimal", "standard", "everything"] as const;
export type FeaturePresetId = (typeof FEATURE_PRESET_IDS)[number];

export const FEATURE_PRESETS: Record<FeaturePresetId, readonly InstanceFeatureKey[]> = {
  minimal: ["enableDecisions", "enableAgentChat", "enableChatConnectors"],
  standard: [
    "enableDecisions",
    "enableAgentChat",
    "enablePixelsOffice",
    "enableStatusCards",
    "enableSummaries",
    "enableCases",
    "enableChatConnectors",
    "enableExternalObjects",
  ],
  everything: featureKeysWithDestination("features").filter(
    (key) => featurePlacement(key, "features")?.finished === true,
  ),
};

export const NEW_INSTALL_FEATURE_DEFAULTS: Partial<Record<InstanceFeatureKey, boolean>> = Object.fromEntries(
  FEATURE_PRESETS.standard.map((key) => [key, true]),
);

export function featurePresetPatch(preset: FeaturePresetId): Partial<Record<InstanceFeatureKey, boolean>> {
  const included = new Set(FEATURE_PRESETS[preset]);
  return Object.fromEntries(
    FEATURE_PRESETS.everything.map((key) => [key, included.has(key)]),
  );
}

export function activeFeaturePreset(
  settings: Partial<Record<InstanceFeatureKey, boolean>>,
): FeaturePresetId | null {
  return (
    FEATURE_PRESET_IDS.find((preset) => {
      const patch = featurePresetPatch(preset);
      return Object.entries(patch).every(([key, on]) => (settings[key as InstanceFeatureKey] === true) === on);
    }) ?? null
  );
}

export function featureRequirements(key: InstanceFeatureKey): readonly InstanceFeatureKey[] {
  const placement: FeaturePlacement | undefined = INSTANCE_FEATURE_PLACEMENT[key];
  return placement?.destination === "features" || placement?.destination === "advanced" ? placement.requires : [];
}

export function featureDependents(key: InstanceFeatureKey): InstanceFeatureKey[] {
  return INSTANCE_FEATURE_KEYS.filter((candidate) => featureRequirements(candidate).includes(key));
}

export function withDependentsDisabled(
  patch: Partial<Record<InstanceFeatureKey, boolean>>,
): Partial<Record<InstanceFeatureKey, boolean>> {
  const result: Partial<Record<InstanceFeatureKey, boolean>> = { ...patch };
  const disable = (key: InstanceFeatureKey) => {
    for (const dependent of featureDependents(key)) {
      if (result[dependent] === false) continue;
      result[dependent] = false;
      disable(dependent);
    }
  };
  for (const [key, value] of Object.entries(patch) as Array<[InstanceFeatureKey, boolean | undefined]>) {
    if (value === false) disable(key);
  }
  return result;
}

export function withRequirementsEnabled(
  patch: Partial<Record<InstanceFeatureKey, boolean>>,
): Partial<Record<InstanceFeatureKey, boolean>> {
  const result: Partial<Record<InstanceFeatureKey, boolean>> = { ...patch };
  const enable = (key: InstanceFeatureKey) => {
    for (const required of featureRequirements(key)) {
      if (result[required] !== undefined) continue;
      result[required] = true;
      enable(required);
    }
  };
  for (const [key, value] of Object.entries(patch) as Array<[InstanceFeatureKey, boolean | undefined]>) {
    if (value === true) enable(key);
  }
  return result;
}

export function withUnmetRequirementsDisabled<T extends Partial<Record<InstanceFeatureKey, boolean>>>(settings: T): T {
  const result = { ...settings };
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of INSTANCE_FEATURE_KEYS) {
      if (result[key] === true && missingFeatureRequirements(key, result).length > 0) {
        (result as Partial<Record<InstanceFeatureKey, boolean>>)[key] = false;
        changed = true;
      }
    }
  }
  return result;
}

export function missingFeatureRequirements(
  key: InstanceFeatureKey,
  settings: Partial<Record<InstanceFeatureKey, boolean>>,
): InstanceFeatureKey[] {
  return featureRequirements(key).filter((required) => settings[required] !== true);
}
