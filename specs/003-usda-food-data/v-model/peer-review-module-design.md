# Peer Review — module-design (auth slice)

**Reviewer**: Independent V-Model Peer Reviewer
**Date**: 2026-06-19
**Artifact**: module-design.md — auth slice: **MOD-012 (ClerkAuthMiddleware)**, **MOD-013 (QuotaAndFairness)**, and **MOD-014 (AsyncProducerAuthz)**, all three decomposing **ARCH-012 (FoodAuthGuard)**; plus the FR-049(b) WS expiry path now carried in **MOD-009 (WebSocketNotifier)**
**Standard**: IEEE 1016 (low-level / module design)
**Cross-checked against**: `../spec.md` FR-035–FR-053, SC-011/SC-012, A-010/A-011/A-012; `../plan.md` §2A; `architecture-design.md` ARCH-012; `unit-test.md` UTP-012; `integration-test.md` ITP-012

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 2     |
| Observation        | 2     |
| **Total Findings** | **4** |

Overall assessment: **PASS.** ARCH-012 now decomposes into three modules (MOD-012 verify/authz, MOD-013 quota/fairness, MOD-014 async-producer authz), each carrying all four mandatory IEEE 1016 views (Algorithmic/Logic, State Machine, Internal Data Structures, Error Handling) with explicit error/return tables; the algorithms are clean pseudocode and all three trace to ARCH-012 in the ARCH↔MOD matrix and the coverage summary (14 MODs total, 100% ARCH coverage).

**All three prior Majors are RESOLVED:**

- **PRF-MOD-002 (FR-052 / SC-011 auth-layer DoS) — RESOLVED.** MOD-012 §1 now models two bounded load-shed gates ahead of the CPU-bound verify: a process-local **verification-concurrency semaphore** (`VERIFY_CONCURRENCY_MAX`, sheds `503` when exhausted) and a **per-source rolling `401`-rate cap** (`SOURCE_401_RATE_MAX`/`SOURCE_401_WINDOW_S`, sheds `429`), with `sourceKey()` deriving source identity from the ALB-attested client IP (never a forgeable client header). The §3 data structures (`VerifySemaphore`, `Source401Counter`, `DosConfig`) and the §4 error table (429 over-cap, 503 saturated) back it, and a dedicated DoS note pins SC-011's ≤10ms p95 "under an invalid-token flood."
- **PRF-MOD-003 (FR-048 async-producer authorization) — RESOLVED.** A new **MOD-014 (AsyncProducerAuthz)** owns the async/internal-producer leg with all four views: a two-layer model (IAM least-privilege producer allowlist on `events:PutEvents`/`fetch_queue` INSERT, plus event-provenance validation that `requestedBy` is an authenticated `sub` or a named service principal — never empty/`'system'`), a state machine, internal data structures (`ProducerAllowlist`, `InvocationContext`, `EventProvenance`), an error table that fails closed on missing allowlist config, and a traceability row in the ARCH↔MOD matrix.
- **PRF-MOD-004 (FR-049(b) mid-connection WS token expiry) — RESOLVED.** The mid-connection-expiry path is modeled as a state machine in **MOD-009** (the WS connection-lifecycle owner): `enforceTokenExpiry` server-side-closes a connection whose captured `tokenExp ≤ now`, the `ConnectionRecord` carries `tokenExp`, and the state machine adds the `Connected/Notified → Disconnected : token exp passes mid-connection → server-side close (FR-049b)` transitions plus `re-auth required on reconnect (FR-049c)`. MOD-012 `authorizeConnect` captures `claims.exp` onto the connection context and explicitly cross-references MOD-009 as the owner. Placement differs from the prior review's literal "add it to MOD-012" action, but the requirement is now fully modeled with an owning module and a traceable transition — the IEEE 1016 obligation is met.

The symbol drift the prior PRF-MOD-008 flagged is now **one-sided**: MOD-012/MOD-013 commit to a single canonical shape (`req.user`, `tokenClass`, `use`/`requireScope`/`enforceQuota`/`admitEnqueue`), but `unit-test.md` was not reconciled to it (it still uses `req.caller`/`isService`/`middleware.verify`/`checkQuota`/`enqueueGate`). The design side is now internally consistent; the unresolved half is a test-artifact defect tracked in the companion `peer-review-unit-test.md` (PRF-UTP-006), so it is downgraded to an Observation here.

Residual findings are non-blocking consistency/under-specification items that do not affect the auth slice's correctness or fail-closed posture.

---

## Findings

---

### PRF-MOD-005 — `MAX_QUEUE_DEPTH` and the demand cap remain symbolic placeholders in MOD-013 (Minor)

**Defect type**: Under-specification
**Artifact**: `module-design.md` MOD-013 §1 (`MAX_QUEUE_DEPTH = M`), §3 `QuotaConfig` (`maxQueueDepth: number`)

**Evidence**:

- The PRF-MOD-001 remediation fixed `QUOTA_PER_HOUR = floor(GLOBAL_BUDGET_HOUR × GLOBAL_SHARE_CAP) = 200`, and `QuotaConfig` (§3) now carries concrete `quotaPerHour: 200, globalBudgetHour: 1000, globalShareCap: 0.20, priorityCap: 1`. Good.
- However MOD-013 §1 still declares `MAX_QUEUE_DEPTH = M` (symbolic) and `QuotaConfig` lists `maxQueueDepth: number` with no default. `requirements.md` REQ-040b fixes a concrete **10,000-entry** ceiling and `unit-test.md` UTS-012-H1/H2 hard-code `MAX_QUEUE_DEPTH = 1000` — neither matches the design (which commits to nothing) and the two consumers disagree with each other.
- The distinct-requester **demand cap** appears as `DEMAND_CAP = 50` only in `unit-test.md` UTS-012-G3; MOD-013 §1/§3 fixes only `priorityCap: 1` and never states a per-`fdcId` distinct-`sub` contribution ceiling.

**Impact**: An implementer cannot derive the queue ceiling or demand cap from the design alone, and the two test artifacts already diverge (`M` vs `1000` vs REQ-040b's `10,000`). Low risk to the auth invariants, but a traceable consistency gap.

**Required Action**: Fix a concrete default for `maxQueueDepth` in §1/§3 reconciled to REQ-040b (`10,000`, configurable), and add the distinct-`sub` demand cap (e.g. `demandCap`) to `QuotaConfig`, then point UTS-012-G3/UTS-012-H at the design's value rather than a test-local literal.

---

### PRF-MOD-006 — FR-044 anti-starvation aging is delegated to "the queue scorer" with no traceable owning MOD (Minor)

**Defect type**: Traceability gap
**Artifact**: `module-design.md` MOD-013 §1 (`recordDemand` — comment "aging applied by the queue scorer"); `../spec.md` FR-044

**Evidence**:

- FR-044 requires three behaviours: distinct-`sub` counting, capped contribution, **and** "queue ordering MUST apply aging so no `fdcId` can be pinned to the front indefinitely."
- MOD-013 models the first two (`fetch_requesters` upsert idempotency + `PRIORITY_CAP = 1`), but the aging clause is still offloaded inline to "the queue scorer" with no MOD/ARCH reference. No MOD in the document owns the queue scorer / aging function (MOD-003 SqsQueueRouter is infrastructure routing, not a demand scorer).
- This is the one sub-clause of the prior PRF-MOD-007 that the remediation did not pick up.

**Impact**: One-third of FR-044 (anti-starvation aging) has no owning module. Per FR-053's stated anti-pattern, an aging requirement with no module home risks being dropped during implementation.

**Required Action**: Point the aging behaviour at a concrete MOD/ARCH (e.g. model it as an explicit step in MOD-013's `recordDemand`/scorer, or reference the owning consumer/priority-queue module), so all three FR-044 clauses trace to a module.

---

### PRF-MOD-007 — MOD-013 internal-data-structure names commit to `req.user`/`tokenClass`, but the unit-test plan was not reconciled (Observation)

**Defect type**: Consistency (naming) — design side now canonical, test side stale
**Artifact**: `module-design.md` MOD-012 §1/§3 (`use`, `requireScope`, `req.user`, `tokenClass`, `enforceQuota`, `enforceBatchCap`, `recordDemand`, `admitEnqueue`); `unit-test.md` UTP-012 (`middleware.verify`, `authorizeScope`, `req.caller`, `isService`, `checkQuota`, `validateBatch`, `countDemand`, `enqueueGate`)

**Evidence**:

- MOD-012/MOD-013 now use one consistent symbol set internally (`req.user.{sub,azp,scopes,permissions,tokenClass}`; orchestrator `admitEnqueue`). The design is no longer self-inconsistent.
- The unit-test plan still references the old shape (`req.caller`/`isService`) and old function names (`middleware.verify`, `checkQuota`, `validateBatch`, `enqueueGate`), so the design↔test names no longer match 1:1. The newly added UTP-012-H's `enqueueGate` symbol does not exist in MOD-013 (the orchestrator is `admitEnqueue` + `checkBackpressure`).

**Impact**: Not a design defect — the module design is the authoritative low-level contract and is internally coherent. The unreconciled half lives in the test artifact and is the responsibility of the companion unit-test finding (PRF-UTP-006). Flagged here only so the design↔test traceability audit records the divergence.

**Required Action**: No change required in module-design. Reconcile `unit-test.md` UTP-012 to the canonical MOD-012/MOD-013 names (tracked in `peer-review-unit-test.md` PRF-UTP-006).

---

### PRF-MOD-008 — MOD-012 §1 `verifyToken` is invoked without an explicit `await`, leaving the async fail-closed boundary unpinned (Observation)

**Defect type**: Interface ambiguity / fail-closed correctness
**Artifact**: `module-design.md` MOD-012 §1 (`claims = verifyToken(...)` inside `TRY/CATCH`); `unit-test.md` UTP-012-A/B ("resolves"/"throws")

**Evidence**:

- MOD-012 §1 writes `claims = verifyToken(token, {...})` inside a synchronous `TRY/CATCH`/`FINALLY` (the FINALLY releasing the new `verifySemaphore`). `@clerk/backend` `verifyToken` returns a Promise.
- UTP-012-A/B/I/J mock registries describe `verifyToken` as "resolves"/"throws", consistent with an awaited async call.
- As written, an unawaited async call would not have its rejection caught by the synchronous `CATCH AnyVerificationError`, so the security-critical fail-closed `401` branch (FR-040) would not fire — and the `FINALLY` semaphore release would run before the verification settled, returning the concurrency slot early.

**Impact**: Minor as design intent (verification is clearly meant to be awaited and fail closed), but the async boundary is not pinned in the pseudocode, and the new semaphore-release-in-`FINALLY` makes the missing `await` materially relevant to both fail-closed behaviour and correct concurrency accounting.

**Required Action**: Make MOD-012 §1 `claims = AWAIT verifyToken(...)` inside an `async use(...)`, so the `CATCH` intercepts the rejected Promise (fail-closed `401`) and the `FINALLY` releases the semaphore only after verification settles.

---

_End of Peer Review — module-design (auth slice), 003-usda-food-data_
