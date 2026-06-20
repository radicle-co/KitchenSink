# Product Specification: USDA Food Data Integration

**Branch**: `003-usda-food-data`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Vision

**Runtime**: Node 24.x (per monorepo `.nvmrc` and root `package.json` engines field).

USDA Food Data Integration makes nutritional data in Commise trustworthy, low-latency, and operationally resilient. Instead of blocking user flows on third-party lookups, the system serves food data from a local store and uses event-driven backfill to continuously improve coverage. The user experience emphasizes clarity: instant cache hits, explicit pending states, and transparent disambiguation between branded and generic foods.

**Tagline**: "Authoritative nutrition, queue-safe UX."

**Core principles**:

- Local-read determinism over synchronous third-party dependency.
- Transparent async states (`pending`, `fetched`, `not_found`, `failed`).
- Rate-limit-aware architecture as a product behavior, not just infrastructure detail.
- USDA-first data trust hierarchy with explicit brand/generic disambiguation.

---

## Personas

### Primary — P4 Sam (Nutrition & Diet Planner)

**Archetype**: Nutrition & Diet Planner
**Core motivation**: Macros, diet protocols, goal tracking

**USDA-data-specific goals**:

- Pull accurate per-ingredient macro breakdowns (protein, fat, carbs, fiber) to hit daily targets without manual cross-referencing.
- Trust that nutrient values reflect the correct USDA entry, not a stale or mismatched record.
- See clear disambiguation between branded and generic foods so calorie counts don't silently drift.
- Know when a food record is still pending vs. confirmed, so meal-plan totals aren't built on placeholder zeros.
- Trigger a manual refresh on stale items when preparing a new diet phase.

**Pain points**:

- Ambiguous food names (e.g., "chicken breast" matching dozens of entries) produce incorrect macro totals.
- No visibility into data freshness means Sam can't tell whether a nutrient value is current or months old.

---

### Secondary — P6 Avery (Waste Optimizer)

**Archetype**: Waste Optimizer
**Core motivation**: Use-the-fridge, ingredient chaining, cost reduction

**USDA-data-specific goals**:

- Look up substitution candidates quickly (e.g., swap Greek yogurt for sour cream) and compare their nutrition profiles side by side.
- Search by partial or approximate ingredient names without the lookup stalling the recipe-editing flow.
- Batch-resolve multiple fridge ingredients at once so substitution decisions don't require repeated round trips.
- Continue drafting a recipe while pending lookups resolve in the background.
- Confirm that a substituted ingredient's nutrition is complete before finalizing a recipe.

**Pain points**:

- Slow or failed lookups break the substitution workflow mid-recipe.
- Missing nutrition on uncommon ingredients (specialty produce, store-brand items) leaves substitution comparisons incomplete.

---

### Tertiary — P3 Riley (Family Meal Planner)

**Archetype**: Family Meal Planner
**Core motivation**: Quick, kid-friendly, weekly rotation, household scale

**USDA-data-specific goals**:

- Scale ingredient quantities for 4-6 servings and see nutrition totals recalculate correctly at household portions.
- Identify kid-friendly foods quickly using recognizable generic names rather than branded SKUs.
- Rely on consistent nutrient data across a weekly meal plan so per-day nutrition estimates hold up.
- Spot when a food record is unavailable early, so a substitute can be chosen before the shopping list is finalized.
- Trust that stale records refresh automatically between weekly planning sessions.

**Pain points**:

- Inconsistent data provenance across food records makes per-serving nutrition unreliable at scale.
- Hidden pending or unmatched states cause silent gaps in weekly nutrition summaries.

---

## Internal Stakeholders

### Operations Engineer

**Role**: Owns the USDA dataset ingestion pipeline and is accountable for data quality, refresh cadence, and system reliability.

**Responsibilities in this feature**:

- Manages the scheduled USDA bulk-import cadence (frequency, retry policy, rollback on bad data drops).
- Monitors the SQS backfill queue and DLQ for growth trends, processing lag, and poison-message accumulation.
- Enforces token-bucket rate limits so USDA API consumption never exceeds hourly caps, even under traffic spikes.
- Responds to data-quality alerts (mismatched nutrient units, missing required fields, duplicate fdcId collisions) before they surface to users.
- Maintains 99.9% monthly availability for food-data endpoints and owns the runbook for USDA outage fallback behavior.

---

## Epics

### Epic 0: Authenticated & Authorized Access (P1)

Every food data surface (HTTP lookups/search/status, batch, and the deferred WebSocket) is reachable only by an authenticated Commise principal. Identity is verified from a Clerk token (networkless), and — critically — authentication is paired with **per-user fairness** so that no single authenticated account can exhaust the shared USDA budget or starve others. This epic is the connective protection layer beneath Epics 1–4. _(Added 2026-06-19; FoodAuthGuard, plan §2A.)_

### Epic 1: Deterministic Food Lookup (P1)

Serve food data from local persistence with clear responses for fetched/pending/not-found states, while preserving strict request-path isolation from USDA.

### Epic 2: Rate-Limited Async Backfill (P1)

Use event-driven queue processing with token bucket control to fetch and upsert missing foods safely under USDA constraints.

### Epic 3: Search and Resolution UX (P2)

Enable high-quality local search, disambiguation, and ingredient-picker workflows that improve nutrition correctness and editing speed.

### Epic 4: Operations and Feedback Loop (P3)

Instrument queue health, latency, and failure signals with optional real-time client notifications after launch.

---

## Stories (MoSCoW)

### Must Have

0. **US-0 — Authenticated & authorized access**
   As any caller of the food data service, I must present a valid Clerk token (user session or service M2M) to reach any endpoint; unauthenticated/expired/wrong-party requests are rejected (`401`) before any work, insufficient scope is `403`, and per-user quotas (`429`) keep one account from exhausting the shared USDA budget. No anonymous access; no unauthenticated path drives USDA spend.
   **FRs**: FR-035–FR-053 (SC-010, SC-011, SC-012)

1. **US-001 — Cache-hit single food lookup**
   As a recipe author, I can request an already-fetched food and receive complete nutrition quickly, so recipe workflows stay responsive.
   **FRs**: FR-001, FR-002, FR-005, FR-006

2. **US-002 — Cache-miss async backfill**
   As a recipe author, I receive immediate pending status when food data is missing, and data appears after background fetch, so I can continue editing without blocking.
   **FRs**: FR-003, FR-004, FR-007, FR-011, FR-013, FR-024, FR-025

3. **US-003 — Rate-limit-safe USDA consumption**
   As an operations engineer, the consumer enforces token-bucket and queue visibility behavior, so USDA limits are never exceeded.
   **FRs**: FR-019, FR-020, FR-021, FR-022, FR-026, FR-027

4. **US-004 — Batch ingredient lookup for recipe workflows**
   As a recipe author, unknown ingredient IDs are fetched in batch efficiently, so large recipes resolve nutrition without token waste.
   **FRs**: FR-012, FR-023, FR-024

5. **US-005 — Demand-weighted backfill priority and durable recovery**
   As an operations engineer, user-facing misses naturally rise in priority as demand grows and failed messages are recoverable, so the pipeline remains reliable and fair under traffic spikes.
   **Mechanism**: A durable Postgres `fetch_queue` table is the priority queue, the dedup, and the audit trail in one row per `fdc_id`. Enqueue is a single `INSERT … ON CONFLICT DO UPDATE SET request_count = request_count + 1` — duplicate requests increment a counter rather than spawning new rows. The consumer (a Fargate worker rate-limited to the USDA 1000 req/hr cap via a token bucket) selects via `ORDER BY request_count DESC, first_requested ASC FOR UPDATE SKIP LOCKED`, so the most-requested item wins and FIFO is the tie-breaker. Wakeup is event-driven via Postgres `LISTEN/NOTIFY` (no cron, no SQS, no Redis). A single user request gets baseline priority; a viral recipe driving 50 polls for the same missing food jumps to the front automatically; background batch enrichment enqueues at `request_count=0` and drains during idle periods. No explicit escalation policy is needed — priority is emergent from demand. Transient 5xx errors retry with exponential backoff up to 5 attempts before being marked `status='tombstone'` (the operational DLQ-equivalent, queryable in SQL and re-runnable by flipping the status back to `pending`). 404s tombstone immediately. In-app notifications inform the requester when a pending food becomes available.
   **FRs**: FR-014, FR-015, FR-016, FR-017, FR-018

### Should Have

6. **US-006 — Local food search with typo tolerance**
   As a recipe author, I can search foods by name quickly from local store only, so ingredient selection stays fast and predictable.
   **FRs**: FR-008, FR-009, FR-010

7. **US-007 — Stale data background refresh**
   As a nutrition-conscious planner, stale foods refresh in background, so nutrient quality remains current over time.
   **FRs**: FR-031, FR-032

8. **US-008 — Polling status endpoint**
   As a client application, I can poll lookup status and transition UI accurately across pending/fetched/not_found/failed states.
   **FRs**: FR-007, FR-033

### Could Have

9. **US-009 — WebSocket push notifications**
   As a client application, I receive push updates when a pending food becomes ready, so I can reduce polling.
   **FRs**: FR-034

10. **US-010 — Operational observability dashboard**
    As an operations engineer, I can inspect queue depth, latency, token levels, and DLQ events in one place, so I can intervene early.
    **FRs**: FR-016, FR-018, FR-035 (authenticated endpoint scope context)

### Won't Have (v1)

- Multi-provider nutrition federation (USDA + paid APIs in live failover mode).
- Automatic user-level ingredient substitution recommendations with guaranteed nutritional equivalence.

---

## Out of Scope

- Modifying existing feature specs (`001`, `002`, `006`, `007`, `009`).
- Recipe-level nutrition policy decisions for unmatched freeform ingredients beyond the provided status semantics.
- New auth boundary separate from existing Commise authorizer (explicitly excluded by FR-035/A-009).

---

## API Surface

> All endpoints conform to S-001 (`/api/v1/*` prefix, JSON, Clerk session token). See `specs/cross-feature-consistency-report.md` §S-001.

| Method | Path                                | Purpose                                                                                                   | Persona                    |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| GET    | `/api/v1/foods/{fdcId}`             | Look up a single food by USDA FDC ID; returns full nutrient data or `202 pending` on cache miss           | P4 Sam, P6 Avery, P3 Riley |
| GET    | `/api/v1/foods/{fdcId}/status`      | Poll async backfill status (`pending` / `fetched` / `not_found` / `failed`)                               | P4 Sam, P6 Avery           |
| GET    | `/api/v1/foods/{fdcId}/nutrients`   | Retrieve full extended nutrient breakdown (micros, sodium, cholesterol, etc.)                             | P4 Sam                     |
| GET    | `/api/v1/foods/search?query=`       | Full-text search against local food store (PostgreSQL `tsvector`); no USDA call                           | P4 Sam, P6 Avery, P3 Riley |
| GET    | `/api/v1/foods/autocomplete?query=` | Typeahead suggestions from local store for ingredient-picker UX                                           | P6 Avery, P3 Riley         |
| POST   | `/api/v1/foods/batch`               | Request async backfill for multiple `fdcId`s in one call; reduces queue pressure for large recipe imports | P6 Avery, P3 Riley         |
| GET    | `/api/v1/foods/batch/status?ids=`   | Poll aggregate status for a batch backfill request                                                        | P6 Avery                   |
| GET    | `/api/v1/foods/resolve?name=`       | Resolve a freeform ingredient name to candidate FDC IDs (disambiguation list)                             | P4 Sam, P6 Avery           |

---

## Success Metrics

- **Cache hit rate**: ≥ 85% of food lookup requests served from local PostgreSQL/Redis without a USDA API call, measured over a rolling 7-day window.
- **p99 lookup latency (cached)**: ≤ 200 ms end-to-end for `GET /api/v1/foods/{fdcId}` when `fetch_status = 'fetched'`.
- **p99 lookup latency (cold / async)**: Initial `202 Accepted` response returned in ≤ 1.5 s; subsequent poll resolves within 60 s under normal queue depth.
- **Backfill queue depth SLO**: SQS `usda-fetch-queue` depth ≤ 500 messages during steady-state; CloudWatch alarm fires if depth exceeds 2,000 for > 5 minutes.
- **USDA upstream availability awareness**: System degrades gracefully (returns `503` with `Retry-After`) when USDA FoodData Central is unavailable; circuit breaker opens after 5 consecutive failures; no user-facing 500 errors attributable to USDA outage.
- **Ingredient resolution accuracy**: ≥ 90% of recipe-import ingredient names resolve to a confirmed FDC ID without requiring manual override by the user, measured over a 30-day cohort.
- **DLQ accumulation**: `usda-fetch-dlq` depth = 0 under normal operations; Operations Engineer MTTR for DLQ events ≤ 4 hours (alerted via CloudWatch alarm).
- **Stale data refresh coverage**: ≥ 95% of `foods` rows with `last_synced_at` > 30 days are re-queued within the weekly `usda-bulk-sync` window.

---

## Open Questions

- **Q-001 — Notification ownership** ✅ **RESOLVED (Rev 1)**: Notification delivery is owned by a **new dedicated feature** (notification service), not by 001 or 003. Contract:
    - **Producer side**: any service publishes a message containing a recipient descriptor (single user, group, or global) and a `messageType` keyword.
    - **Delivery side**: clients subscribe to receive messages whose recipient descriptor matches their identity / group membership. The exact delivery mechanism (push via WebSocket, webhook callback, client-pull retrieval, or a hybrid) is an implementation-time decision.
    - **Client side**: the receiving client parses the payload and dispatches behavior based on the `messageType` keyword (e.g., `food.backfill.completed` → toast + refresh ingredient detail).
    - **Launch transport scope**: in-app only. Email/push deferred.
    - Feature 003's role: **publish** `food.backfill.completed` (and related fetch-failure events) to the notification service. 003 does not own transport, templating, retry, or preference storage.
    - User notification preferences and template management are deferred to a later revision of the notification feature.

- **Q-002 — Search architecture decision** ✅ **RESOLVED (Rev 1)**: Default to PostgreSQL FTS (`tsvector`/`tsquery` + GIN index) for launch. The search layer must be designed behind a pluggable interface so an external engine (e.g., OpenSearch/Typesense) can be swapped in later without changing call sites. Concrete abstraction shape is an implementation-time decision.

- **Q-003 — Shared food/ingredient type ownership** ✅ **RESOLVED (Rev 1)**: Do not introduce a `recipe-core` package. Food and ingredient types relevant to feature 003 live with this feature's data layer. Cross-feature sharing, package boundaries, and naming are deferred to implementation; the spec stays generic and does not prescribe a package name or location.

- **Q-004 — USDA license attribution placement** ✅ **RESOLVED (Rev 1)**: USDA attribution appears in the **ingredient detail view**. Footer / settings placement and API `source` field are out of scope for launch unless required by USDA terms; revisit if compliance review flags it.

- **Q-005 — Ingredient name normalization strategy** ✅ **RESOLVED (Rev 1)**: Normalization (singular/plural, trade names, regional spelling, synonyms) is a first-class concern of the search/resolution layer and must be implemented in a way that is compatible with the pluggable search backend from Q-002 — i.e., normalization rules and synonym data live above the engine boundary so they survive a backend swap. Specific pipeline (rule-based, dictionary, ML-assisted) is an implementation-time decision.

- **Q-006 — Cache invalidation cadence vs USDA refresh schedule** ✅ **RESOLVED (Rev 1)**: Refresh cadence and staleness thresholds are configurable. Defaults: weekly bulk sync and a 3-day `fetched_at` staleness threshold for on-demand revalidation. Per-dataset overrides (Foundation / Branded / SR Legacy) and breaking-change invalidation are operational concerns handled at implementation; the spec does not pin a fixed schedule.

- **Q-007 — Branded vs generic disambiguation UX** ✅ **RESOLVED (Rev 1)**: Use a **badge** on each search result to distinguish branded vs generic foods (and to surface data-type provenance). Default sort order and ranking weights are implementation-time decisions; the UI affordance is a badge, not separate sections or tooltips.

- **Q-008 — Backfill prioritization policy** ✅ **RESOLVED (Rev 1)**: Backfill prioritization is demand-weighted: duplicate / repeated requests for the same pending food increase its effective priority in the queue (see US-005). Static high/normal flags are replaced by demand signal. Exact weighting function and any time-decay are implementation-time decisions.
