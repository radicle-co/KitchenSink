# Peer Review — architecture-design

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-19
**Artifact**: architecture-design.md (12 architecture modules) — auth slice (ARCH-012 FoodAuthGuard) and the HTTP read entry point (ARCH-001 FoodApiController)
**Standard**: IEEE 42010 / Kruchten 4+1
**Scope**: ARCH-001 + ARCH-012 — 4+1 view coverage (Logical / Process / Physical / Development / Scenarios), upward traceability to SYS-001 / SYS-013, interface-definition completeness, and consistency of the deployment model with `../plan.md` §2A and within the document itself.

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 1     |
| Observation        | 1     |
| **Total Findings** | **2** |

Overall assessment: **PASS**. The prior Major is **RESOLVED**: the Scenarios "+1" view now carries two concrete, load-bearing auth scenarios (lines 372–428) rather than a single boilerplate paragraph. **Scenario A** (authenticated user, cache miss → verify → quota gate → enqueue) and **Scenario B** (unauthenticated request → `401` before any work) each traverse all four other views in a per-view table (Logical / Process / Development / Physical) and include a mermaid sequence diagram, exercising ARCH-012's accept and fail-closed branches, the `401`/`403`/`429`/`503` outcomes, status precedence, the M2M/session token path, and the shared-`ClerkAuthService` build boundary — tracing to SYS-013 / FR-053 / FR-035/FR-039/FR-043/FR-046. The criterion "populated across the 4+1 views" is now met for ARCH-012. The prior Critical deployment contradiction and the two prior Physical/Development Majors remain resolved and were not regressed. One residual Minor (Interaction 0 call-direction) and one Observation (CROSS-CUTTING tag) remain — neither blocks the gate.

## Findings

---

### PRF-ARCH-001 — Scenarios "+1" view auth coverage

**Severity**: Observation (Resolved — prior Major: Scenarios view was boilerplate)
**Defect type**: Completeness / 4+1 Scenarios coverage
**Location**: architecture-design.md Scenarios — Architecture Validation (lines 372–428)

**Description**: **RESOLVED.** The "+1" view now validates ARCH-012 with concrete walkthroughs. Two scenarios are added, each with a four-row view table and a mermaid sequence:

- **Scenario A** — valid session token, cache miss: Interaction 0 (Auth Edge) passes, the per-`sub` quota check runs after auth and before the EventBridge publish, status precedence `401 → 403 → 400 → 404/202/200` holds, and the request reaches `202 Accepted`. The Logical row threads ARCH-012 → ARCH-001 → ARCH-007 → ARCH-006 → ARCH-002 → ARCH-003; Development names the shared `@kitchensink/*` `ClerkAuthService` reuse; Physical lands it on ALB → ECS/Fargate (networkless, no Lambda authorizer).
- **Scenario B** — missing/malformed/expired/wrong-`azp` token: ARCH-012 fails closed to `401`, no other module is reached, no quota check, no enqueue, no USDA consumption (validates US-0). Physical notes the in-process reject and the deferred WebSocket `$connect` pinned `403` equivalent.

The closing note ties both to FR-053 and the `401`/`403`/`429`/`503` outcomes of FR-035/FR-039/FR-043/FR-046. The prior boilerplate paragraph (line 370) remains as a lead-in but is now explicitly superseded by the two load-bearing scenarios, so the criterion is met for ARCH-012.

Minor structural note (not a defect): Scenario A diagrams the happy `429`/`403`/`503` branches in prose/table but its mermaid shows only the admitted path; a third scenario (or an alt-branch in Scenario A's diagram) exercising the `403` scope denial and the `429`/`503` admission gate end-to-end would fully complete the FR-039/FR-043–FR-046 walkthrough. Optional — the per-view tables already assert these outcomes.

---

### PRF-ARCH-002 — Interaction 0 sequence misattributes the post-auth quota/backpressure gate to FoodAuthGuard after the handler returns

**Severity**: Minor
**Defect type**: Process-view precision
**Location**: architecture-design.md Process View Interaction 0 (lines 57–68) and Scenario A diagram (line 399)

**Description**: In the success branch the Process View still shows the handler (ARCH-001) calling back into FoodAuthGuard for the quota/backpressure check after control already passed to it — Scenario A's diagram likewise shows `A->>AG: pre-enqueue quota/fairness check (per-sub)` (line 399) followed by `AG-->>A: within budget (admit)`. This implies ARCH-001 invokes ARCH-012 after `next()`, which muddles the admission-control ordering ("after authentication and before `INSERT INTO fetch_queue`," plan §2A.4). The ARCH-012 interface table correctly lists `enforceQuota`/`checkBackpressure` as ARCH-012 operations (lines 260–261), so the diagram and the interface table describe the call direction slightly differently. (Unchanged from prior review — not in the remediation scope; the new Scenario A inherits the same call-direction depiction.)

**Recommendation**: Model it explicitly as ARCH-001 invoking ARCH-012's `enforceQuota`/`checkBackpressure` synchronously and short-circuiting on `429`/`503` (which the `A->>AG` arrow already implies), or redraw so the gate runs within the ARCH-012 admission path before ARCH-001 performs the enqueue — so the sequence matches the interface contract and the "before enqueue" ordering unambiguously.

---

### PRF-ARCH-003 — ARCH-012 is not tagged CROSS-CUTTING despite fronting every entry point

**Severity**: Observation
**Defect type**: Classification consistency
**Location**: architecture-design.md ARCH-012 Logical row (line 34); ID Schema CROSS-CUTTING convention (lines 16–17)

**Description**: ARCH-005, ARCH-009, ARCH-010, ARCH-011 carry the `[CROSS-CUTTING; …]` tag because they support multiple SYS components. ARCH-012 maps 1:1 to SYS-013, so the strict tagging rule (multiple SYS) does not apply, yet it is the most cross-cutting module in the system — it fronts every HTTP route and the WS `$connect` and reuses a shared cross-service package. The classification is defensible (dedicated parent SYS) but the asymmetry is worth a note so reviewers do not read the absent tag as "auth is not cross-cutting." (Unchanged from prior review.)

**Recommendation**: No change required. Optionally add a one-line rationale on ARCH-012 noting it is intentionally a first-class Component (1:1 with SYS-013 per FR-053) even though its concern is cross-cutting, to pre-empt the question.
