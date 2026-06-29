# Product Specification: Source-Agnostic Food Data Integration

**Branch**: `003-usda-food-data`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

_Updated 2026-06-22: re-baselined to the source-agnostic model._

---

## Vision

**Runtime**: Node 24.x (per monorepo `.nvmrc` and root `package.json` engines field).

Source-Agnostic Food Data Integration makes nutritional data in Commise trustworthy, low-latency, and operationally resilient. A **food is an internal-`id` entity** assembled from one-or-more **pluggable sources** into a single **golden record** with **per-field provenance** — USDA is just the first wired source adapter, not the schema. Instead of blocking user flows on third-party lookups, the system serves food data from a local store and uses event-driven, rate-limited backfill to grow coverage from real demand. Users add foods they don't have **by name**; the system creates the canonical `id` up front and resolves it in the background through a transparent `PENDING → (UNRESOLVED) → RESOLVED` lifecycle (terminal `NOT_FOUND` / `FAILED`). When sources disagree or a name is ambiguous, the user is the final arbiter: they pick from cross-source candidates and the system merges their choice into the golden record.

**Tagline**: "One food, many sources, one golden record — queue-safe UX."

**Core principles**:

- A food's identity is our own internal `id`; no source-native key (USDA `fdcId`, a barcode) is ever a primary or foreign key. Source terms live only inside the adapter boundary.
- Local-read determinism over synchronous third-party dependency — the read path never calls an external source.
- Add-by-name as the primary path into external sources; the `id` is the queue key, the poll handle, and the eventual canonical identity.
- Transparent async lifecycle (`PENDING`, `UNRESOLVED`, `RESOLVED`, `NOT_FOUND`, `FAILED`) surfaced to the client.
- Multi-source fan-out → golden-record merge with **per-field provenance**; the human is the final arbiter for ambiguous candidates.
- Per-source rate-limit-aware architecture as a product behavior, not just infrastructure detail.
- Change-driven refresh: once a food is populated, our stored values stand; a field updates only when its originating source item changed upstream — human resolutions are protected automatically.

---

## Personas

### Primary — P4 Sam (Nutrition & Diet Planner)

**Archetype**: Nutrition & Diet Planner
**Core motivation**: Macros, diet protocols, goal tracking

**Food-data-specific goals**:

- Pull accurate per-ingredient macro breakdowns (protein, fat, carbs, fiber) to hit daily targets without manual cross-referencing.
- Trust that nutrient values reflect the **correct source entry**, with visible **per-field provenance** (which source supplied each value), not a stale or mismatched record.
- When add-by-name is ambiguous, **disambiguate candidates** by picking the entry that matches what was meant, so calorie counts don't silently drift.
- Know when a food is still `PENDING`/`UNRESOLVED` vs. `RESOLVED`, so meal-plan totals aren't built on placeholder zeros.
- Rely on change-driven refresh to keep values current across diet phases without overwriting a manual pick.

**Pain points**:

- Ambiguous food names (e.g., "chicken breast" matching many candidate entries across sources) produce incorrect macro totals unless the user can pick the right one.
- No visibility into data provenance/freshness means Sam can't tell which source a value came from or whether it is current.

---

### Secondary — P6 Avery (Waste Optimizer)

**Archetype**: Waste Optimizer
**Core motivation**: Use-the-fridge, ingredient chaining, cost reduction

**Food-data-specific goals**:

- Look up substitution candidates quickly (e.g., swap Greek yogurt for sour cream) and compare their golden-record nutrition profiles side by side.
- Search by partial or approximate ingredient names (typo-tolerant) without the lookup stalling the recipe-editing flow.
- Batch-resolve multiple fridge ingredients at once (add-by-name in bulk) so substitution decisions don't require repeated round trips.
- Continue drafting a recipe while `PENDING` resolutions complete in the background.
- Confirm that a substituted ingredient resolved to a complete golden record (and resolve it from candidates if it landed `UNRESOLVED`) before finalizing a recipe.

**Pain points**:

- Slow or failed resolutions break the substitution workflow mid-recipe.
- Missing nutrition on uncommon ingredients (specialty produce, store-brand items) leaves substitution comparisons incomplete — and a single-source view can't fill gaps that another source would.

---

### Tertiary — P3 Riley (Family Meal Planner)

**Archetype**: Family Meal Planner
**Core motivation**: Quick, kid-friendly, weekly rotation, household scale

**Food-data-specific goals**:

- Scale ingredient quantities for 4-6 servings and see nutrition totals recalculate correctly at household portions.
- Identify kid-friendly foods quickly using recognizable generic names rather than branded SKUs (the food `kind` distinguishes `generic` vs `branded`).
- Rely on consistent golden-record data across a weekly meal plan so per-day nutrition estimates hold up.
- Spot when a food is `NOT_FOUND`/`FAILED` or `UNRESOLVED` early, so a substitute can be chosen (or candidates picked) before the shopping list is finalized.
- Trust that change-driven refresh keeps records current between weekly planning sessions without churning unchanged values.

**Pain points**:

- Inconsistent provenance across food records makes per-serving nutrition unreliable at scale; per-field provenance makes the source of each value auditable.
- Hidden `PENDING`/`UNRESOLVED`/`NOT_FOUND` states cause silent gaps in weekly nutrition summaries unless surfaced.

---

## Internal Stakeholders

### Operations Engineer

**Role**: Owns the source ingestion pipeline (fan-out/merge worker, per-source adapters, rate limiters) and is accountable for data quality, refresh cadence, and system reliability.

**Responsibilities in this feature**:

- Manages the change-driven refresh cadence (frequency, version/etag detection, re-pull policy) and the source-adapter roster (USDA wired today; adding a source is additive and never touches the canonical schema).
- Monitors the `fetch_queue` pending-row depth, the `UNRESOLVED` backlog, and tombstone-row count (`status='tombstone'`) for growth trends, processing lag, and poison-row accumulation. The queue is **keyed on the food `id`**.
- Enforces the **per-source rolling 60-minute-window** rate limit so each source's hourly cap is never exceeded (USDA: 1,000 req/hr; worker pauses at 90% per source), even under traffic spikes.
- Responds to data-quality alerts (mismatched nutrient units/basis, candidates that fail adapter validation, conflicting cross-source values) before they surface to users.
- Maintains 99.9% monthly availability (target) for food-data endpoints and owns the runbook for per-source outage fallback behavior.

---

## Epics

### Epic 0: Authenticated & Authorized Access (P1)

Every food data surface (HTTP create-by-name/read/search/candidates/resolve/status, batch, and the deferred WebSocket) is reachable only by an authenticated Commise principal. Identity is verified from a Clerk token (networkless), and — critically — authentication is paired with **per-user fairness** so that no single authenticated account can exhaust a shared per-source budget or starve others. This epic is the connective protection layer beneath Epics 1–4. _(Added 2026-06-19; FoodAuthGuard, plan §2A.)_

### Epic 1: Add-by-Name & Golden-Record Read (P1)

Users add foods they don't have **by name** (the system creates the canonical row + `id` up front and returns `202` + `id`); resolved foods are read by `id` from local persistence as a single golden record, with clear `RESOLVED` / `PENDING`-`UNRESOLVED` (`202`) / `NOT_FOUND`-`FAILED` (`404`) responses, while preserving strict request-path isolation from every external source.

### Epic 2: Rate-Limited Fan-Out & Merge (P1)

Use event-driven queue processing with **per-source** rolling 60-minute-window rate-limit control to fan out by name across all wired source adapters, fetch from each that has the item, normalize, and **merge into one golden record** with per-field provenance — safely under each source's constraints.

### Epic 3: Candidate Disambiguation & Resolution UX (P2)

Enable high-quality local search, **cross-source candidate disambiguation** (`UNRESOLVED` → `GET /candidates` → `PATCH`-resolve), and ingredient-picker workflows that improve nutrition correctness and editing speed — the human is the final arbiter.

### Epic 4: Operations and Feedback Loop (P3)

Instrument queue health, per-source rolling-window utilization, resolution latency, `UNRESOLVED` backlog, and failure signals with optional real-time client notifications after launch.

---

## Stories (MoSCoW)

### Must Have

0. **US-0 — Authenticated & authorized access**
   As any caller of the food data service, I must present a valid Clerk token (user session or service M2M) to reach any endpoint; unauthenticated/expired/wrong-party requests are rejected (`401`) before any work, insufficient scope is `403`, and dynamic queue demotion (no quota, no `429`) keeps one account from exhausting a shared per-source budget — a food is demoted to the back of `fetch_queue` only once **all** of its current requesters exceed 50 pending items, and is re-promoted as soon as any requester drops below 50, while near a per-source rolling-window ceiling a flooding account's **new** enqueues are shed with `503` (never `429`) to preserve headroom. No anonymous access; no unauthenticated path drives external source spend.
   **FRs**: FR-035–FR-053 (SC-010, SC-011, SC-012)

1. **US-1 — Golden-record read by `id` (resolved hit)**
   As a recipe author, I can request an already-`RESOLVED` food by its `id` and receive its complete golden-record nutrition quickly (`200`), get `202` while it is `PENDING`/`UNRESOLVED`, and `404` (with the lifecycle `status` still retrievable) when it is `NOT_FOUND`/`FAILED` — so recipe workflows stay responsive and a held `id` always means something.
   **FRs**: FR-001, FR-002, FR-003, FR-004, FR-007

2. **US-2 — Add food by name (async resolution)**
   As a recipe author, when a food isn't in our store I add it **by name** (`POST /v1/foods`) and immediately get `202 Accepted` + the new `id`; in the background the worker fans out across all source adapters by name and assembles a golden record, moving the food to `RESOLVED` (exactly one candidate survives normalized-name matching) or `UNRESOLVED` (more than one survivor — candidates need a human pick) — so I can keep editing without blocking, and concurrent adds of the same name collapse to one `id`.
   **FRs**: FR-005, FR-006, FR-011, FR-013, FR-MRG-1

3. **US-2a — Disambiguate candidates and resolve**
   As a recipe author, when add-by-name leaves more than one cross-source candidate surviving normalized-name matching, the food becomes `UNRESOLVED`; I fetch the candidate list (`GET /v1/foods/{id}/candidates`), pick the candidate(s) that match what I meant, and submit the pick (`PATCH /v1/foods/{id}`). The system validates each chosen candidate belongs to that food's own candidate set, merges it into the golden record, moves the food to `RESOLVED`, and stores my pick as ordinary provenance — so ambiguous adds never dead-end and cross-source matching never has to be perfect.
   **FRs**: FR-RES-1, FR-RES-2, FR-RES-3, FR-MRG-2, FR-MRG-3

4. **US-3 — Per-source rate-limit-safe consumption**
   As an operations engineer, the consumer enforces a **per-source** rolling 60-minute-window rate limit (USDA: 1,000 req/hr; pause at 90%/900 per source) and queue-drain behavior, so no source's limit is ever exceeded as more sources are added.
   **FRs**: FR-019, FR-020, FR-021, FR-022, FR-026, FR-027

5. **US-4 — Batch add-by-name for recipe workflows**
   As a recipe author, unknown ingredient **names** in a recipe import are resolved in batch (one canonical row + `id` per unknown name, deduped), and the response is a per-item partial result — resolved foods inline with `id`s, each miss returned as a `PENDING` entry — so large recipes resolve nutrition without source-call waste. The USDA adapter may internally coalesce its own source fetches (≤20 keys/USDA call), but that is an adapter detail, not the client-facing limit.
   **FRs**: FR-012, FR-023, FR-045

6. **US-5 — Demand-weighted backfill priority and durable recovery**
   As an operations engineer, user-facing misses naturally rise in priority as demand grows and failed messages are recoverable, so the pipeline remains reliable and fair under traffic spikes.
   **Mechanism**: A durable Postgres `fetch_queue` table is the priority queue, the dedup, and the audit trail in one row per **food `id`** (created up front by add-by-name). Enqueue is a single `INSERT … ON CONFLICT` plus `pg_notify`, where demand is tracked as a **distinct-requester** count: each requesting `sub` is recorded at most once in a companion `fetch_requesters` table (PRIORITY_CAP=1), so a row's demand reflects how many distinct accounts want it rather than a raw `request_count + 1` increment that a single poller could inflate. The consumer (a single Fargate worker, guarded by a Postgres advisory lock and rate-limited **per source** via a **rolling 60-minute window** over `source_call_log`, pausing at 90% of each source's cap — USDA: 900) selects by distinct-requester demand descending with `first_requested ASC` as the FIFO tie-breaker, via `FOR UPDATE SKIP LOCKED`, so the most-demanded item wins. Wakeup is event-driven via Postgres `LISTEN/NOTIFY` (no cron, no SQS, no Redis). A single user request gets baseline priority; a viral recipe wanted by many distinct accounts rises to the front automatically; background change-driven refresh enqueues through the ordinary enqueue path at low demand and drains during idle periods. Fairness is enforced by **dynamic queue demotion** computed at drain time (not a stored tier): a food is demoted to the back only when **all** of its current requesters individually exceed 50 pending items, and is re-promoted as soon as any requester drops below 50 (work-conserving; no per-user quota, no `429`); near a source's global rolling-window ceiling, **new** enqueues from the highest-pending `sub` are shed first with `503` (Retry-After) to preserve headroom, while reads and candidate resolves are never shed. No explicit escalation policy is needed — priority is emergent from demand. Transient source `5xx` errors retry with exponential backoff up to 5 attempts before the food lands in `FAILED` and the row is set `status='tombstone'` (the operational DLQ-equivalent, queryable in SQL and re-runnable by flipping the status back to `pending`); a `FAILED` food is retried via `FAILED → PENDING` with bounded backoff (no 30-day gate). A fan-out where no source has the item lands the food in `NOT_FOUND` (tombstone immediately); a `NOT_FOUND` tombstone carries a 30-day TTL, after which a fresh add re-attempts the fan-out. In-app notifications inform the requester when a pending food becomes available.
   **FRs**: FR-014, FR-015, FR-016, FR-017, FR-018

### Should Have

7. **US-6 — Local food search with typo tolerance**
   As a recipe author, I can search foods by name quickly from the local store only — name/substring/partial/fuzzy (`pg_trgm`) matching returning canonical `id`s, plus barcode / source `external_key` lookup via the crosswalk — so ingredient selection stays fast and predictable and never triggers an external source call.
   **FRs**: FR-008, FR-009, FR-010

8. **US-7 — Change-driven background refresh**
   As a nutrition-conscious planner, `RESOLVED` foods are refreshed in the background **only when** a backing source item changed upstream — unchanged fields, including any I manually resolved, are left intact — so nutrient quality stays current over time without overwriting human decisions or churning unchanged values.
   **FRs**: FR-031, FR-032

9. **US-8 — Resolution status polling**
   As a client application, I can poll `GET /v1/foods/{id}` (or `/status`) and transition UI accurately across the lifecycle — `202` while `PENDING`/`UNRESOLVED`, `200` once `RESOLVED`, `404` (status still retrievable) when `NOT_FOUND`/`FAILED`.
   **FRs**: FR-007, FR-033

### Could Have

10. **US-9 — WebSocket push notifications**
    As a client application, I receive a push update (carrying the food `id`) when a pending food becomes ready, delivered only to connections whose authenticated `sub` requested that `id`, so I can reduce polling.
    **FRs**: FR-034, FR-041

11. **US-10 — Operational observability dashboard**
    As an operations engineer, I can inspect `fetch_queue` pending-row depth, per-source rolling-window utilization, resolution latency, the `UNRESOLVED` backlog, and tombstone rows in one place, so I can intervene early.
    **FRs**: FR-016, FR-018, FR-035 (authenticated endpoint scope context)

### Won't Have (v1)

- A second concrete live source adapter wired alongside USDA (the multi-source fan-out/merge/candidate/provenance machinery is built now, but USDA is the only wired source at launch).
- Automatic user-level ingredient substitution recommendations with guaranteed nutritional equivalence.

---

## Out of Scope

- Modifying existing feature specs (`001`, `002`, `006`, `007`, `009`).
- Recipe-level nutrition policy decisions for unmatched freeform ingredients beyond the provided lifecycle/status semantics.
- New auth boundary separate from existing Commise authorizer (explicitly excluded by FR-035/A-009).

---

## API Surface

> All endpoints conform to S-001 (`/v1/foods/*` prefix, JSON, Clerk session token). The path param is the internal `id` (ULID), never a source key. See `specs/cross-feature-consistency-report.md` §S-001.

| Method | Path                        | Purpose                                                                                                                               | Persona                    |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| POST   | `/v1/foods`                 | Add a food **by name**; creates the canonical row + `id`, enqueues a sync, returns `202 Accepted` + `{ status: PENDING, id }`         | P4 Sam, P6 Avery, P3 Riley |
| GET    | `/v1/foods/{id}`            | Read a food by internal `id`; `200` golden record when `RESOLVED`, `202` when `PENDING`/`UNRESOLVED`, `404` when `NOT_FOUND`/`FAILED` | P4 Sam, P6 Avery, P3 Riley |
| GET    | `/v1/foods/{id}/status`     | Poll the lifecycle `status` (`PENDING`/`UNRESOLVED`/`RESOLVED`/`NOT_FOUND`/`FAILED`) + golden record when `RESOLVED`                  | P4 Sam, P6 Avery           |
| GET    | `/v1/foods/{id}/candidates` | List cross-source candidates for an `UNRESOLVED` food (each carries its `source` + that source's item key) for the user to pick       | P4 Sam, P6 Avery           |
| PATCH  | `/v1/foods/{id}`            | Resolve an `UNRESOLVED` food from a candidate selection (validated to that food's set) → merge into the golden record → `RESOLVED`    | P4 Sam, P6 Avery           |
| GET    | `/v1/foods/search?query=`   | Search the local store (`pg_trgm` fuzzy match) returning canonical `id`s; supports barcode / `external_key` lookup; no source call    | P4 Sam, P6 Avery, P3 Riley |
| POST   | `/v1/foods/batch`           | Add up to 100 names in one call; per-item partial result (resolved inline, each miss a `PENDING` entry with an `id`)                  | P6 Avery, P3 Riley         |

---

## Success Metrics

- **In-flow resolution success**: ≥ 90% of recipe-import ingredient names reach a golden record (`RESOLVED`) **without leaving the add flow** — counting both auto-`RESOLVED` (a single survivor under the survivor-count rule, D-AUTORESOLVE) **and** one-tap candidate picks (`UNRESOLVED`→`RESOLVED` via `PATCH`) — measured over a 30-day cohort. This is deliberately **not** a no-human-pick rate: a name like "broccoli" returns many distinctly-named USDA variants ("Broccoli, raw" / "…cooked, boiled" / "…frozen"), which are different normalized names → `UNRESOLVED`, so most realistic add-by-name results resolve via the one-tap pick. The complement (foods abandoned terminally `UNRESOLVED`) is ≤ 10%.
- **Add-by-name → resolve latency**: from `202 Accepted` + `id` to `RESOLVED` available, ≤ 60 s at p95 when `fetch_queue` pending-row depth is under 100 rows (excluding `UNRESOLVED` foods awaiting a human pick); initial `202` returned in ≤ 100 ms (`POST /v1/foods`).
- **Golden-record read latency**: ≤ 50 ms at p95 for `GET /v1/foods/{id}` when `status = 'RESOLVED'` (served from the local store, no source call).
- **Per-source budget adherence**: ≤ 1,000 USDA calls in ANY rolling 60-minute window (and ≤ each additional source's limit, per source), verifiable via CloudWatch; no rolling-hour window over a source's cap and zero `429` responses under normal operation.
- **Backfill queue-depth SLO**: `fetch_queue` pending-row depth (`status='pending'`) ≤ 500 rows during steady-state (ceiling 10,000, `503` backpressure beyond); CloudWatch alarm fires if depth exceeds 2,000 for > 5 minutes. `UNRESOLVED` backlog tracked separately (awaiting human picks).
- **Golden-record completeness & provenance**: for any `RESOLVED` food, every stored scalar field, nutrient, and portion carries a resolvable `source_id`/`field`-provenance reference, and "which fields came from source X" is answerable by a single query; no canonical row, DAO, public DTO, or API field outside the USDA adapter exposes a source-native identifier.
- **Tombstone accumulation**: `fetch_queue` tombstone-row count (`status='tombstone'`, the DLQ-equivalent) = 0 under normal operations; Operations Engineer MTTR for tombstone events ≤ 4 hours (alerted via CloudWatch alarm). `FAILED` foods are re-fetchable; `NOT_FOUND` tombstones carry a 30-day TTL.
- **Change-driven refresh fidelity**: refresh updates a field only when its originating source item changed upstream; a manually-resolved field whose source item is unchanged is never overwritten (verified by test), and unchanged records are not churned.

---

## Open Questions

- **Q-001 — Notification ownership** ✅ **RESOLVED (Rev 1)**: Notification delivery is owned by a **new dedicated feature** (notification service), not by 001 or 003. Contract:
    - **Producer side**: any service publishes a message containing a recipient descriptor (single user, group, or global) and a `messageType` keyword.
    - **Delivery side**: clients subscribe to receive messages whose recipient descriptor matches their identity / group membership. The exact delivery mechanism (push via WebSocket, webhook callback, client-pull retrieval, or a hybrid) is an implementation-time decision.
    - **Client side**: the receiving client parses the payload and dispatches behavior based on the `messageType` keyword (e.g., `food.resolution.completed` → toast + refresh ingredient detail).
    - **Launch transport scope**: in-app only. Email/push deferred.
    - Feature 003's role: **publish** `FoodFetchCompleted` (food resolved) and related fetch-failure events (carrying the food `id`) to the notification service. 003 does not own transport, templating, retry, or preference storage.
    - User notification preferences and template management are deferred to a later revision of the notification feature.

- **Q-002 — Search architecture decision** ✅ **RESOLVED (Rev 1)**: Default to PostgreSQL search (`pg_trgm` fuzzy / full-text + GIN index) for launch, returning canonical `id`s. The search layer must be designed behind a pluggable interface so an external engine (e.g., OpenSearch/Typesense) can be swapped in later without changing call sites. Concrete abstraction shape is an implementation-time decision.

- **Q-003 — Shared food/ingredient type ownership** ✅ **RESOLVED (Rev 1)**: Do not introduce a `recipe-core` package. The source-agnostic food/ingredient types relevant to feature 003 live with this feature's data layer (canonical model keyed on the internal `id`). Cross-feature sharing, package boundaries, and naming are deferred to implementation; the spec stays generic and does not prescribe a package name or location.

- **Q-004 — Source license attribution placement** ✅ **RESOLVED (Rev 1)**: Source attribution (e.g. USDA) appears in the **ingredient detail view**, and is naturally surfaced by the **per-field provenance** model (each value records its originating source). Footer / settings placement is out of scope for launch unless required by a source's terms; revisit if compliance review flags it.

- **Q-005 — Ingredient name normalization strategy** ✅ **RESOLVED (Rev 1)**: Normalization (singular/plural, trade names, regional spelling, synonyms) is a first-class concern of the search/resolution layer and is also what backs the **normalized-name dedup key** used by add-by-name (FR-005/FR-013). It must be implemented in a way that is compatible with the pluggable search backend from Q-002 — i.e., normalization rules and synonym data live above the engine boundary so they survive a backend swap. Specific pipeline (rule-based, dictionary, ML-assisted) is an implementation-time decision.

- **Q-006 — Refresh cadence vs source change detection** ✅ **RESOLVED (Rev 1)**: Refresh is **change-driven**, not age-driven (this supersedes the old fixed-staleness model): a scheduled rule periodically re-checks `RESOLVED` foods, and a field is re-pulled **only** when its originating source item changed upstream (detected via a per-item version/etag/hash, not stored payload). Cadence is configurable; per-source overrides and breaking-change handling are operational concerns handled at implementation; the spec does not pin a fixed schedule.

- **Q-007 — Cross-source candidate disambiguation UX** ✅ **RESOLVED (Rev 1)**: When add-by-name yields multiple candidates the system can't confidently collapse, the food becomes `UNRESOLVED` and the candidate set is surfaced for a **human pick** (`GET /v1/foods/{id}/candidates` → `PATCH /v1/foods/{id}`). Each candidate carries its `source` and that source's item key, and a **badge** distinguishes `branded` vs `generic` foods (the `kind` field) and surfaces source provenance. Default sort/ranking weights are implementation-time decisions; the affordance is a candidate list with badges, and the user is the final arbiter (so the matcher need not be perfect).

- **Q-008 — Backfill prioritization policy** ✅ **RESOLVED (Rev 1)**: Backfill prioritization is demand-weighted by **distinct requester**: repeated requests for the same pending food increase its effective priority (capped at one per `sub`, PRIORITY_CAP=1) with aging so no `id` is pinned indefinitely (see US-5). Static high/normal flags are replaced by demand signal. Exact weighting function and any time-decay are implementation-time decisions.

### Design questions the re-baselined spec resolved

- **Auto-`RESOLVE` rule**: After pre-merge dedup the worker counts candidates surviving a **normalized-name exact match**: exactly **one** → `RESOLVED` (auto-merge); **more than one** → `UNRESOLVED` (the surviving candidate set is persisted for a human pick); **zero** → `NOT_FOUND` (FR-MRG-1, FR-MRG-5, FR-RES-3). There is **no** nutrient-tolerance threshold — the matcher need not be perfect because the user is the final arbiter, so the system biases toward `UNRESOLVED` over a wrong auto-pick.
- **`UNRESOLVED` TTL / expiry**: An `UNRESOLVED` food is **kept until a human picks** — it is never swept to `NOT_FOUND`. Its persisted candidate set expires **30 days** after it was assembled; the next add-by-name request re-fans-out against the normal per-source budget (mirroring the `NOT_FOUND` 30-day TTL), and a human pick made before expiry still wins (FR-025a). `NOT_FOUND` tombstones carry the same configurable 30-day TTL (FR-025).
