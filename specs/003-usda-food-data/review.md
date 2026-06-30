# Product Forge Revalidation Log: Feature 003

**Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Pending initial human review
**Mode**: Retroactive bootstrap
**Milestone**: `M1` Rivendell
**Public Launch**: Beta (end of `M4`)
**Launch Plan**: [`v1-launch-plan.md`](../v1-launch-plan.md)

---

## Purpose

This file records the iterative revalidation cycle for the Product Forge layer of feature 003. Each revision captures user feedback, the corrections applied, and an explicit approval marker.

This feature was **retroactively bootstrapped** — the SpecKit + V-Model artifacts already existed before Product Forge was layered on. Revalidation here therefore focuses on:

1. Whether the synthesized `research/` and `product-spec/` artifacts faithfully reflect the existing `spec.md`, `plan.md`, and `v-model/requirements.md`.
2. Whether the new artifacts surface any gaps, contradictions, or stale assumptions in the upstream artifacts.
3. Whether the Must Have / Should Have / Could Have decomposition in `product-spec/product-spec.md` matches true launch priorities for USDA integration.

---

## Revision Log

### Revision 0 — Initial Bootstrap (2026-05-09)

**Author**: Sisyphus (Product Forge bootstrap)
**Trigger**: User-requested retroactive bootstrap for feature 003.

**Artifacts produced**:

- [research/competitors.md](./research/competitors.md)
- [research/ux-patterns.md](./research/ux-patterns.md)
- [research/codebase-analysis.md](./research/codebase-analysis.md)
- [research/tech-stack.md](./research/tech-stack.md)
- [research/metrics-roi.md](./research/metrics-roi.md)
- [product-spec/product-spec.md](./product-spec/product-spec.md)
- [product-spec/user-journey.md](./product-spec/user-journey.md)
- [product-spec/wireframes/](./product-spec/wireframes/)
- [product-spec/metrics.md](./product-spec/metrics.md)

**Synthesis sources**:

| Bootstrapped File    | Primary Source(s)                                 |
| -------------------- | ------------------------------------------------- |
| competitors.md       | `research.md` (RQ-1, RQ-3)                        |
| ux-patterns.md       | `research.md` (RQ-8), `spec.md` user stories      |
| codebase-analysis.md | `plan.md`, root `package.json`, `AGENTS.md`       |
| tech-stack.md        | `plan.md`, `research.md`, `spec.md` FR-001..035   |
| metrics-roi.md       | `spec.md` NFR-001..010, SC-001..009               |
| product-spec.md      | `spec.md` user stories + FR-001..035              |
| user-journey.md      | `spec.md` user stories P1/P2/P3                   |
| wireframes/          | `spec.md` FRs + clarifications                    |
| metrics.md           | `spec.md` success criteria + FR-traceable stories |

**Known constraints during synthesis**:

- No new requirements were invented.
- Domain asks for ingredient matching + unit conversion UX; where no direct FR exists, it is marked as warning/non-blocking gap in `verify-report.md`.
- Existing `spec.md`, `plan.md`, `tasks.md`, and `v-model/*` were not modified.

**User feedback**: Superseded by Revision 1.

**Corrections applied**: See Revision 1.

**Approval status**: Superseded.

---

### Revision 1 — Open-question resolution pass (2026-05-10)

**Author**: Sisyphus
**Trigger**: User review of `product-spec/product-spec.md` open questions Q-001..Q-008.

**User feedback (verbatim)**:

- "first, there should be no code whatsoever, so it makes sense that none of the folders exist."
- "What I said about the data-\* packages holds and we shouldn't have a recipe-core package."
- "Rather than prescribing, we should be a bit more generic instead… The actual decision of what patterns and architectural best practices to use and what to name them should be decided at implementation."
- "For q-005, yes."
- "For q-008, sounds good"

**Decisions recorded**:

| ID    | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-001 | Notification delivery owned by a new dedicated notification-service feature. Producers publish messages with recipient descriptor (single/group/global) + `messageType` keyword. Clients receive messages whose recipient matches; exact delivery mechanism (WebSocket push, webhook callback, client-pull retrieval, or hybrid) deferred to implementation. Client dispatches on `messageType`. Launch transport scope: in-app only. 003 publishes `food.backfill.completed` and fetch-failure events; does not own transport/templates/preferences. |
| Q-002 | PostgreSQL FTS for launch; search must sit behind a pluggable interface so the engine can be swapped later. Concrete abstraction shape decided at implementation.                                                                                                                                                                                                                                                                                                                                                                                     |
| Q-003 | No `recipe-core` package. Food/ingredient types stay local to feature 003's data layer. Cross-feature sharing, package boundaries, and naming deferred to implementation; spec stays generic.                                                                                                                                                                                                                                                                                                                                                         |
| Q-004 | USDA attribution shown in the ingredient detail view. Footer/settings/API `source` field out of scope for launch unless compliance review flags it.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Q-005 | Normalization is a first-class concern of the search/resolution layer and must be compatible with the pluggable backend from Q-002 (rules/synonyms above the engine boundary). Specific pipeline decided at implementation.                                                                                                                                                                                                                                                                                                                           |
| Q-006 | Cadence and staleness thresholds are configurable. Defaults: weekly bulk sync, 3-day `fetched_at` staleness threshold. Per-dataset overrides and breaking-change invalidation handled at implementation.                                                                                                                                                                                                                                                                                                                                              |
| Q-007 | Use a badge on each search result to distinguish branded vs generic (and surface data-type provenance). Sort order and ranking weights deferred to implementation.                                                                                                                                                                                                                                                                                                                                                                                    |
| Q-008 | Backfill prioritization is demand-weighted: duplicate / repeated requests for a pending food increase its effective priority. Static high/normal flags removed. Exact weighting and time-decay decided at implementation.                                                                                                                                                                                                                                                                                                                             |

**Corrections applied**:

- `product-spec/product-spec.md` US-005 rewritten as **"Demand-weighted backfill priority and DLQ recovery"** with Redis sorted-set / duplicate-request-driven prioritization and in-app notification on backfill completion.
- `product-spec/product-spec.md` Open Questions section: Q-001..Q-008 all marked ✅ RESOLVED with the decisions above.

**Still open**: None within feature 003. A new notification-service feature must be specced separately (see Follow-ups).

**Follow-ups (outside feature 003)**:

- Spec a new feature for the notification service (pub/sub with WebSocket + webhook delivery, recipient descriptors, `messageType` dispatch). Launch scope: in-app only. Defer preferences/templates/email/push.
- Update `specs/cross-feature-consistency-report.md` §5.3 to point to the new notification feature once specced.

**Approval status**: ⏳ Awaiting reviewer confirmation of Revision 1.

---

### Revision 2 — Source-agnostic re-baseline (2026-06-22)

**Author**: Product Forge revalidation (`/speckit-product-forge-revalidate`)
**Trigger**: The 003 design was re-baselined to a **source-agnostic** model (brainstorm 2026-06-21 + `/ce-doc-review` walk-through); `spec.md`, `plan.md`, `tasks.md`, and all 12 v-model artifacts were regenerated. Revalidation found the `product-spec/` PRD still described the **old USDA-coupled / `fdcId` / cache-hit** design (drift). User chose **Revise — re-baseline the PRD**.

**Changes applied:**

| File                                                          | Change Type      | Description                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product-spec/product-spec.md`                                | Modify (rewrite) | Vision/principles/epics/stories/API/metrics → source-agnostic; US-001 cache-hit → read-by-`id`; US-002 → add-by-name; **added US-005a** candidate disambiguation + resolve; US-005 demand-weighting preserved (re-keyed to food `id`); API surface + metrics reframed |
| `product-spec/user-journey.md`                                | Modify (rewrite) | Journeys → add-by-name → PENDING → fan-out/merge → UNRESOLVED→candidate-pick→RESOLVED; per-source budget; change-driven refresh                                                                                                                                       |
| `product-spec/metrics.md`                                     | Modify (rewrite) | Cache-hit-rate/p99-by-`fdcId` KPIs → resolution accuracy, add-by-name→RESOLVED time, per-source budget adherence, golden-record completeness/provenance                                                                                                               |
| `product-spec/wireframes/*`                                   | Modify           | food-search/ingredient-picker/food-detail/nutrition-panel/food-substitution reframed to golden-record + lifecycle + per-field provenance                                                                                                                              |
| `product-spec/wireframes/candidate-resolution.md`             | **Add**          | NEW screen: the UNRESOLVED candidate-pick / resolve flow                                                                                                                                                                                                              |
| `product-spec/wireframes/README.md`, `product-spec/README.md` | Modify           | Index + FR-range + screen list updated; titles → "Source-Agnostic Food Data Integration"                                                                                                                                                                              |

**Decisions recorded:** `fdcId`/USDA confined to the adapter boundary everywhere; the candidate-resolution screen models single-select with a "none match" escape (multi-candidate merge flagged for UX review); new-KPI numeric thresholds (UNRESOLVED ≤10%, NOT_FOUND ≤5%) are reasonable defaults derived from SC-008, not separately pinned.

**Open questions:** Q-007 (branded/generic disambiguation) folded into the candidate-resolution flow; the spec-resolved design Qs (auto-RESOLVE rule, UNRESOLVED 30-day TTL) noted as resolved in the re-baselined spec/plan.

**Preserved verbatim-in-intent:** US-0 auth (FR-035..053); US-005 distinct-requester demand + fairness-by-demotion + Postgres-queue; the persona set; the out-of-scope items.

**Approval status**: ⏳ Awaiting reviewer confirmation of Revision 2.

---

### Revision 3 — Doc stabilization reconciliation (2026-06-28)

**Author**: Doc-stabilization reconciler (context-docs group)
**Trigger**: STABILIZE-AND-COMPLETE pass over the design docs driven by [`decision-register.md`](./decision-register.md) and [`.stabilization/inputs/autoresolutions.md`](./.stabilization/inputs/autoresolutions.md). This revision records the canonical `D-*` decisions as applied to the `research/` and report artifacts and **supersedes** the stale defaults still carried in Revisions 0–2 (left intact above as history). No redesign — `plan.md §2` (+ `food_candidates`) remains the canonical data model.

**Supersessions (replace the noted Rev 0–2 defaults):**

| Superseded item                                                        | Where it came from            | Stabilized decision                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed-cadence refresh (weekly bulk sync, 3-day `fetched_at` staleness) | Rev 1, Q-006                  | **D-REFRESH** — change detection = re-fetch + hash compare (`item_version`); refresh runs as a low-priority **Fargate scheduled task** (idle-drain, yields to live demand); cadence is **budget-bounded, not a fixed promise**; refresh never overwrites a user's manual pick. There is no `stale` status. |
| Redis sorted-set / `ZINCRBY` demand weighting + "DLQ recovery"         | Rev 1 (US-005 rewrite), Rev 2 | **D-DEMAND** — demand is **distinct-requester** in Postgres: upsert `(food_id, sub)` into `fetch_requesters`, set `fetch_queue.request_count` to the capped distinct-`sub` count (`PRIORITY_CAP=1`), never raw `+1`. Terminal failures are **tombstone rows** (no DLQ, no Redis sorted set).               |
| `messageType: food.backfill.completed`                                 | Rev 1, Q-001                  | **D-CLEANUP / glossary** — notification keyword is **`food.resolution.completed`**.                                                                                                                                                                                                                        |
| Cache-hit / cache-hit-rate framing on demand/read paths                | Rev 0–2 residuals             | **D-CLEANUP** — local store is the source of record, not a USDA cache: use "local-store read (RESOLVED)" / "local-store serve rate" / "add-by-name miss". Cache vocabulary is reserved for the deferred Redis variant (ARCH-007).                                                                          |
| `fdcId` as a schema/DTO/API/DAO key                                    | Rev 0–2 residuals             | **D-CLEANUP** — internal ULID `id` is identity; the source-native id is `external_key` and `fdcId` appears **only** inside the USDA adapter boundary.                                                                                                                                                      |
| Disambiguation story id `US-005a`                                      | Rev 2                         | **Glossary** — canonical id is **`US-2a`**, re-parented under add-by-name (**US-2**); user-story ids use short form cluster-wide.                                                                                                                                                                          |
| Flat "≥5,000 foods/hour" resolution metric                             | Rev 0 metrics                 | **D-SC005** — SC-005 is **read/serve throughput** (local reads, no source call, high target); new **SC-014** is the **first-time NEW-food resolution rate** (~500–900/hr, bounded by the source budget).                                                                                                   |

**Other `D-*` decisions applied to the context docs:**

- **D-EVENT** — completion event is **`FoodFetchCompleted`** / `publishFoodFetchCompleted` everywhere (matches plan §4 + the deployed CDK rule); `FoodDataReceived`/`FoodDataEvent` purged.
- **D-CANDIDATES** — `food_candidates` table added to the canonical model (**13 tables** total); backs `UNRESOLVED` / US-2a.
- **D-AUTORESOLVE** — after dedup, exactly 1 normalized-name survivor → `RESOLVED`; >1 → `UNRESOLVED` (persist set); 0 → `NOT_FOUND`. No nutrient-tolerance knob.
- **D-UNRESOLVED-TTL** — an `UNRESOLVED` food is kept until a human picks; its candidate set expires after **30 days** and the next request re-fans-out (mirrors the NOT_FOUND 30-day TTL).
- **D-FAIRNESS** — drain-time demotion (a food is demoted only when **all** its requesters exceed the 50-pending threshold) + near-ceiling flood-shed (`503`, never `429`); no per-user quota; `user_fetch_quota`/`global_fetch_quota` removed.
- **D-LEASE** — `leased_at` lease column + reaper (reclaim `in_flight` older than 30s); single-drainer advisory lock (FR-022) makes the limiter check-and-record serial.
- **D-LIFECYCLE** — explicit legal transition set; `PATCH`-resolve is UNRESOLVED-only, idempotent, candidate-in-set validated; `createByName` reactivates a terminal-state row instead of `23505`.
- **D-PROVENANCE-FK** — `UNIQUE(food_id, id)` on `food_sources` + composite `(food_id, source_id)` FKs (`ON DELETE NO ACTION`) on provenance tables.
- **D-AUTH** — the auth slice is **preserved and reaffirmed**: `FoodAuthGuard` (networkless Clerk verify, fail-closed, scopes from `public_metadata`); the forgeable `x-debug-sub` path is removed.
- **D-STATUS** — `.forge-status.yml` `implement` → `not-started` (design baseline only; no implementation this phase); revalidation reflects the stabilized product-spec.

**Open question (still open):** the **food-substitution FR** (Pending Q3 below) is the single Open-for-user item — no autoresolution default promotes a first-class substitution FR, so it remains **warning-tracked** (no FR invented) pending a maintainer scope call (decision-register §6).

**Approval status**: ✅ APPROVED 2026-06-29 (see Approval Marker below).

---

## Pending Reviewer Questions

When the user reviews, please confirm or correct the following inferred decisions:

1. **MoSCoW decomposition**: Should P3 items (WebSocket notifications, advanced observability surfaces) remain Could Have for launch?
2. **Food disambiguation depth**: Is the current disambiguation UX (brand vs generic + data-type badges) sufficient for initial release?
3. **Ingredient matching / substitution** (the single Open-for-user item, decision-register §6): the `food-substitution` wireframe has no backing FR. The stabilization default leaves it **warning-tracked** (no FR invented). Confirm whether substitution should enter v1 scope as a first-class FR family (e.g. `FR-SUB-*`) or remain a tracked gap.
4. **Unit conversion UX**: Cross-unit conversion is represented as a panel-level affordance; confirm whether this should remain informational or become a hard functional requirement.
5. **Metrics targets**: Confirm realism of the p95 PENDING→RESOLVED target and the split throughput metrics — read/serve throughput (SC-005) vs first-time NEW-food resolution rate ~500–900/hr (SC-014) — in `research/metrics-roi.md` and `product-spec/metrics.md`.

---

## ✅ APPROVED — 2026-06-29

> APPROVED by Brandon (maintainer) on 2026-06-29.
> Revision: 3 (stabilized source-agnostic design baseline)

**Approved after 3 revisions** (Rev 1 open-question resolution, Rev 2 source-agnostic re-baseline, Rev 3 doc-stabilization reconciliation). Approval followed a stabilization pass + two adversarial multi-agent review loops; the design baseline is implementation-ready (GO).

**Final document inventory:**

| Document                     | Lines | Last Modified |
| ---------------------------- | ----- | ------------- |
| product-spec/product-spec.md | 262   | 2026-06-28    |
| product-spec/user-journey.md | 203   | 2026-06-28    |
| product-spec/metrics.md      | 151   | 2026-06-28    |
| product-spec/README.md       | 67    | 2026-06-28    |
| product-spec/wireframes/ (6) | —     | 2026-06-28    |

**Pending Reviewer Questions — resolution (by approval):**

| #   | Question                      | Resolution                                                                                                                                     |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P3 items remain Could-Have?   | ✅ Confirmed — WebSocket notifications + advanced observability stay Could-Have for v1.                                                        |
| 2   | Disambiguation UX sufficient? | ✅ Confirmed — brand/generic + provenance badges sufficient for initial release.                                                               |
| 3   | Substitution FR?              | ⏸ Deferred — `food-substitution` stays **warning-tracked, no FR invented** (maintainer scope call; decision-register §6). Revisit post-launch. |
| 4   | Unit-conversion UX?           | ✅ Confirmed — remains informational (panel-level affordance), not a hard FR for v1.                                                           |
| 5   | Metrics targets realistic?    | ✅ Confirmed — split SC-005 (read/serve) vs SC-014 (~500–900/hr NEW-food resolution) and the p95 targets accepted.                             |

§4A consistency check: PASS — all product-spec/README cross-links resolve, all 6 wireframes present, every Must-Have user story (US-0/1/2/2a/3/4/5) maps to ≥1 journey, and the determinism lens found Must-Have acceptance criteria carry concrete thresholds (status codes, 50-pending/90%-900 fairness, queue-depth 500/2000/10000, p95 latencies, the 1-survivor auto-RESOLVE rule). The lone soft spot (food-substitution lacking an FR) is the tracked Q3 deferral above.

**Status: LOCKED — Ready for SpecKit Bridge (Phase 4)**
