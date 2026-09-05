# 0030 — First-party analytics events: one store, two doors, lifetime counts

- **Status:** Accepted
- **Date:** 2026-09-01
- **Origin:** `docs/brainstorms/2026-08-31-analytics-events-requirements.md` (owner dialogue) →
  `docs/plans/2026-09-01-001-feat-analytics-events-plan.md` (five-persona review + staff-architect
  blueprint). Greenlit by the U15 report's "Owner rulings" §2.

## Decision

The product records what people do — ingredient searches and their outcomes, recipe saves, recipe
views — in **one append-only store in the recipe database** (`analytics_events`, migration 0043),
folded into **lifetime per-recipe counts** (`recipe_impact_signals`) by a database trigger. Two
capture doors feed it: the **server door** (inline fire-and-forget capture at the handlers that
already observe saves and views) and the **client door** (`POST /ingest/v1/events`, carrying only
settled query-outcome events from web and mobile). No third-party vendor sits between the product and
its own numbers ("plain Postgres for now" — owner, 2026-08-31; the market scan lives in the origin
doc: PostHog Cloud EU won the paper comparison if a vendor projection is ever wanted, and it would be
a disposable fan-out, never the system of record).

## The rules that hold the design up

### 1. The fold is a DELTA UPSERT on exactly one INSERT-only trigger — never a recompute

Migration 0010's ratings trigger RECOMPUTES from the base table, which is correct for rows that live
forever and **fatal here**: after retention deletes aged rows, a recompute collapses a lifetime count
of 100 to the survivors. The fold reads ONLY the statement-level transition table
(`count = count + delta`), so deleted history is invisible to it by construction. ⛔ There is **no
UPDATE trigger and no DELETE trigger** — absence is the design, pinned by the integration suite —
because the erasure sweep's UPDATE and retention's DELETE must both fire nothing. The
recompute-catcher scenario (fold → delete aged → new save = old + 1) is the one test that
distinguishes the implementations; it runs in the recipe-service IT and again through the real
sweeper in the workers IT. ⛔ `recipe_impact_signals` has ONE legal writer — the trigger (the table
COMMENT says so); counts never decrement: not on unsave, not on erasure, not on retention (KD6). The
table is 015's future home — recipe-keyed, viewer-less from birth (012-FR-024), `cook_count`
provisioned unwritten.

### 2. Erasure ANONYMIZES — rows and counts survive their author

`eraseRecipeRows` step 14: `UPDATE analytics_events SET user_id = NULL, query_text = NULL WHERE
user_id = $1`. Deliberately **stricter than ADR-0027** by ruling, not drift: the typed search query is
the user's own words, not a recipe's ingredient phrase, so it goes with the id. The pair CHECK
(`query_text IS NULL OR user_id IS NOT NULL`) makes the pairing structural, and the erasure-coverage
gate classifies the table from the statement itself. ⛔ Do not "fix" the sweep into a DELETE — it
would erase the history SC2 promises 015 and look correct in any test that only checks for a
remaining user id. Anonymized rows stop contributing to distinct-user dedup, and the residual
re-identification long-tail (timestamp + subject correlated against other logs) is ACCEPTED, per the
origin's KD4 and ADR-0027's pseudonymous-ULID precedent.

### 3. Door binding: credit-bearing families are server-observed ONLY

`recipe_saved` and `recipe_viewed` (and cooks when they exist) feed 015's user-visible recognition,
so the client ingest door accepts only `query_outcome` — a server-door type in a batch is dropped and
logged (R12/AE3), and the payload schema has **no actor-shaped field** (strictObject + a walked-key
pin): the actor is always the verified bearer's principal. A save event fires only on a genuinely NEW
membership (the DAL's `created` flag) — a replayed add minting credit would permanently diverge
`save_count` from `recipe_collections` (R11's reconcilability) and let a user farm recognition. View
capture lives at the **controller detail handler**, deliberately not `RecipesService.getById`, whose
six non-view internal call sites (photos ×2, versions ×3, ratings ×1) would inflate every lifetime
count; the IT's mutation test drives those routes and asserts zero views.

### 4. Isolation: fire-and-forget behind a per-instance, two-tier shed

Server capture is synchronous-void (`void recordSafely()`, the `notifyCorroborated` precedent) — a
failed, slow, or saturated analytics write costs the user-facing action nothing (SC4 is proven by
fault-injection ITs with a rejecting and a hanging analytics db). The in-flight bound is
**per-instance on purpose**: the protected resource is each Fargate task's own DB pool, and a
distributed limiter would protect the wrong thing while adding a dependency to a path whose whole
point is having none. Two tiers: client-door families shed first (at 16 in-flight — a lost
query-outcome is at-most-once noise), server-door families only at the hard cap (32). Drops are
counted and flushed as ONE aggregated line per interval — never a line per drop, which storms during
the exact saturation the cap exists for.

### 5. The client door is off the domain contract, and the payload bounds come from the keepalive quota

The route mounts at `ingest/v1` (the contract parity filter admits only `health` and `api/*`), the
payload zod is a `@kitchensink/recipe-core` SUBPATH export (`analytics/event-payload`, never the
barrel — the barrel is inside the contract corpus), and no `*.schema.ts` file may exist under
`src/analytics/` (contract discovery is blunt on purpose; one glob pin enforces it). Evolution is
**additive only** (R8). The batch/query/list/label caps are derived from the Fetch spec's 64 KiB
aggregate `keepalive` quota — an over-quota send rejects immediately and a swallowing emitter would
turn that into systematic silent loss of exactly the richest events — and the payload module's own
test serializes the worst-case batch and demands it under HALF the quota (which is why the batch cap
is 8, not 10: at 10 it measured 35 KiB). React Native ignores `keepalive`; its loss window is app
termination, inside R11's at-most-once budget.

### 6. The no-pick unit is a SEARCH SESSION, not a settled render

The resolver debounces ~300ms, so every typing pause settles a prefix; counting each superseded
prefix as an abandonment would make the capture-rate denominator a function of typing cadence.
Extension/refinement CONTINUES the session (same event id — minted at session start, the KTD5
"occurrence" moment, so transport retries dedup at the door); an outcome emits exactly once — pick at
`selectSuggestion` (the only seam where provenance and served-list position both exist; never
`resolveLine`, which converges eight non-pick paths), or no-pick on clear-to-empty, a non-suggestion
resolution (create-after-search included), or unmount cleanup. The ingest route reports accepted vs
landed and logs the divergence: a dedup rate persistently above retry noise is the
id-minted-at-mount-bug alarm.

Two boundary semantics, made explicit after the staff-architect REVIEW (2026-09-01) so the record
matches the code:

- **Continuation is TEXT REFINEMENT; a wholesale retype is an ABANDONMENT (owner ruling
  2026-09-01).** One settled text starting with the other — typing more, or backspacing — continues
  the session (same event id, updated query + served list); a replacement ("butter" retyped to
  "sugar") settles the old session as a no-pick carrying ITS query and served list, and the new text
  begins a NEW session with a new id — two logical search intents, two events. The prefix test runs
  against the LAST SETTLED query, so a retype whose intermediate backspace states settle still
  registers as a replacement at the first non-refining settle. This supersedes the
  continued-interaction reading an earlier draft of this section recorded.
- **An unlocatable pick emits NOTHING — no pick, no no-pick.** When the tapped suggestion cannot be
  found in the served digest (a stale render, or an entry truncated past the 20-entry digest cap),
  asserting a position that was never served would be worse than silence, so the session evaporates.
  This slightly understates the denominator for the long-list case; accepted, and recorded here so the
  capture-rate reader knows the bias direction.

- **The event-id minter is a platform seam** (`mintEventId.ts` / `mintEventId.native.ts`): Hermes
  ships no `crypto` global, so the native leaf delegates to `expo-crypto`; the shared hook never
  touches the bare global (guarded at source by
  `packages/infra/global/__tests__/analyticsMintEventIdSeam.test.ts`). ⚠️ Residual: the native leaf
  has run under vitest stubs only — the on-device/Maestro pass is the outstanding confirmation.

### 7. Retention: 6 months, fold-before-delete by construction

A daily recipe-workers Lambda deletes rows older than 6 months (owner, 2026-09-01), keyed on
`created_at` — the server clock; `occurred_at` is client-asserted and could age a row straight into
deletion. Because counts fold at INSERT and no DELETE trigger exists, fold-before-delete needs no
runtime check; AE5 is asserted against a real database anyway. The store's shape keeps the S3/Athena
export door open (R9): an export step would land before the delete in the same handler, no redesign.
The sweeper is a NAT-ledger consumer (ADR-0004 marker block; ~zero actual traffic).

### 8. The count-serving contract — v1 SHIPPED (owner instruction 2026-09-01), and what still is not

**`RecipeDetail.impact` (`{ saveCount, viewCount }`) now rides the detail read** — an additive
optional field on `recipeDetailSchema`, composed at the CONTROLLER detail handler (the same seam as
view capture, for the same reason: the service's `getById` is an internal authorization helper with
six non-view call sites that must not pay — or serve — analytics). Three rules hold it up:

- **The visibility boundary is INHERITED, never re-derived**: the counts merge only onto a response
  the domain read authorized; a 404/403 read serves nothing.
- **Absent means UNKNOWN, zeros mean NEVER.** `AnalyticsService.readImpactSignals` answers zeros for
  a recipe with no signals row, and `undefined` — the field omitted — on a read failure OR a read
  exceeding its `IMPACT_READ_TIMEOUT_MS` budget. ⛔ The budget exists because this read is AWAITED on
  the hottest read in the service, unlike every fire-and-forget capture — SC4's hanging-db
  fault-injection scenario caught exactly that regression when the read first shipped unbounded.
- **OQ2 resolves to KD6's default**: author self-actions COUNT. The folded table is actor-blind by
  design (viewer-less, 012-FR-024), so exclusion could only ever be capture-time filtering going
  forward — a future revision path, never a retroactive one. `cookCount` is deliberately not served
  until 015 writes it; adding it then is additive.

The served figure typically excludes the very view that fetched it (capture is fire-and-forget after
the read), and view counts are inherently soft (any signed-in refresh increments). Both server-door
families, so ADR-0030's accepted-risk guardrail (client-asserted pick data) is not implicated.

Still deliberately NOT built: the save-count reconciliation job (the seam is the collections table),
the recognition PRODUCT surface (badges/copy — 015's work), the vendor projection, dashboards, and
the S3 archival tier. Operator queries run plain SQL on the request-path instance; if they ever
contend, the levers are a read replica or the export tier — not a new store.

## ⚠️ The accepted-risk guardrail (binding on future work)

Query-outcome data — the query, the served list, the pick's group/position/provenance — is
**client-asserted and unverifiable**. That is acceptable while these numbers feed only internal SQL
analysis. ⛔ **If picks ever feed an automated ranking signal or any user-visible metric, an
integrity/anomaly bar is owed FIRST** (rate/shape anomaly detection at minimum). The identity half is
already structural — attribution comes only from the verified token — but the CONTENT half is an
honest client assumption, and promoting it to an input of anything user-visible without that bar
re-opens the attack the door binding closed for credit.

## Consequences

- U15-style measurements become SQL over rows (SC1); 015 finds save/view history preserved and builds
  no telemetry (SC2).
- The events table grows write-per-read on views (origin OQ3's resolution: fine at current scale; the
  shed policy and sampling are the levers if it ever isn't).
- An erased user's rows survive as anonymized facts; a 423 during an in-flight erasure is the
  DESIGNED ingest answer (no new user-keyed rows mid-sweep) and must not be "fixed" with a lock
  exemption.
- Migration 0043's partial idempotency index obliges every landing to spell
  `ON CONFLICT (event_id) WHERE event_id IS NOT NULL` — a bare `ON CONFLICT (event_id)` errors at
  runtime.
