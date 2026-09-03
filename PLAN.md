# Implementation Plan: mycompose v0

**Date:** 2026-09-01  
**Spec:** [SPEC-0.md](./SPEC-0.md)  
**Constitution:** [CONSTITUTION.md](./CONSTITUTION.md)  
**Tasks:** [TASKS.md](./TASKS.md)

## Summary

Build a single-process SvelteKit (Bun) control plane that stores apps and deploy history in PostgreSQL, clones public Git repos onto the host, and runs `docker compose` against those checkouts. HTTP request handlers never wait for `compose up`. A small in-process job runner owns clone/build/up, appends logs, and is abortable on destroy. Live logs and metrics use SSE/JSON over HTTP so they work in `vite dev`. The interactive terminal (P7) uses a WebSocket plus Docker exec, isolated behind a shared handler so Vite and production can attach differently.

P1 (create app + deploy) is the vertical slice that proves the architecture. Everything else hangs off the same Git/Compose/job/runtime modules.

## Technical context

| Item                              | Choice                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Language                          | TypeScript (strict), Svelte 5 runes                                               |
| App                               | SvelteKit 2, adapter `svelte-adapter-bun`                                         |
| Runtime / package manager         | Bun                                                                               |
| CSS                               | Tailwind CSS v4 (`@tailwindcss/vite`)                                             |
| DB                                | PostgreSQL 16, `drizzle-orm` + `postgres` (postgres.js), `drizzle-kit` migrations |
| Validation                        | Zod                                                                               |
| Git                               | Host `git` binary via `Bun.spawn`                                                 |
| Compose lifecycle                 | Host `docker compose` v2 CLI via `Bun.spawn`                                      |
| Engine API (ping, ps/stats, exec) | `dockerode` against `DOCKER_HOST` / `/var/run/docker.sock`                        |
| Jobs                              | In-process queue (one Bun process). No Redis, no extra worker service             |
| Deploy/container logs             | SSE (`text/event-stream`)                                                         |
| Metrics                           | JSON poll every 3s                                                                |
| Terminal                          | xterm.js + WebSocket → Docker exec TTY                                            |
| Tests                             | Vitest (unit), Playwright (e2e), Docker-gated integration tests                   |
| Scale                             | One host, tens of apps, one inflight deploy per app                               |

## Constitution check

| Gate                              | Status                                                 |
| --------------------------------- | ------------------------------------------------------ |
| Spec-first, no extra capabilities | Pass — plan stays inside SPEC-0 §4                     |
| P1→P7 order                       | Pass — modules exist early; UI/features gated by story |
| Dual source of truth              | Pass — Git / Postgres / Docker roles below             |
| No auth                           | Pass                                                   |
| No `down -v`                      | Pass — destroy flags documented                        |
| Stack lock                        | Pass                                                   |
| Fail visible                      | Pass — deploy log + status machine                     |

## Key decisions

### D1 — One Bun process, in-process jobs (not a worker service)

`compose up --build` can run for minutes. The form action that starts a deploy must: insert a `deploys` row (`pending`), set app `deploying`, enqueue work, return immediately.

A module-level queue (`src/lib/server/jobs/queue.ts`) runs one job at a time _per app_, with an `AbortController`. Global parallelism: unbounded across apps, serialized per app. For v0, also cap **global** inflight deploys at 2 so two huge builds cannot melt the host (constant `MAX_GLOBAL_DEPLOYS = 2`; extras stay `pending` and start when a slot frees).

**Rejected:** HTTP handler awaits compose (timeouts, proxy buffers). **Rejected:** Redis/Bull — one host, one process. **Rejected:** detached systemd units — opaque to the panel.

On boot (`hooks.server.ts`): any deploy still `pending`/`deploying` is marked `failed` with `Interrupted by process restart`. Apps in `deploying` fall back to `failed` unless a live SHA exists (then `running` is wrong — set `failed` and let the operator redeploy; do not guess Docker state on boot beyond an optional reconcile in P3+).

### D2 — Compose CLI for stacks, Engine API for inspect/exec

Compose v2 interpolation, `--env-file`, build contexts, and project names are the product. Re-implementing them is out of scope.

```
docker compose \
  -p mycompose-<slug> \
  --project-directory <repoRoot> \
  -f <composePath> \
  --env-file <envFile> \
  <up -d --build | stop | start | down | logs | ps>
```

- **Never** pass `-v` to `down`.
- `--project-directory` is the clone root so relative `build:` contexts work even if the compose file is nested.
- `-f` is the operator-supplied relative path, resolved then checked to stay inside `repoRoot` (no `..`).

`dockerode` is used for: daemon ping, listing containers by compose labels, one-shot stats, exec attach. **Rejected:** talking to Compose only through the Engine API (no stable Compose client in JS that we trust). **Rejected:** shelling out for `docker exec` (TTY and cleanup are worse).

### D3 — Pin SHA, then clone (not `git pull`)

1. `git ls-remote <url> refs/heads/<branch>` → SHA (timeout 30s).
2. Replace `$DATA/apps/<slug>/repo` entirely (rm + mkdir).
3. Shallow fetch of that SHA:

```
git init
git remote add origin <url>
git fetch --depth 1 origin <sha>
git checkout --detach FETCH_HEAD
```

Timeout 120s. If SHA is gone from the remote, fail the deploy _before_ compose. Previous stack is untouched.

**Rejected:** `git clone --branch` then hope HEAD matches (race with push). **Rejected:** isomorphic-git (slow, submodule-shaped gaps we do not want to paper over).

Bind mounts that point at the clone directory are **unsupported**: the directory is wiped every deploy. Named volumes are the persistence path. Document this in the UI help text on the compose-path field.

### D4 — Env overlay is a file written at deploy start

At the start of a job, snapshot `app_env_vars` into `deploys.env_snapshot` (JSONB) and write `$DATA/apps/<slug>/deploy.env` (KEY=VALUE, docker `--env-file` syntax, values escaped). Compose interpolation and container env both see this file. Editing env in the UI does not rewrite the file until the next deploy (SPEC-0 US2).

Empty string values are allowed. Keys: `^[A-Za-z_][A-Za-z0-9_]*$`. Duplicate keys rejected in Zod.

### D5 — Logs: persist deploy output in Postgres; stream with SSE

Each spawn’s stdout/stderr is appended to `deploys.log_text` in ~4KiB chunks (`UPDATE … SET log_text = log_text || $chunk`). Cap at **1 MiB**; then set `log_truncated = true` and stop appending after a final `\n\n[log truncated]\n`.

Live view: `GET` SSE that polls the row every 400ms until status is `succeeded` or `failed`, then sends the remainder and closes. Works in Vite and production. No WebSocket for logs.

Container logs (P5): `docker compose logs --follow --tail 200` as a child process; SSE forwards lines; abort the child when the client disconnects.

### D6 — Terminal is P7 and WebSocket-only

xterm.js in the browser. Server upgrades `/ws/apps/<slug>/services/<service>/exec`. Handler looks up the container by compose project + service label, `dockerode` exec with `Tty: true`, `Cmd: ['/bin/sh']` (if that fails, try `/bin/bash`, then error). Resize messages from the client call exec resize.

**Dev:** Vite does not speak Bun WebSockets. `scripts/ws-dev.ts` is a small `Bun.serve` on `5174` that imports the same `handleExecUpgrade` module. `vite.config.ts` proxies `/ws` → `ws://localhost:5174`. Production uses `handleWebsocket` from `svelte-adapter-bun` in `hooks.server.ts`.

If the service is not running, the upgrade is rejected with HTTP 409 before the socket opens.

### D7 — Status model

**App.status** (persisted): `draft` | `deploying` | `running` | `stopped` | `failed`

| Event            | App status  | live_sha                              |
| ---------------- | ----------- | ------------------------------------- |
| Created          | `draft`     | null                                  |
| Deploy enqueued  | `deploying` | unchanged                             |
| Deploy succeeded | `running`   | new SHA                               |
| Deploy failed    | `failed`    | unchanged (previous live SHA remains) |
| Stop             | `stopped`   | unchanged                             |
| Start            | `running`   | unchanged                             |
| Destroy          | row deleted | —                                     |

**Deploy.status:** `pending` → `deploying` → `succeeded` | `failed`

FR-006: unique **partial** index `UNIQUE (app_id) WHERE status IN ('pending','deploying')`. A second Deploy gets a constraint error, mapped to “A deploy is already in progress”.

Live SHA on the detail header is `apps.live_sha`, not “latest deploy row”.

When Docker is reachable, the detail page **overlays** container state (ports, running/exited) from Engine labels. If Docker is down, show persisted status plus the banner “Docker is unavailable”.

### D8 — Project and paths

- Compose project name: `mycompose-<slug>`
- Slug: `^[a-z][a-z0-9-]{0,46}[a-z0-9]$` or a single char `^[a-z]$`, max 48, **immutable** after insert
- Data dir: `MYCOMPOSE_DATA_DIR` (dev default `./data`, prod `/var/lib/mycompose`)
- Per app: `$DATA/apps/<slug>/repo/`, `$DATA/apps/<slug>/deploy.env`
- Docker socket: `DOCKER_SOCK` default `/var/run/docker.sock`
- Git URLs: `https:` only. Userinfo (embedded credentials) rejected. Test-only: `MYCOMPOSE_ALLOW_LOCAL_GIT=1` permits `file://` and absolute paths so e2e does not need GitHub.

### D9 — Panel does not deploy itself in v0

Dev: `compose.yaml` runs **only Postgres**. The SvelteKit app runs on the host with `bun run dev`, using the host Docker socket and host `git`. This avoids a chicken-and-egg of the panel composing itself.

A production `Dockerfile` + compose that mounts the socket is **polish**, after P7, not a story blocker.

### D10 — No component library, no i18n, no auth package

Tailwind utilities. English copy in the templates. No better-auth. SvelteKit’s built-in origin CSRF check stays on.

## Alternatives considered

| Topic         | Chosen                   | Rejected                                  | Why                                                                  |
| ------------- | ------------------------ | ----------------------------------------- | -------------------------------------------------------------------- |
| ORM           | Drizzle                  | Prisma                                    | Matches sibling Bun kits; thin SQL; easy JSONB                       |
| Adapter       | svelte-adapter-bun       | adapter-node                              | Locked: Bun runtime                                                  |
| Jobs          | In-process               | Redis, pg-boss, detached processes        | One process, abortable, enough for tens of apps                      |
| Stack control | `docker compose` CLI     | Compose spec reimplementation, Stackstorm | Interpolation + build must match Docker’s                            |
| Git           | system git               | isomorphic-git, hosted API                | SHA pin + shallow fetch; public HTTPS; no tokens                     |
| Log stream    | SSE                      | WebSocket, polling only                   | SSE is trivial in Vite; persist + poll is correct                    |
| Terminal      | WS + dockerode exec      | `docker exec` pipe, ttyd sidecar          | One extra container type is against “limited”; CLI pipe loses resize |
| IDs           | UUID (`gen_random_uuid`) | nanoid / slug ids                         | No extra dep; not user-facing                                        |
| Validation    | Zod                      | Valibot                                   | Slightly more common for agents; both fine                           |

## Architecture

```
Browser
  ├── pages / form actions (SvelteKit)
  ├── EventSource  →  /api/.../logs          (SSE)
  ├── fetch poll   →  /api/.../runtime       (ports + stats)
  └── WebSocket    →  /ws/apps/.../exec      (P7)

SvelteKit (Bun)
  ├── routes (UI + actions)
  ├── lib/server/db          Drizzle
  ├── lib/server/git         ls-remote + fetch SHA
  ├── lib/server/compose     spawn docker compose
  ├── lib/server/docker      dockerode: ping, stats, exec, labels
  ├── lib/server/jobs        queue + deploy pipeline
  └── hooks.server.ts        boot reconcile + (prod) WebSocket

Host
  ├── git
  ├── docker compose v2
  ├── Docker Engine socket
  ├── $MYCOMPOSE_DATA_DIR/apps/<slug>/
  └── PostgreSQL (compose service `db`)
```

### Deploy pipeline (job)

1. Load app + env. If missing, fail.
2. Mark deploy `deploying`, app `deploying`.
3. Validate HTTPS URL (or local git flag).
4. `ls-remote` → SHA; store on the deploy row immediately.
5. Snapshot env to JSONB + write `deploy.env`.
6. Wipe and clone SHA into `repo/`.
7. Assert compose path exists and is a file inside repo root.
8. `docker compose … up -d --build` with abort signal; stream output to log.
9. Timeout **15 minutes**. On abort/timeout, mark `failed`, leave whatever Compose already created (no automatic rollback — documented).
10. Exit 0 → deploy `succeeded`, app `running`, `live_sha = sha`. Non-zero → deploy `failed`, app `failed`, `live_sha` unchanged.

Clone failure stops before step 8, so the previous stack stays.

Destroy while deploying: abort controller → spawn killed (process group) → deploy `failed` with “Cancelled” → then `compose down` (no `-v`) → delete rows → `rm -rf` data dir.

## Data model

### `apps`

| Column                  | Type                 | Notes                             |
| ----------------------- | -------------------- | --------------------------------- |
| id                      | uuid pk              | default `gen_random_uuid()`       |
| name                    | text not null        | display, editable                 |
| slug                    | text not null unique | immutable; compose project suffix |
| git_url                 | text not null        |                                   |
| branch                  | text not null        | default `'main'`                  |
| compose_path            | text not null        | default `'docker-compose.yml'`    |
| status                  | text not null        | check in enum set                 |
| live_sha                | text null            | 40-char hex when set              |
| created_at / updated_at | timestamptz          |                                   |

Check: `status in ('draft','deploying','running','stopped','failed')`.  
Slug check: SQL regex matching D8.

### `app_env_vars`

| Column               | Type                             | Notes                |
| -------------------- | -------------------------------- | -------------------- |
| id                   | uuid pk                          |                      |
| app_id               | uuid fk → apps on delete cascade |                      |
| key                  | text not null                    |                      |
| value                | text not null                    | empty string allowed |
| unique (app_id, key) |                                  |                      |

### `deploys`

| Column        | Type                             | Notes                              |
| ------------- | -------------------------------- | ---------------------------------- |
| id            | uuid pk                          |                                    |
| app_id        | uuid fk → apps on delete cascade |                                    |
| git_url       | text                             | snapshot                           |
| branch        | text                             | snapshot                           |
| sha           | text null                        | filled after ls-remote             |
| compose_path  | text                             | snapshot                           |
| env_snapshot  | jsonb not null                   | `{}` default                       |
| status        | text not null                    | pending/deploying/succeeded/failed |
| log_text      | text not null                    | default `''`                       |
| log_truncated | boolean not null                 | default false                      |
| error_summary | text null                        | short; UI list uses this           |
| started_at    | timestamptz not null             | now()                              |
| finished_at   | timestamptz null                 |                                    |

Indexes:

- `deploys_app_started_idx` on `(app_id, started_at desc)`
- `deploys_inflight_uidx` **unique** on `app_id` **where** `status in ('pending','deploying')`

Runtime (ports, CPU, memory, container ids) is **not** a table.

## Contracts (HTTP)

Form actions (progressive enhancement, also used as POST):

| Action                           | Effect                                       |
| -------------------------------- | -------------------------------------------- |
| `POST /apps/new`                 | create app, redirect to `/apps/<slug>`       |
| `POST /apps/<slug>` `?/update`   | edit name/url/branch/path (not slug)         |
| `POST /apps/<slug>` `?/deploy`   | enqueue deploy, redirect to app (stay)       |
| `POST /apps/<slug>` `?/stop`     | compose stop                                 |
| `POST /apps/<slug>` `?/start`    | compose start                                |
| `POST /apps/<slug>` `?/destroy`  | confirm field `confirm=<slug>`, then destroy |
| `POST /apps/<slug>/env` `?/save` | replace env set                              |

JSON/SSE:

| Endpoint                                      | Purpose                                                               |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/health`                             | `{ ok, docker: boolean }`                                             |
| `GET /api/apps/<slug>/runtime`                | services, ports, cpu, memory; `dockerUnavailable: true` if ping fails |
| `GET /api/apps/<slug>/deploys/<id>/logs`      | SSE, deploy log                                                       |
| `GET /api/apps/<slug>/logs?service=`          | SSE, compose logs (P5)                                                |
| `GET /ws/apps/<slug>/services/<service>/exec` | WebSocket upgrade (P7)                                                |

Pages:

| Path                        | Story                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `/`                         | list apps                                                                             |
| `/apps/new`                 | create                                                                                |
| `/apps/<slug>`              | detail: status, SHA, ports, actions; later env/history/logs/metrics/terminal sections |
| `/apps/<slug>/deploys/<id>` | full deploy log page                                                                  |

## Project structure

```text
mycompose/
├── SPEC-0.md
├── CONSTITUTION.md
├── PLAN.md
├── TASKS.md
├── compose.yaml                 # postgres only
├── drizzle.config.ts
├── drizzle/                     # generated SQL
├── package.json
├── svelte.config.js             # svelte-adapter-bun, runes
├── vite.config.ts               # tailwind + /ws proxy in dev
├── scripts/
│   ├── migrate.ts
│   └── ws-dev.ts                # Bun.serve WebSocket in vite dev
├── fixtures/
│   └── sample-compose/          # tiny compose used by e2e (git init in test)
├── src/
│   ├── hooks.server.ts
│   ├── app.d.ts
│   ├── routes/
│   │   ├── +layout.svelte
│   │   ├── +page.server.ts
│   │   ├── +page.svelte
│   │   ├── apps/
│   │   │   ├── new/
│   │   │   └── [slug]/
│   │   └── api/
│   └── lib/
│       ├── server/
│       │   ├── db/{index,schema,migrate}.ts
│       │   ├── git.ts
│       │   ├── compose.ts
│       │   ├── docker.ts
│       │   ├── envfile.ts
│       │   ├── jobs/{queue,deploy}.ts
│       │   └── exec-ws.ts
│       └── components/          # status badge, log viewer, later xterm
└── tests/
    ├── unit/
    └── e2e/
```

## Timeouts and limits

| Operation                 | Limit                                       |
| ------------------------- | ------------------------------------------- |
| `git ls-remote`           | 30s                                         |
| clone/fetch               | 120s                                        |
| `compose up --build`      | 15 min                                      |
| `compose stop/start/down` | 60s                                         |
| Deploy log                | 1 MiB                                       |
| Global inflight deploys   | 2                                           |
| Inflight deploys per app  | 1 (DB unique + map)                         |
| Metrics poll              | 3s, stats stream disabled (`stream: false`) |
| Container log SSE tail    | last 200 lines then follow                  |

Spawn must use a **process group** (`detached` / `posix_spawn` setsid as Bun allows) so abort kills `docker compose` and its children, not just the parent.

## UI notes (not a mock)

Operator console, not a marketing site.

- List: name, slug, status badge, live SHA short, last deploy time.
- Detail header: name, status, live SHA, published ports as `host:port` links (`http://<panel-hostname>:<port>` is wrong if the panel is remote — show `:<hostPort>` and the host port from Docker; operator knows the machine).
- Actions always visible but disabled with a reason (e.g. Deploy disabled while `deploying`; Start disabled unless `stopped`).
- Destroy: type the slug to confirm.
- Help text: public HTTPS only; named volumes persist; clone dir bind mounts do not.

## Environment

```
DATABASE_URL=postgres://...
MYCOMPOSE_DATA_DIR=./data
DOCKER_SOCK=/var/run/docker.sock
MYCOMPOSE_ALLOW_LOCAL_GIT=0
ORIGIN=http://localhost:5173
```

`DATABASE_URL` required at boot. Data dir created on first deploy if missing.

## Testing strategy

- **Unit (no Docker):** URL/slug/path validation; env-file encoding; status transitions; log truncation helper; compose argv builder (assert `-v` never present).
- **Integration (Docker required):** tagged `docker`; deploy fixture compose; assert project `mycompose-<slug>` comes up; second deploy keeps a named volume file.
- **E2E:** Playwright against `bun run dev`; `MYCOMPOSE_ALLOW_LOCAL_GIT=1`; fixture repo copied + `git init`; SC-001 path for P1.

Do not hit the public internet in CI.

## Quickstart (after P1 lands)

```bash
bun install
docker compose up -d --wait   # postgres
bun run db:migrate
bun run dev                   # http://localhost:5173
```

Host needs `git` and Docker Engine with the Compose v2 plugin.

## Risks

| Risk                                             | Mitigation                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `docker compose up` mutates the stack then fails | No rollback; live_sha only on success; logs show the failure                                             |
| Vite + WebSocket                                 | P7 only; dedicated `ws-dev.ts`; P1–P6 do not need it                                                     |
| dockerode + Bun                                  | Use it behind a thin module; if broken, Engine HTTP + unix fetch for ping/stats, keep dockerode for exec |
| Panel running as user not in `docker` group      | Fail ping with “Docker is unavailable” + socket path in server log                                       |
| Huge builds filling disk                         | Out of scope; operator’s host                                                                            |
| Untrusted compose (privileged)                   | Accepted in SPEC-0 §11                                                                                   |

## What this plan will not do

Anything in SPEC-0 §4. Also: no rewrite of compose, no auto `compose.yaml` detection, no slug rename, no volume browser, no panel-in-Docker until polish.

## Suggested PR / merge slices

Aligned with stories; each is reviewable.

1. **Scaffold + schema** — SvelteKit/Bun/Tailwind/Drizzle/Postgres compose, empty list page.
2. **P1 Deploy** — CRUD apps + job + git + compose up + deploy row + basic log page (polling or SSE).
3. **P2 Env** — env CRUD + `--env-file` + snapshot.
4. **P3 Lifecycle** — stop/start/destroy + abort in-flight.
5. **P4 History** — history table, live SHA header, inflight uniqueness UX.
6. **P5 Logs** — live deploy SSE polish + container logs SSE.
7. **P6 Metrics** — runtime JSON + CPU/memory on detail.
8. **P7 Terminal** — xterm + exec WebSocket + ws-dev.

P4 is partly implied by P1 (a deploy row already exists). The P4 slice is the dedicated history UI and live-SHA rules, not a second table.

Next artifact to execute: [TASKS.md](./TASKS.md), starting at Setup then P1 until SPEC-0 SC-001 is true.
