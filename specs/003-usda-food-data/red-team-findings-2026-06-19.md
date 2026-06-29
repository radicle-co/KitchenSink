# Red Team Findings — 003-usda-food-data

> **⚠️ SUPERSEDED IN PART (doc-stabilization 2026-06-28).** This is a historical point-in-time
> record. Two themes are superseded by the stabilized design (see `decision-register.md`):
>
> 1. **Fairness (F-001/F-011/F-012 — per-user quota / `429`)** is superseded by **D-FAIRNESS**:
>    queue **demotion** + near-ceiling `503` shedding of a flooding `sub`'s new enqueues, with a
>    per-`sub` pending counter — **no per-user quota and no `429`**.
> 2. **Identity (`fdcId` / `fdc_id` framing)** is superseded by the internal ULID **`id`**; a source's
>    native key survives only as `food_sources.external_key` inside the adapter boundary.
>    All other findings remain valid as recorded. Read with the decision register as the source of truth.

|                        |                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Session ID**         | `RT-003-usda-food-data-2026-06-19`                                                                               |
| **Target**             | `specs/003-usda-food-data/spec.md` (Clerk auth protection: US-0, FR-035–FR-042, SC-010/011, AuthenticatedCaller) |
| **Date**               | 2026-06-19                                                                                                       |
| **Matched triggers**   | `multi_party`, `contracts`                                                                                       |
| **Lenses**             | Trust-Boundary Adversary, API Contract Adversary, Availability / Denial-of-Wallet Adversary                      |
| **Selection method**   | auto (3 matched, ≤5)                                                                                             |
| **Supporting context** | plan.md, v-model/architecture-design.md, v-model/hazard-analysis.md                                              |
| **Mode**               | bootstrap (no `## Red Team Trigger Criteria` in constitution)                                                    |

## 1. Session Summary

US-0's framing — "auth prevents denial-of-wallet" — is **necessary but not sufficient**, and that gap is the spine of this session. All three lenses independently converged on two structural holes:

1. **Authentication ≠ rate limiting.** The spec adds Clerk auth but **no per-user quota**. A single authenticated account can drain the shared 1,000 req/hr USDA budget and starve all other users (F-001 + F-011 + F-012). US-0 closes the _anonymous_ flood it names, not the _insider_ flood.
2. **Only the synchronous HTTP edge is authenticated.** The async/internal surfaces — SQS/Postgres consumer, EventBridge producers, stale-refresh cron, WebSocket push, and **service-to-service calls from downstream consumers** — sit outside the authenticated boundary, and the auth design is **absent from the architecture/plan artifacts** an implementer follows (F-002 + F-005 + F-006 + F-013). This confirms sync-verify DRIFT-101 adversarially.

These must be resolved in `spec.md` before the auth slice is re-planned.

## 2. Findings

| ID    | Lens             | Severity     | Location                                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Suggested resolution                                                                                                                                                                                                            |
| ----- | ---------------- | ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-001 | Denial-of-Wallet | **CRITICAL** | US-0, FR-035–042, FR-014–022, SC-002                  | Auth proves _a_ valid user, but adds **zero per-user rate limit/quota**. Every cache-miss lookup enqueues a fetch against a _global_ 1,000-token/hr bucket. One authenticated account scripting arbitrary `fdcId`s drains the whole budget and starves everyone — insider denial-of-wallet, the exact threat US-0 claims to close.                                                                                                                      | Add a per-`sub` enqueue/fetch quota enforced _after_ auth and _before_ `INSERT INTO fetch_queue`; specify limit, `429` response, and a test that one user can't consume >X% of the global budget.                               |
| F-002 | Trust-Boundary   | **CRITICAL** | architecture-design.md ARCH-001–011, plan.md §3/§5    | The authoritative architecture/plan artifacts contain **no authenticator** — none of the 11 ARCH modules is an authorizer; the data-flow shows `Client → API Gateway → FoodApiController` with no token check. Auth lives only in spec prose, unmapped to any module, so an implementer following the design ships an unauthenticated service that still "traces."                                                                                      | Add an explicit `ClerkAuthorizer` ARCH module fronting ARCH-001 and the WS `$connect`; update process/data-flow views; add traceability rows binding FR-035–042 to it.                                                          |
| F-006 | API Contract     | **CRITICAL** | FR-035, FR-036, A-009, Dependencies (001/006/007/009) | The contract assumes a **Clerk user session token** on every call, but downstream consumers are **backend services**, and server-initiated paths (recipe import FR-012, stale-refresh FR-032) have no user token. No machine-to-machine credential is defined, and FR-036/FR-042 forbid a Clerk secret key / non-Clerk authorizer — so a backend caller literally cannot authenticate and gets `401`, breaking async backfill + downstream integration. | Define service-to-service auth (M2M token in `azp` allowlist, or internal service principal); specify which calls are user-token vs service-token; reconcile with FR-036/FR-042.                                                |
| F-011 | Denial-of-Wallet | **CRITICAL** | FR-015, US-5, FR-014                                  | The demand-weighted queue drains `ORDER BY request_count DESC`, and `request_count` increments on every authenticated request with **no cap and no per-`sub` dedup**. An attacker repeatedly requesting chosen `fdcId`s pins them to the front of the queue forever, starving genuine single-request items — the viral-demand mechanism is a trivially gameable priority-inversion lever.                                                               | Count demand by _distinct authenticated `sub`_ (per-`fdcId` requester set), cap the priority contribution, and/or add aging so no single ID monopolizes drain order.                                                            |
| F-012 | Trust-Boundary   | **CRITICAL** | FR-041, US-0 AS-8, ARCH-009                           | The WS notification ownership guarantee is **unimplementable as written**: FR-041/AS-8 require pushes go "only to the `sub` that requested the food," but dedup (FR-013/014) means the `fetch_queue` row and `FoodDataReceived` event carry only `fdcId` — no requester `sub`. The notifier must either broadcast (leaks that _someone_ requested a food; lets any client subscribe to arbitrary `fdcId` signals) or drop the guarantee.                | Persist a requester→`fdcId` subscription set (authenticated `sub` recorded at request/`$connect`); resolve recipients from it; FR stating completion events MUST NOT broadcast to non-requesting connections.                   |
| F-003 | Trust-Boundary   | HIGH         | FR-040, A-011, US-0 AS-7                              | Fail-closed is asserted for inline verification but unproven for the API Gateway authorizer: (1) authorizer **result caching** keyed on a client-controlled value can replay a 200 policy after token expiry; (2) `$context.authorizer` is only trustworthy if the authorizer actually ran — Gateway can be misconfigured to skip it on `OPTIONS`/`$default`/unattached routes. Spec mandates neither TTL=0 nor full route+method coverage.             | FR requiring authorizer cache TTL=0 (or cache key from verified token only) and "every route AND method incl. `$connect`/`$default` MUST have the authorizer attached; deny is 401/403, never a default-open Gateway response." |
| F-004 | Trust-Boundary   | HIGH         | FR-035, FR-039, plan §3 batch                         | Gates read identity but leaves the highest-cost write surface under-specified: `POST /v1/foods/batch` enqueues up to 20 fetches/call with no per-user limit. FR-039 only says admin endpoints "if exposed" need scope — never names the stale-refresh (FR-032) or manual re-fetch triggers, and "`public_metadata` scopes" is a client-influenceable field unless pinned to a server-set signed claim.                                                  | Per-`sub` enqueue quota on write/batch endpoints; FR enumerating every privileged trigger + the exact signed claim (not arbitrary `public_metadata`) that gates them.                                                           |
| F-007 | API Contract     | HIGH         | FR-002/003/005/006 vs FR-035                          | FR-035 inserts a `401` gate ahead of existing endpoints, but FR-002/003/005/006 and their acceptance scenarios were **not updated** and still document unconditional responses. The `401` vs `400` (FR-006) vs `404`/`202` **ordering is undefined** — a consumer can't tell what a malformed `fdcId` with a bad token returns. Internal contradiction + undocumented contract change.                                                                  | State that auth (`401`) precedes input validation (`400`) and business logic; add a normative status-precedence ordering (`401`→`400`→`404`/`202`/`200`) referenced by FR-002/003/005/006.                                      |
| F-008 | API Contract     | HIGH         | FR-041, US-9 AS-1/3, Edge Cases                       | The WS auth contract is underspecified: FR-041 says authenticate "at `$connect`" but never defines **how the token is presented** (browsers can't set `Authorization` on WS), **mid-connection expiry** (the `exp` passes during a long-lived connection), or the **reconnect/re-auth** flow after the 10-min idle close. `$connect` rejection status is ambiguous (US-0 says 401/403; API Gateway WS returns 403).                                     | Specify token-presentation mechanism, mid-connection expiry behavior (close vs revalidate), reconnect/re-auth flow, and pin a single `$connect` rejection status.                                                               |
| F-009 | API Contract     | HIGH         | A-010, FR-035, plan §3                                | Adding `401` to every `/v1/` endpoint is a **breaking change to existing consumers under the same `/v1/` prefix**; A-010's "breaking change" definition is route-shape-only and doesn't cover auth-semantic changes, so it passes the versioning gate while breaking clients. Also plan §3 documents `/v1/foods/batch`, `/nutrients`, `/autocomplete` that **no FR mentions** — auth status formally undefined.                                         | Broaden A-010 to include response-contract/auth-semantic changes (or gate auth behind a coordinated cutover); reconcile FR-035's endpoint list with the full plan endpoint set.                                                 |
| F-013 | Denial-of-Wallet | HIGH         | FR-012/023, US-4, plan §3 batch, FR-032               | Batch is an amplification multiplier with no edge bound: FR-023 caps the _USDA_ call at 20 IDs/token, but nothing limits how many `fdcId`s a client submits to `/v1/foods/batch` or a recipe import. Thousands of distinct IDs in one request → unbounded `fetch_queue` rows + N/20 token-consuming calls.                                                                                                                                              | Hard max batch size at the API edge (e.g. ≤100 IDs, `400` over limit), counted against the per-user quota; test that oversized batches never enqueue.                                                                           |
| F-014 | Denial-of-Wallet | HIGH         | FR-016/018, plan §4–6, Edge Cases                     | Failure bounds are per-row, not global: under a USDA outage every cache miss still enqueues while rows cycle with backoff — new enqueues are unbounded. "Queue depth > 10,000 → SNS alert" is an alert, not backpressure. No max `fetch_queue` depth, no _enforced_ circuit breaker shedding enqueue load → outage → unbounded DB growth + thundering recovery burst.                                                                                   | Define a max queue depth / per-user enqueue ceiling that fail-closes new enqueues with `503` when exceeded or the USDA circuit is open; make the circuit breaker an enforced FR, not a plan footnote.                           |
| F-005 | Trust-Boundary   | MEDIUM       | FR-032, plan §5 (bulk-sync, indexer), EventBridge     | Async producers are trust-boundary holes: the stale-refresh cron, bulk-sync Lambda, and search-indexer write to the queue / drive USDA, but only the HTTP edge is authenticated. Nothing constrains who may emit `IngestionScheduled`/`FoodRequested` to EventBridge or insert into `fetch_queue` — a compromised peer service or over-broad IAM role injects fetch work bypassing the edge.                                                            | FR requiring least-privilege IAM on the bus/queue (only named producer roles publish fetch events) + consumer validates event provenance, so US-0's "no unauthenticated path drives USDA" covers async producers.               |
| F-010 | API Contract     | MEDIUM       | FR-039, A-011, AuthenticatedCaller                    | Authenticated-but-unauthorized (valid token, missing scope) failure is never specified — `403` is implied but undocumented, absent from US-0's test matrix (only `401` cases) and SC-010.                                                                                                                                                                                                                                                               | Add a `403 Forbidden` contract for insufficient-scope on operational/admin endpoints; include it in US-0 acceptance scenarios and SC-010.                                                                                       |
| F-015 | Denial-of-Wallet | MEDIUM       | SC-011 vs FR-036/040, plan §5                         | SC-011 budgets ≤10ms p95 verification but specifies no behavior under load: signature checks are CPU-bound with no stated concurrency cap or auth-failure rate limit. A flood of well-formed-but-invalid tokens (each forcing a full crypto verify before the fail-closed `401`) saturates authorizer CPU, blows the 10ms p95, and degrades SC-009 availability — a DoS that never touches the USDA budget.                                             | Specify an auth-layer concurrency/throttle limit + per-source `401`-rate cap (load-shed); load-test SC-011 under an invalid-token flood, not just the happy path.                                                               |

## 3. Resolutions Log

Resolution category for all 15: **spec-fix** (landed in `spec.md`, the canonical living spec under Product Forge — this repo has no separate graduated docs tree). Applied 2026-06-19; pending re-plan to propagate into plan/tasks/v-model.

- **F-001** — spec-fix — **FR-043** (per-`sub` enqueue quota + `429`; ≤20% global-budget share) + **SC-012**.
- **F-002** — spec-fix — **FR-053** (auth as a named architecture component fronting all entry points, with traceability rows).
- **F-003** — spec-fix — **FR-050** (authorizer cache TTL=0 / token-keyed; every route+method incl. `$connect`/`$default`; deny never default-open).
- **F-004** — spec-fix — **FR-043** (per-user quota on write/batch) + **FR-047/FR-039** (privileged triggers + signed-claim gating) + **FR-051** (`403`).
- **F-005** — spec-fix — **FR-048** (least-privilege IAM on async producers; consumer validates event provenance).
- **F-006** — spec-fix — **FR-047** + **A-012** (Clerk M2M token for service-to-service; endpoints classified user/service).
- **F-007** — spec-fix — **FR-051** (normative `401`→`403`→`400`→`404`/`202`/`200` precedence; governs FR-002/003/005/006).
- **F-008** — spec-fix — **FR-049** (WS token presentation, mid-connection expiry, reconnect, pinned `403`).
- **F-009** — spec-fix — **A-010** (breaking-change broadened to response-contract/auth-semantic; endpoint list reconciled).
- **F-010** — spec-fix — **FR-051** + **US-0 AS-10** (`403` for authenticated-but-insufficient-scope).
- **F-011** — spec-fix — **FR-044** (demand counted by distinct `sub`, capped, aged).
- **F-012** — spec-fix — **FR-041** (requester `sub`→`fdcId` subscription set; no broadcast).
- **F-013** — spec-fix — **FR-045** (hard max batch size; `400` over limit; counts to quota).
- **F-014** — spec-fix — **FR-046** (enforced max queue depth + circuit breaker → `503`; jittered recovery).
- **F-015** — spec-fix — **FR-052** + **SC-011** (auth-layer concurrency/`401`-rate cap; SC-011 load-tested under invalid-token flood).

## 5. Session Metadata

```yaml
session_id: RT-003-usda-food-data-2026-06-19
target: specs/003-usda-food-data/spec.md
date: 2026-06-19
matched_triggers: [multi_party, contracts]
lenses: [Trust-Boundary Adversary, API Contract Adversary, Availability / Denial-of-Wallet Adversary]
selection_method: auto
findings:
    total: 15
    by_severity: { CRITICAL: 5, HIGH: 7, MEDIUM: 3 }
    by_lens: { trust-boundary: 5, api-contract: 5, denial-of-wallet: 5 }
lens_failures: []
dropped_for_bound: 0
unresolved: 0
resolution_summary: { spec-fix: 15, new-OQ: 0, accepted-risk: 0, out-of-scope: 0 }
resolution_note: 'All 15 landed as new/revised requirements in spec.md (FR-041 revised; FR-043–FR-053 added; US-0 AS-9..12; SC-011 revised + SC-012; A-010 revised + A-012). Pending re-plan to propagate into plan/tasks/v-model.'
cross_lens_convergence:
    - 'no per-user quota / insider denial-of-wallet (F-001, F-011, F-004)'
    - 'only synchronous HTTP edge authenticated; async + M2M surfaces open (F-002, F-005, F-006, F-012)'
notes: >
    Confirms sync-verify DRIFT-101 adversarially: auth is absent from the
    architecture/plan artifacts and the requirements have material gaps.
    Findings should harden spec.md before the auth slice is re-planned.
```
