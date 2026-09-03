# Implementation Plan: mycompose A1 (Explain)

**Date:** 2026-09-03  
**Spec:** [SPEC-AI.md](./SPEC-AI.md)  
**Depends on:** [SPEC-0.md](./SPEC-0.md) (P1–P7 already implemented)  
**Constitution:** [CONSTITUTION.md](./CONSTITUTION.md) article VIII  
**Tasks:** [TASKS-AI.md](./TASKS-AI.md)

## Summary

Add a read-only **Explain** action on a deploy. The operator clicks a button; the panel builds an evidence pack from Postgres (and optionally a capped compose-file excerpt and a one-shot runtime snapshot), calls a **local Ollama** model over the OpenAI-compatible API **without tools**, persists a structured `deploy_explanations` row, and renders it. Git, Docker, env values, and app/deploy status do not change. SpaceXAI / xAI is deferred; swapping the base URL later is a two-line change.

A1 is the whole AI experiment for now. A2 (alarms) and A3 (watch loops) stay unimplemented until a later SPEC replaces SPEC-AI §4 / §12.

## Technical context

| Item        | Choice                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------ |
| Provider    | Local [Ollama](https://ollama.com) OpenAI-compatible API (`http://127.0.0.1:11434/v1`)     |
| Auth        | None (Ollama ignores the key; send a dummy `ollama` if the client requires one)            |
| Model       | `llama3.2` (override with `OLLAMA_MODEL`)                                                  |
| Client      | `openai` npm package, `baseURL` from `OLLAMA_BASE_URL`                                     |
| Output      | JSON object + Zod. No function calling. Ollama may not honour json_schema; always validate |
| Persistence | New `deploy_explanations` table (Drizzle). List newest first                               |
| Trigger     | Form action `?/explain` on `/apps/<slug>/deploys/<id>`                                     |
| Tests       | Vitest for the pack builder (no network). E2E uses a stub provider. Live Ollama is opt-in  |

## Constitution check

| Gate                                | Status                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Model is not an operator            | Pass — no mutating tools; only insert explanation text                       |
| Trigger is explicit operator action | Pass — Explain button only                                                   |
| Model is not the sensor             | Pass — pack is built from P1–P7 records already stored                       |
| Env values never in the prompt      | Pass — pack builder copies keys only; unit-tested                            |
| P1–P7 still work without Ollama     | Pass — unreachable Ollama fails Explain visibly; rest of the panel unchanged |
| No A2/A3                            | Pass — no cron, no alarms, no sampler                                        |
| SPEC-0 §4–§5 untouched              | Pass — still no auth, still button-only deploy, still no proxy               |

## Key decisions

### D-AI-1 — Local Ollama, no tools, JSON + Zod

Call the Ollama OpenAI-compatible endpoint from the server only:

```ts
new OpenAI({
	apiKey: 'ollama',
	baseURL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1'
});
```

Model: `OLLAMA_MODEL` or `llama3.2`. **Do not** attach tools. The model must only see the evidence pack. Ask for SPEC-AI §9 fields. Prefer `response_format: { type: 'json_object' }` when the daemon accepts it; always parse with Zod. If the body is unusable, still insert a row: `cause_class = unknown`, `summary` from raw text, `raw` stored.

Ollama must already be running on the host (`ollama serve` + `ollama pull llama3.2`). The panel does not install or pull models.

**Rejected for this slice:** xAI / SpaceXAI — operator wants local inference first; the same OpenAI-compatible client can point at `https://api.x.ai/v1` later. **Rejected:** sending the pack to the browser.

### D-AI-2 — The HTTP handler may wait (unlike compose)

`compose up` can run for minutes, so deploy is async. An Explain call is one round trip (seconds). The form action **awaits** the provider (timeout **120s**, local models are slower) and re-renders the deploy page with the new row or an error. No job queue, no SSE.

Double-click: disable the button while submitting. No unique inflight index. Multiple explanations per deploy are allowed (SPEC-AI default: **list, newest first**). Re-explain never mutates `deploys.log_text`.

**Rejected:** streaming tokens into the log viewer (optional UX, not required). **Rejected:** sharing the deploy job queue (would stall deploys).

### D-AI-3 — Evidence pack is a pure server module

`src/lib/server/ai/evidence.ts` builds a JSON-serializable pack. Never assembled in the browser. Never written to Docker.

**Always**

- App: name, slug, git URL, branch, compose path, status, live SHA
- Deploy: id, SHA, branch, compose path, status, error summary, started/finished, `log_truncated`
- Deploy log, further shortened for the prompt: **32 KiB head + 32 KiB tail** if longer; pack includes `log_prompt_truncated: true` when shortened (in addition to `log_truncated` from the 1 MiB persist cap)
- Env snapshot **keys only** (`Object.keys(env_snapshot)`), never values
- `deploy_finished: boolean` derived from status `succeeded` \| `failed`

**When cheap and present**

- Compose file body from `$DATA/apps/<slug>/repo/<compose_path>` if it exists and `resolveInside` keeps it in the clone; cap **64 KiB**, flag if cut
- One-shot `projectRuntime(slug)` (existing P6 helper). If Docker is down, omit runtime and set `docker_unavailable: true`
- Last **200** lines of `docker compose logs --no-color --tail 200` with a **5s** timeout, **no `--follow`**. Omit on failure

**Never**

- Env values, `deploy.env` bytes, exec/TTY, other apps, host paths outside the app data dir, the Docker socket stream itself

Empty `log_text` (after trim): return a user error **No log to explain** and **do not** call the model.

### D-AI-4 — Prompt contract

System message (English): you are diagnosing **this** deploy from the evidence pack only. Quote only strings that appear in the pack. Classify `cause_class`. If status is not terminal, say the log is incomplete. Do not suggest commands that change the host; `next_checks` are for a human in the panel or on the machine.

User message: the pack as JSON.

Temperature low (0 or 0.2). Max output tokens bounded (e.g. 1024).

### D-AI-5 — Failures are visible and local

| Condition                        | Behaviour                                                               |
| -------------------------------- | ----------------------------------------------------------------------- |
| Ollama down / connection refused | 502, “Ollama is not reachable at OLLAMA_BASE_URL”                       |
| Empty log                        | 400, “No log to explain” — no HTTP to Ollama                            |
| Model missing (404) / timeout    | 502/504, readable error; **no** explanation row                         |
| Schema mismatch                  | Insert `unknown` + raw; still success from the operator’s point of view |

P1–P7 routes do not import the provider module except the Explain action.

### D-AI-6 — Stub provider for tests

`MYCOMPOSE_AI_STUB=1` (or missing network in unit tests) uses `src/lib/server/ai/stub.ts`: deterministic `cause_class` from log/error_summary keywords (`yaml`/`compose` → `compose`, `not a git`/`ls-remote` → `git`, `no such file` → `compose`, else `unknown`). E2E never needs the public internet (same rule as SPEC-0 tests).

A live check with Ollama running is **manual** (SC-AI-1 on `fixtures/invalid-compose`).

## Data model

### `deploy_explanations`

| Column      | Type                                | Notes                       |
| ----------- | ----------------------------------- | --------------------------- |
| id          | uuid pk                             | `gen_random_uuid()`         |
| deploy_id   | uuid fk → deploys on delete cascade |                             |
| cause_class | text not null                       | check in enum set           |
| summary     | text not null                       |                             |
| evidence    | jsonb not null                      | `string[]`                  |
| next_checks | jsonb not null                      | `string[]`                  |
| confidence  | text not null                       | `low` \| `medium` \| `high` |
| model       | text not null                       | e.g. `llama3.2` or `stub`   |
| raw         | text null                           | provider body for debugging |
| created_at  | timestamptz not null                | now()                       |

Indexes: `deploy_explanations_deploy_created_idx` on `(deploy_id, created_at desc)`.

Check: `cause_class in ('git','compose','build','image','port','runtime','config','unknown')`.

## Contracts

| Action                                       | Effect                                                                |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `POST /apps/<slug>/deploys/<id>` `?/explain` | Build pack, call model, insert row, re-render. Does not touch Docker. |

Pages: same deploy log page. History table on the app detail may show a one-line cause class later; not required for A1 independent test (the log page is enough). AI-2 is that list on the deploy page.

## Project structure (additions)

```text
src/lib/server/ai/
  evidence.ts      # pack builder (unit-tested)
  schema.ts        # Zod explanation + json_schema
  provider.ts      # OpenAI-compatible Ollama client
  stub.ts          # MYCOMPOSE_AI_STUB
  explain.ts       # orchestrate pack → model → insert
src/lib/server/db/schema.ts   # + deployExplanations
src/routes/apps/[slug]/deploys/[id]/
  +page.server.ts  # load explanations; ?/explain
  +page.svelte     # Explain button + list
.env.example       # OLLAMA_BASE_URL, OLLAMA_MODEL, MYCOMPOSE_AI_STUB
```

## Timeouts and limits

| Operation              | Limit                     |
| ---------------------- | ------------------------- |
| Provider HTTP          | 120s (local models)       |
| Compose excerpt        | 64 KiB                    |
| Log in prompt          | 32 KiB head + 32 KiB tail |
| Container log snapshot | 200 lines, 5s             |
| Output tokens          | 1024                      |

## Environment

```
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
OLLAMA_MODEL=llama3.2
MYCOMPOSE_AI_STUB=0      # 1 in e2e
```

## Testing strategy

- **Unit:** pack builder never contains env values even if `env_snapshot` is `{ POSTGRES_PASSWORD: 'hunter2' }`; empty log short-circuits; head+tail flags; compose path cannot escape repo root.
- **E2E (stub):** invalid-compose fixture → Explain → `cause_class` compose (or config) and evidence/summary mentions compose/YAML; `docker compose -p mycompose-<slug> ps` identical; `log_text` unchanged after two Explains; stub off + Ollama down shows the unreachable-error path.
- **Live (manual, Ollama up):** SC-AI-1 / SC-AI-2 / SC-AI-3 on the existing fixtures.

## What this plan will not do

Anything in SPEC-AI §4: tools, alarms, watch loops, chat follow-ups, auto-fix PRs, sending `deploy.env`. Also: no panel Dockerfile (still T053, unrelated).

## Suggested slices

1. Schema + pack builder + unit tests (no provider).
2. Stub provider + Explain action + UI list + stub e2e (SC-AI-4, SC-AI-5 shape).
3. Live Ollama client; daemon down keeps P1–P7 green (SC-AI-6).

Next artifact to execute: [TASKS-AI.md](./TASKS-AI.md).
