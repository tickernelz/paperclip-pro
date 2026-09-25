<!-- GENERATED FILE — DO NOT EDIT. Run pnpm generate:capability-inventory. -->

# Capability Capability Contract

This generated contract is a self-contained derivative of the Paperclip skill, its seven references, the Paperclip Evals corpus, and the legacy MCP tool surface. It does not import or contact the Paperclip control plane.

The skill/reference inventory and eval cases are the only normative behavior sources. Paperclip does not use the legacy MCP calls as a production capability surface; all MCP names below are traceability aliases folded into normative eval rows. Their disposition, grants, assertions, and evidence contract are inherited from the target row rather than classified independently.

## Baseline Counts

- Skill/reference headings: 157
- Eval cases: 106 across 16 groups
- Total normative rows: 263
- Legacy MCP aliases folded into normative rows: 42

| Eval group | Cases |
| --- | ---: |
| hb | 5 |
| co | 6 |
| st | 8 |
| cm | 6 |
| se | 4 |
| su | 4 |
| bl | 5 |
| dp | 3 |
| ix | 9 |
| ap | 6 |
| ar | 4 |
| er | 9 |
| rf | 22 |
| mh | 4 |
| rs | 3 |
| wk | 8 |

## Regeneration

- `pnpm --dir packages/paperclip-runner generate:capability-inventory` imports the canonical baselines and rewrites every generated file.
- `pnpm --dir packages/paperclip-runner check:capability-inventory` validates counts, uniqueness, normative dispositions, one-to-one MCP folds, required fields, and generated-file drift without requiring the external eval repository.

## Skill / Reference Rows

| Capability | Primary disposition | Source anchor |
| --- | --- | --- |
| skill:skills/paperclip/SKILL.md:paperclip-skill:10 | optional_agent_tool | skills/paperclip/SKILL.md:10 |
| skill:skills/paperclip/SKILL.md:terminology:14 | optional_agent_tool | skills/paperclip/SKILL.md:14 |
| skill:skills/paperclip/SKILL.md:authentication:18 | control_plane_owned | skills/paperclip/SKILL.md:18 |
| skill:skills/paperclip/SKILL.md:paperclip-mcp-tools:30 | optional_agent_tool | skills/paperclip/SKILL.md:30 |
| skill:skills/paperclip/SKILL.md:no-paperclip-tools-in-this-runtime:39 | optional_agent_tool | skills/paperclip/SKILL.md:39 |
| skill:skills/paperclip/SKILL.md:conversation-tasks:60 | optional_agent_tool | skills/paperclip/SKILL.md:60 |
| skill:skills/paperclip/SKILL.md:server-verified-external-chat-turns:77 | control_plane_owned | skills/paperclip/SKILL.md:77 |
| skill:skills/paperclip/SKILL.md:the-heartbeat-procedure:117 | optional_agent_tool | skills/paperclip/SKILL.md:117 |
| skill:skills/paperclip/SKILL.md:generated-artifacts-and-work-products:187 | always_agent_tool | skills/paperclip/SKILL.md:187 |
| skill:skills/paperclip/SKILL.md:status-quick-guide:222 | control_plane_owned | skills/paperclip/SKILL.md:222 |
| skill:skills/paperclip/SKILL.md:monitors-and-watchers-say-only-what-you-actually-scheduled:232 | optional_agent_tool | skills/paperclip/SKILL.md:232 |
| skill:skills/paperclip/SKILL.md:delegating-review-tasks:245 | always_agent_tool | skills/paperclip/SKILL.md:245 |
| skill:skills/paperclip/SKILL.md:managing-a-user-s-inbox:256 | control_plane_owned | skills/paperclip/SKILL.md:256 |
| skill:skills/paperclip/SKILL.md:issue-dependencies-blockers:264 | control_plane_owned | skills/paperclip/SKILL.md:264 |
| skill:skills/paperclip/SKILL.md:requesting-board-approval:281 | optional_agent_tool | skills/paperclip/SKILL.md:281 |
| skill:skills/paperclip/SKILL.md:issue-thread-interactions:301 | optional_agent_tool | skills/paperclip/SKILL.md:301 |
| skill:skills/paperclip/SKILL.md:standalone-decisions:330 | optional_agent_tool | skills/paperclip/SKILL.md:330 |
| skill:skills/paperclip/SKILL.md:mcp-tool-approval-gates:432 | optional_agent_tool | skills/paperclip/SKILL.md:432 |
| skill:skills/paperclip/SKILL.md:niche-workflow-pointers:473 | optional_agent_tool | skills/paperclip/SKILL.md:473 |
| skill:skills/paperclip/SKILL.md:cases:483 | optional_agent_tool | skills/paperclip/SKILL.md:483 |
| skill:skills/paperclip/SKILL.md:company-skills-workflow:489 | optional_agent_tool | skills/paperclip/SKILL.md:489 |
| skill:skills/paperclip/SKILL.md:routines:500 | optional_agent_tool | skills/paperclip/SKILL.md:500 |
| skill:skills/paperclip/SKILL.md:issue-workspace-runtime-controls:511 | optional_agent_tool | skills/paperclip/SKILL.md:511 |
| skill:skills/paperclip/SKILL.md:proposing-credentials-safely:518 | optional_agent_tool | skills/paperclip/SKILL.md:518 |
| skill:skills/paperclip/SKILL.md:reading-granted-secrets:525 | optional_agent_tool | skills/paperclip/SKILL.md:525 |
| skill:skills/paperclip/SKILL.md:critical-rules:539 | optional_agent_tool | skills/paperclip/SKILL.md:539 |
| skill:skills/paperclip/SKILL.md:comment-style-required:563 | always_agent_tool | skills/paperclip/SKILL.md:563 |
| skill:skills/paperclip/SKILL.md:update:595 | optional_agent_tool | skills/paperclip/SKILL.md:595 |
| skill:skills/paperclip/SKILL.md:planning-required-when-planning-requested:605 | optional_agent_tool | skills/paperclip/SKILL.md:605 |
| skill:skills/paperclip/SKILL.md:key-endpoints-hot-routes:637 | optional_agent_tool | skills/paperclip/SKILL.md:637 |
| skill:skills/paperclip/SKILL.md:searching-issues:669 | optional_agent_tool | skills/paperclip/SKILL.md:669 |
| skill:skills/paperclip/SKILL.md:full-reference:675 | optional_agent_tool | skills/paperclip/SKILL.md:675 |
| skill:skills/paperclip/references/artifacts.md:generated-artifacts-and-work-products:1 | always_agent_tool | skills/paperclip/references/artifacts.md:1 |
| skill:skills/paperclip/references/artifacts.md:inspect-what-is-already-on-the-issue:17 | optional_agent_tool | skills/paperclip/references/artifacts.md:17 |
| skill:skills/paperclip/references/artifacts.md:record-the-work-product:23 | always_agent_tool | skills/paperclip/references/artifacts.md:23 |
| skill:skills/paperclip/references/artifacts.md:workspace-only-file-references:48 | optional_agent_tool | skills/paperclip/references/artifacts.md:48 |
| skill:skills/paperclip/references/artifacts.md:external-chat-responses:95 | optional_agent_tool | skills/paperclip/references/artifacts.md:95 |
| skill:skills/paperclip/references/cases.md:cases:1 | optional_agent_tool | skills/paperclip/references/cases.md:1 |
| skill:skills/paperclip/references/cases.md:core-model:17 | optional_agent_tool | skills/paperclip/references/cases.md:17 |
| skill:skills/paperclip/references/cases.md:upsert-semantics:34 | optional_agent_tool | skills/paperclip/references/cases.md:34 |
| skill:skills/paperclip/references/cases.md:read-and-search:69 | optional_agent_tool | skills/paperclip/references/cases.md:69 |
| skill:skills/paperclip/references/cases.md:documents:93 | always_agent_tool | skills/paperclip/references/cases.md:93 |
| skill:skills/paperclip/references/cases.md:fields:124 | optional_agent_tool | skills/paperclip/references/cases.md:124 |
| skill:skills/paperclip/references/cases.md:issue-links:155 | optional_agent_tool | skills/paperclip/references/cases.md:155 |
| skill:skills/paperclip/references/cases.md:child-cases:178 | optional_agent_tool | skills/paperclip/references/cases.md:178 |
| skill:skills/paperclip/references/cases.md:attachments:198 | optional_agent_tool | skills/paperclip/references/cases.md:198 |
| skill:skills/paperclip/references/cases.md:lifecycle:206 | optional_agent_tool | skills/paperclip/references/cases.md:206 |
| skill:skills/paperclip/references/cases.md:worked-blog-post-example:220 | optional_agent_tool | skills/paperclip/references/cases.md:220 |
| skill:skills/paperclip/references/company-skills.md:company-skills-workflow:1 | optional_agent_tool | skills/paperclip/references/company-skills.md:1 |
| skill:skills/paperclip/references/company-skills.md:what-exists:7 | optional_agent_tool | skills/paperclip/references/company-skills.md:7 |
| skill:skills/paperclip/references/company-skills.md:permission-model:24 | optional_agent_tool | skills/paperclip/references/company-skills.md:24 |
| skill:skills/paperclip/references/company-skills.md:tools:31 | optional_agent_tool | skills/paperclip/references/company-skills.md:31 |
| skill:skills/paperclip/references/company-skills.md:install-a-skill-into-the-company:58 | optional_agent_tool | skills/paperclip/references/company-skills.md:58 |
| skill:skills/paperclip/references/company-skills.md:app-shipped-catalog:68 | optional_agent_tool | skills/paperclip/references/company-skills.md:68 |
| skill:skills/paperclip/references/company-skills.md:external-source-import:88 | optional_agent_tool | skills/paperclip/references/company-skills.md:88 |
| skill:skills/paperclip/references/company-skills.md:source-types-in-order-of-preference:92 | optional_agent_tool | skills/paperclip/references/company-skills.md:92 |
| skill:skills/paperclip/references/company-skills.md:example-skills-sh-import-preferred:103 | optional_agent_tool | skills/paperclip/references/company-skills.md:103 |
| skill:skills/paperclip/references/company-skills.md:example-github-import:117 | optional_agent_tool | skills/paperclip/references/company-skills.md:117 |
| skill:skills/paperclip/references/company-skills.md:inspect-what-was-installed:131 | optional_agent_tool | skills/paperclip/references/company-skills.md:131 |
| skill:skills/paperclip/references/company-skills.md:assign-skills-to-an-existing-agent:137 | optional_agent_tool | skills/paperclip/references/company-skills.md:137 |
| skill:skills/paperclip/references/company-skills.md:include-skills-during-hire-or-create:164 | optional_agent_tool | skills/paperclip/references/company-skills.md:164 |
| skill:skills/paperclip/references/company-skills.md:notes:180 | optional_agent_tool | skills/paperclip/references/company-skills.md:180 |
| skill:skills/paperclip/references/issue-workspaces.md:issue-workspace-runtime-controls:1 | optional_agent_tool | skills/paperclip/references/issue-workspaces.md:1 |
| skill:skills/paperclip/references/issue-workspaces.md:discover-the-workspace:7 | optional_agent_tool | skills/paperclip/references/issue-workspaces.md:7 |
| skill:skills/paperclip/references/issue-workspaces.md:control-services:24 | optional_agent_tool | skills/paperclip/references/issue-workspaces.md:24 |
| skill:skills/paperclip/references/issue-workspaces.md:read-the-url:46 | optional_agent_tool | skills/paperclip/references/issue-workspaces.md:46 |
| skill:skills/paperclip/references/issue-workspaces.md:workspace-scoped-read:63 | control_plane_owned | skills/paperclip/references/issue-workspaces.md:63 |
| skill:skills/paperclip/references/routines.md:paperclip-routines:1 | optional_agent_tool | skills/paperclip/references/routines.md:1 |
| skill:skills/paperclip/references/routines.md:lifecycle:18 | optional_agent_tool | skills/paperclip/references/routines.md:18 |
| skill:skills/paperclip/references/routines.md:creating-a-routine:29 | optional_agent_tool | skills/paperclip/references/routines.md:29 |
| skill:skills/paperclip/references/routines.md:concurrency-policies:69 | optional_agent_tool | skills/paperclip/references/routines.md:69 |
| skill:skills/paperclip/references/routines.md:catch-up-policies:81 | optional_agent_tool | skills/paperclip/references/routines.md:81 |
| skill:skills/paperclip/references/routines.md:activity-gated-scheduled-runs:92 | optional_agent_tool | skills/paperclip/references/routines.md:92 |
| skill:skills/paperclip/references/routines.md:example-skip-quiet-nights:112 | optional_agent_tool | skills/paperclip/references/routines.md:112 |
| skill:skills/paperclip/references/routines.md:adding-triggers:131 | optional_agent_tool | skills/paperclip/references/routines.md:131 |
| skill:skills/paperclip/references/routines.md:schedule-cron:137 | optional_agent_tool | skills/paperclip/references/routines.md:137 |
| skill:skills/paperclip/references/routines.md:webhook:154 | optional_agent_tool | skills/paperclip/references/routines.md:154 |
| skill:skills/paperclip/references/routines.md:api-manual-only:174 | optional_agent_tool | skills/paperclip/references/routines.md:174 |
| skill:skills/paperclip/references/routines.md:updating-and-deleting-triggers:187 | optional_agent_tool | skills/paperclip/references/routines.md:187 |
| skill:skills/paperclip/references/routines.md:manual-run:205 | optional_agent_tool | skills/paperclip/references/routines.md:205 |
| skill:skills/paperclip/references/routines.md:updating-a-routine:223 | optional_agent_tool | skills/paperclip/references/routines.md:223 |
| skill:skills/paperclip/references/routines.md:reading-routines-and-runs:233 | optional_agent_tool | skills/paperclip/references/routines.md:233 |
| skill:skills/paperclip/references/workflows.md:paperclip-workflow-playbooks:1 | optional_agent_tool | skills/paperclip/references/workflows.md:1 |
| skill:skills/paperclip/references/workflows.md:project-setup-ceo-manager:9 | optional_agent_tool | skills/paperclip/references/workflows.md:9 |
| skill:skills/paperclip/references/workflows.md:openclaw-invite-ceo:24 | optional_agent_tool | skills/paperclip/references/workflows.md:24 |
| skill:skills/paperclip/references/workflows.md:setting-agent-instructions-path:47 | optional_agent_tool | skills/paperclip/references/workflows.md:47 |
| skill:skills/paperclip/references/workflows.md:company-import-export:76 | optional_agent_tool | skills/paperclip/references/workflows.md:76 |
| skill:skills/paperclip/references/workflows.md:self-test-playbook-app-level:100 | optional_agent_tool | skills/paperclip/references/workflows.md:100 |
| skill:skills/paperclip/references/api-reference.md:paperclip-api-reference:1 | optional_agent_tool | skills/paperclip/references/api-reference.md:1 |
| skill:skills/paperclip/references/api-reference.md:response-schemas:9 | optional_agent_tool | skills/paperclip/references/api-reference.md:9 |
| skill:skills/paperclip/references/api-reference.md:agent-record-paperclipme-paperclipgetagent:11 | optional_agent_tool | skills/paperclip/references/api-reference.md:11 |
| skill:skills/paperclip/references/api-reference.md:company-portability:44 | optional_agent_tool | skills/paperclip/references/api-reference.md:44 |
| skill:skills/paperclip/references/api-reference.md:issue-with-ancestors-paperclipgetissue:108 | optional_agent_tool | skills/paperclip/references/api-reference.md:108 |
| skill:skills/paperclip/references/api-reference.md:issue-update-response-paperclipupdateissue:194 | optional_agent_tool | skills/paperclip/references/api-reference.md:194 |
| skill:skills/paperclip/references/api-reference.md:blocker-diagnostics-papercliplistissuediagnosticblockers-extended:222 | control_plane_owned | skills/paperclip/references/api-reference.md:222 |
| skill:skills/paperclip/references/api-reference.md:wake-diagnostics-papercliplistissuediagnosticwakes-extended:261 | control_plane_owned | skills/paperclip/references/api-reference.md:261 |
| skill:skills/paperclip/references/api-reference.md:subtree-diagnostics-paperclipgetissuediagnosticsubtree-extended:305 | optional_agent_tool | skills/paperclip/references/api-reference.md:305 |
| skill:skills/paperclip/references/api-reference.md:execution-policy-fields-on-an-issue:353 | optional_agent_tool | skills/paperclip/references/api-reference.md:353 |
| skill:skills/paperclip/references/api-reference.md:cross-agent-review-gates:405 | always_agent_tool | skills/paperclip/references/api-reference.md:405 |
| skill:skills/paperclip/references/api-reference.md:worked-example-ic-heartbeat:442 | optional_agent_tool | skills/paperclip/references/api-reference.md:442 |
| skill:skills/paperclip/references/api-reference.md:1-identity-skip-if-already-in-context:447 | control_plane_owned | skills/paperclip/references/api-reference.md:447 |
| skill:skills/paperclip/references/api-reference.md:2-check-inbox:451 | control_plane_owned | skills/paperclip/references/api-reference.md:451 |
| skill:skills/paperclip/references/api-reference.md:3-already-have-issue-101-inprogress-highest-priority-continue-it:458 | optional_agent_tool | skills/paperclip/references/api-reference.md:458 |
| skill:skills/paperclip/references/api-reference.md:4-do-the-actual-work-write-code-run-tests:465 | optional_agent_tool | skills/paperclip/references/api-reference.md:465 |
| skill:skills/paperclip/references/api-reference.md:5-work-is-done-update-status-and-comment-in-one-call:467 | always_agent_tool | skills/paperclip/references/api-reference.md:467 |
| skill:skills/paperclip/references/api-reference.md:6-still-have-time-checkout-the-next-task:470 | control_plane_owned | skills/paperclip/references/api-reference.md:470 |
| skill:skills/paperclip/references/api-reference.md:7-made-partial-progress-not-done-yet-comment-and-exit:476 | always_agent_tool | skills/paperclip/references/api-reference.md:476 |
| skill:skills/paperclip/references/api-reference.md:worked-example-report-a-board-user-s-mine-inbox:480 | control_plane_owned | skills/paperclip/references/api-reference.md:480 |
| skill:skills/paperclip/references/api-reference.md:board-user-created-the-requesting-issue:485 | optional_agent_tool | skills/paperclip/references/api-reference.md:485 |
| skill:skills/paperclip/references/api-reference.md:fetch-the-board-user-s-mine-inbox-issues:489 | control_plane_owned | skills/paperclip/references/api-reference.md:489 |
| skill:skills/paperclip/references/api-reference.md:summarize-it-back-to-the-board-in-a-comment-or-document:503 | always_agent_tool | skills/paperclip/references/api-reference.md:503 |
| skill:skills/paperclip/references/api-reference.md:worked-example-archive-a-resolved-inbox-item:507 | control_plane_owned | skills/paperclip/references/api-reference.md:507 |
| skill:skills/paperclip/references/api-reference.md:the-responsible-user-s-id-is-resolved-from-the-authenticated-agent-run:514 | optional_agent_tool | skills/paperclip/references/api-reference.md:514 |
| skill:skills/paperclip/references/api-reference.md:reverse-the-archive-if-it-was-premature-or-no-longer-desired:522 | optional_agent_tool | skills/paperclip/references/api-reference.md:522 |
| skill:skills/paperclip/references/api-reference.md:worked-example-reviewer-approver-heartbeat:531 | always_agent_tool | skills/paperclip/references/api-reference.md:531 |
| skill:skills/paperclip/references/api-reference.md:worked-example-manager-heartbeat:568 | optional_agent_tool | skills/paperclip/references/api-reference.md:568 |
| skill:skills/paperclip/references/api-reference.md:1-identity-skip-if-already-in-context:571 | control_plane_owned | skills/paperclip/references/api-reference.md:571 |
| skill:skills/paperclip/references/api-reference.md:2-check-team-status:575 | optional_agent_tool | skills/paperclip/references/api-reference.md:575 |
| skill:skills/paperclip/references/api-reference.md:3-agent-42-is-blocked-read-comments:582 | control_plane_owned | skills/paperclip/references/api-reference.md:582 |
| skill:skills/paperclip/references/api-reference.md:4-unblock-reassign-and-comment:586 | control_plane_owned | skills/paperclip/references/api-reference.md:586 |
| skill:skills/paperclip/references/api-reference.md:5-check-own-assignments:589 | optional_agent_tool | skills/paperclip/references/api-reference.md:589 |
| skill:skills/paperclip/references/api-reference.md:6-create-subtasks-and-delegate:595 | optional_agent_tool | skills/paperclip/references/api-reference.md:595 |
| skill:skills/paperclip/references/api-reference.md:load-tests-depend-on-caching-layer-being-done-first-paperclip-will-auto-wake-agent-55-when-the-blocker-resolves:599 | control_plane_owned | skills/paperclip/references/api-reference.md:599 |
| skill:skills/paperclip/references/api-reference.md:7-dashboard-for-health-check:603 | optional_agent_tool | skills/paperclip/references/api-reference.md:603 |
| skill:skills/paperclip/references/api-reference.md:comments-and-mentions:609 | always_agent_tool | skills/paperclip/references/api-reference.md:609 |
| skill:skills/paperclip/references/api-reference.md:update:616 | optional_agent_tool | skills/paperclip/references/api-reference.md:616 |
| skill:skills/paperclip/references/api-reference.md:cross-team-work-and-delegation:653 | optional_agent_tool | skills/paperclip/references/api-reference.md:653 |
| skill:skills/paperclip/references/api-reference.md:receiving-cross-team-work:657 | optional_agent_tool | skills/paperclip/references/api-reference.md:657 |
| skill:skills/paperclip/references/api-reference.md:escalation:667 | optional_agent_tool | skills/paperclip/references/api-reference.md:667 |
| skill:skills/paperclip/references/api-reference.md:company-context:677 | optional_agent_tool | skills/paperclip/references/api-reference.md:677 |
| skill:skills/paperclip/references/api-reference.md:company-branding-ceo-board:689 | optional_agent_tool | skills/paperclip/references/api-reference.md:689 |
| skill:skills/paperclip/references/api-reference.md:openclaw-invite-prompt-ceo:709 | optional_agent_tool | skills/paperclip/references/api-reference.md:709 |
| skill:skills/paperclip/references/api-reference.md:setting-agent-instructions-path:727 | optional_agent_tool | skills/paperclip/references/api-reference.md:727 |
| skill:skills/paperclip/references/api-reference.md:project-setup-create-workspace:760 | optional_agent_tool | skills/paperclip/references/api-reference.md:760 |
| skill:skills/paperclip/references/api-reference.md:option-a-one-call-create-with-workspace:783 | optional_agent_tool | skills/paperclip/references/api-reference.md:783 |
| skill:skills/paperclip/references/api-reference.md:option-b-two-calls-project-first-then-workspace:805 | optional_agent_tool | skills/paperclip/references/api-reference.md:805 |
| skill:skills/paperclip/references/api-reference.md:governance-and-approvals:839 | optional_agent_tool | skills/paperclip/references/api-reference.md:839 |
| skill:skills/paperclip/references/api-reference.md:requesting-a-hire-management-only:843 | optional_agent_tool | skills/paperclip/references/api-reference.md:843 |
| skill:skills/paperclip/references/api-reference.md:ceo-strategy-approval:906 | optional_agent_tool | skills/paperclip/references/api-reference.md:906 |
| skill:skills/paperclip/references/api-reference.md:questions-and-waiting-for-human-input:916 | always_agent_tool | skills/paperclip/references/api-reference.md:916 |
| skill:skills/paperclip/references/api-reference.md:issue-thread-confirmations:1019 | always_agent_tool | skills/paperclip/references/api-reference.md:1019 |
| skill:skills/paperclip/references/api-reference.md:checkbox-confirmations:1078 | always_agent_tool | skills/paperclip/references/api-reference.md:1078 |
| skill:skills/paperclip/references/api-reference.md:item-verdict-requests:1190 | optional_agent_tool | skills/paperclip/references/api-reference.md:1190 |
| skill:skills/paperclip/references/api-reference.md:checking-approval-status:1300 | optional_agent_tool | skills/paperclip/references/api-reference.md:1300 |
| skill:skills/paperclip/references/api-reference.md:approval-follow-up-requesting-agent:1304 | always_agent_tool | skills/paperclip/references/api-reference.md:1304 |
| skill:skills/paperclip/references/api-reference.md:issue-lifecycle:1317 | always_agent_tool | skills/paperclip/references/api-reference.md:1317 |
| skill:skills/paperclip/references/api-reference.md:error-handling:1347 | control_plane_owned | skills/paperclip/references/api-reference.md:1347 |
| skill:skills/paperclip/references/api-reference.md:full-tool-reference:1362 | optional_agent_tool | skills/paperclip/references/api-reference.md:1362 |
| skill:skills/paperclip/references/api-reference.md:agents:1366 | optional_agent_tool | skills/paperclip/references/api-reference.md:1366 |
| skill:skills/paperclip/references/api-reference.md:issues-tasks:1389 | optional_agent_tool | skills/paperclip/references/api-reference.md:1389 |
| skill:skills/paperclip/references/api-reference.md:companies-projects-goals:1442 | optional_agent_tool | skills/paperclip/references/api-reference.md:1442 |
| skill:skills/paperclip/references/api-reference.md:routines:1466 | optional_agent_tool | skills/paperclip/references/api-reference.md:1466 |
| skill:skills/paperclip/references/api-reference.md:approvals-costs-activity-dashboard:1484 | optional_agent_tool | skills/paperclip/references/api-reference.md:1484 |
| skill:skills/paperclip/references/api-reference.md:secrets:1503 | optional_agent_tool | skills/paperclip/references/api-reference.md:1503 |
| skill:skills/paperclip/references/api-reference.md:agent-secret-proposals:1518 | optional_agent_tool | skills/paperclip/references/api-reference.md:1518 |
| skill:skills/paperclip/references/api-reference.md:agent-secret-access:1584 | optional_agent_tool | skills/paperclip/references/api-reference.md:1584 |
| skill:skills/paperclip/references/api-reference.md:common-mistakes:1624 | optional_agent_tool | skills/paperclip/references/api-reference.md:1624 |

## Legacy MCP Alias Index

This is a compatibility/traceability index, not a tool catalog. “Inherited disposition” is shown only to make the normative target easy to audit.

| Legacy MCP name | Folded into normative row | Inherited disposition | Source anchor |
| --- | --- | --- | --- |
| paperclipMe | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts:387 |
| paperclipInboxLite | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts:393 |
| paperclipListAgents | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:399 |
| paperclipListSkills | eval:rf-cskill-audit-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:405 |
| paperclipGetAgent | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:411 |
| paperclipListIssues | eval:se-q-filters-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:420 |
| paperclipGetIssue | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:435 |
| paperclipGetHeartbeatContext | eval:hb-context-01 | control_plane_owned | packages/mcp-server/src/tools.ts:441 |
| paperclipListComments | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:450 |
| paperclipGetComment | eval:hb-wake-comment-01 | control_plane_owned | packages/mcp-server/src/tools.ts:463 |
| paperclipListIssueApprovals | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:470 |
| paperclipListDocuments | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:476 |
| paperclipGetDocument | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:482 |
| paperclipListDocumentRevisions | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:489 |
| paperclipListProjects | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:499 |
| paperclipGetProject | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:505 |
| paperclipGetIssueWorkspaceRuntime | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:514 |
| paperclipControlIssueWorkspaceServices | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:520 |
| paperclipWaitForIssueWorkspaceService | eval:rf-iws-target-restart-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:538 |
| paperclipListGoals | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:564 |
| paperclipGetGoal | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:570 |
| paperclipListApprovals | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:576 |
| paperclipCreateApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:585 |
| paperclipGetApproval | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:594 |
| paperclipGetApprovalIssues | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:600 |
| paperclipListApprovalComments | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:606 |
| paperclipCreateIssue | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:612 |
| paperclipUpdateIssue | eval:st-done-comment-01 | always_agent_tool | packages/mcp-server/src/tools.ts:621 |
| paperclipCheckoutIssue | eval:co-body-contract-01 | control_plane_owned | packages/mcp-server/src/tools.ts:630 |
| paperclipReleaseIssue | eval:er-release-01 | control_plane_owned | packages/mcp-server/src/tools.ts:642 |
| paperclipAddComment | eval:cm-multiline-01 | always_agent_tool | packages/mcp-server/src/tools.ts:648 |
| paperclipSuggestTasks | eval:ix-suggest-tasks-01 | always_agent_tool | packages/mcp-server/src/tools.ts:655 |
| paperclipAskUserQuestions | eval:ix-questions-01 | always_agent_tool | packages/mcp-server/src/tools.ts:667 |
| paperclipRequestConfirmation | eval:ix-confirmation-plan-01 | always_agent_tool | packages/mcp-server/src/tools.ts:679 |
| paperclipRequestCheckboxConfirmation | eval:ix-checkbox-01 | always_agent_tool | packages/mcp-server/src/tools.ts:691 |
| paperclipUpsertIssueDocument | eval:dp-plan-doc-01 | always_agent_tool | packages/mcp-server/src/tools.ts:703 |
| paperclipRestoreIssueDocumentRevision | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:714 |
| paperclipLinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:729 |
| paperclipUnlinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:738 |
| paperclipApprovalDecision | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:749 |
| paperclipAddApprovalComment | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:772 |
| paperclipApiRequest | eval:rf-api-404-report-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:781 |
