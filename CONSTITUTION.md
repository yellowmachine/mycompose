# mycompose constitution

Project invariants. Later specs and code must not violate these without an explicit SPEC that replaces the cited rule.

## I. Spec is the source of truth

Behavior is defined in `SPEC-0.md`. This constitution and `PLAN.md` may only refine _how_. If code and spec disagree, the spec wins and the code changes.

New capabilities (auth, domains, webhooks, private git, volume wipe) require a new SPEC that states which lines of SPEC-0 §4–§5 it replaces. Code-first is not the process.

## II. Product slice order

Implement and demonstrate user stories in SPEC-0 order: P1 → P7. Do not start P(n+1) until P(n) meets its independent test. P1 alone must be a usable deploy loop.

## III. Dual source of truth

- **Git commit of a deploy** defines what ran (compose, images, build context).
- **PostgreSQL** defines operator overlay (repo, branch, path, env) and history (deploys, logs).
- **Docker** defines live process state (running/stopped, ports, stats). When Docker is down, the panel still reads Postgres (SPEC-0 FR-017).

Never rewrite an operator’s compose file.

## IV. Trust boundary

v0 is a single-operator tool on a trusted network. No authentication. The panel is equivalent to root on the host. Do not pretend otherwise (no fake login, no “safe mode” that still mounts the Docker socket).

Env values are stored in Postgres in plaintext.

## V. Volume policy

Named Docker volumes survive deploy, stop, start, and destroy. No `docker compose down -v` from the product. Destroy removes containers and networks only.

## VI. Stack

SvelteKit on Bun, Tailwind CSS, PostgreSQL, public HTTPS Git, local Docker Engine, Compose v2 CLI. UI copy and identifiers in English.

## VII. Fail visible

A failed clone or compose must not mark the app `running`. Errors go on the deploy record with captured output. Do not swallow Docker/Git stderr.

## VIII. Model is not an operator

AI behavior is defined in `SPEC-AI.md`. Until a later SPEC replaces that document:

- The model runs only on an explicit operator action (Explain).
- The model is **not** the sensor: no periodic LLM polling of metrics or logs.
- The model has **no** mutating tools. It cannot deploy, stop, start, destroy, exec, or write env. An explanation may persist text only.
- Evidence packs never include env **values**.

P1–P7 of SPEC-0 are the sensors. Do not reorder them to “get to the chatbot.”
