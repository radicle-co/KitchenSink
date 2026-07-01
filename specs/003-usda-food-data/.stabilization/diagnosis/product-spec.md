# Diagnosis — product-spec cluster (feature 003 source-agnostic food data)

**Cluster**: product-spec
**Docs read**: `product-spec/product-spec.md`, `product-spec/user-journey.md`, `product-spec/metrics.md`,
`product-spec/README.md`, `product-spec/wireframes/{README,food-search,food-detail,ingredient-picker,
candidate-resolution,nutrition-panel,food-substitution}.md`, `review.md`.
**Cross-checked against**: `.stabilization/inputs/staff-review.md`, `.stabilization/inputs/autoresolutions.md`,
`spec.md`, `plan.md`, `v-model/*` (event-name, FR/SC ids, lifecycle).

**Scope note**: STABILIZE-AND-COMPLETE only. Every finding below maps to a canonical autoresolution
default (D-\*) unless flagged "needs decision". The product-spec cluster was already largely re-baselined
to the source-agnostic model (Rev 2, 2026-06-22); the residuals below are the half-applied or
not-yet-applied edges.

Overall: the _bodies_ of the wireframes, the journeys, and most of `product-spec.md`/`metrics.md` are
already source-agnostic and clean. The defects cluster in (a) one stale event name, (b) the SC-005
throughput KPI, (c) a systematic user-story-id form/parenting drift, (d) a wrong FR id reused across
the wireframes, (e) two not-yet-updated "resolved/deferred" statements, and (f) a stale `review.md`
revalidation log.

---

## 1. Contradictions

### C1 — Disambiguation story has THREE different IDs, and product-spec mis-parents it

- **Where**: `product-spec/product-spec.md:163` (`US-005a`); `product-spec/metrics.md:64,141` (`US-002a`);
  `product-spec/user-journey.md:72` (`US-2a`), `:194` (`US-002a`); all wireframes (`US-2a`, e.g.
  `wireframes/candidate-resolution.md:5`). `spec.md` canonically uses **`US-2a`** (`spec.md:126,130,233,249,471`,
  incl. "User Story 2a").
- **Problem**: The candidate-disambiguation story is referred to as `US-005a` (product-spec), `US-002a`
  (metrics + user-journey), and `US-2a` (wireframes + spec). Worse, `product-spec.md` numbers it **`US-005a`**,
  listing it as story #6 right after US-005 (the queue/recovery story) — semantically mis-parenting it under
  the demand-queue story when it is logically a sub-story of **add-by-name (US-2/US-002)**, which is how
  spec/metrics/user-journey treat it (`US-2a`/`US-002a`). One story, three ids, wrong parent in the PRD.
- **Resolution**: autoresolutions "Quality bar" — _"Every … id traces end-to-end … Consistent terminology +
  the canonical names."_ Harmonize to **one** id (spec.md canonical = `US-2a`; if the cluster keeps
  zero-padded form, use `US-002a`) and re-parent it under add-by-name, not US-005. _needs decision_ only on
  the exact surface form (short `US-2a` vs padded `US-002a`); the mis-parenting itself must be fixed.

### C2 — SC-005 throughput KPI contradicts the USDA budget

- **Where**: `product-spec/metrics.md:101` (`MET-US004-02` — "Effective fan-out/merge throughput **>= 5,000
  foods/hour** … (SC-005)") and Summary Coverage `metrics.md:143` (US-004 → SC-005). Mirrors `spec.md:491`
  SC-005.
- **Problem**: Exactly the staff-review `[C] SC-002 vs SC-005` defect. A ≥5,000 foods/hr resolution target is
  impossible under the per-source budget (USDA 1,000 req/hr; ~1 non-batchable name-search call per NEW food →
  ~500–900/hr real ceiling). The product-spec.md "Success Metrics" section (`:222–231`) was already cleaned
  (it carries no 5,000/hr line), so `metrics.md` is the lone offender in this cluster.
- **Resolution**: **D-SC005** — restate the metric to separate **read/serve throughput** (local golden-record
  reads, no source call → keep a high target) from **first-time resolution rate of NEW foods** (USDA-budget-bound,
  ~500–900/hr). Drop the ">=5,000 foods/hr" framing; keep the SC-002 budget metric (`MET-US003-01`) as-is.

### C3 — `review.md` records a fixed-staleness refresh default that contradicts change-driven refresh

- **Where**: `review.md:94` (Q-006 decision: _"Defaults: weekly bulk sync, 3-day `fetched_at` staleness
  threshold"_) vs `product-spec/product-spec.md:253` (Q-006 RESOLVED: _"Refresh is change-driven, not
  age-driven (this supersedes the old fixed-staleness model)…"_) and `user-journey.md:151–154`.
- **Problem**: The canonical model is change-driven (re-fetch + hash/`item_version`); `review.md`'s recorded
  Q-006 default still asserts the superseded age-driven "weekly bulk sync / 3-day staleness" design. A reader
  of the revalidation log gets the wrong refresh model.
- **Resolution**: **D-REFRESH** (change detection = re-fetch + hash compare, idle-drain background work).
  Because `review.md` is a historical log, preferred fix is a **Revision 3 (stabilization)** entry that
  supersedes the Rev-1 Q-006 line (or annotate it "superseded by Rev 2 re-baseline"), not silent rewriting of
  history.

### C4 — Notification `messageType` keyword drift (`food.resolution.completed` vs `food.backfill.completed`)

- **Where**: `product-spec/product-spec.md:240` (`food.resolution.completed`) vs `review.md:89`
  (`food.backfill.completed`).
- **Problem**: The same in-app notification keyword is spelled two ways across the cluster. (Separate from the
  EventBridge event name in C5.)
- **Resolution**: Quality-bar consistency. Pick one keyword and use it in both docs. The notification
  `messageType` taxonomy is owned by the future notification feature (Q-001), so this is _needs decision_ on
  the exact string — but the two must agree. Recommend `food.resolution.completed` (matches the
  PENDING→RESOLVED lifecycle vocabulary the re-baseline standardized on; "backfill" is older framing).

### C5 — Wireframes assert `FR-018 = candidate set`, but `FR-018` is the rate limiter (see also §4 N2)

- Cross-listed here because it is an internal contradiction of fact, not just a stale label. Full detail in §4.

### C6 (low) — FAILED tombstone TTL over-applied

- **Where**: `product-spec/product-spec.md:160` — _"tombstones become eligible for re-attempt after a 30-day
  TTL"_ (applied to FAILED tombstones) vs `user-journey.md:176` + `wireframes/food-detail.md:50` /
  `ingredient-picker.md:28` (FAILED = "[Retry] later" / "re-fetchable", **no** 30-day gate) and
  `spec.md` FR-025 (30-day TTL is the **NOT_FOUND** tombstone).
- **Problem**: `product-spec.md:160` blankets _all_ tombstones with the 30-day TTL; the canonical lifecycle is
  FAILED→PENDING retry (re-fetchable, bounded backoff) and NOT_FOUND→PENDING only **after** the 30-day TTL.
- **Resolution**: **D-LIFECYCLE** (legal transition set: `FAILED→PENDING` retry; `NOT_FOUND→PENDING after
TTL`). Scope the 30-day TTL to NOT_FOUND in `product-spec.md:160`.

---

## 2. Gaps / missing requirements

### G1 — UNRESOLVED-TTL still marked "deferred to planning"

- **Where**: `product-spec/product-spec.md:262` — _"`UNRESOLVED` TTL / expiry … is deferred to planning."_
- **Problem**: Staff-review lists UNRESOLVED-TTL as an open decision; it is now resolved. The PRD still says
  "deferred", so the doc lags the canonical decision.
- **Resolution**: **D-UNRESOLVED-TTL** — an `UNRESOLVED` food is kept until a human picks; its candidate set
  expires after **30 days**, and re-fan-out occurs on the next request (mirrors the NOT_FOUND 30-day TTL).
  Replace the "deferred" note with this rule.

### G2 — Auto-RESOLVE boundary stated only qualitatively, but the ≥90% metric depends on it

- **Where**: `product-spec/product-spec.md:261` ("A confident single cross-source merge auto-resolves…") and
  the dependent KPIs `product-spec.md:224` / `metrics.md:72` (`MET-US002a-01`, ≥90% resolved without manual
  pick) / `metrics.md:73` (`MET-US002a-02`, UNRESOLVED ≤10%).
- **Problem**: "confident single merge" is not a testable boundary; the ≥90% accuracy and ≤10% UNRESOLVED
  targets are unmeasurable without the concrete rule.
- **Resolution**: **D-AUTORESOLVE** — auto-RESOLVE when **exactly one** candidate survives normalized-name
  exact match (after dedup); **>1 → UNRESOLVED**; **0 → NOT_FOUND** (bias toward UNRESOLVED over a wrong
  auto-pick; human is final arbiter). State this concretely under "Design questions the re-baselined spec
  resolved" and as the basis for the accuracy KPIs.

### G3 — Fairness described per-`sub` only; multi-requester demotion + flood-shedding missing

- **Where**: `product-spec/product-spec.md:139` (US-0) and `:160` (US-005) — fairness = _"a `sub` with >50
  pending items is ranked to the back / re-promoted below 50"_; `user-journey.md:142`; `metrics.md:32`
  (`MET-US0-03`).
- **Problem**: The PRD's demotion rule is keyed to a single `sub`. The canonical completion adds (a) the
  multi-requester rule — a food is demoted only when **all** its requesters exceed the threshold — and (b)
  flood-shedding: near the **global** ceiling, a flooding `sub`'s **NEW** enqueues are shed first (`503`) to
  preserve headroom. Neither is reflected.
- **Resolution**: **D-FAIRNESS** — complete (don't redesign) the demotion description: per-`sub` pending
  count; demote a food only when all its requesters exceed 50; shed a flooding `sub`'s NEW enqueues (`503`)
  near the global ceiling; no per-user quota, no `429` on reads/resolves. (Design detail primarily lives in
  plan/spec; the PRD/journey statements should at least not contradict it — add the multi-requester clause.)

### G4 — Food-substitution has no backing FR (known warning-tracked gap)

- **Where**: `product-spec/wireframes/food-substitution.md:5,46` ("no standalone substitution FR… tracked as
  a warning-level gap"); echoed in `review.md:146` Pending Reviewer Q3.
- **Problem**: A user-facing screen with no FR coverage.
- **Resolution**: _needs decision_ — no autoresolution default promotes a substitution FR, and the
  re-baseline explicitly keeps it warning-tracked. Leave as-is (documented), but surface in the "Open for
  user" list if the maintainer wants an explicit FR. No invented requirement.

### G5 (informational) — `food_candidates` persistence not surfaced in the PRD

- **Where**: candidate flow described in `product-spec.md:163–165`, `wireframes/candidate-resolution.md`,
  `user-journey.md:69,75`.
- **Problem/Resolution**: **D-CANDIDATES** adds the `food_candidates` table to plan §2 / ARCH-006 /
  module-design / spec FR-028 / tasks / traceability — **not** to the product-spec docs (a PRD names no
  tables). No product-spec change required _except_ the candidate-set expiry already captured in G1. Listed
  only so the reviewer can confirm the PRD's candidate language stays consistent with the new table at the
  other layers.

---

## 3. Naming drift

### N1 — Stale completion event name `FoodDataReceived` in the PRD

- **Where**: `product-spec/product-spec.md:242` — _"publish `FoodDataReceived` (food resolved) … to the
  notification service."_ (The entire spec/plan/v-model corpus also uses `FoodDataReceived`; this is the one
  occurrence in the product-spec cluster.)
- **Problem**: Naming drift — completion event must be the single canonical name everywhere.
- **Resolution**: **D-EVENT** — rename to **`FoodFetchCompleted`** (matches plan §4 + the CDK rule). Replace
  here; the same replacement is required across spec.md and the v-model in their own clusters.

### N2 — Wireframes reuse `FR-018` (the rate limiter) to mean "candidate set"

- **Where**: `wireframes/README.md:16` ("US-2a, FR-018"), `:44` ("**FR-018**: candidate set + candidate
  resolution (`/candidates`, `PATCH`-resolve)"); `wireframes/candidate-resolution.md:5` ("FR-018 (candidate
  set)").
- **Problem**: `FR-018` in `spec.md:365` is the **per-source rolling-window rate limiter + 30s `in_flight`
  lease reclaim** — nothing to do with candidates. The candidate-set / resolve FRs are **FR-RES-1/FR-RES-2/
  FR-RES-3** (`spec.md:343–345`), which `product-spec.md:165` and `metrics.md:68` already cite correctly.
  This is a broken cross-reference (wrong FR id), not a missing id.
- **Resolution**: Quality-bar correctness — re-point the wireframe FR refs from `FR-018` to
  `FR-RES-1/FR-RES-2/FR-RES-3` (and `FR-MRG-2/FR-MRG-3` for the merge step). No new id; pure correction.

### N3 — User-story id surface form is inconsistent across the cluster

- **Where**: wireframes + spec use short form (`US-2`, `US-7`, `US-2a`); `product-spec.md`, `metrics.md`,
  `user-journey.md` use zero-padded (`US-002`, `US-007`) — but `user-journey.md:72` slips into `US-2a` while
  `:194` uses `US-002a`.
- **Problem**: Mixed `US-N` / `US-00N` / `US-Na` forms; same as C1 at the formatting level.
- **Resolution**: Quality-bar consistency — pick one form cluster-wide (recommend aligning to spec.md's
  `US-2a`/`US-7` short form, or consistently zero-pad and keep `US-002a`). _needs decision_ on which form;
  must be applied uniformly. (The mis-parenting in C1 is the substantive part; this is the cosmetic part.)

---

## 4. Residual `fdcId` / cache-hit framing

### R1 — US-002 title still says "(cache miss / async resolution)"

- **Where**: `product-spec/product-spec.md:146` — _"**US-002 — Add food by name (cache miss / async
  resolution)**"_.
- **Problem**: Residual cache-miss framing on the story title; the body is already add-by-name.
- **Resolution**: **D-CLEANUP** — drop "cache miss"; e.g. "Add food by name (async resolution)".

### R2 — `review.md` carries Redis + cache-hit residuals in live/log sections

- **Where**: `review.md:100` ("US-005 rewritten … with **Redis sorted-set** … and in-app notification on
  **backfill** completion"); `review.md:148` (Pending Reviewer Q5: "Confirm realism of p95 fetch and
  **cache-hit** goals in `research/metrics-roi.md` and `product-spec/metrics.md`").
- **Problem**: Redis was removed (Postgres-as-queue is canonical; `product-spec.md:160` explicitly "no SQS,
  no Redis"). The Pending-Q5 "cache-hit goals" reference is a residual cache framing **and** dangling — the
  referenced `product-spec/metrics.md` no longer contains cache-hit goals.
- **Resolution**: **D-CLEANUP** — purge the Redis/cache-hit framing. For the historical Rev-1 entry, prefer a
  superseding Revision-3 note over rewriting; the live "Pending Reviewer Questions" section should be updated
  (drop/replace the cache-hit item).

### R3 (acceptable, note only) — changelog notes that _describe_ the removal

- **Where**: `metrics.md:10`, `user-journey.md:9`, `wireframes/README.md:5`, `wireframes/food-search.md:4`
  each say "the `fdcId` cache-hit/miss framing is removed/replaced".
- **Problem/Resolution**: These are re-baseline changelog notes documenting _that_ cache framing was removed;
  the in-body `no fdcId` statements (e.g. `product-spec.md:22`, `wireframes/*`) are the sanctioned
  adapter-boundary mentions allowed by **D-CLEANUP** (_"`fdcId` may appear ONLY as 'USDA's `external_key`,
  inside the adapter boundary'"_). **Acceptable as-is.** Optionally tighten the changelog notes once the
  re-baseline is fully stabilized, but no contradiction remains.

---

## 5. Quality / completeness problems

### Q1 — `review.md` revalidation log is stale and unapproved

- **Where**: `review.md:3,5,8` (Status "Pending initial human review"); `:110,136` ("⏳ Awaiting reviewer
  confirmation"); `:140–148` (live Pending Reviewer Questions); `:154` ("**NOT YET APPROVED**").
- **Problem**: The log predates the stabilization pass and still contains superseded Rev-1 decisions
  (C3, R2), an unresolved approval marker, and live reviewer questions whose premises changed.
- **Resolution**: **D-STATUS** (spirit — revalidation reflects the stabilized product-spec). Add a
  **Revision 3 — stabilization** entry that: supersedes the Q-006 fixed-staleness default (C3), the Redis /
  cache-hit residuals (R2), and records the canonical decisions (D-EVENT, D-SC005, D-AUTORESOLVE,
  D-UNRESOLVED-TTL, D-FAIRNESS) applied to the cluster. Leave Rev 0–2 as history.

### Q2 — Stale tool-version reference

- **Where**: `product-spec/README.md:12` — "Product Forge **v1.3.0**".
- **Problem**: Minor staleness/placeholder-grade inconsistency vs the v1.6.0 forge tooling now in use.
- **Resolution**: Low priority; update or drop the version pin during the doc pass. Not load-bearing.

### Q3 — `metrics.md` Summary Coverage anchor follows SC-005

- **Where**: `metrics.md:143` (US-004 → "SC-005"), tied to the C2 KPI.
- **Problem/Resolution**: After the **D-SC005** restatement, update the Summary Coverage SLO anchor for
  US-004 so it points at the corrected throughput framing rather than the impossible 5,000/hr SC-005.

---

## Cross-layer consistency confirmed (no action)

- **FR ids**: every FR referenced in the product-spec cluster (FR-001…FR-053, FR-ADP-2, FR-MRG-1/2/3,
  FR-RES-1/2/3) is defined in `spec.md`. No orphan FR ids.
- **SC ids**: all SC refs (SC-001/002/003/005/006/008/009/010/011/012/013) exist in `spec.md`. (SC-004 and
  SC-007 are simply not cited by this cluster — not an error; note SC-004 in `spec.md:490` still says "Cache
  hit rate", a residual owned by the spec cluster, not product-spec.)
- **API surface** (`product-spec.md:210–218`) matches the spec/journey endpoints; path param is the internal
  `id` throughout.
- **Demand model**: `product-spec.md:160` already encodes **D-DEMAND** (distinct-requester, `fetch_requesters`,
  PRIORITY_CAP=1, no raw `+1`) and the Postgres-as-queue / advisory-lock / rolling-window design — consistent
  with autoresolutions; no change needed there.
- **Auth**: `product-spec.md:114` cites `FoodAuthGuard` + plan §2A (both exist in `plan.md`); no forgeable
  `x-debug-sub` mention leaks into the PRD. Consistent with **D-AUTH**.
- **Lifecycle vocabulary** (`PENDING/UNRESOLVED/RESOLVED/NOT_FOUND/FAILED`) is uniform across the cluster.
