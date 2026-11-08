---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `wardmote run`

One-command bootstrap and start:

```sh
pnpm wardmote run
```

Does:

1. Auto-onboards if config is missing
2. Runs `wardmote doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
npx @tickernelz/wardmote run --instance dev
```

## `wardmote onboard`

Interactive first-time setup:

```sh
pnpm wardmote onboard
```

If Wardmote is already configured, rerunning `onboard` keeps the existing config in place. Use `wardmote configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm wardmote onboard --run
```

Quickstart defaults + immediate start:

```sh
pnpm wardmote onboard --yes
```

When onboarding starts Wardmote from an interactive terminal, it opens the
onboarding page in your browser once. Non-interactive terminals stay silent.
Suppress browser opening explicitly for headless or automated runs with either
environment variable:

```sh
PAPERCLIP_NO_BROWSER=1 pnpm wardmote onboard --yes
PAPERCLIP_OPEN_ON_LISTEN=false pnpm wardmote onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts Wardmote with that setup.

## `wardmote doctor`

Health checks with optional auto-repair:

```sh
pnpm wardmote doctor
pnpm wardmote doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration, including AWS Secrets Manager non-secret env
  config when selected
- Storage configuration
- Missing key files

## `wardmote configure`

Update configuration sections:

```sh
pnpm wardmote configure --section server
pnpm wardmote configure --section secrets
pnpm wardmote configure --section storage
```

`--section secrets` updates the deployment-level provider used as the fallback
for secrets that do not target a specific company vault. Per-company provider
vaults (named instances, default vault selection, multiple vaults per provider,
coming-soon GCP/Vault) live in the board UI under
`Company Settings → Secrets → Provider vaults` and the
`/api/companies/{companyId}/secret-provider-configs` API.

## `wardmote env`

Show resolved environment configuration:

```sh
pnpm wardmote env
```

This now includes bind-oriented deployment settings such as `PAPERCLIP_BIND` and `PAPERCLIP_BIND_HOST` when configured.

## `wardmote allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
npx @tickernelz/wardmote allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.wardmote/instances/default/config.json` |
| Database | `~/.wardmote/instances/default/db` |
| Logs | `~/.wardmote/instances/default/logs` |
| Storage | `~/.wardmote/instances/default/data/storage` |
| Secrets key | `~/.wardmote/instances/default/secrets/master.key` |

Override with:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm wardmote run
```

Or pass `--data-dir` directly on any command:

```sh
npx @tickernelz/wardmote run --data-dir ./tmp/paperclip-dev
npx @tickernelz/wardmote doctor --data-dir ./tmp/paperclip-dev
```
