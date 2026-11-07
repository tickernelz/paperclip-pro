# New-agent setup prerequisites

Reviewed against the adapter builders and runtime probes on 2026-11-07.

| Adapter | Setup connection/prerequisites | Model and effort in setup |
| --- | --- | --- |
| OMP (`omp_local`) | `omp` installed on the selected environment | Model from `omp models`; thinking effort per model |
| Paperclip Runner | The selected Codex, Claude ACPX, or OpenCode connection | Provider model; no generic effort setting |

## Contracts and regression coverage

- New runtime keys are stored as distinct organization secrets when setup completes. They do not rotate existing keys.
- A draft key goes only into the allowlisted `testCredentials` request field during testing. It does not pass through persistence normalization.
- Failed tests and abandoned forms do not create secrets. A failed hire removes the newly created secret; cleanup errors remain visible.
- `ui/src/pages/NewAgent.test.tsx` covers field visibility, request payloads, secret reuse/storage, and failure cleanup. `server/src/__tests__/agent-test-environment-routes.test.ts` verifies transient credential handling and rejects arbitrary environment variables.

UI and mocked contract tests do not prove a provider account can run a task. Successful live authentication requires the user's credential.
