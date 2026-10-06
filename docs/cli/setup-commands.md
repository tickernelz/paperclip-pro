---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `paperclip-pro run`

One-command bootstrap and start:

```sh
pnpm paperclip-pro run
```

Does:

1. Auto-onboards if config is missing
2. Runs `paperclip-pro doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
npx @tickernelz/paperclip-pro run --instance dev
```

## `paperclip-pro onboard`

Interactive first-time setup:

```sh
pnpm paperclip-pro onboard
```

If Paperclip is already configured, rerunning `onboard` keeps the existing config in place. Use `paperclip-pro configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm paperclip-pro onboard --run
```

Quickstart defaults + immediate start:

```sh
pnpm paperclip-pro onboard --yes
```

When onboarding starts Paperclip from an interactive terminal, it opens the
onboarding page in your browser once. Non-interactive terminals stay silent.
Suppress browser opening explicitly for headless or automated runs with either
environment variable:

```sh
PAPERCLIP_NO_BROWSER=1 pnpm paperclip-pro onboard --yes
PAPERCLIP_OPEN_ON_LISTEN=false pnpm paperclip-pro onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts Paperclip with that setup.

## `paperclip-pro doctor`

Health checks with optional auto-repair:

```sh
pnpm paperclip-pro doctor
pnpm paperclip-pro doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration, including AWS Secrets Manager non-secret env
  config when selected
- Storage configuration
- Missing key files

## `paperclip-pro configure`

Update configuration sections:

```sh
pnpm paperclip-pro configure --section server
pnpm paperclip-pro configure --section secrets
pnpm paperclip-pro configure --section storage
```

`--section secrets` updates the deployment-level provider used as the fallback
for secrets that do not target a specific company vault. Per-company provider
vaults (named instances, default vault selection, multiple vaults per provider,
coming-soon GCP/Vault) live in the board UI under
`Company Settings → Secrets → Provider vaults` and the
`/api/companies/{companyId}/secret-provider-configs` API.

## `paperclip-pro env`

Show resolved environment configuration:

```sh
pnpm paperclip-pro env
```

This now includes bind-oriented deployment settings such as `PAPERCLIP_BIND` and `PAPERCLIP_BIND_HOST` when configured.

## `paperclip-pro allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
npx @tickernelz/paperclip-pro allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.paperclip-pro/instances/default/config.json` |
| Database | `~/.paperclip-pro/instances/default/db` |
| Logs | `~/.paperclip-pro/instances/default/logs` |
| Storage | `~/.paperclip-pro/instances/default/data/storage` |
| Secrets key | `~/.paperclip-pro/instances/default/secrets/master.key` |

Override with:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm paperclip-pro run
```

Or pass `--data-dir` directly on any command:

```sh
npx @tickernelz/paperclip-pro run --data-dir ./tmp/paperclip-dev
npx @tickernelz/paperclip-pro doctor --data-dir ./tmp/paperclip-dev
```
