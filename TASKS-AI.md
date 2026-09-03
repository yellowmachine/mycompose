# Tasks: mycompose A1 (Explain)

**Input:** [SPEC-AI.md](./SPEC-AI.md), [PLAN-AI.md](./PLAN-AI.md), [CONSTITUTION.md](./CONSTITUTION.md)

**Rules:** Do not add tools, cron, alarms, or mutating model actions. P1–P7 of SPEC-0 must keep passing without Ollama running. Implement in phase order. Live inference is **local Ollama**, not xAI.

**Format:** `- [ ] [ID] [P?] [Story?] Description with file path`

---

## Phase A0: Schema and evidence pack

**Goal:** Pack builder is testable with no network and no UI.

- [x] A001 Add `deploy_explanations` to `src/lib/server/db/schema.ts` (checks, index, cascade) and generate a Drizzle migration under `drizzle/`
- [ ] A002 [P] Zod explanation schema + json_schema helper in `src/lib/server/ai/schema.ts` (`cause_class`, `summary`, `evidence`, `next_checks`, `confidence`)
- [ ] A003 [P] Evidence pack builder `src/lib/server/ai/evidence.ts`: keys-only env, log head+tail (32 KiB / 32 KiB), optional compose excerpt ≤ 64 KiB via `resolveInside`, optional runtime snapshot, optional `compose logs --tail 200` (5s, no follow)
- [ ] A004 Pack unit tests `tests/unit/evidence.test.ts`: env values never appear; empty log detected; path escape rejected; truncation flags set

**Independent test:** `bun run test:unit` covers SC-AI-4.

---

## Phase A1: User Story AI-1 — Explain this deploy 🎯

**Goal:** Operator clicks Explain; a structured row appears; host is unchanged.

**Independent test:** SPEC-AI US AI-1 — invalid-compose fixture, stub provider, `cause_class` compose (or config); `docker compose ps` same before/after.

- [ ] A005 Stub provider `src/lib/server/ai/stub.ts` when `MYCOMPOSE_AI_STUB=1` (keyword → cause class; never calls the network)
- [ ] A006 Orchestrator `src/lib/server/ai/explain.ts`: empty log / Ollama unreachable errors; otherwise pack → provider → insert
- [ ] A007 `?/explain` on `src/routes/apps/[slug]/deploys/[id]/+page.server.ts`; load explanations newest first; action does not update apps/deploys/env
- [ ] A008 UI on `src/routes/apps/[slug]/deploys/[id]/+page.svelte`: Explain button (enabled while pending/deploying); list of explanations; error if unconfigured
- [ ] A009 E2E `tests/e2e/explain.e2e.ts` with `MYCOMPOSE_AI_STUB=1`: invalid compose → Explain → compose/config class; log_text unchanged; second Explain adds a newer row
- [ ] A010 E2E or assertion: `docker compose -p mycompose-<slug> ps` identical before/after Explain (SC-AI-5)

**Stop here until the stub independent test is true.**

---

## Phase A2: User Story AI-2 — History on the deploy page

**Goal:** Newest explanation is obvious; re-explain does not rewrite the deploy log.

- [ ] A011 [AI-2] Render cause class, summary, evidence quotes, next checks, model, timestamp; newest first
- [ ] A012 [AI-2] Covered by A009 second Explain; no extra table

---

## Phase A3: Live Ollama client

**Goal:** Local Ollama uses `llama3.2` (or `OLLAMA_MODEL`); daemon down keeps the panel usable.

- [ ] A013 Provider `src/lib/server/ai/provider.ts`: `openai` + `baseURL` `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434/v1`), model `OLLAMA_MODEL` or `llama3.2`, JSON + Zod, 120s timeout, no tools
- [ ] A014 Wire stub vs live in `explain.ts`; stub off and Ollama down → visible error, no row
- [ ] A015 `.env.example` documents `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `MYCOMPOSE_AI_STUB`
- [ ] A016 Confirm `bun run test:unit` and existing e2e still pass without Ollama (SC-AI-6)
- [ ] A017 Manual (Ollama up): fixtures invalid-compose / missing path / bad URL → SC-AI-1..3

---

## Polish

- [ ] A018 README: Explain needs Ollama (or stub); panel works without it
- [ ] A019 `bun run check` and `bun run lint` clean

---

## Dependency graph

```
A0 (schema + pack)
  → A1 stub Explain (US AI-1) 🎯
      → A2 history UI (mostly the same page)
      → A3 live Ollama client
          → polish
```

## What not to schedule

Tools, cron, incident table, “apply this action”, chat follow-ups, sending `deploy.env`.
