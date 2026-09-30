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
| skill:skills/paperclip/SKILL.md:generated-artifacts-and-work-products:189 | always_agent_tool | skills/paperclip/SKILL.md:189 |
| skill:skills/paperclip/SKILL.md:status-quick-guide:224 | control_plane_owned | skills/paperclip/SKILL.md:224 |
| skill:skills/paperclip/SKILL.md:monitors-and-watchers-say-only-what-you-actually-scheduled:234 | optional_agent_tool | skills/paperclip/SKILL.md:234 |
| skill:skills/paperclip/SKILL.md:delegating-review-tasks:249 | always_agent_tool | skills/paperclip/SKILL.md:249 |
| skill:skills/paperclip/SKILL.md:managing-a-user-s-inbox:262 | control_plane_owned | skills/paperclip/SKILL.md:262 |
| skill:skills/paperclip/SKILL.md:issue-dependencies-blockers:270 | control_plane_owned | skills/paperclip/SKILL.md:270 |
| skill:skills/paperclip/SKILL.md:requesting-board-approval:287 | optional_agent_tool | skills/paperclip/SKILL.md:287 |
| skill:skills/paperclip/SKILL.md:issue-thread-interactions:307 | optional_agent_tool | skills/paperclip/SKILL.md:307 |
| skill:skills/paperclip/SKILL.md:standalone-decisions:336 | optional_agent_tool | skills/paperclip/SKILL.md:336 |
| skill:skills/paperclip/SKILL.md:mcp-tool-approval-gates:438 | optional_agent_tool | skills/paperclip/SKILL.md:438 |
| skill:skills/paperclip/SKILL.md:niche-workflow-pointers:479 | optional_agent_tool | skills/paperclip/SKILL.md:479 |
| skill:skills/paperclip/SKILL.md:cases:489 | optional_agent_tool | skills/paperclip/SKILL.md:489 |
| skill:skills/paperclip/SKILL.md:company-skills-workflow:495 | optional_agent_tool | skills/paperclip/SKILL.md:495 |
| skill:skills/paperclip/SKILL.md:routines:506 | optional_agent_tool | skills/paperclip/SKILL.md:506 |
| skill:skills/paperclip/SKILL.md:issue-workspace-runtime-controls:517 | optional_agent_tool | skills/paperclip/SKILL.md:517 |
| skill:skills/paperclip/SKILL.md:proposing-credentials-safely:524 | optional_agent_tool | skills/paperclip/SKILL.md:524 |
| skill:skills/paperclip/SKILL.md:reading-granted-secrets:531 | optional_agent_tool | skills/paperclip/SKILL.md:531 |
| skill:skills/paperclip/SKILL.md:critical-rules:545 | optional_agent_tool | skills/paperclip/SKILL.md:545 |
| skill:skills/paperclip/SKILL.md:comment-style-required:568 | always_agent_tool | skills/paperclip/SKILL.md:568 |
| skill:skills/paperclip/SKILL.md:update:600 | optional_agent_tool | skills/paperclip/SKILL.md:600 |
| skill:skills/paperclip/SKILL.md:planning-required-when-planning-requested:610 | optional_agent_tool | skills/paperclip/SKILL.md:610 |
| skill:skills/paperclip/SKILL.md:key-endpoints-hot-routes:642 | optional_agent_tool | skills/paperclip/SKILL.md:642 |
| skill:skills/paperclip/SKILL.md:searching-issues:674 | optional_agent_tool | skills/paperclip/SKILL.md:674 |
| skill:skills/paperclip/SKILL.md:full-reference:680 | optional_agent_tool | skills/paperclip/SKILL.md:680 |
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
| skill:skills/paperclip/references/api-reference.md:worked-example-ic-heartbeat:444 | optional_agent_tool | skills/paperclip/references/api-reference.md:444 |
| skill:skills/paperclip/references/api-reference.md:1-identity-skip-if-already-in-context:449 | control_plane_owned | skills/paperclip/references/api-reference.md:449 |
| skill:skills/paperclip/references/api-reference.md:2-check-inbox:453 | control_plane_owned | skills/paperclip/references/api-reference.md:453 |
| skill:skills/paperclip/references/api-reference.md:3-already-have-issue-101-inprogress-highest-priority-continue-it:460 | optional_agent_tool | skills/paperclip/references/api-reference.md:460 |
| skill:skills/paperclip/references/api-reference.md:4-do-the-actual-work-write-code-run-tests:467 | optional_agent_tool | skills/paperclip/references/api-reference.md:467 |
| skill:skills/paperclip/references/api-reference.md:5-work-is-done-update-status-and-comment-in-one-call:469 | always_agent_tool | skills/paperclip/references/api-reference.md:469 |
| skill:skills/paperclip/references/api-reference.md:6-still-have-time-checkout-the-next-task:472 | control_plane_owned | skills/paperclip/references/api-reference.md:472 |
| skill:skills/paperclip/references/api-reference.md:7-made-partial-progress-not-done-yet-comment-and-exit:478 | always_agent_tool | skills/paperclip/references/api-reference.md:478 |
| skill:skills/paperclip/references/api-reference.md:worked-example-report-a-board-user-s-mine-inbox:482 | control_plane_owned | skills/paperclip/references/api-reference.md:482 |
| skill:skills/paperclip/references/api-reference.md:board-user-created-the-requesting-issue:487 | optional_agent_tool | skills/paperclip/references/api-reference.md:487 |
| skill:skills/paperclip/references/api-reference.md:fetch-the-board-user-s-mine-inbox-issues:491 | control_plane_owned | skills/paperclip/references/api-reference.md:491 |
| skill:skills/paperclip/references/api-reference.md:summarize-it-back-to-the-board-in-a-comment-or-document:505 | always_agent_tool | skills/paperclip/references/api-reference.md:505 |
| skill:skills/paperclip/references/api-reference.md:worked-example-archive-a-resolved-inbox-item:509 | control_plane_owned | skills/paperclip/references/api-reference.md:509 |
| skill:skills/paperclip/references/api-reference.md:the-responsible-user-s-id-is-resolved-from-the-authenticated-agent-run:516 | optional_agent_tool | skills/paperclip/references/api-reference.md:516 |
| skill:skills/paperclip/references/api-reference.md:reverse-the-archive-if-it-was-premature-or-no-longer-desired:524 | optional_agent_tool | skills/paperclip/references/api-reference.md:524 |
| skill:skills/paperclip/references/api-reference.md:worked-example-reviewer-approver-heartbeat:533 | always_agent_tool | skills/paperclip/references/api-reference.md:533 |
| skill:skills/paperclip/references/api-reference.md:worked-example-manager-heartbeat:570 | optional_agent_tool | skills/paperclip/references/api-reference.md:570 |
| skill:skills/paperclip/references/api-reference.md:1-identity-skip-if-already-in-context:573 | control_plane_owned | skills/paperclip/references/api-reference.md:573 |
| skill:skills/paperclip/references/api-reference.md:2-check-team-status:577 | optional_agent_tool | skills/paperclip/references/api-reference.md:577 |
| skill:skills/paperclip/references/api-reference.md:3-agent-42-is-blocked-read-comments:584 | control_plane_owned | skills/paperclip/references/api-reference.md:584 |
| skill:skills/paperclip/references/api-reference.md:4-unblock-reassign-and-comment:588 | control_plane_owned | skills/paperclip/references/api-reference.md:588 |
| skill:skills/paperclip/references/api-reference.md:5-check-own-assignments:591 | optional_agent_tool | skills/paperclip/references/api-reference.md:591 |
| skill:skills/paperclip/references/api-reference.md:6-create-subtasks-and-delegate:597 | optional_agent_tool | skills/paperclip/references/api-reference.md:597 |
| skill:skills/paperclip/references/api-reference.md:load-tests-depend-on-caching-layer-being-done-first-paperclip-will-auto-wake-agent-55-when-the-blocker-resolves:601 | control_plane_owned | skills/paperclip/references/api-reference.md:601 |
| skill:skills/paperclip/references/api-reference.md:7-dashboard-for-health-check:605 | optional_agent_tool | skills/paperclip/references/api-reference.md:605 |
| skill:skills/paperclip/references/api-reference.md:comments-and-mentions:613 | always_agent_tool | skills/paperclip/references/api-reference.md:613 |
| skill:skills/paperclip/references/api-reference.md:update:620 | optional_agent_tool | skills/paperclip/references/api-reference.md:620 |
| skill:skills/paperclip/references/api-reference.md:cross-team-work-and-delegation:659 | optional_agent_tool | skills/paperclip/references/api-reference.md:659 |
| skill:skills/paperclip/references/api-reference.md:receiving-cross-team-work:663 | optional_agent_tool | skills/paperclip/references/api-reference.md:663 |
| skill:skills/paperclip/references/api-reference.md:escalation:673 | optional_agent_tool | skills/paperclip/references/api-reference.md:673 |
| skill:skills/paperclip/references/api-reference.md:company-context:683 | optional_agent_tool | skills/paperclip/references/api-reference.md:683 |
| skill:skills/paperclip/references/api-reference.md:company-branding-ceo-board:695 | optional_agent_tool | skills/paperclip/references/api-reference.md:695 |
| skill:skills/paperclip/references/api-reference.md:openclaw-invite-prompt-ceo:715 | optional_agent_tool | skills/paperclip/references/api-reference.md:715 |
| skill:skills/paperclip/references/api-reference.md:setting-agent-instructions-path:733 | optional_agent_tool | skills/paperclip/references/api-reference.md:733 |
| skill:skills/paperclip/references/api-reference.md:project-setup-create-workspace:766 | optional_agent_tool | skills/paperclip/references/api-reference.md:766 |
| skill:skills/paperclip/references/api-reference.md:option-a-one-call-create-with-workspace:789 | optional_agent_tool | skills/paperclip/references/api-reference.md:789 |
| skill:skills/paperclip/references/api-reference.md:option-b-two-calls-project-first-then-workspace:811 | optional_agent_tool | skills/paperclip/references/api-reference.md:811 |
| skill:skills/paperclip/references/api-reference.md:governance-and-approvals:845 | optional_agent_tool | skills/paperclip/references/api-reference.md:845 |
| skill:skills/paperclip/references/api-reference.md:requesting-a-hire-management-only:849 | optional_agent_tool | skills/paperclip/references/api-reference.md:849 |
| skill:skills/paperclip/references/api-reference.md:ceo-strategy-approval:912 | optional_agent_tool | skills/paperclip/references/api-reference.md:912 |
| skill:skills/paperclip/references/api-reference.md:questions-and-waiting-for-human-input:922 | always_agent_tool | skills/paperclip/references/api-reference.md:922 |
| skill:skills/paperclip/references/api-reference.md:issue-thread-confirmations:1025 | always_agent_tool | skills/paperclip/references/api-reference.md:1025 |
| skill:skills/paperclip/references/api-reference.md:checkbox-confirmations:1084 | always_agent_tool | skills/paperclip/references/api-reference.md:1084 |
| skill:skills/paperclip/references/api-reference.md:item-verdict-requests:1196 | optional_agent_tool | skills/paperclip/references/api-reference.md:1196 |
| skill:skills/paperclip/references/api-reference.md:checking-approval-status:1306 | optional_agent_tool | skills/paperclip/references/api-reference.md:1306 |
| skill:skills/paperclip/references/api-reference.md:approval-follow-up-requesting-agent:1310 | always_agent_tool | skills/paperclip/references/api-reference.md:1310 |
| skill:skills/paperclip/references/api-reference.md:issue-lifecycle:1323 | always_agent_tool | skills/paperclip/references/api-reference.md:1323 |
| skill:skills/paperclip/references/api-reference.md:error-handling:1353 | control_plane_owned | skills/paperclip/references/api-reference.md:1353 |
| skill:skills/paperclip/references/api-reference.md:full-tool-reference:1368 | optional_agent_tool | skills/paperclip/references/api-reference.md:1368 |
| skill:skills/paperclip/references/api-reference.md:agents:1372 | optional_agent_tool | skills/paperclip/references/api-reference.md:1372 |
| skill:skills/paperclip/references/api-reference.md:issues-tasks:1395 | optional_agent_tool | skills/paperclip/references/api-reference.md:1395 |
| skill:skills/paperclip/references/api-reference.md:companies-projects-goals:1448 | optional_agent_tool | skills/paperclip/references/api-reference.md:1448 |
| skill:skills/paperclip/references/api-reference.md:routines:1472 | optional_agent_tool | skills/paperclip/references/api-reference.md:1472 |
| skill:skills/paperclip/references/api-reference.md:approvals-costs-activity-dashboard:1490 | optional_agent_tool | skills/paperclip/references/api-reference.md:1490 |
| skill:skills/paperclip/references/api-reference.md:secrets:1509 | optional_agent_tool | skills/paperclip/references/api-reference.md:1509 |
| skill:skills/paperclip/references/api-reference.md:agent-secret-proposals:1524 | optional_agent_tool | skills/paperclip/references/api-reference.md:1524 |
| skill:skills/paperclip/references/api-reference.md:agent-secret-access:1590 | optional_agent_tool | skills/paperclip/references/api-reference.md:1590 |
| skill:skills/paperclip/references/api-reference.md:common-mistakes:1630 | optional_agent_tool | skills/paperclip/references/api-reference.md:1630 |

## Legacy MCP Alias Index

This is a compatibility/traceability index, not a tool catalog. “Inherited disposition” is shown only to make the normative target easy to audit.

| Legacy MCP name | Folded into normative row | Inherited disposition | Source anchor |
| --- | --- | --- | --- |
| paperclipMe | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts:426 |
| paperclipInboxLite | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts:432 |
| paperclipListAgents | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:438 |
| paperclipListSkills | eval:rf-cskill-audit-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:448 |
| paperclipGetAgent | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:454 |
| paperclipListIssues | eval:se-q-filters-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:463 |
| paperclipGetIssue | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:479 |
| paperclipGetHeartbeatContext | eval:hb-context-01 | control_plane_owned | packages/mcp-server/src/tools.ts:485 |
| paperclipListComments | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:494 |
| paperclipGetComment | eval:hb-wake-comment-01 | control_plane_owned | packages/mcp-server/src/tools.ts:507 |
| paperclipListIssueApprovals | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:514 |
| paperclipListDocuments | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:520 |
| paperclipGetDocument | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:526 |
| paperclipListDocumentRevisions | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:533 |
| paperclipListProjects | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:543 |
| paperclipGetProject | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:552 |
| paperclipGetIssueWorkspaceRuntime | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:561 |
| paperclipControlIssueWorkspaceServices | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:567 |
| paperclipWaitForIssueWorkspaceService | eval:rf-iws-target-restart-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:585 |
| paperclipListGoals | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:611 |
| paperclipGetGoal | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:617 |
| paperclipListApprovals | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:623 |
| paperclipCreateApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:632 |
| paperclipGetApproval | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:641 |
| paperclipGetApprovalIssues | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:647 |
| paperclipListApprovalComments | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:653 |
| paperclipCreateIssue | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:659 |
| paperclipUpdateIssue | eval:st-done-comment-01 | always_agent_tool | packages/mcp-server/src/tools.ts:668 |
| paperclipCheckoutIssue | eval:co-body-contract-01 | control_plane_owned | packages/mcp-server/src/tools.ts:677 |
| paperclipReleaseIssue | eval:er-release-01 | control_plane_owned | packages/mcp-server/src/tools.ts:689 |
| paperclipAddComment | eval:cm-multiline-01 | always_agent_tool | packages/mcp-server/src/tools.ts:695 |
| paperclipSuggestTasks | eval:ix-suggest-tasks-01 | always_agent_tool | packages/mcp-server/src/tools.ts:702 |
| paperclipAskUserQuestions | eval:ix-questions-01 | always_agent_tool | packages/mcp-server/src/tools.ts:714 |
| paperclipRequestConfirmation | eval:ix-confirmation-plan-01 | always_agent_tool | packages/mcp-server/src/tools.ts:726 |
| paperclipRequestCheckboxConfirmation | eval:ix-checkbox-01 | always_agent_tool | packages/mcp-server/src/tools.ts:738 |
| paperclipUpsertIssueDocument | eval:dp-plan-doc-01 | always_agent_tool | packages/mcp-server/src/tools.ts:750 |
| paperclipRestoreIssueDocumentRevision | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:761 |
| paperclipLinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:776 |
| paperclipUnlinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:785 |
| paperclipApprovalDecision | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:796 |
| paperclipAddApprovalComment | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:819 |
| paperclipApiRequest | eval:rf-api-404-report-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:828 |
