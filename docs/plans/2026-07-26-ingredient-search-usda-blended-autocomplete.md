---
type: feat
status: proposed
date: 2026-07-26
title: 'Ingredient search & USDA-blended autocomplete — coverage-first (seed → blend → on-demand live)'
origin: owner ask (this session) — "autocomplete from both our database and USDA; there is a performance and UX concern to be figured out." Grounded in 3 parallel research streams (internal system map, competitive/food-DB market research, federated-autocomplete UX research), all cited inline.
---

> ⚠️ **Superseded as a description of current state** by [`docs/architecture/2026-08-28-ingredient-pipeline-state.md`](../architecture/2026-08-28-ingredient-pipeline-state.md) (2026-08-28, PR 91).
>
> The decisions and reasoning below remain valid and this document is deliberately NOT deleted. Where it
> and the state addendum disagree about **what exists today**, the addendum wins.

# Ingredient search & USDA-blended autocomplete

> **Intent (owner):** when a user types an ingredient, autocomplete should draw on **both our own catalog and
> USDA**, fast, without the per-keystroke performance/quota problem. This document is the design.

## TL;DR — the reframe

"Autocomplete from DB + USDA" naively reads as "add a live USDA search box." That is the **expensive, risky
20%**. The high-leverage path to the same user outcome is **coverage-first**, in three stages that each ship
value independently:

1. **Seed** the local catalog from the **USDA bulk download** (Foundation + SR Legacy ≈ 8k lab-analyzed whole
   foods) — one-time ETL, **zero live-API quota cost**, covers the overwhelming majority of everyday searches.
2. **Blend** the food-service catalog into the ingredient typeahead (today it is **not queried at all**) —
   instant, local, no quota.
3. **Live USDA on-demand** for the long tail (branded / obscure / misspelled) — a **cached, quota-budgeted,
   explicitly-triggered** fallback with a **synchronous by-fdcId admit** on pick.

After (1)+(2), (3) is rarely hit — which is exactly what makes the **1,000-req/hr per-IP USDA quota**
survivable. This inverts the risk: seeding does the heavy lifting; live search becomes a small cache-fronted
tail, not the primary load against a shared quota.

**Recommendation:** build (1)+(2), instrument the **local hit-rate**, then decide whether (3)'s complexity is
warranted — it may be needed only for a thin branded tail, or deferrable. Do NOT build (3) first.

## Feasibility resolutions (round 2 — code-verified adversarial pass)

A feasibility review against the real code corrected four things in the first draft; they are folded into the
sections below and summarized here so the record is honest:

- **F-C2 (was missed) — "seed is free" is only true at ingest.** Seeding ~8k RESOLVED foods turns the
  **change-refresh worker into a sustained consumer of the same 1,000/hr USDA window**: `refreshResolvedFood`
  does a live `fetchByKey` per backing item to compare `item_version`
  (`food-service/src/worker/foodConsumer.service.ts:337-385`). ~8k re-fetches/cycle would compete with the
  interactive reserve — and **SR Legacy is a frozen dataset that never changes**, so those calls are pure
  waste. **Seeded foods MUST be excluded from live change-refresh and re-freshed from the next bulk download.**
  This is a **Stage-1 requirement**, not deferrable (the drain starts the moment the seed lands).
- **F-#4 (owner corrected me, then sharpened) — the live-search endpoint is USER-AGNOSTIC.** USDA rate-limits
  by **IP** (our food-service egress), not by user, so the **aggregate limiter is the only quota-protection
  mechanism** and it needs no owner identity. Per-owner throttling is **not** a quota mechanism — it is
  optional **fairness** (one user not hogging our self-imposed interactive budget). recipe→food stays **M2M**
  (static `svc_recipe` token; owner decision); food-service's live-search is user-agnostic; any per-owner
  fairness limit lives at **recipe-service** (verified `@OwnerId()`) and is **deferred pending measurement**.
  The earlier "owner-scoped `/search/live` + per-owner throttle at the food boundary" framing is **removed** —
  food-service deliberately trusts no caller-supplied identity (forgeable behind the public ALB; PR#39).
- **F-W1 — the interactive sub-budget is a schema + limiter change, not "config."** `source_call_log` has only
  a `source` column and the limiter keys on `FoodSourceId` alone; splitting interactive-vs-worker needs a new
  `channel` dimension on the ledger + a channel-aware count/insert + a limiter-API arg. Real migration.
- **F-W2/W3 — the "reuse" claims are net-new (modest) work.** Stage 1 needs its **own bulk parser** (bulk CSV ≠
  the API `UsdaFoodDetail` shape) + an explicit **find-or-create on the crosswalk** (a blind re-create causes an
  FK violation — `onConflictDoUpdate` doesn't update `foodId`); the nutrient dictionary **does** auto-resolve
  (no pre-population). Stage 3's `admitByExternalKey` is a **new** `MergeAndPersistService` method (find-or-create
  food → `fetchByKey` → single-survivor persist) reusing the merge _primitive_ (`blendPicks`), not
  `resolveFromPicks` (which is bound to an existing food row). The opaque token **reuses the existing `jose`
  codec** (`recipe-service/src/auth/serviceErasureAuth.service.ts`). Stage 2 blend is feasible
  (`SearchResultView.id` **is** the `food_id`), needs null-name handling + merged ranking.
- **Round-3 (adversarial pass on the revision, Stage 1+2 focus) — folded in:**
    - **F1 (material)** — Stage 2 "synchronous, no poll, already has RESOLVED nutrition" was WRONG (re-introduced
      the very over-claim Stage 3 retracted). Food search carries no nutrition; `createFoodBacked` writes none;
      the pick MUST do one immediate `getStatus`+`updateResolution` backfill or ship NULL calories. Corrected.
    - **F2 (medium)** — Stage 2 adds a **per-keystroke cross-service call** to food-service; it is "no quota," NOT
      "entirely local." Given the same timeout + local-fallback discipline as USDA. Corrected.
    - **F3 (medium-low)** — the refresh-exclusion marker lives on **`food` (`origin` column)**, NOT
      `food_sources.fetch_state` (CHECK-constrained + clobbered); and the exclusion is **correctness-critical**
      (null `item_version` → permanent churn + nutrition clobber), not just quota. Corrected + strengthened.
    - **F4 (low, Stage 3)** — `admitByExternalKey` needs BOTH external-key dedup AND a normalized-name
      find-or-create (a different fdcId can collide on a seeded row's normalized name). Flagged in Stage 3.
    - **Verified sound:** seeding does NOT change by-name merge semantics (a RESOLVED seed stays RESOLVED,
      no enqueue, the merge engine is never re-run); Stage-1 create-PENDING-then-`resolveAndPersist` is a legal
      transition; `SearchResultView.id` IS the `food_id`.

---

## 1. Research synthesis (all cited)

### 1a. Internal system — what exists vs what's missing (code-grounded)

- **USDA search is non-persisting but unreachable interactively.** `UsdaSourceAdapter.searchByName`
  (`food-service/src/sources/usda/usda.adapter.ts:181`) returns `SourceCandidate[] = {source, externalKey=fdcId,
name}` **without persisting** — but its ONLY caller is the Fargate worker's `fanOut`
  (`worker/foodConsumer.service.ts:446`), which immediately fetch-merges-persists. **No public / read-only /
  cached USDA-search path exists.**
- **Neither ingredient search nor food search touches USDA today.** recipe `GET /v1/ingredients/search`
  (`recipe-service/src/ingredients/dal/ingredients.dal.ts:149`) is a **local** Postgres FTS+trgm query over the
  recipe-service `ingredients` catalog. food-service `GET /v1/foods/search`
  (`food-service/src/foods/foods.service.ts:164`) is **also local** (it only crosswalks the raw query if it _is_
  a barcode/fdcId). And **the ingredient search does not even call food-service** — the bridge proxy
  `IngredientsService.suggestFoods` (`ingredients.service.ts:146`) is **dead code with no endpoint/caller**.
- **The quota is the constraint.** `RollingWindowLimiter`: `DEFAULT_SOURCE_CAPS.usda = {hardCap: 1000,
pauseThreshold: 900}` (`sources/RollingWindowLimiter.ts:24`), a rolling **60-min** window over
  `source_call_log`, atomic `tryRecord` (strict, no token-bucket overshoot), 429 → **60s in-process** backoff
  (`markWindowFull`, `:154`, **not** cross-process visible). This 1,000/hr is **shared** with the worker
  fan-out; there is **no separate budget for interactive search**, and **no cache of USDA search results**
  (`source_call_log` is a rate ledger, not a result cache).
- **The identity boundary.** `fdcId`/`externalKey` is confined to the adapter (FR-IDN-2); `SearchResultView` /
  `FoodView` carry no fdcId. The crosswalk `FoodSourcesDao.findFoodIdByExternalKey('usda', key)`
  (`dao/foodSources.dao.ts:92`) is **single-key** — no bulk `external_key IN` reconciliation exists.
- **Admit is name-fan-out, async, and can land UNRESOLVED.** Picking an unknown today = `POST
/v1/ingredients/by-name` → food `POST /v1/foods` (202 PENDING) → worker fans out `searchByName` + top-20
  `fetchByKeys` → `GoldenRecordMergeEngine` survivor-count: **1→RESOLVED, >1→UNRESOLVED (needs disambiguation),
  0→NOT_FOUND** (`merge/mergeEngine.ts:294`). There is **no synchronous by-fdcId admit** — so even a hit the
  user explicitly chose re-enters the fan-out and may split UNRESOLVED.
- **Reusable primitives:** the API process already has `UsdaSourceAdapter` + `RollingWindowLimiter` in DI
  (`foods.module.ts:76-102`); `searchByName` (non-persisting); the local `FoodSearchDao`; the merge/persist
  pipeline (`resolveFromPicks` bypasses the survivor gate for a human-chosen pick — `mergeAndPersist.service.ts:138`);
  the client/hook + debounce patterns.

### 1b. Market / competitive (sources below)

- **The single biggest lever: USDA bulk download.** Full CSV/JSON dumps of Foundation, SR Legacy, FNDDS,
  Branded exist ([FDC downloads]). Foundation + SR Legacy are **small, stable, lab-analyzed whole foods** —
  pre-seeding them makes local-first cover the everyday case with **no** live-API cost. Branded (~1.5M, ~3GB) is
  the long tail we leave to on-demand.
- **The pattern is cache-aside + layered/golden-record** — not novel. Cronometer curates lab-analyzed sources,
  tags each by provenance, and staff-reviews user entries **before** merging; MyFitnessPal's ~70% unvetted
  user layer erodes search trust ("just delete the user-entered database"). Yummly computes recipe nutrition by
  mapping ingredients to USDA — a "recipe-first, defer to USDA" shape structurally identical to ours. The
  cache-aside shape (local → miss → source-within-quota → persist → never re-fetch) is the textbook answer to a
  rate-limited cacheable upstream ([Azure cache-aside]).
- **Cautions:** USDA **Branded** is manufacturer-submitted — **not** uniformly "verified"; badge honestly.
  Off-the-shelf food-search ranking is weak (Nutritionix surfaced "almond milk" for "almonds") — category
  disambiguation matters. Segregate any user layer (Cronometer rule).
- **USDA FDC limits (confirmed):** 1,000 req/hr **per IP** (server-proxied ⇒ one abusive client can lock the
  key for everyone for the hour); `DEMO_KEY` far lower. `X-RateLimit-*` headers + 429. Higher limits available
  on request for OSS/research. Fallbacks if ever needed: Open Food Facts (free, no limit, ODbL, branded/barcode),
  FatSecret/Edamam (paid).

### 1c. Federated-autocomplete UX (sources below)

- **Section, don't blend** (command-palette pattern — Linear/Slack/Raycast): local results render instantly in
  one section; a slower source **appends below in its own labeled section**, never interleaving/reordering the
  fast section — structurally eliminates layout-shift jank.
- **Scoped-then-global** (GitHub code search): default to the fast/local corpus; require an **explicit action**
  to widen to the external source. This is the closest analog to "local instant, USDA on tap."
- **Trigger:** local fires per keystroke ≥2 chars, ~150–200ms debounce (it's a local index). USDA is **never
  auto-fired on keystroke** — auto only when local is **thin** (e.g. <3 after settle, ~500ms further debounce),
  and always offer an explicit pinned "**Search USDA for '{query}'**" row.
- **Presentation:** provenance **badges** (Cronometer-style "USDA" vs "Your ingredients"); **fuzzy-threshold**
  dedup (not exact-string) to reconcile "chicken breast" vs "Chicken, broiler or fryers, breast, meat only,
  raw"; **stall-threshold** spinner (only if USDA is genuinely slow past its debounce); 429 → inline dismissible
  "USDA temporarily unavailable," **never blocking local**.
- **A11y:** WAI-ARIA combobox (`role=combobox/listbox/option`, `aria-expanded`, `aria-activedescendant`) across
  both sections as one logical list + a visually-hidden `aria-live="polite"` announcer for late USDA results
  (the spec has **no async guidance** — this is the gap to design past).
- **Mobile:** bottom-sheet takeover on focus (keyboard eats ~50% of viewport), cap ~10 rows, never auto-collapse,
  sticky "Search USDA" affordance.

---

## 2. Architecture — three stages

### Stage 1 — Seed the local catalog from the USDA bulk download _(highest leverage; zero quota at ingest)_

- **What:** a one-time (+ periodic) importer that parses the USDA **bulk** Foundation + SR Legacy datasets
  (~8k whole-food records) and inserts them as **RESOLVED golden records** into food-service (`food`,
  `food_sources` crosswalk on `(usda, fdcId)`, `food_nutrients`, `food_portions`, `food_field_provenance`).
- **How (honest sizing — F-W2):** a food-service **admin/CLI lambda or worker task** (NOT the rate-limited API
  — bulk files are downloads, not API calls). It needs: 1. **A new bulk parser** — the bulk CSV/JSON schema (`food.csv`/`food_nutrient.csv`/`food_portion.csv`, fields
  like `gram_weight`, `portion_description`, `measure_unit`) differs from the API's `UsdaFoodDetail` that
  `mapToCanonical` consumes, so the mapping to `CanonicalCandidate` is **re-implemented for the bulk shape**,
  not a reuse of the private API mapper. 2. **Explicit find-or-create per fdcId** — `findFoodIdByExternalKey('usda', fdcId)` → reuse the existing
  `food` row if present, else create a PENDING row FIRST; then `MergeAndPersistService.resolveAndPersist({
foodId, candidates:[canonical]})` (single survivor ⇒ RESOLVED). A blind re-create then upsert would keep
  the old crosswalk `foodId` while values write against a new one → same-food FK violation. The **nutrient
  dictionary auto-resolves** (`NutrientDao.resolveOrCreate` inside `persistResolved`) — no pre-population.
  Idempotent via the find-or-create, NOT the raw unique constraint.
- **Scope decision:** Foundation + SR Legacy only (small, high quality). **Branded is NOT seeded** (~3GB, junk
  risk) — it stays on-demand (Stage 3). FNDDS (Survey) optional later.
- **Refresh — F-C2, a HARD Stage-1 requirement (CORRECTNESS-critical, not just quota):** seeded foods MUST be
  **excluded from the live change-refresh scan** and re-freshed from the **next bulk download**, not the API.
  `refreshResolvedFood` / `ChangeRefreshConsumer` do a live `fetchByKey` per backing item to compare
  `item_version` (`worker/foodConsumer.service.ts:357,385`, `change-refresh/changeRefresh.consumer.ts:138`).
  Two failure modes if not excluded: (1) ~8k seeded foods drain the 1,000/hr window (~8h/sweep) against the
  interactive reserve (SR Legacy never changes upstream — pure waste); and (2) **data corruption** — a bulk row
  has `item_version = null`, which never equals an API version, so every sweep treats it as "changed",
  re-enqueues forever **and clobbers the lab-analyzed bulk nutrition with API data** via `mergeChangedSources`.
  **Marker:** a NEW `origin` column on **`food`** (`bulk` | `live`) — NOT `food_sources.fetch_state` (CHECK-
  constrained to `fetched`/`error` and overwritten by every `upsertSource`). `listResolvedBackingItems` already
  joins `food_sources → food` (`foodSources.dao.ts:144`), so the gate is a clean `AND f.origin <> 'bulk'`.
- **Value:** most everyday ingredient searches become **instant local hits with real nutrition, and zero live
  USDA calls** — at ingest AND at refresh (once excluded). This is the bulk of the user-visible win.

### Stage 2 — Blend the food-service catalog into the ingredient typeahead _(instant; no quota)_

- **Problem:** the ingredient typeahead queries only the recipe-service `ingredients` table (rows that have
  already been _used_ in a recipe). After Stage 1, ~8k seeded golden records live in the **food-service** `food`
  catalog but are invisible to the typeahead until someone add-by-names them.
- **What:** the ingredient search returns a **blended, deduped** local result set = recipe-service `ingredients`
  (freeform + previously-used, includes the 4 cached macros) **+** food-service `/v1/foods/search` (the seeded
  golden catalog, `SearchResultView.id` IS the `food_id`). Wire the dead `suggestFoods` proxy
  (`ingredients.service.ts:146`) into the `/search` handler, or a new `?includeCatalog=true`. Dedup by `food_id`
  crosswalk (a food already an ingredient row appears once). Rank: local recipe rows (familiar) and catalog rows
  interleaved by score, or sectioned ("Your ingredients" / "Food catalog") per the UX pattern.
- **Availability discipline (F2 — NOT "entirely local"):** `/v1/foods/search` returns `{id,name,score}` and
  runs a trgm+FTS query + 2 crosswalk lookups per call, so the blend adds a **cross-service HTTP round-trip per
  keystroke**. Apply the SAME degradation the doc prescribes for USDA: a short timeout, and **fall back to the
  recipe-local DAL results** (today's single Postgres query) if food-service is slow/down — the local section
  must always render. It is "no quota," NOT "instant/local."
- **Pick path (F1 — corrected):** `SearchResultView` carries **no nutrition**, and `createFoodBacked` writes
  only `name/food_id/status` (`ingredients.dal.ts:302-308`) — nutrition is populated ONLY by `updateResolution`
  via `refreshStatus`→`getStatus`→`extractNutrition`. So picking a food-catalog hit: create the food-backed row
  (status RESOLVED) **then do ONE immediate food-service by-id read** (`getStatus`) to backfill nutrition/portions
  via `updateResolution`. It is **poll-free in timing** (the seeded food is already RESOLVED, so `getStatus`
  returns immediately) but it IS one cross-service round-trip — NOT "already has nutrition, no call." A builder
  who skips the backfill ships an ingredient row with NULL calories.
- **Value:** "type chicken breast → instant local hit from the seeded USDA data; pick → RESOLVED nutrition in
  one immediate round-trip."

### Stage 3 — On-demand live USDA search (the long tail) _(cached, budgeted, explicit)_

Only the residual (branded, obscure, misspelled, not-yet-seeded) reaches here. New pieces:

- **A read-only, cached, non-persisting, USER-AGNOSTIC live-search endpoint** in **food-service** (it owns the
  adapter, crosswalk, and limiter): e.g. `GET /v1/foods/search/live?query=`, called over the existing recipe→food
  **M2M** (`svc_recipe`) path. **No owner identity is needed or accepted here** (F-#4): USDA limits by IP, so the
  aggregate limiter is the quota authority; the endpoint stays identity-free and never trusts a caller-supplied
  owner. Flow:
    1. **Result cache first.** New short-TTL `usda_search_cache` (normalized query → `SourceCandidate[]`, TTL ~24h
       — USDA data is stable). A popular long-tail query ("bimbo bread") hits USDA **once per TTL, across all
       users** — the primary quota amplifier-killer.
    2. **On cache miss, gate the interactive sub-budget** (below), then `searchByName` (one windowed charge),
       cache the result.
    3. **Bulk-crosswalk** the returned fdcIds against `food_sources` via a NEW `external_key IN (...)` batch
       method — a live hit **already admitted/seeded** returns its **internal id** (dedup vs local); a
       not-yet-admitted hit returns an **opaque admit token** (below). fdcId never leaves the boundary (FR-IDN-2).
- **Interactive quota sub-budget (the quota lever — F-W1, a real migration).** The 1,000/hr USDA key is split
  into two lanes summing to ≤ the key cap: `FOOD_INTERACTIVE_SEARCH_CAP_PER_HOUR` (a **reserved floor** for
  user-facing search, e.g. ~300) and the worker fan-out gets the remainder. User search is prioritized (a
  waiting human > admission lag; the worker already tolerates `isPaused`). **This is not config:** it needs a
  new `channel` dimension on `source_call_log`, a channel-aware count/insert (keep the advisory lock on `source`
  so both lanes serialize), a limiter-API arg, and two-cap DI wiring. Plus load-shedding analogous to
  `AuthLoadShedder`. **No per-owner throttle here** — quota is aggregate/IP; optional per-owner _fairness_ is a
  recipe-service concern, deferred (see §4).
- **Opaque admit token + by-fdcId admit (F-W3 — net-new, reuses the merge primitive).** A not-yet-admitted hit
  carries an **opaque token** (server-encoded `{source, externalKey}`) — **reuse the existing `jose` codec**
  (`recipe-service/src/auth/serviceErasureAuth.service.ts`), not a hand-rolled one; NOT the raw fdcId. Picking
  it → `POST /v1/foods/admit-by-key {token}` → a **NEW `MergeAndPersistService.admitByExternalKey`**:
  `findFoodIdByExternalKey` (dedup vs already-admitted → return its id) else create a food row **via the
  `createByName` `ON CONFLICT (normalized_name)` path** — NOT a blind insert (F4): a _different_ fdcId can
  normalize to a seeded row's name (branded "chicken breast" vs seeded SR-Legacy "chicken breast") and
  `food.normalized_name` is a NOT-NULL unique index, so the admit needs **both** external-key dedup AND a
  normalized-name find-or-create or it 23505s. Then `fetchByKey` → persist as a single survivor via
  `blendPicks`/`persistResolved` (the reusable primitive; `resolveFromPicks` is bound to an existing-food
  lifecycle, so this is a new method, not a reuse of it).
  recipe-service wraps it as `POST /v1/ingredients/by-key` → a food-backed RESOLVED ingredient row.
  **Latency (F-info):** `fetchByKey`/`getFood` has a 10s timeout, so the pick path is designed as **fast-poll via
  the existing status mechanism** (median sub-second, ≤10s tail), NOT a promised-instant synchronous RESOLVED —
  still strictly better than the by-name path (deterministic single survivor, no UNRESOLVED split).
- **UX:** local sections render instantly; a pinned "**Search USDA for '{query}'**" row (+ auto-trigger when
  local <3); USDA results append in a labeled, badged section; stall-threshold spinner; 429/quota → inline
  "USDA busy, try again" that never blocks local; ARIA combobox + `aria-live`; mobile bottom-sheet.

---

## 3. Data-model & contract changes (summary)

- **New:** `usda_search_cache` (query-normalized key, `SourceCandidate[]` payload, `fetched_at`, TTL index) —
  food-service. A bulk-crosswalk DAO method (`findFoodIdsByExternalKeys(source, keys[])`). A **`channel` column
  on `source_call_log`** (+ channel-aware count/insert, limiter-API arg, two-cap DI) for the interactive
  sub-budget (F-W1 — a migration, not config). A NEW **`origin` column on `food`** (`bulk`|`live`) to exclude
  seeded rows from live refresh (F-C2/F3 — on `food`, NOT `fetch_state`). An opaque-token codec (**reuse the
  `jose` service-erasure codec**, server-side only).
- **Stage-2 pick (F1):** a food-service by-id read (`getStatus`) + `updateResolution` to backfill nutrition on
  pick — the food-catalog hit carries no nutrition in the search result.
- **New endpoints:** food `GET /v1/foods/search/live` (user-agnostic, M2M), `POST /v1/foods/admit-by-key`;
  recipe `POST /v1/ingredients/by-key` (+ the Stage-2 blended `/search`). The live-search endpoint is **not**
  owner-scoped (F-#4).
- **New importer:** food-service bulk-seed task (Foundation + SR Legacy) — own bulk parser + find-or-create.
- **Unchanged / preserved:** fdcId boundary (FR-IDN-2), the golden-record merge, the existing by-name async path
  (kept as a fallback), recipe→food **M2M** auth, the 1,000/hr key cap (now _split into lanes_, not raised).
- **Client/UI:** a blended-result shape (discriminated: `local` | `catalog` | `usda-admitted` | `usda-token`),
  a live-search hook (heavier debounce + on-demand), the sectioned/badged picker, the by-key admit mutation.

## 4. Rate/quota strategy (the crux, restated)

USDA rate-limits by **IP** (our food-service egress), not by user — so quota protection is entirely **aggregate**
and user-agnostic (F-#4). The levers, in order of impact:

1. **Seed** removes most demand from the live path entirely — at ingest AND at refresh (seeded foods excluded
   from live change-refresh, F-C2).
2. **Result cache** (24h) collapses repeated long-tail queries to **one call per query per day across ALL users**.
3. **Interactive sub-budget** (a reserved lane in the aggregate limiter) guarantees user search and the worker
   can't starve each other; the two lanes sum to the one key cap. This is the aggregate quota lever — it needs
   no user identity.
4. **Graceful degradation:** at cap/429, local always works; the USDA section shows an inline retry state.
5. **Escape valve:** USDA grants higher limits on request for OSS/research — a lever if the tail is bigger than
   expected. (Also: Open Food Facts as an unlimited branded/barcode supplement — future.)
6. **Per-owner fairness (NOT a quota mechanism, optional, deferred):** since quota is aggregate/IP, a per-owner
   limit only prevents one user hogging _our own_ interactive lane — a fairness concern, not quota. If wanted it
   lives at **recipe-service** (verified `@OwnerId()`, M2M unchanged). **Deferred pending measurement** — the
   on-demand trigger + cache + aggregate cap already bound the abuse surface; add it only if a single user is
   shown to meaningfully starve the lane.

## 5. Risks & mitigations

| Risk                                                                                                 | Mitigation                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Seed floods live change-refresh against the 1,000/hr window (F-C2)**                               | **Stage-1 hard requirement:** mark seeded foods `bulk`-origin + skip them in `listResolvedBackingItems`; re-freshen from the next bulk download (SR Legacy never changes upstream anyway) |
| Bulk-seed ETL complexity / nutrient mapping (F-W2)                                                   | Foundation+SR Legacy only (~8k, small); **own bulk parser** (bulk CSV ≠ API shape) + explicit find-or-create on the crosswalk; nutrient dictionary auto-resolves                          |
| Two-catalog dedup (recipe `ingredients` vs food `food`)                                              | Dedup on `food_id`; section by provenance; long-term one-catalog is a separate refactor (flagged)                                                                                         |
| **Stage 2 adds a per-keystroke food-service dependency (F2)** — typeahead no longer "entirely local" | Short timeout + **fall back to recipe-local DAL results** if food-service slow/down; local section always renders                                                                         |
| **Stage 2 pick backfill (F1)** — food search carries no nutrition                                    | Create row RESOLVED **then** one immediate `getStatus`+`updateResolution` backfill; never ship NULL-calorie rows                                                                          |
| Interactive lane starves worker (or vice-versa)                                                      | Two-lane split summing ≤ key cap (a schema+limiter migration, F-W1); worker tolerates pause; monitor both lanes                                                                           |
| USDA search junk / bad ranking (Branded spam, "almonds"→"almond milk")                               | Live search is the _tail_, explicitly triggered + badged; prefer Foundation/SR/Survey `dataType` filters; whole-food core is seeded + locally ranked                                      |
| One user hogging the interactive lane                                                                | **Fairness, not quota** — aggregate cap + cache + on-demand trigger already bound it; optional per-owner limit at recipe-service, deferred (§4)                                           |
| By-key admit latency (10s USDA timeout, F-info)                                                      | Fast-poll via the existing status mechanism (median sub-second, ≤10s tail); deterministic single-survivor merge; not promised-instant                                                     |
| fdcId leakage                                                                                        | Opaque token (reuse `jose` codec); bulk crosswalk stays inside food-service                                                                                                               |
| Scope creep — building Stage 3 before proving Stages 1–2 suffice                                     | **Instrument local hit-rate after 1–2; gate 3 on the measured tail**                                                                                                                      |

## 6. Alternatives considered (and why not)

- **Live USDA on every debounced keystroke (blend live).** Rejected: exhausts the shared per-IP 1,000/hr in
  minutes; adds USDA latency to every search; the UX research + rate facts both kill it.
- **Skip seeding; live-search only.** Rejected: makes the fragile live path carry all load; worse coverage,
  worse quota risk, worse latency for the common case.
- **Persist every search hit (warm the catalog on view).** Rejected: quota-expensive and pollutes the catalog
  with junk Branded hits; cache-aside persists **on pick** only.
- **Swap USDA for a paid provider (Nutritionix/Edamam) as primary.** Rejected now: cost, and USDA whole-food
  quality is excellent for the core; keep paid providers as a future branded/barcode supplement.
- **One unified catalog (collapse recipe `ingredients` into food `food`).** Deferred: cleaner long-term but a
  large refactor orthogonal to this feature; the blend + `food_id` dedup is the pragmatic path.

## 7. Open decisions for the owner

1. **Stage-gate:** ship **Stage 1+2, measure local hit-rate, then decide on Stage 3** (recommended) — or commit
   to all three up front?
2. **Seed breadth:** Foundation + SR Legacy only (recommended), or also FNDDS/Survey? (Branded stays on-demand
   either way.)
3. **Interactive-vs-worker lane split** of the 1,000/hr (e.g. 300/700), user-search as the priority reserve
   (recommended)? (Note: this is a schema+limiter migration, F-W1 — only needed for Stage 3.)
4. **Auto-trigger USDA on thin local results, or explicit-tap only?** (Recommended: both — auto at <3 + a
   pinned affordance.)
5. **Branded strategy** long-term: on-demand USDA Branded, or add Open Food Facts / a paid provider for
   barcode/branded coverage? (Out of scope now; flag the seam.)

**Resolved this session:** recipe→food stays **M2M** (not user-token passthrough); the live-search endpoint is
**user-agnostic** (quota is aggregate/IP); per-owner throttle is **fairness, deferred** to recipe-service.

## 8. Rollout & measurement

- Ship Stage 1 (seed) behind an importer + verify catalog coverage; Stage 2 (blend) behind a flag; instrument
  **% of ingredient searches served fully locally** and **the residual (would-hit-USDA) rate**. Only build
  Stage 3 if the residual justifies it, sized to the measured tail. Each stage carries the full test matrix
  (unit + integration for the services; k6 for any new food-service route; component + Playwright/Maestro for
  the picker) per the repo testing policy.

---

## Sources

- Internal: `food-service/src/sources/usda/usda.adapter.ts`, `sources/RollingWindowLimiter.ts`,
  `foods/foods.service.ts`, `foods/dao/foodSources.dao.ts`, `merge/*`, `worker/foodConsumer.service.ts`;
  `recipe-service/src/ingredients/*`; `features/recipes/src/hooks/{useIngredientResolver,ingredientResolver.model}.*`.
- USDA FoodData Central API Guide (1,000 req/hr per IP) — fdc.nal.usda.gov/api-guide; FDC bulk downloads —
  fdc.nal.usda.gov/download-datasets.html.
- Cronometer data sources / "Small is Better"; MyFitnessPal food-DB blog + duplicate-entry community threads;
  Samsung Food/Whisk "Food Genome"; Nutritionix (MIT NLP thesis ranking weakness); Open Food Facts API (ODbL);
  Edamam / FatSecret / Spoonacular editions.
- W3C WAI-ARIA APG Combobox; NN/g Site Search Suggestions; Baymard mobile autocomplete; Algolia
  debouncing-sources / autocomplete sections; GitHub scoped code search; MS Learn Power Query fuzzy merge;
  Azure cache-aside pattern.
