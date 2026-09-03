# SPEC-AI: Read-only deploy diagnosis

**Status:** Draft  
**Created:** 2026-09-01  
**Product:** mycompose  
**Kind:** Product specification for the AI experiment (what / why).  
**Depends on:** [SPEC-0.md](./SPEC-0.md) (does not replace it)  
**Constitution:** [CONSTITUTION.md](./CONSTITUTION.md) article VIII

## 1. Thesis

mycompose is not interesting as a smaller Dokploy. The experiment is:

> Can a spec-driven single-host control plane, whose evidence is Git SHA + deploy history + logs, let a model **explain** a bad deploy well enough that a human skips SSH?

This spec is **A1 only**: the operator asks, the model reads, the host does not change.

Loops **A2** (alarm wakes the model) and **A3** (watch sampler) are named so they cannot be smuggled in as “just add tools.” They are out of scope until a later SPEC replaces the non-goals below.

## 2. Problem

A failed `docker compose up` already leaves a SHA, an env snapshot, a status, and a log. The operator still has to correlate those by hand. The model should do that correlation and point at evidence. It should not become a second operator.

## 3. Goals

- **G-AI-1.** From a deploy record, the operator can request an explanation in the UI with one action.
- **G-AI-2.** The explanation is grounded in **this** deploy: SHA, compose path, status, log quotes. It does not invent files or commands that were not in the evidence pack.
- **G-AI-3.** Requesting or rendering an explanation **mutates nothing** in Git, Docker, env vars, or app/deploy status (it may only persist the explanation text).
- **G-AI-4.** If the model is missing, misconfigured, or down, P1–P7 still work. The explain action fails visibly.
- **G-AI-5.** Env **values** never enter the prompt. Keys may.

## 4. Non-goals (this spec)

- Any model tool that changes the host: deploy, stop, start, destroy, exec, env write, compose rewrite, `down -v`.
- Alarms, paging, webhooks, or “wake the model” without a human click (**A2**).
- A periodic loop where the model inspects metrics or logs (**A3**). Cheap local samplers that _do not_ call a model are also out of this spec.
- Chat with free-form follow-ups, memory across apps, or a general “ops copilot.”
- Sending the full clone tarball, secrets, or `deploy.env` contents.
- Auto-fix PRs back to the source Git repo.

A2/A3, if ever specified, must keep the constitution rule: the model is not the sensor; allowed actions are a closed catalog the panel already has.

## 5. Relationship to SPEC-0

SPEC-0 remains the product for register → deploy → observe. This spec **consumes** that evidence. It does not relax SPEC-0 §4–§5 (still no auth, still button-only deploy, still no proxy).

| Evidence                                          | Available after | Used by A1                             |
| ------------------------------------------------- | --------------- | -------------------------------------- |
| App overlay (URL, branch, path, status, live SHA) | P1              | Required                               |
| Deploy row + `log_text` + `error_summary`         | P1              | Required                               |
| Env **keys** (not values)                         | P2              | Optional, then required once P2 exists |
| Container logs                                    | P5              | Optional additive                      |
| CPU/memory, restart/ports                         | P6              | Optional additive                      |

A1 may ship as soon as P1 exists (log + SHA). It gets better as P2/P5/P6 land. It does **not** reorder P2–P7.

## 6. Actors

- **Operator** — same trusted-network person as SPEC-0. Clicks Explain.
- **Model** — not an operator. A function the panel calls with an evidence pack. No Docker socket of its own.

There is no autonomous actor in this spec.

## 7. User scenarios

### User Story AI-1 — Explain this deploy (Priority: P1)

On a deploy log page (especially `failed`), the operator clicks **Explain**. After a wait, they see a structured diagnosis: cause class, short summary, quotes from the log, and next checks for a human. The app status, containers, and Git checkout are unchanged.

**Why this priority:** This is the whole experiment for now. Without it, later alarms have nothing to say.

**Independent test:** Deploy the invalid-compose fixture (SPEC-0 T024). Click Explain. The cause class is `compose` (or equivalent) and the summary or evidence mentions that the compose file is invalid. `docker compose -p mycompose-<slug> ps` is the same before and after.

**Acceptance scenarios:**

1. **Given** a deploy with status `failed` and a non-empty log, **When** the operator clicks Explain, **Then** an explanation is stored and shown, with at least a cause class and a summary.
2. **Given** that explanation, **When** Docker/Git/app rows are compared before vs after, **Then** only a new explanation record exists; app status, `live_sha`, and containers are unchanged.
3. **Given** a successful deploy, **When** they click Explain, **Then** the model may say it looks healthy or point at warnings; it still must not mutate.
4. **Given** no API key or a provider error, **When** they click Explain, **Then** the UI shows a readable error and the deploy stays as it was.
5. **Given** env vars on the app (after P2), **When** an explanation is requested, **Then** the prompt contains keys only, never values (verified by a unit test on the evidence-pack builder).

### User Story AI-2 — Explanation is part of history (Priority: P2)

The deploy page shows the latest explanation (cause class + summary) and when it was produced. Explaining again replaces or appends a new attempt (implementation may keep only the latest, or a list). Old explanations do not change the deploy log.

**Independent test:** Explain twice on the same failed deploy. The UI shows the newest explanation; `log_text` is identical.

### Edge cases

- Explain while status is `pending`/`deploying`: allowed but the copy must say the log is incomplete; or the button is disabled until a terminal status. **Decision:** button enabled; the explanation must mention that the deploy had not finished if status is not terminal.
- Empty log: fail visibly (“No log to explain”) without calling the model.
- Log truncated: the evidence pack includes the truncation flag; the explanation may say the log was cut.
- Clone directory already wiped: do not require the compose file bytes; log + overlay are enough. If the file is still on disk, it may be included (capped).
- Two operators / no auth: same as SPEC-0; anyone who can reach the panel can spend model tokens.

## 8. Evidence pack (what the model may see)

Built server-side. Never assembled in the browser.

**Always**

- App: name, slug, git URL, branch, compose path, status, live SHA
- Deploy: id, SHA, branch, compose path, status, error summary, started/finished timestamps, `log_truncated`
- Deploy log text, already capped at the deploy log cap (1 MiB); may be further shortened for the prompt (e.g. head+tail) if needed, with that fact stated in the pack

**When present**

- Env snapshot **keys** only
- Compose file body from the clone, if the file exists, max a documented byte cap (e.g. 64 KiB)
- Later: last N lines of container logs; per-service running state; CPU/memory snapshot (no time-series dump)

**Never**

- Env values, `deploy.env` file contents, Docker socket streams, shells, host paths outside the app data dir, other apps’ deploys unless we later spec a “host summary”

## 9. Explanation shape (what the operator sees)

Stored as structured data, rendered in English:

| Field                  | Meaning                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `cause_class`          | One of: `git`, `compose`, `build`, `image`, `port`, `runtime`, `config`, `unknown` |
| `summary`              | 2–5 sentences                                                                      |
| `evidence`             | 1–5 short quotes copied from the log or compose excerpt                            |
| `next_checks`          | 1–5 items a human could do in the panel or on the host (not executed)              |
| `confidence`           | `low` \| `medium` \| `high`                                                        |
| `model` / `created_at` | Provenance                                                                         |

If the provider returns prose, the panel still persists a structured row (parse or wrap as `unknown` + raw summary). The UI is not a chat transcript as the source of truth.

## 10. Key entity

- **DeployExplanation:** `id`, `deploy_id` (fk, cascade), `cause_class`, `summary`, `evidence` (json), `next_checks` (json), `confidence`, `model`, `created_at`, optional `raw` for debugging the provider. Does not include the prompt’s env values because those were never sent.

## 11. Success criteria

- **SC-AI-1.** Invalid compose fixture → explanation `cause_class` is `compose` (or `config`) and evidence/summary refers to the compose file or YAML/parse failure.
- **SC-AI-2.** Missing compose path fixture → mentions the missing path.
- **SC-AI-3.** Bad Git URL fixture → `cause_class` is `git`.
- **SC-AI-4.** Instrumented test: evidence-pack builder never emits env values.
- **SC-AI-5.** Before/after `docker compose ps` and app row for Explain on a running or failed stack: no change except the explanation row.
- **SC-AI-6.** With the provider disabled, the rest of the panel’s independent tests still pass.

## 12. Locked constraints (AI)

| Constraint                  | Decision                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Trigger                     | Explicit **Explain** button only                                                   |
| Effect on runtime           | None                                                                               |
| Secrets                     | Keys only in the pack                                                              |
| UI language                 | English, same as SPEC-0                                                            |
| Provider (when implemented) | SpaceXAI (xAI API, `XAI_API_KEY`, server-side only). Plan spec may name the model. |
| Panel without a key         | Fully usable; Explain errors                                                       |

## 13. Sketch of A2 / A3 (not requirements)

These exist so the next spec does not start from zero. **Do not implement.**

- **A2 — Alarm:** A deterministic trigger (deploy → `failed`, container restart loop, disk threshold) creates an **incident**, fills the same evidence pack, may call the model, **notifies a human**, still does not mutate. Optional later: one-click “apply suggested panel action.”
- **A3 — Watch:** A local sampler (stats, disk, last deploy age) fires A2 rules. The model is not in the sampling loop.

Either spec must restate: closed action catalog = existing panel actions; model is not the sensor.

## 14. Assumptions

- One host, tens of apps, same as SPEC-0.
- One model call per click is enough; streaming is optional UX.
- The operator will not paste secrets into the compose file in Git; if they do, those bytes may appear in the compose excerpt. Env overlay is the secret path and is redacted.

## 15. Open questions

None that block this spec. Residual, for the AI plan spec:

1. Keep only the latest explanation per deploy vs a full list (default: **list, newest first**).
2. Prompt size policy (head+tail vs full 1 MiB) — plan choice, as long as truncation is disclosed.

## 16. Suggested SDD next steps

1. SPEC-0 **P1 → P7** are implemented (sensors).
2. Execute [PLAN-AI.md](./PLAN-AI.md) / [TASKS-AI.md](./TASKS-AI.md) for A1 (provider client, evidence-pack module, `DeployExplanation` table, Explain button).
3. Do not add tools, cron, or notifications under this spec.

**Change control:** Acting, alarming, or sampling requires a new SPEC that states which lines of §4 and §12 it replaces.
