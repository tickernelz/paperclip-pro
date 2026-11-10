---
title: Docker
summary: Docker Compose quickstart
---

Run Wardmote in Docker without installing Node or pnpm locally.

## Compose Quickstart (Recommended)

```sh
docker compose -f docker/docker-compose.quickstart.yml up --build
```

Open [http://localhost:3100](http://localhost:3100).

Defaults:

- Host port: `3100`
- Data directory: `./data/docker-wardmote`

Override with environment variables:

```sh
WARDMOTE_PORT=3200 WARDMOTE_DATA_DIR=../data/pc \
  docker compose -f docker/docker-compose.quickstart.yml up --build
```

**Note:** `WARDMOTE_DATA_DIR` is resolved relative to the compose file (`docker/`), so `../data/pc` maps to `data/pc` in the project root.

## Manual Docker Build

```sh
docker build -t wardmote-local .
docker run --name wardmote \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e WARDMOTE_HOME=/wardmote \
  -v "$(pwd)/data/docker-wardmote:/wardmote" \
  wardmote-local
```

## Data Persistence

All data is persisted under the bind mount (`./data/docker-wardmote`):

- Embedded PostgreSQL data
- Uploaded assets
- Local secrets key
- Agent workspace data

## Provider CLIs in Docker

The Docker image pre-installs the `claude`, `codex`, and `opencode` CLIs. The experimental Wardmote Runner and AI connection checks use them; OMP agents do not need them.

Pass provider keys when you use those features:

```sh
docker run --name wardmote \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e WARDMOTE_HOME=/wardmote \
  -e OPENAI_API_KEY=sk-... \
  -e ANTHROPIC_API_KEY=sk-... \
  -v "$(pwd)/data/docker-wardmote:/wardmote" \
  wardmote-local
```

Without API keys, the app runs normally — adapter environment checks will surface missing prerequisites.
