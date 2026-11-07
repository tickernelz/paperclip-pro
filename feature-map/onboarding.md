# Onboarding and first work

An operator installs OMP, starts an instance, and reaches a first agent working on a first task in three steps: Check OMP, Connect a model (skipped when OMP already has a signed-in model), and First task. Instance setup and company onboarding are separate steps.

Implementation: [web flow](../ui/src/components/onboarding/OnboardingFlow.tsx), [OMP readiness](../packages/adapters/omp-local/src/server/readiness.ts), [onboarding API](../server/src/routes/onboarding-omp.ts), [CLI setup](../cli/src/commands/onboard.ts).

## Sub-features

- `omp-gate`: OMP must be on PATH (or chosen as a file) at version 18.1.16 or newer before setup continues. The CLI `onboard` command and the first-agent hire enforce it on local installs; the Docker image bundles a pinned OMP (`PAPERCLIP_OMP_BUNDLED_VERSION`) and is not gated.
- `connect`: models are read from OMP's own sign-in (`~/.omp`); Paperclip never copies the credential. Sign-in runs `omp login <provider>` on this machine; on another machine or in Docker the step shows the command to run there.
- `first-task`: one text box. The agent is Atlas (role general) with OMP's recommended model and the most recent OMP project folder, all changeable later on the agent page.
- `remote`: one SSH address; OMP is checked over SSH and the agent gets an SSH environment whose working folder is the remote home folder.

## How to get to it (user POV)

### `web-flow`

Open `/onboarding` or the onboarding launcher in an empty company context.

### `cli-setup`

Use `paperclip-pro onboard --help` or `paperclip-pro run --help` to select an isolated data directory before setup.

## Driving it

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Use a new isolated data directory and record deployment mode.

### `web-flow`

Automated: [onboarding browser suite](../tests/e2e/onboarding.spec.ts) counts the steps, decisions, clicks and fields of the real flow and captures every step and state at 360, 768 and 1440 px in both themes; [readiness](../packages/adapters/omp-local/src/server/readiness.test.ts), [route](../server/src/__tests__/onboarding-omp-route.test.ts) and [gate](../server/src/services/onboarding-omp-gate.test.ts) tests cover the version gate. [Docker pin check](../scripts/check-docker-omp-pin.sh) runs in CI.

Manual: With an OMP older than 18.1.16 first on PATH, open `/onboarding` and confirm it stays on Update OMP. Update it and confirm the page moves on by itself. Finish with a first task and confirm Atlas runs it.

### `cli-setup`

Automated: [CLI onboarding](../cli/src/__tests__/onboard.test.ts) and [isolated test drive](../cli/src/__tests__/test-drive.test.ts) cover their setup contracts, including the OMP gate.

Manual: Run setup in the disposable directory, open the URL it prints, and confirm the instance identity and company. Restart using that same configuration and verify saved state.

## Gotchas

- An empty company, an empty instance, and an unauthenticated browser are different states.
- Creating an agent does not prove its provider login or first execution succeeded.
- See [access](./access.md) for authenticated deployments and [agents](./agents.md) for later hiring.
