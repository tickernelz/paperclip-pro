#!/usr/bin/env python3
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
M = HERE.parent / "measurements"
F = json.loads((M / "features.json").read_text())["entries"]

P = {
  "enableDecisions": ("Features", "Collaboration", "Decisions", "Agents ask you to choose; you answer from one queue.", "Board members who approve agent work.", "Inbox gets a Decisions tab; agents can raise choice cards.", "Tab hides; open cards stay readable in task history.", ""),
  "enableAgentChat": ("Features", "Collaboration", "Agent chat", "Talk to one agent outside a task.", "Anyone who briefs agents ad hoc.", "Chat appears in the navigation.", "Chat leaves the navigation; past chats stay stored.", ""),
  "enableConferenceRoomChat": ("Features", "Collaboration", "Conference room", "Several agents and people in one shared chat.", "Teams running multi-agent discussions.", "Reachable from Search and its URL (I-6: not in the main navigation).", "Room closes for new messages; transcripts stay.", "enableAgentChat"),
  "enablePixelsOffice": ("Features", "Collaboration", "Pixels office", "A visual office view of who is working on what.", "People who like a spatial overview.", "Reachable from Search and its URL (I-6: not in the main navigation).", "View hides; no data involved.", ""),
  "enableStatusCards": ("Features", "Collaboration", "Status cards", "Pinned summaries of a project, refreshed by an agent.", "Leads who want a one-glance status.", "Status cards page and Home tiles appear.", "Cards hide; their history stays.", "enableSummaries"),
  "enableSummaries": ("Features", "Collaboration", "Summaries", "Short agent-written summaries on long tasks.", "Anyone catching up on a long thread.", "Summary block on task and chat headers.", "Block hides; no data lost.", ""),
  "enableCombinedInboxTasks": ("Features", "Collaboration", "Inbox and tasks in one list", "Show your tasks inside the Inbox instead of a separate page.", "People who work mostly from the Inbox.", "Inbox gains a Mine section.", "Back to separate pages.", ""),
  "enablePipelines": ("Features", "Automation", "Pipelines", "Multi-stage work that moves cases through steps.", "Teams with repeatable processes.", "Pipelines tab under Routines.", "Tab hides; pipeline data stays.", "enableCases"),
  "enableCases": ("Features", "Automation", "Cases", "Track external requests as cases agents work on.", "Support and ops teams.", "Cases tab under Routines.", "Tab hides; cases stay stored.", ""),
  "enableIssuePlanDecompositions": ("Features", "Automation", "Plan breakdown", "Agents split a big task into planned sub-tasks.", "Leads delegating large work.", "Plan breakdown action on tasks.", "Action hides; created sub-tasks stay.", ""),
  "enableFirstTaskPlanProposal": ("Features", "Automation", "Plan before first task", "A new agent proposes a plan document before it starts.", "Teams that review approach first.", "First task opens with a plan for approval.", "Agents start directly.", "enableDecisions"),
  "enableBuiltInAgents": ("Features", "Automation", "Built-in agents", "Ready-made agents (reviewer, researcher) you can hire in one click.", "New companies.", "Hire screen offers templates.", "Templates hide; hired agents stay.", ""),
  "enableFastResponses": ("Features", "Automation", "Fast replies", "A quick acknowledgement before the full answer.", "Chat-heavy users.", "Agents post a short receipt first.", "Only full answers.", ""),
  "enableChatConnectors": ("Features", "Integrations", "Chat channels", "Reach agents from WhatsApp, Slack, Telegram and email.", "Anyone away from the desk.", "Connectors list shows chat channels.", "Channels stop receiving; settings kept.", ""),
  "enableMemoryConnectors": ("Features", "Integrations", "Memory connectors", "Give agents a shared long-term memory service.", "Teams with recurring context.", "Memory section in Connectors.", "Agents stop reading memory; stored memory untouched.", ""),
  "enablePublicMcp": ("Features", "Integrations", "Assistant connections", "Let outside assistants (Claude, ChatGPT) work with your tasks over MCP.", "People using another assistant daily.", "Assistant connections in Connectors.", "Outside assistants are disconnected.", ""),
  "enableGitHubReviewBots": ("Features", "Integrations", "GitHub review bots", "Agents review pull requests and reply on GitHub.", "Engineering teams on GitHub.", "Review bot settings in Connectors.", "Bots stop replying.", ""),
  "enableOpenAiDot": ("Features", "Integrations", "OpenAI Dot", "Connect the OpenAI Dot device to your agents.", "Dot owners.", "Dot pairing in Connectors.", "Dot is unpaired.", ""),
  "enableExternalObjects": ("Features", "Integrations", "Linked objects", "Show linked GitHub issues, PRs and docs inside tasks.", "Anyone linking outside work.", "Link previews in tasks.", "Links show as plain URLs.", ""),
  "enableBetaSkills": ("Features", "Integrations", "Preview skills", "Offer skills that are still being tested.", "Early adopters.", "Preview skills listed in Skills.", "Preview skills hidden; installed copies stay.", ""),
  "enableEnvironments": ("Features", "Workspace", "Environments", "Assign machines and secrets to projects and agents.", "Teams with several machines.", "Environments in company settings.", "Assignment controls hide; existing assignments keep working.", ""),
  "enableIsolatedWorkspaces": ("Features", "Workspace", "Isolated workspaces", "Each task gets its own copy of the code (git worktree).", "Teams running many agents on one repo.", "Workspace option on projects.", "New tasks share the project folder.", ""),
  "enableIsolatedWorkspacesByDefault": ("Merge", "Workspace", "Isolated by default", "Becomes the option 'Use for new projects' inside Isolated workspaces.", "", "", "", "enableIsolatedWorkspaces"),
  "enableGoalsSidebarLink": ("Features", "Display", "Goals in navigation", "Show Goals in the main navigation.", "Teams that plan by goals.", "Goals entry appears in Work.", "Goals stays reachable from Search.", ""),
  "enableSimplifiedEnglishInteractions": ("Features", "Display", "Plain-English cards", "Agents write questions and approvals in simpler English.", "Non-native readers.", "New cards use plain wording.", "Default wording.", ""),
  "enableExperimentalFileViewer": ("Permanent", "Display", "File viewer", "Already on; becomes the only viewer.", "", "", "", ""),
  "enableStreamlinedLeftNavigation": ("Permanent", "Display", "Streamlined navigation", "Replaced by the v2 navigation.", "", "", "", ""),
  "enableStreamlinedUi": ("Permanent", "Display", "Streamlined UI", "Already on; v2 styles assume it.", "", "", "", ""),
  "enableApps": ("Permanent", "Integrations", "Apps", "Compatibility key, on everywhere; Connectors replaces it.", "", "", "", ""),
  "enableMcpAggregators": ("Permanent", "Integrations", "MCP aggregators", "Compatibility key, on; part of Connectors.", "", "", "", ""),
  "enableClassicTaskInterface": ("Remove", "Display", "Classic task interface", "Off; only protects the old task screen.", "", "", "", ""),
  "enableRunnerPreviewIngress": ("Remove", "Advanced", "Runner preview ingress", "Deprecated; follows the runner setting already.", "", "", "", "enableNativeRunner"),
  "enableAiConnectionRouters": ("Remove", "Advanced", "AI connection routers", "Chooses harnesses per task; with OMP as the only runtime there is nothing to route. No UI (0 files).", "", "", "", ""),
  "enablePaperclipDeveloperMode": ("Advanced", "Developer", "Developer mode", "Shows raw IDs, payloads and debug actions.", "Developers of Wardmote.", "", "", ""),
  "enableServerInfoDebugView": ("Advanced", "Developer", "Server info", "Shows server start time and running commit in the account menu.", "Operators.", "", "", ""),
  "autoRestartDevServerWhenIdle": ("Advanced", "Developer", "Restart dev server when idle", "In pnpm dev:once, restart after runs finish when the build is stale.", "Developers of Wardmote.", "", "", ""),
  "enableSmokeLab": ("Advanced", "Developer", "Smoke lab", "A page to smoke-test tool connections.", "Operators.", "", "", ""),
  "enableSandboxDuplexBridge": ("Advanced", "Runtime", "Sandbox duplex bridge", "Two-way channel to sandboxed runs.", "Operators of sandboxes.", "", "", "enableManagedSandboxOnly"),
  "enableWorktreeRunExecution": ("Advanced", "Runtime", "Worktree run execution", "Run agents inside per-task worktrees.", "Operators.", "", "", "enableIsolatedWorkspaces"),
  "enableManagedSandboxOnly": ("Advanced", "Runtime", "Managed environments only", "Block runs outside managed environments.", "Operators with a strict policy.", "", "", "enableEnvironments"),
  "enableNativeRunner": ("Advanced", "Runtime", "Native runner (frozen)", "Rust runner; frozen by decision I-4, kept as is.", "Operators.", "", "", ""),
  "enableWorkspaceBranchReconcileForward": ("Advanced", "Runtime", "Branch reconcile forward", "Fast-forward task branches when the base moves.", "Operators.", "", "", ""),
  "enableWorkspaceDirtyQuarantineRepair": ("Advanced", "Runtime", "Dirty workspace repair", "Quarantine and repair workspaces left dirty by a crash.", "Operators.", "", "", ""),
  "enableOwnerInstanceAdmin": ("Advanced", "Runtime", "Owner is instance admin", "Give the company owner instance-admin rights.", "Single-owner installs.", "", "", ""),
}
assert set(P) == set(F), (set(F) - set(P), set(P) - set(F))
rows = []
for k, (dest, group, name, line, who, on, off, dep) in P.items():
    e = F[k]
    ready = bool(e["live"]) or e["uiPagesOrComponents"] >= 2 or dest != "Features"
    rows.append({"key": k, "title": e["title"], "live": e["live"], "default": e["selfHostedDefault"], "dest": dest, "group": group, "name": name, "line": line, "who": who, "on": on, "off": off, "dep": dep, "uiFiles": e["uiFiles"], "serverFiles": e["serverFiles"], "uiPages": e["uiPagesOrComponents"], "ready": ready})
cnt = Counter(r["dest"] for r in rows)
groups = Counter(r["group"] for r in rows if r["dest"] == "Features")
presets = {
  "Minimal": [r["key"] for r in rows if r["dest"] == "Features" and r["key"] in ("enableDecisions", "enableAgentChat", "enableChatConnectors")],
  "Standard": [r["key"] for r in rows if r["dest"] == "Features" and r["live"]],
  "Full": [r["key"] for r in rows if r["dest"] == "Features" and r["ready"]],
}
out = {"rows": rows, "counts": dict(cnt), "featureGroups": dict(groups), "presets": {k: len(v) for k, v in presets.items()}, "presetKeys": presets, "notReady": [r["key"] for r in rows if not r["ready"]], "liveOnByDest": dict(Counter(r["dest"] for r in rows if r["live"]))}
(M / "features-plan.json").write_text(json.dumps(out, indent=1) + "\n")
(HERE / "features-data.js").write_text("const FEATURES = " + json.dumps(rows) + ";\nconst FEATURE_PRESETS = " + json.dumps(presets) + ";\n")
print(json.dumps({k: v for k, v in out.items() if k not in ("rows", "presetKeys")}, indent=1))
