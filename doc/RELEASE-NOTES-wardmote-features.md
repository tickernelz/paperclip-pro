# Release notes: Features and Advanced replace Experimental

## What changes

- **Settings > Features** replaces the Experimental page. It holds 24 switches in five groups (Working together, Automation, Integrations, Workspaces, Display), three presets (Minimal: 3, Standard: 8, Everything: 19 finished features), one search box, and "N of 24 on" counts for the page and each group. Each row says what you see when it is on and when it is off.
- **Dependencies are enforced.** Turning on Pipelines turns on Cases, Status cards turns on Summaries, and OpenAI Dot turns on Assistant connections. Turning a requirement off turns its dependents off, in the UI and on the server.
- **Settings > Advanced** holds 11 runtime and developer switches behind a warning, with a "changed" label on rows that differ from the default and one Reset to defaults button. It is reachable from Settings and Search, not from the main navigation.
- **Not finished yet:** Plan before first task, Fast replies, Memory connectors, GitHub review bots, and Plain-English cards show as disabled with that label. They are not part of any preset and cannot be turned on from the UI; an instance that already has one on can turn it off.
- **Isolated workspaces** gains the option "Use for new projects", which is the former `enableIsolatedWorkspacesByDefault` switch. Its stored value is kept.
- **New installs start on the Standard preset** (Decisions, Agent chat, Pixels office, Status cards, Summaries, Cases, Chat channels, Linked objects). Existing installs keep exactly what they have; cloud-managed installs keep their catalog defaults.
- The old URL `/company/settings/instance/experimental` redirects to Features.

## Now permanent

The file viewer, the streamlined shell, the streamlined navigation, Apps, and MCP aggregators are always on. The classic task interface and its screens are removed.

## API compatibility

`GET` and `PATCH /api/instance/settings/experimental` (MCP `paperclipGetInstanceSettingExperimental`, `paperclipUpdateInstanceExperimental`) keep their names and shape, and every switch is still read per request, so no switch needs a restart. For one release these keys are still accepted and returned, but ignored:

| Key | Read as |
| --- | --- |
| `enableExperimentalFileViewer` | `true` |
| `enableStreamlinedLeftNavigation` | `true` |
| `enableStreamlinedUi` | `true` |
| `enableApps` | `true` |
| `enableMcpAggregators` | `true` |
| `enableClassicTaskInterface` | `false` |
| `enableRunnerPreviewIngress` | `false` |
| `enableAiConnectionRouters` | `false` |

## AI connection pools removed

AI connection pools (plugin routers that rotated tasks between accounts) are gone: the pool routes under `/api/companies/:companyId/ai-connection-pools` and their MCP tools (`paperclipListAiConnectionPools`, `paperclipCreateAiConnectionPool`, `paperclipDeleteAiConnectionPool`, `paperclipGetAiConnectionPoolInspection`), the `poolId` filter on adapter models, the pool screens in Apps, and the plugin SDK hook `onRouteAiConnection`.

- An agent that still has a pool binding (`runtimeConfig.aiConnection.mode: "router"`) keeps it. Its runs stop before work with "AI connection pools were removed. Choose an account in the agent settings." Saving a new pool binding is rejected with the same sentence.
- A plugin manifest that still declares `aiConnectionRouter` or the `ai.connections.route` capability installs as before; both are ignored.
- Existing pool connections stay listed in Apps and can be removed there like any other connection.

## Removed in the next release

The eight keys in the table above leave the settings schema, the feature catalog artifact, and the API response. A `PATCH` that still sends one is then stripped without effect, and a managed config (`PAPERCLIP_MANAGED_CONFIG`) that names one fails validation and the server refuses to start, so remove them from scripts and managed configs during this release.

The tables `ai_connection_pools`, `ai_connection_router_cursors`, and `ai_connection_task_pins` are dropped, together with the `aiConnectionRouter` manifest field and the `ai.connections.route` capability that are only tolerated in this release.

## Upgrade

No migration and no data change. Stored values for all 44 keys are read as before; only the eight keys above are pinned.
