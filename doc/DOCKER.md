# Docker Quickstart

Run Wardmote in Docker without installing Node or pnpm locally.

All commands below assume you are in the **project root** (the directory containing `package.json`), not inside `docker/`.

## Building the image

```sh
docker build -t wardmote-local .
```

The Dockerfile installs common agent tools (`git`, `gh`, `curl`, `wget`, `ripgrep`, `python3`) and the Claude, Codex, and OpenCode CLIs.

Build arguments:

| Arg | Default | Purpose |
|-----|---------|---------|
| `USER_UID` | `1000` | UID for the container `node` user (match your host UID to avoid permission issues on bind mounts) |
| `USER_GID` | `1000` | GID for the container `node` group |
| `CLI_TOOLS_CACHE_EPOCH` | empty | Refresh the CLI-install layer; CI supplies the current ISO week |
| `WARDMOTE_BUILD_VERSION` | empty | Runtime version when Git metadata is unavailable |
| `WARDMOTE_BUILD_COMMIT` | empty | Source commit written into the server build stamp and runtime environment |

Changing the build version or commit preserves the CLI-install cache. The
tool layer refreshes when its weekly epoch, base image, installation command,
or earlier build inputs change. Local builds can set a new epoch explicitly
to refresh tools without clearing the entire build cache.

```sh
docker build -t wardmote-local \
  --build-arg USER_UID=$(id -u) --build-arg USER_GID=$(id -g) .
```

## Standard images and downstream composition

Stamped standard images include the build-owned remote provider pack at
`/opt/wardmote-runner/provider-pack` and set
`WARDMOTE_RUNNER_REMOTE_PROVIDER_PACK_PATH` to that directory. Downstream
compositions and the explicit `cloud` target inherit both. The pack is required
on the controller for remote OpenCode and ACPX runs, even when the sandbox has
preinstalled providers; setting the environment variable alone cannot repair an
image that omits the pack. Rebuild and redeploy from a standard image containing
the pack if runs fail with `runner_remote_provider_artifact_incompatible`.

Local Docker builds must supply a full `WARDMOTE_BUILD_COMMIT` to include a
qualified pack. Unstamped builds remain usable for local adapters and skip pack
generation. The pack stays root-owned and readable by remapped runtime UIDs.

The legacy recurring public `-cloud` publisher is retired. Master pushes,
release tags, and manual `Docker` dispatches no longer build that variant.
Existing `-cloud` tags and digests remain in the registry for rollback; their
release-channel aliases no longer advance. This change deletes no images,
cache tags, or migrator artifacts.

The `cloud` Dockerfile target remains available for explicit
[preview builds](preview-release-artifacts.md). Those requests still publish a
full-SHA `-cloud` tag when needed. They do not advance a release channel or
replace downstream private composition.

A published image alone does not prove source tests or migration compatibility.
Downstream deployment tooling must verify the exact-source CI run, the standard
image attestation, the exact-source migrator, and its own composed image before
rollout. Resolve immutable digests instead of deploying mutable tags.

## One-liner (build + run)

```sh
docker build -t wardmote-local . && \
docker run --name wardmote \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e WARDMOTE_HOME=/wardmote \
  -e BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  -e WARDMOTE_TOOL_ACTION_SIGNING_SECRET=$(openssl rand -hex 32) \
  -v "$(pwd)/data/docker-wardmote:/wardmote" \
  wardmote-local
```

Open: `http://localhost:3100`

Data persistence:

- Embedded PostgreSQL data
- uploaded assets
- local secrets key
- local agent workspace data

All persisted under your bind mount (`./data/docker-wardmote` in the example above).

## Docker Compose

### Quickstart (embedded SQLite)

Single container, no external database. Data persists via a bind mount.

```sh
BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
WARDMOTE_TOOL_ACTION_SIGNING_SECRET=$(openssl rand -hex 32) \
  docker compose -f docker/docker-compose.quickstart.yml up --build
```

Defaults:

- host port: `3100`
- persistent data dir: `./data/docker-wardmote`

Optional overrides:

```sh
WARDMOTE_PORT=3200 WARDMOTE_DATA_DIR=../data/pc \
  docker compose -f docker/docker-compose.quickstart.yml up --build
```

**Note:** `WARDMOTE_DATA_DIR` is resolved relative to the compose file (`docker/`), so `../data/pc` maps to `data/pc` in the project root.

If you change host port or use a non-local domain, set `WARDMOTE_PUBLIC_URL` to the external URL you will use in browser/auth flows.

Pass `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` to enable local adapter runs.

### Full stack (with PostgreSQL)

Wardmote server + PostgreSQL 17. The database is health-checked before the server starts.

```sh
BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  docker compose -f docker/docker-compose.yml up --build
```

PostgreSQL data persists in a named Docker volume (`pgdata`). Wardmote data persists in `wardmote-data`. The database user, password and name default to `wardmote`; set `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` to override them.

### Untrusted PR review

Isolated container for reviewing untrusted pull requests with Codex or Claude, without exposing your host machine. See `doc/UNTRUSTED-PR-REVIEW.md` for the full workflow.

```sh
docker compose -f docker/docker-compose.untrusted-review.yml build
docker compose -f docker/docker-compose.untrusted-review.yml run --rm --service-ports review
```

## Authenticated Compose (Single Public URL)

For authenticated deployments, set one canonical public URL and let Wardmote derive auth/callback defaults:

```yaml
services:
  wardmote:
    environment:
      WARDMOTE_DEPLOYMENT_MODE: authenticated
      WARDMOTE_DEPLOYMENT_EXPOSURE: private
      WARDMOTE_PUBLIC_URL: https://desk.koker.net
```

`WARDMOTE_PUBLIC_URL` is used as the primary source for:

- auth public base URL
- Better Auth base URL defaults
- bootstrap invite URL defaults
- hostname allowlist defaults (hostname extracted from URL)

For fresh `authenticated/private` Docker or appliance-style installs, the first
admin can now be claimed entirely from the browser after sign-in. Open the
Wardmote URL, sign in or create an account, then choose `Claim this instance`
on the setup screen. This browser claim is disabled for `authenticated/public`;
public deployments should run the high-entropy CLI invite fallback instead:

```sh
pnpm wardmote auth bootstrap-ceo
```

Granular overrides remain available if needed (`WARDMOTE_AUTH_PUBLIC_BASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `WARDMOTE_ALLOWED_HOSTNAMES`).

Set `WARDMOTE_ALLOWED_HOSTNAMES` explicitly only when you need additional hostnames beyond the public URL host (for example Tailscale/LAN aliases or multiple private hostnames).

### Optional Vercel Connect credentials

Vercel Connect's backend integration is retained for controlled testing and
existing Vercel-backed connections, but its new-connection UI is currently
withheld from **Apps → Browse**. Setting
`WARDMOTE_VERCEL_CONNECT_ENABLED=true` does not expose a customer-facing setup
entry. Native provider setup screens remain unchanged. Vercel-hosted deployments use the
workload OIDC token Vercel injects. Other hosted and self-hosted deployments
can provide `WARDMOTE_VERCEL_CONNECT_ACCESS_TOKEN` as a deployment bootstrap
secret only when that token type is accepted by the live Connect API:

```yaml
services:
  wardmote:
    environment:
      WARDMOTE_VERCEL_CONNECT_ENABLED: "true"
      WARDMOTE_VERCEL_CONNECT_ACCESS_TOKEN: ${WARDMOTE_VERCEL_CONNECT_ACCESS_TOKEN}
```

Do not save that access token in a company secret or connection config. It is
instance bootstrap authority for the operator-selected Vercel account. A token's
long expiry and broad Vercel scope do not prove Connect compatibility; validate
it with connector metadata before rollout. Workload OIDC takes precedence when
both authorities are present. Turning the feature flag off hides new
Vercel-backed setup; existing connections keep resolving while workload OIDC or
the bootstrap token remains available. Missing or invalid authority fails
closed. See the [Vercel Connect operator guide](./connections/VERCEL-CONNECT.md).

## Claude + Codex Local Adapters in Docker

The image pre-installs:

- `claude` (Anthropic Claude Code CLI)
- `codex` (OpenAI Codex CLI)
- `python3` (used to run local subscription sign-in in a pseudo-terminal)

Start the container, then open **Apps → Connections** to connect a Claude or
Codex subscription in your browser. You can also enter a provider API key there.
You do not run a shell command or configure a CLI home.

```sh
docker run --name wardmote \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e WARDMOTE_HOME=/wardmote \
  -v "$(pwd)/data/docker-wardmote:/wardmote" \
  wardmote-local
```

Notes:

- The image provides the CLI and Python prerequisites for local subscription sign-in.
- Adapter environment checks in Wardmote surface missing authentication or CLI prerequisites.

## Podman Quadlet (systemd)

The `docker/quadlet/` directory contains unit files to run Wardmote + PostgreSQL as systemd services via Podman Quadlet.

| File | Purpose |
|------|---------|
| `docker/quadlet/wardmote.pod` | Pod definition — groups containers into a shared network namespace |
| `docker/quadlet/wardmote.container` | Wardmote server — joins the pod, connects to Postgres at `127.0.0.1` |
| `docker/quadlet/wardmote-db.container` | PostgreSQL 17 — joins the pod, health-checked |

### Setup

1. Build the image (see above).

2. Copy quadlet files to your systemd directory:

   ```sh
   # Rootless (recommended)
   cp docker/quadlet/*.pod docker/quadlet/*.container \
     ~/.config/containers/systemd/

   # Or rootful
   sudo cp docker/quadlet/*.pod docker/quadlet/*.container \
     /etc/containers/systemd/
   ```

3. Create a secrets env file (keep out of version control):

   ```sh
   cat > ~/.config/containers/systemd/wardmote.env <<EOL
   BETTER_AUTH_SECRET=$(openssl rand -hex 32)
   WARDMOTE_TOOL_ACTION_SIGNING_SECRET=$(openssl rand -hex 32)
   POSTGRES_USER=wardmote
   POSTGRES_PASSWORD=wardmote
   POSTGRES_DB=wardmote
   DATABASE_URL=postgres://wardmote:wardmote@127.0.0.1:5432/wardmote
   # OPENAI_API_KEY=sk-...
   # ANTHROPIC_API_KEY=sk-...
   EOL
   ```

4. Create the data directory and start:

   ```sh
   mkdir -p ~/.local/share/wardmote
   systemctl --user daemon-reload
   systemctl --user start wardmote-pod
   ```

### Quadlet management

```sh
journalctl --user -u wardmote -f        # App logs
journalctl --user -u wardmote-db -f     # DB logs
systemctl --user status wardmote-pod    # Pod status
systemctl --user restart wardmote-pod   # Restart all
systemctl --user stop wardmote-pod      # Stop all
```

### Quadlet notes

- **First boot**: Unlike Docker Compose's `condition: service_healthy`, Quadlet's `After=` only waits for the DB unit to *start*, not for PostgreSQL to be ready. On a cold first boot you may see one or two restart attempts in `journalctl --user -u wardmote` while PostgreSQL initialises — this is expected and resolves automatically via `Restart=on-failure`.
- Containers in a pod share `localhost`, so Wardmote reaches Postgres at `127.0.0.1:5432`.
- PostgreSQL data persists in the `wardmote-pgdata` named volume.
- Wardmote data persists at `~/.local/share/wardmote`.
- For rootful quadlet deployment, remove `%h` prefixes and use absolute paths.

## Upgrading from the old names

Before the Wardmote rename the image kept its data in `/paperclip`, the Compose files used the `paperclip-data` volume and the `docker-paperclip` folder, and the Quadlet units used `paperclip.*` unit files, the `paperclip-pgdata` volume, `~/.local/share/paperclip` and `paperclip.env`. The new image keeps its data in `/wardmote`. When the instance config still names `/paperclip`, the entrypoint links `/paperclip` to the new data directory so stored paths keep working. Move the data once; the old copies stay until you remove them.

Single container or quickstart Compose with a bind mount:

```sh
docker stop paperclip && docker rm paperclip
mv data/docker-paperclip data/docker-wardmote
```

Then start the new image with `-v "$(pwd)/data/docker-wardmote:/wardmote"`, or run `docker compose -f docker/docker-compose.quickstart.yml up`.

Full-stack Compose (`docker/docker-compose.yml`, project name `docker`):

```sh
docker compose -f docker/docker-compose.yml down
docker volume create docker_wardmote-data
docker run --rm -v docker_paperclip-data:/from -v docker_wardmote-data:/to alpine cp -a /from/. /to/
```

The existing `pgdata` volume was created with the database user, password and name `paperclip`, so start the stack with those values:

```sh
POSTGRES_USER=paperclip POSTGRES_PASSWORD=paperclip POSTGRES_DB=paperclip \
BETTER_AUTH_SECRET=<existing secret> \
  docker compose -f docker/docker-compose.yml up
```

Podman Quadlet:

```sh
systemctl --user stop paperclip-pod
rm ~/.config/containers/systemd/paperclip.pod \
  ~/.config/containers/systemd/paperclip.container \
  ~/.config/containers/systemd/paperclip-db.container
mv ~/.config/containers/systemd/paperclip.env ~/.config/containers/systemd/wardmote.env
mv ~/.local/share/paperclip ~/.local/share/wardmote
podman volume create wardmote-pgdata
podman run --rm -v paperclip-pgdata:/from -v wardmote-pgdata:/to docker.io/library/alpine cp -a /from/. /to/
podman build -t wardmote-local .
cp docker/quadlet/*.pod docker/quadlet/*.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user start wardmote-pod
```

The env file keeps its database values, which match the copied volume.
## Onboard Smoke Test (Ubuntu + npm only)

Use this when you want to mimic a fresh machine that only has Ubuntu + npm and verify:

- `npx @tickernelz/wardmote onboard --yes` completes
- the server binds to `0.0.0.0:3100` so host access works
- onboard/run banners and startup logs are visible in your terminal

Build + run:

```sh
./scripts/docker-onboard-smoke.sh
```

Open: `http://localhost:3131` (default smoke host port)

Useful overrides:

```sh
HOST_PORT=3200 WARDMOTE_VERSION=latest ./scripts/docker-onboard-smoke.sh
WARDMOTE_DEPLOYMENT_MODE=authenticated WARDMOTE_DEPLOYMENT_EXPOSURE=private ./scripts/docker-onboard-smoke.sh
SMOKE_DETACH=true SMOKE_METADATA_FILE=/tmp/wardmote-smoke.env WARDMOTE_VERSION=latest ./scripts/docker-onboard-smoke.sh
```

Notes:

- Persistent data is mounted at `./data/docker-onboard-smoke` by default.
- Container runtime user id defaults to your local `id -u` so the mounted data dir stays writable while avoiding root runtime.
- Smoke script defaults to `authenticated/private` mode so `HOST=0.0.0.0` can be exposed to the host.
- Smoke script defaults host port to `3131` to avoid conflicts with local Wardmote on `3100`.
- Smoke script also defaults `WARDMOTE_PUBLIC_URL` to `http://localhost:<HOST_PORT>` so bootstrap invite URLs and auth callbacks use the reachable host port instead of the container's internal `3100`.
- In authenticated mode, the smoke script defaults `SMOKE_AUTO_BOOTSTRAP=true` and drives the real bootstrap path automatically: it signs up a real user, runs `wardmote auth bootstrap-ceo` inside the container to mint a real bootstrap invite, accepts that invite over HTTP, and verifies board session access.
- Run the script in the foreground to watch the onboarding flow; stop with `Ctrl+C` after validation.
- Set `SMOKE_DETACH=true` to leave the container running for automation and optionally write shell-ready metadata to `SMOKE_METADATA_FILE`.
- Set `SMOKE_CONTAINER_NAME` to fix the container's name up front. Automation that has to collect diagnostics when the script *fails* needs a name it already knows, rather than one it can only read back out of a successful run. Defaults to the image name.
- The container's logs are dumped to `SMOKE_LOG_FILE` (default `$TMPDIR/<container name>.log`) before the script tears the container down, so a run that never became ready still leaves its logs behind.
- The image definition is in `docker/Dockerfile.onboard-smoke`.

## General Notes

- The `docker-entrypoint.sh` adjusts the container `node` user UID/GID at startup to match the values passed via `USER_UID`/`USER_GID`, avoiding permission issues on bind-mounted volumes.
- Wardmote data persists via Docker volumes/bind mounts (compose) or at `~/.local/share/wardmote` (quadlet).

## Native Runner build cache

The image compiles the native Runner in `runner-build`, before copying the
application source. A pinned `cargo-chef` generates a dependency recipe in
`runner-plan`. The separate `runner-deps` stage compiles that recipe with the
package-owned Rust compiler. Both the dependency build and the real binary use
the release profile and locked Cargo dependencies. The recipe stage never
modifies source in the checkout.

Changes to Rust source or embedded protocol inputs rebuild the real binary but
can reuse compiled dependencies when the recipe is unchanged. Dependency
manifests, the Cargo lockfile, target metadata, or compiler changes invalidate
the relevant cache. Ordinary server or UI changes can reuse the entire native
build through the existing registry cache (`mode=max`). Each platform gets its
own native build; no cross-architecture binary is reused. No additional GitHub
Actions cache is created. A cold build also installs the recipe generator and
compiles dependencies, so the savings apply after those layers are available.

Cloud builds import one registry cache: the first available full-SHA cache in
the current commit's ten-entry first-parent ancestry, with the legacy cache
as a final fallback. Each build still exports its own SHA cache with
`mode=max`. In fresh-builder checks, importing several historical manifests
missed native layers that a single matching manifest reused. The selector
inspects metadata after Docker login, stops at the first available cache, and
permits a cold build if no cache can be read.

The application build inherits that stage and still runs the normal server
build, including Cargo, binary staging, and generated-contract checks. Rust
input file times are normalized in both stages so fresh checkouts do not force
Cargo to rebuild unchanged source. Changes made by build scripts still reach
Cargo's normal validation. The final application copy excludes Cargo's target
directory as before. Cache misses only cost compilation time.

Pull requests that change the Dockerfile, Docker ignore rules, or Runner native
inputs also build the isolated `runner-build` target in `Docker Runner check`.
The check runs `bash scripts/check-docker-runner-cache.sh` against a disposable
copy of tracked source and the actual Docker ignore rules. It compiles a baseline
and exports a local cache, removes that builder, changes a Rust metadata constant,
and rebuilds on a fresh builder using only the exported cache. It requires a
cached dependency build, an unchanged dependency recipe, and changed metadata
from the real binary. It also verifies that a dependency declaration change
alters the recipe. The probe exports small metadata results instead of importing
a large test image into the Docker daemon. Temporary builders and cache files
are removed afterward. It catches missing embedded inputs before the post-merge
build. It uses a GitHub-hosted runner with read-only repository access and never
publishes images or registry caches. Allow up to 20 minutes for its cold build and
source rebuild.
