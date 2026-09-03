# Tasks: mycompose v0

**Input:** [SPEC-0.md](./SPEC-0.md), [PLAN.md](./PLAN.md), [CONSTITUTION.md](./CONSTITUTION.md)

**Rules:** Implement in phase order. A later user-story phase must not start until the previous story’s independent test in SPEC-0 passes. Tests are included where they lock a spec rule (argv, status, URL). Do not add auth, proxy, or webhooks.

**Format:** `- [ ] [ID] [P?] [Story?] Description with file path`

- `[P]` = parallelizable (no dependency on incomplete sibling tasks in the same cluster)
- `[USn]` = user story from SPEC-0

---

## Phase 1: Setup

**Goal:** Empty SvelteKit (Bun) app boots, talks to Postgres, Tailwind works.

- [x] T001 Create SvelteKit project in repo root with TypeScript, Svelte 5 runes, `svelte-adapter-bun`, Tailwind v4 (`@tailwindcss/vite`), and Bun as package manager (`package.json`, `svelte.config.js`, `vite.config.ts`, `src/app.html`)
- [x] T002 [P] Add `compose.yaml` with PostgreSQL 16 only (no panel container) and `DATABASE_URL` in `.env.example`
- [x] T003 [P] Add Drizzle (`drizzle.config.ts`, `src/lib/server/db/index.ts`, empty `src/lib/server/db/schema.ts`, `scripts/migrate.ts`, `package.json` scripts `db:migrate` / `db:generate` / `db:studio`)
- [x] T004 [P] English shell layout: `src/routes/+layout.svelte`, `src/routes/+page.svelte` (“mycompose”, empty app list placeholder)
- [x] T005 Verify: `docker compose up -d --wait`, `bun install`, `bun run dev` serves `/` without auth middleware

**Independent test:** Browser shows the mycompose home page; Postgres accepts a connection from the app.

---

## Phase 2: Foundational (blocking for all stories)

**Goal:** Schema, validation, Git/Compose/Docker modules, job queue. No deploy UI yet.

- [x] T006 Schema for `apps`, `app_env_vars`, `deploys` plus checks and `deploys_inflight_uidx` in `src/lib/server/db/schema.ts`; generate migration under `drizzle/`
- [x] T007 [P] Zod validators for slug, HTTPS git URL, compose path (relative, no `..`), env keys in `src/lib/server/validate.ts` with unit tests `tests/unit/validate.test.ts`
- [x] T008 [P] Compose argv builder in `src/lib/server/compose.ts` (`-p mycompose-<slug>`, `--project-directory`, `-f`, `--env-file`, `up -d --build` / `stop` / `start` / `down`); unit test asserts `down` never includes `-v` (`tests/unit/compose.test.ts`)
- [x] T009 [P] Git helper `src/lib/server/git.ts`: `ls-remote`, SHA-pinned shallow fetch into a clean directory; honor `MYCOMPOSE_ALLOW_LOCAL_GIT`; timeouts from PLAN.md
- [x] T010 [P] Docker ping + label inspect wrapper `src/lib/server/docker.ts` (dockerode, `DOCKER_SOCK`)
- [x] T011 [P] Env-file writer `src/lib/server/envfile.ts` with escaping tests `tests/unit/envfile.test.ts`
- [x] T012 In-process queue `src/lib/server/jobs/queue.ts`: per-app serialization, global cap 2, `AbortController`, process-group kill
- [x] T013 Deploy job `src/lib/server/jobs/deploy.ts` implementing PLAN.md pipeline (status transitions, log append + 1 MiB cap, clone then compose, `live_sha` only on success)
- [x] T014 Boot reconcile in `src/hooks.server.ts`: mark interrupted `pending`/`deploying` deploys `failed`
- [x] T015 `GET /api/health` in `src/routes/api/health/+server.ts` returning `{ ok, docker }`
- [x] T016 Log truncation helper unit test `tests/unit/log.test.ts`

**Independent test:** Unit tests green; `/api/health` returns JSON; with Docker down `docker: false` and the process still serves `/`.

---

## Phase 3: User Story 1 — Register and deploy (P1) 🎯 MVP

**Goal:** Operator creates an app from a public (or test-local) Git URL and deploys a compose file.

**Independent test:** SPEC-0 US1 — fixture compose comes up as `mycompose-<slug>`; UI shows SHA and `running`.

- [x] T017 [US1] App list + create UI: `src/routes/+page.server.ts`, `src/routes/+page.svelte`, `src/routes/apps/new/+page.svelte`, `src/routes/apps/new/+page.server.ts` (defaults branch `main`, path `docker-compose.yml`)
- [x] T018 [US1] App detail `src/routes/apps/[slug]/+page.server.ts` and `+page.svelte`: name, slug, status, git fields, Deploy button
- [x] T019 [US1] `?/deploy` form action enqueues job and does not await compose
- [x] T020 [US1] `?/update` action (name, git_url, branch, compose_path; slug immutable)
- [x] T021 [US1] Deploy log page `src/routes/apps/[slug]/deploys/[id]/+page.svelte` reading `log_text` (refresh is enough for P1; SSE can wait until P5)
- [x] T022 [US1] Map unique inflight index errors to “A deploy is already in progress”
- [x] T023 [US1] Fixture `fixtures/sample-compose/` (named volume + a tiny service, e.g. nginx or busybox httpd) and Playwright e2e `tests/e2e/deploy.spec.ts` with `MYCOMPOSE_ALLOW_LOCAL_GIT=1`
- [x] T024 [US1] Failure paths: bad URL, missing compose path, invalid compose — app ends `failed`, log names the cause (e2e or integration)

**Stop here until SC-001 is true.** Do not start env UI until a real deploy works.

---

## Phase 4: User Story 2 — Environment variables (P2)

**Goal:** Per-app env applied on the next deploy; snapshots immutable.

**Independent test:** SPEC-0 US2 — interpolated `${VAR}` visible in running service after deploy, not before.

- [x] T025 [US2] Env section UI + `?/save` on `src/routes/apps/[slug]/env/+page.svelte` (or a section on detail): add/remove rows, reject duplicate keys, allow empty values
- [x] T026 [US2] Deploy job writes `deploy.env` from snapshot and passes `--env-file` (already in argv builder; wire it)
- [x] T027 [US2] Persist `env_snapshot` on the deploy row at job start; later edits do not mutate old rows
- [x] T028 [US2] E2E or integration: fixture compose echoes `$FOO`; set FOO, deploy, assert; change FOO without deploy, assert old value still in container

---

## Phase 5: User Story 3 — Stop, start, destroy (P3)

**Goal:** Day-2 lifecycle without SSH.

**Independent test:** SPEC-0 US3 — stop keeps volumes; start does not clone; destroy removes project and DB row, not named volumes.

- [x] T029 [US3] `?/stop` and `?/start` actions in `src/routes/apps/[slug]/+page.server.ts` calling `src/lib/server/compose.ts`; start must not insert a deploy or clone
- [x] T030 [US3] Disable buttons according to status (Start only when `stopped`, etc.) in `src/routes/apps/[slug]/+page.svelte`
- [x] T031 [US3] Destroy with confirm-slug field; abort inflight job; `compose down` without `-v`; delete app row (cascade); `rm -rf` `$DATA/apps/<slug>`
- [x] T032 [US3] E2E: deploy → write marker into named volume → stop → start → marker remains → destroy → `docker compose -p mycompose-<slug> ps` empty → volume still exists on host

---

## Phase 6: User Story 4 — Deploy history (P4)

**Goal:** History list and live SHA are the Git source-of-truth UX.

**Independent test:** SPEC-0 US4 — two deploys, two rows, live SHA is last success after a failure.

- [x] T033 [US4] History table on app detail (newest first: short SHA, status, timestamps, duration, link to log)
- [x] T034 [US4] Header live SHA from `apps.live_sha`; failed deploy does not overwrite it
- [x] T035 [US4] While `deploying`, history shows inflight row; Deploy button disabled
- [x] T036 [US4] E2E: succeed, then fail (bad path), list has both; header SHA is the success

---

## Phase 7: User Story 5 — Build and container logs (P5)

**Goal:** Follow deploy output without refresh; follow container stdout.

**Independent test:** SPEC-0 US5.

- [x] T037 [US5] SSE `src/routes/api/apps/[slug]/deploys/[id]/logs/+server.ts` polling `log_text` every 400ms until terminal status
- [x] T038 [US5] Log viewer component `src/lib/components/LogViewer.svelte` used on deploy page and detail
- [x] T039 [US5] SSE `src/routes/api/apps/[slug]/logs/+server.ts` spawning `docker compose logs --follow --tail 200`; kill child on client abort; optional `?service=`
- [x] T040 [US5] Stopped app: container log UI shows “No running containers”, no crash
- [x] T041 [US5] Truncation notice when `log_truncated` is true

---

## Phase 8: User Story 6 — CPU and memory (P6)

**Goal:** Best-effort live stats per service.

**Independent test:** SPEC-0 US6.

- [x] T042 [US6] `GET /api/apps/[slug]/runtime` in `src/routes/api/apps/[slug]/runtime/+server.ts`: ping Docker; list containers with `com.docker.compose.project=mycompose-<slug>`; one-shot stats; published ports; explicit `unavailable` per service when stats missing
- [x] T043 [US6] Detail page polls every 3s; stopped/destroyed show no live consumption; Docker-down banner (FR-017, SC-008)
- [x] T044 [US6] Port list from runtime payload on the header (FR-015, SC-007) if not already shown in P1

---

## Phase 9: User Story 7 — Terminal (P7)

**Goal:** Interactive `/bin/sh` in a running service.

**Independent test:** SPEC-0 US7.

- [x] T045 [US7] Shared exec upgrade `src/lib/server/exec-ws.ts`: resolve container by project+service labels; reject if not running; Engine TTY hijack; `/bin/sh` then `/bin/bash`; cleanup on socket close
- [x] T046 [US7] Production: `handleWebsocket` in `src/hooks.server.ts` for `/ws/apps/<slug>/services/<service>/exec`
- [x] T047 [US7] Dev: `scripts/ws-dev.ts` + Vite proxy in `vite.config.ts`
- [x] T048 [US7] `src/lib/components/ServiceTerminal.svelte` (xterm.js); disable when service not running
- [x] T049 [US7] Manual/e2e: `pwd` in fixture service; close tab cleans exec; image without shell errors instead of hanging

---

## Phase 10: Polish

- [x] T050 Help text on create/edit: HTTPS-only public git; named volumes persist; clone-dir bind mounts are unsupported
- [x] T051 README with quickstart from PLAN.md (English)
- [x] T052 `bun run check` and `bun run lint` clean
- [ ] T053 Optional: panel Dockerfile mounting Docker socket — only after P7, not required for v0 acceptance

---

## Dependency graph

```
Phase 1 → Phase 2 → US1 (P1)
                      ↓
                    US2 (P2)
                      ↓
                    US3 (P3)
                      ↓
                    US4 (P4)
                      ↓
                    US5 (P5)
                      ↓
                    US6 (P6)
                      ↓
                    US7 (P7) → Polish
```

US4 UI can reuse deploy rows from US1. US5 SSE can replace US1 refresh-the-log. US6 runtime can supply ports for US1 if the header is still incomplete.

## Parallel opportunities

- T002, T003, T004 after T001
- T007–T011 after T006
- T025 UI vs T026/T027 job wiring
- T045 vs T048 once runtime (T042) can list services

## Definition of done per story

The SPEC-0 **Independent Test** paragraph for that story, plus the listed acceptance scenarios. SC-001 is the gate out of Phase 3.
