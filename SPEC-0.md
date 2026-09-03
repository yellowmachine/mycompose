# SPEC-0: mycompose

**Status:** Draft  
**Created:** 2026-09-01  
**Product:** mycompose  
**Kind:** Product specification (what / why). Implementation shape belongs in a later plan spec.

## 1. Vision

mycompose is a single-host control panel for running Docker Compose stacks. Each stack is defined by a **public Git repository**. The operator pastes a Git URL, optionally sets a branch, compose-file path, and environment variables, then presses **Deploy**. The panel clones that commit, runs the compose file on the same machine, and keeps the result visible: status, history, logs, resource use, and a shell into a service.

It is deliberately smaller than Dokploy / Coolify. There is no reverse proxy, no Git webhook, no private-repo credentials, and no authentication in this version. Git is the source of truth for **what runs**. The panel is the source of truth for **operator overlay** (which repo, which branch, which env vars) and for **what happened** (deploy history).

## 2. Problem

Self-hosting several compose apps on one VPS today means SSH, ad-hoc directories, and `docker compose up` with no shared record of _which commit_ is live. Full PaaS tools (Dokploy, Coolify) solve this with a large surface: auth, domains, builders, databases as first-class objects, multi-server. mycompose covers the thin loop: **register a public repo → deploy compose → observe and control the stack**.

## 3. Goals

- G1. An operator can register a public Git repo as an app and deploy its Compose file from the UI with one action.
- G2. Every deploy is an immutable record: Git URL, branch, commit SHA, compose path, env snapshot, status, timestamps, and build output.
- G3. The operator can stop, start, redeploy, and destroy a stack without SSH.
- G4. The operator can set per-app environment variables that are applied on the next deploy and used for Compose interpolation.
- G5. The operator can read deploy logs and live container logs, see CPU/memory per service, and open a terminal into a running service.
- G6. Redeploy rebuilds/recreates containers and **leaves named volumes intact**.

## 4. Non-goals (v0)

- Authentication, users, roles, or CSRF-hardened multi-user access.
- Private Git repositories, SSH deploy keys, GitHub Apps, or Git tokens.
- Automatic deploy on git push (webhooks or polling).
- Reverse proxy, virtual hosts, TLS, or assigned domains. Published Compose `ports` are the public surface.
- Dockerfile-only apps, Nixpacks/buildpacks, or registry-image apps that are not declared in a compose file.
- Multi-host, Docker Swarm, or Kubernetes.
- First-class managed databases, backups, or volume browsers. A compose file may still declare Postgres/Redis; mycompose treats them as ordinary services.
- One-click templates, preview environments, notifications, or a public API product.
- Sandboxing or rewriting untrusted compose files (privileged, host network, bind mounts). The operator must trust the repo.
- Git submodules, Git LFS, or multiple compose override files (v0 uses **one** relative compose path).
- Removing named volumes from the UI (`docker compose down -v`). Leftover volumes after destroy are a manual/host concern.

## 5. Locked constraints

These are decided for v0 and must not be silently changed in later specs:

| Constraint         | Decision                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| UI + control plane | SvelteKit, runtime **Bun**                                                                                       |
| Styling            | Tailwind CSS                                                                                                     |
| Panel persistence  | PostgreSQL                                                                                                       |
| Auth               | None. Anyone who can reach the panel has full control.                                                           |
| Workload source    | Public Git clone over HTTPS only                                                                                 |
| Workload runtime   | Docker Engine on the **same host** as the panel, via the local Docker API/socket                                 |
| Workload format    | A Docker Compose file inside the cloned repo                                                                     |
| Deploy trigger     | Explicit **Deploy** button in the UI only                                                                        |
| Ingress            | Whatever the compose file publishes with `ports:`                                                                |
| Volume policy      | Redeploy and stop/start **reuse** named volumes (`compose up --build`; never `down -v` as part of normal deploy) |
| Language           | English for this spec, for code identifiers, and for all UI copy                                                 |

## 6. Actors

- **Operator** — a trusted person on a private network (LAN, VPN, or SSH tunnel) who uses the panel. There is no login. This is the only actor.

There is no end-user of the deployed apps inside mycompose. Those apps are reached through the ports Compose publishes.

## 7. Core concepts

- **App** — a named panel record: public Git URL, branch, relative compose-file path, slug, env vars, desired lifecycle. It is the operator overlay.
- **Deploy** — one attempt to materialize an app at a specific Git commit. Immutable after it finishes (success or failure). The Git tree at that SHA is the source of truth for that attempt.
- **Stack** — the Docker Compose project on the host that belongs to an app (`docker compose -p <project>`). Isolated from other apps by project name.
- **Service** — a service declared in the compose file (web, db, worker, …).

**Dual source of truth**

| Question                                                               | Source                                  |
| ---------------------------------------------------------------------- | --------------------------------------- |
| What image/build/command/volumes does a service have?                  | Git commit of the deploy                |
| Which repo, branch, compose path, env vars should the next deploy use? | App record in PostgreSQL                |
| What is currently running, and which SHA is live?                      | Latest successful deploy + Docker state |
| What happened last Tuesday?                                            | Deploy history in PostgreSQL            |

## 8. User scenarios and testing

Stories are independently demonstrable. P1 alone is a useful MVP. Later stories add control and observability. All of the following are **in scope for v0**.

### User Story 1 — Register an app and deploy from public Git (Priority: P1)

The operator opens the panel, creates an app with a name, a public HTTPS Git URL, a branch (default `main`), and a compose-file path (default `docker-compose.yml`). They press **Deploy**. The panel resolves the branch to a commit SHA, clones that commit, runs Compose against the given file, and shows whether the stack is running or failed.

**Why this priority:** Without this loop the product does not exist.

**Independent test:** Point the panel at a known public repo that contains a valid compose file (for example a two-service `web` + `redis` sample). After Deploy, `docker compose ps` for that project shows services up, and the UI shows the commit SHA and status `running`.

**Acceptance scenarios:**

1. **Given** no apps, **When** the operator submits name + valid public Git URL + branch `main` + path `docker-compose.yml` and deploys, **Then** a clone of `main`'s HEAD is stored, Compose runs, a deploy record exists with that SHA and status `succeeded`, and the app status is `running`.
2. **Given** a URL that is not a public Git repo (404, private, not git), **When** they deploy, **Then** the deploy fails with a readable error, no stack is left half-defined as `running`, and the app remains so they can fix the URL.
3. **Given** a public repo whose compose path does not exist, **When** they deploy, **Then** the deploy fails with an error that names the missing path.
4. **Given** an invalid compose file, **When** they deploy, **Then** the deploy fails, Compose error output is stored on the deploy, and app status is `failed`.
5. **Given** an existing app, **When** the operator edits URL/branch/path and deploys again, **Then** a new deploy record is created for the new SHA; the previous deploy remains in history.

---

### User Story 2 — Environment variables as operator overlay (Priority: P2)

The operator sets key/value environment variables on the app. They are **not** committed to Git. The next deploy passes them to Compose so `${VAR}` interpolation in the compose file works, and so services can read them as environment.

**Why this priority:** Real compose files need secrets and host-specific values; without env, many public repos cannot actually boot.

**Independent test:** A compose file that interpolates `IMAGE_TAG` or `POSTGRES_PASSWORD`. Set the var in the panel, deploy, confirm the running service received it (inspect or app behavior). Change the var, deploy again, confirm the new value is live. History of the previous deploy still shows the old snapshot.

**Acceptance scenarios:**

1. **Given** an app with env `FOO=bar`, **When** a deploy runs, **Then** Compose interpolation and container environment see `FOO=bar`, and the deploy record stores a snapshot of the keys and values used.
2. **Given** a running app, **When** the operator changes env but does not deploy, **Then** running containers keep the old values until the next deploy.
3. **Given** empty values or duplicate keys, **When** the operator saves, **Then** the UI rejects duplicates; empty values are allowed only if explicitly saved as empty string.
4. **Given** a deploy snapshot, **When** the operator later edits env on the app, **Then** historical deploys do not change.

---

### User Story 3 — Stop, start, destroy (Priority: P3)

From the app page the operator can **Stop** (containers stop, volumes stay), **Start** (existing containers start), and **Destroy** (containers and compose networks removed, named volumes **kept**, app record removed from the panel).

**Why this priority:** Deploy without on/off/delete forces SSH for day-2 operations.

**Independent test:** Deploy, stop, confirm process is not running and volume data still exists; start, confirm the same volume is reused; destroy, confirm the compose project is gone and the app no longer appears in the list.

**Acceptance scenarios:**

1. **Given** a running app, **When** the operator stops it, **Then** containers are stopped, app status is `stopped`, named volumes still exist, and Git history is unchanged.
2. **Given** a stopped app, **When** the operator starts it, **Then** containers start without a new Git clone (no new deploy record), status is `running`.
3. **Given** a stopped or failed app, **When** the operator deploys, **Then** that is a new deploy (clone + `up --build`), not a start.
4. **Given** any app, **When** the operator destroys it and confirms, **Then** the compose project is removed (`down` without `-v`), the app and its env disappear from the panel, deploy history for that app is deleted or no longer listed, and named volumes remain on the host.
5. **Given** a destroy, **When** the operator does not confirm, **Then** nothing is removed.

---

### User Story 4 — Deploy history (Priority: P4)

Each Deploy click produces a history row: time, SHA (short and full), branch, status (`pending` → `running`/`succeeded`/`failed`), duration, and a link to that deploy's logs. The app shows which SHA is currently live (last successful deploy that is still the running stack).

**Why this priority:** Git as source of truth is meaningless if the panel cannot say which commit is in production.

**Independent test:** Deploy twice (or force a failing then a succeeding deploy). History lists both in reverse chronological order with distinct SHAs/statuses. The header shows the live SHA of the last success.

**Acceptance scenarios:**

1. **Given** three deploy attempts, **When** the operator opens the app, **Then** they see three rows, newest first, each with SHA, status, and timestamps.
2. **Given** a failed deploy after a successful one, **When** the stack is still the previous containers, **Then** “live SHA” remains the last successful deploy’s SHA and the failed row is visible.
3. **Given** a deploy in progress, **When** the operator views history, **Then** that row shows `pending` or `deploying` and a second Deploy on the same app is rejected until it finishes.

---

### User Story 5 — Build logs and container logs (Priority: P5)

The operator can read (a) the captured output of clone + compose up for a specific deploy, and (b) live logs of the running services.

**Why this priority:** A failed deploy without logs is not operable.

**Independent test:** Deploy a repo that prints during build/up; open that deploy and see the output. Then open live logs and see service stdout. Stop the stack; live logs make it clear there is nothing running; historical deploy logs remain.

**Acceptance scenarios:**

1. **Given** a deploy in progress, **When** the operator opens its log, **Then** they see clone/compose output appending until the deploy finishes.
2. **Given** a failed deploy, **When** they open its log, **Then** they see the error output that caused failure, preserved after refresh.
3. **Given** a running stack, **When** they open container logs, **Then** they can see recent stdout/stderr per service or for the whole compose project, updating without a full page reload.
4. **Given** a stopped app, **When** they open container logs, **Then** the UI shows that there is no running container, without crashing.

---

### User Story 6 — CPU and memory per service (Priority: P6)

On the app page the operator sees current CPU and memory for each service in the stack, updating while the page is open.

**Why this priority:** Requested for v0 so the panel is enough to notice a runaway container without SSH + `docker stats`.

**Independent test:** Deploy a stack, open the app page, confirm each running service shows CPU% and memory. Stop the app; metrics show services as not running rather than stale numbers presented as live.

**Acceptance scenarios:**

1. **Given** a running multi-service compose, **When** the operator views the app, **Then** each service shows current CPU and memory.
2. **Given** a stopped or destroyed app, **When** they view metrics, **Then** no service is shown as consuming resources.
3. **Given** a service that is defined but not yet healthy, **When** stats are unavailable, **Then** the UI shows an explicit empty/unavailable state, not a fabricated zero that looks healthy.

---

### User Story 7 — Terminal into a service (Priority: P7)

From the app page the operator picks a running service and opens an interactive shell in that container (`stdin`/`stdout`/`stderr`, likely `/bin/sh` with a documented fallback).

**Why this priority:** Requested for v0; completes “I should not need SSH for this host.” Highest operational risk (unauthenticated panel + container exec) and therefore last slice, not omitted.

**Independent test:** Deploy a stack with a service that has a shell. Open terminal, run `pwd` / `ls`, see output. Close the session. If the service has no shell, show a clear error.

**Acceptance scenarios:**

1. **Given** a running service with a shell, **When** the operator opens the terminal, **Then** they get an interactive prompt and can run commands whose output appears in the UI.
2. **Given** a stopped service, **When** they try to open a terminal, **Then** the action is disabled or errors with “service is not running”.
3. **Given** an open session, **When** the container dies or the operator closes the tab, **Then** the exec session is cleaned up and does not leak processes on the host.
4. **Given** no `/bin/sh` in the image, **When** they open a terminal, **Then** they see a clear failure, not a hang.

---

### Edge cases

- Docker Engine is down or the socket is unreachable: every runtime action fails fast with “Docker is unavailable”; app records still load from PostgreSQL.
- Two apps use compose files that both publish the same host port: the second deploy fails; the error is in that deploy’s log; the first app stays running.
- Branch does not exist: deploy fails before compose, with an error naming the branch.
- Remote HEAD moved between SHA resolve and clone: clone the resolved SHA (pinned), not a floating branch, so the stored SHA matches what ran.
- Compose file uses `container_name` that collides with another app: deploy fails with Docker’s error in the log. v0 does not rewrite compose files.
- Very large log output: the UI remains usable (tail/window). Full capture for a deploy may be truncated at a documented size; truncation is visible.
- Operator destroys an app while a deploy is running: the in-flight deploy is cancelled/abandoned, then destroy proceeds; the UI does not leave a zombie “pending” row for a deleted app.
- Git host is slow or hangs: clone/fetch times out; deploy marked `failed` with a timeout error.
- App slug/name collision: creating a second app with the same slug is rejected.
- Public repo later becomes private or is deleted: next deploy fails; the currently running stack is not touched until the operator stops/destroys/redeploys.

## 9. Requirements

### Functional requirements

- **FR-001:** The panel MUST allow creating, listing, editing, and deleting apps. Required fields: name, slug, public HTTPS Git URL, branch, compose-file path (relative to repo root).
- **FR-002:** The panel MUST reject non-HTTPS URLs and MUST NOT accept SSH Git URLs in v0.
- **FR-003:** Deploy MUST resolve the configured branch to a commit SHA, clone that SHA, and run Docker Compose using the configured file path and project name derived from the app slug.
- **FR-004:** Deploy MUST use a rebuild/recreate path equivalent in effect to `docker compose up --build` and MUST NOT pass `-v` (must not delete named volumes).
- **FR-005:** A deploy MUST be recorded in PostgreSQL with: app identity, Git URL, branch, SHA, compose path, env snapshot, status, start/end timestamps, and captured clone/compose output.
- **FR-006:** Only one deploy per app MAY run at a time. A second Deploy MUST be rejected until the current one finishes or is abandoned by destroy.
- **FR-007:** Stop MUST stop the app’s compose services without removing named volumes. Start MUST start existing containers without cloning Git and without creating a new deploy record.
- **FR-008:** Destroy MUST require confirmation, remove the compose project without `-v`, and remove the app (and its env and listed history) from the panel.
- **FR-009:** The operator MUST be able to CRUD string env vars on an app. Those values MUST be applied on the next deploy for Compose interpolation and service environment. Running containers MUST NOT change until that deploy.
- **FR-010:** The app detail view MUST show current status (`draft` never deployed, `deploying`, `running`, `stopped`, `failed`) and the live SHA when one exists.
- **FR-011:** The operator MUST be able to read captured logs for a selected deploy after refresh (persisted).
- **FR-012:** The operator MUST be able to read live (or near-live) container logs for a running stack, per service or whole project.
- **FR-013:** The app detail view MUST show current CPU and memory for each running service and an explicit unavailable state otherwise.
- **FR-014:** The operator MUST be able to open an interactive terminal to a running service, and MUST be prevented from opening one on a non-running service.
- **FR-015:** The UI MUST surface published host ports for a running stack so the operator knows how to reach the app without a reverse proxy.
- **FR-016:** All user-visible strings MUST be English.
- **FR-017:** The panel MUST remain usable for listing apps and reading history when Docker is down; runtime actions then fail with a clear error.
- **FR-018:** There MUST be no login, session, or permission check in v0. Network exposure of the panel is an operator responsibility.

### Key entities

- **App:** `id`, `name`, `slug` (unique, compose project suffix), `git_url`, `branch`, `compose_path`, `status`, `live_sha` (nullable), timestamps.
- **AppEnvVar:** `app_id`, `key`, `value`, unique `(app_id, key)`.
- **Deploy:** `id`, `app_id`, `git_url`, `branch`, `sha`, `compose_path`, `env_snapshot` (copy of keys/values at start), `status` (`pending` | `deploying` | `succeeded` | `failed`), `started_at`, `finished_at`, `log` (text or chunked log), `error_summary` (nullable).
- **Runtime view (not necessarily a table):** per-service running state, published ports, CPU, memory. Derived from Docker at read time.

## 10. Operator journeys (happy path)

1. Open the panel on the host (no login).
2. Create app `sample` → `https://github.com/example/sample-compose.git` → branch `main` → path `docker-compose.yml`.
3. Set `POSTGRES_PASSWORD=…`.
4. Press Deploy. Watch deploy log until status `running`. Note published ports.
5. Open container logs; glance at CPU/memory; optionally exec into `db` and run `psql`.
6. Push is **not** detected. To pick up a new commit, press Deploy again. Volumes keep data. History shows both SHAs.
7. Stop overnight; Start in the morning; Destroy when done. Data volume may still exist on disk.

## 11. Security and trust (explicit)

v0 is a **single-operator, trusted-network** tool.

- No authentication means the panel is equivalent to root on the host (Docker socket + `docker exec`).
- A public compose file can request host bind mounts, `privileged: true`, or `network_mode: host`. v0 will honor the file as written.
- Env var values are stored in PostgreSQL in plaintext in v0 (no vault). The panel itself is not exposed to the internet.
- Deploy webhooks are out of scope partly because there is no auth to protect them.

These are accepted risks for v0, not oversights. A later spec may add bind-to-localhost, auth, and secret storage.

## 12. Success criteria

- **SC-001:** An operator who has a public Git repo with a valid compose file can go from empty panel to a reachable running stack in one sitting, using only the UI (no SSH except to open the panel if it is bound locally).
- **SC-002:** After two deploys of the same app, the panel shows two history rows with distinct SHAs, and named volume data created in the first deploy is still present after the second.
- **SC-003:** A broken compose file or private/missing repo never leaves the app stuck as `running`; it ends as `failed` with a log that names the cause.
- **SC-004:** Stop → start does not create a new deploy row and does not clone Git.
- **SC-005:** Destroy removes the app from the list and removes its containers; a subsequent `docker compose -p <project> ps` shows nothing. Named volumes may still exist.
- **SC-006:** While a stack is running, the operator can read live logs, see CPU/memory for each service, and run at least one command in a service terminal.
- **SC-007:** Published ports for the running stack are visible in the UI without inspecting Docker by hand.
- **SC-008:** With Docker stopped, the operator can still open the panel and see app names and past deploys.

## 13. Assumptions

- The host already has Docker Engine with Compose v2 (`docker compose`) and the panel process can talk to the Docker socket.
- PostgreSQL is available to the panel (local container or host service). It is **not** the same thing as databases declared inside operator compose files.
- The operator deploys **repos they trust**. v0 is not a multi-tenant builder for strangers’ code.
- Default branch is `main`; default compose path is `docker-compose.yml`. Operators change both per app.
- `compose.yaml` is **not** auto-detected; if the repo uses that name, the operator sets `compose_path`.
- Slug is immutable after create (compose project name depends on it). Name may be edited.
- Start after Stop uses the containers last created by a successful deploy. If those containers were removed out-of-band, Start fails and the operator must Deploy again.
- Metrics are best-effort snapshots (a few seconds’ resolution), not a time-series database.
- Terminal uses `/bin/sh` first; no TTY-size/termios polish beyond “usable interactive shell” is required in v0.
- The panel may bind to localhost or a LAN interface; shipping a hardened public deployment is out of scope.
- One Docker host, tens of apps at most, not hundreds.

## 14. Open questions

None that block SPEC-0. Defaults above are binding until a later spec supersedes them.

If a follow-up spec wants to decide them explicitly, the only residual product choices are:

1. Whether destroy should offer an optional “also delete named volumes” checkbox (currently: never from the UI).
2. Whether slug may be renamed (currently: immutable).
3. Log retention (currently: keep deploy logs until the app is destroyed; live container logs are not a long-term store).

These are **not** [NEEDS CLARIFICATION] for implementation of v0.

## 15. What this spec is not

- Not a UI mock or visual design (layout is free as long as the journeys exist).
- Not an API catalog, schema migration, or package list (ORM, Docker SDK, log streaming mechanism). That is the plan spec.
- Not a constitution of coding rules. Add one only if the SDD loop needs project-wide invariants beyond §5.

## 16. Suggested SDD next steps

1. Keep this file as the product source of truth for the control plane.
2. AI diagnosis is **[SPEC-AI.md](./SPEC-AI.md)** (read-only Explain). It does not replace §4–§5 and does not reorder P2–P7.
3. Write a **plan** spec (stack details: SvelteKit adapter, schema, Docker access, log/terminal transport, job execution so HTTP requests do not block on `compose up`).
4. Break the plan into tasks **per user story P1→P7**.
5. Implement P1 until SC-001 is true; only then P2, etc.
6. Do not add auth, proxies, webhooks, or a mutating agent unless a new SPEC explicitly supersedes §4 / SPEC-AI §4.

---

**Change control:** Any new capability (auth, domains, webhooks, private git, volume wipe) requires a new SPEC that states which lines of §4 and §5 it replaces. Code first is not the process for this repo.
