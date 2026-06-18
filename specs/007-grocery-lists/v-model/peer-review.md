# V-Model Peer Review: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Review Date**: 2026-05-09
**Reviewer**: AI Peer Review (speckit.v-model.peer-review)
**Artifacts Reviewed**:

- `specs/007-grocery-lists/v-model/requirements.md`
- `specs/007-grocery-lists/v-model/acceptance-plan.md`
- `specs/007-grocery-lists/v-model/unit-test.md`
- `specs/007-grocery-lists/v-model/trace.md`

**Review Standard**: ISO 29119 / V-Model bidirectional coverage; ISO 29119-4 white-box technique compliance

---

## Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 4     |
| WARNING  | 8     |
| PASSED   | 12    |

Overall artifact quality is **high**. The requirements are well-structured, the acceptance plan achieves full REQ coverage, and the unit test plan applies all five ISO 29119-4 techniques across 14 modules. The findings below are targeted gaps and inconsistencies rather than systemic deficiencies.

---

## CRITICAL Findings

---

### PRF-007-A1 — Verification method mismatch: REQ-006 and REQ-007 marked "Demonstration" but acceptance tests exist

**Artifact**: `requirements.md` + `acceptance-plan.md`
**Lens**: Internal Consistency / Standards Compliance

**Evidence**:

- `requirements.md` REQ-006: `Verification Method = Demonstration`
- `requirements.md` REQ-007: `Verification Method = Demonstration`
- `acceptance-plan.md` defines `AT-006-A` (two BDD scenarios) and `AT-007-A` (one BDD scenario) for these exact requirements
- `trace.md` Matrix A correctly lists `AT-006-A` and `AT-007-A` as the ATP-IDs for REQ-006 and REQ-007

**Problem**: The requirements table declares "Demonstration" as the verification method, implying no automated test is required. However, executable acceptance test cases exist for both requirements. This contradiction means the requirements artifact misrepresents the actual verification strategy, which could cause a downstream auditor to skip test execution for P2 online ordering flows.

**Required Action**: Change `Verification Method` for REQ-006 and REQ-007 in `requirements.md` from `Demonstration` to `Test`. Alternatively, if demonstration is intentional (manual walkthrough only), remove `AT-006-A` and `AT-007-A` from `acceptance-plan.md` and update `trace.md` Matrix A accordingly.

---

### PRF-007-A2 — UTS scenario count discrepancy between unit-test.md and trace.md

**Artifact**: `unit-test.md` + `trace.md`
**Lens**: Internal Consistency / Traceability Completeness

**Evidence**:

- `unit-test.md` Overview: "32 UTP cases, 73 UTS scenarios"
- `trace.md` Coverage Audit table: "32 UTP cases, **75** UTS scenarios"
- `trace.md` footnote: "minor variance from unit-test.md summary (73) reflects counting of UTS-014-A sub-scenarios"

**Problem**: The footnote acknowledges the discrepancy but does not resolve it. A 2-scenario variance without a definitive authoritative count creates ambiguity for coverage audits. If UTS-014-A sub-scenarios are legitimate test scenarios, they must be counted consistently in both documents. If they are sub-steps within a single scenario, they must not be counted as separate scenarios in either document.

**Required Action**: Decide the canonical count (73 or 75), update both documents to agree, and remove the hedging footnote. If UTS-014-A sub-scenarios are distinct executable scenarios, enumerate them explicitly in `unit-test.md` with individual UTS IDs.

---

### PRF-007-A3 — REQ-CN-003 has no unit test coverage and is marked "Inspection" with no inspection procedure defined

**Artifact**: `requirements.md` + `trace.md` + `unit-test.md`
**Lens**: Coverage Gaps / Standards Compliance

**Evidence**:

- `requirements.md` REQ-CN-003: "Grocery list generation MUST derive ingredient data exclusively from the meal plan, recipe entities; no manual ingredient entry is in scope." `Verification Method = Inspection`
- `trace.md` Matrix A: `REQ-CN-003` → `*(Inspection — no AT defined)*`
- `trace.md` Matrix D: No UTP entry for REQ-CN-003
- No inspection checklist, code review gate, or static analysis rule is defined anywhere in the artifact set

**Problem**: "Inspection" as a verification method is only valid when a concrete inspection procedure exists (e.g., a code review checklist item, a linting rule, a PR gate). Without a defined procedure, REQ-CN-003 has effectively zero verifiable coverage. This is a scope-boundary constraint — if violated, manual ingredient entry could silently enter the codebase.

**Required Action**: Either (a) add a concrete inspection checklist entry to `trace.md` Matrix A (e.g., "PR reviewer confirms no `POST /grocery-lists/items` endpoint accepts free-text ingredient body"), or (b) convert to a unit test that asserts the `generateList` service only accepts `mealPlanId` as input and rejects any direct ingredient payload.

---

### PRF-007-A4 — AT-011-A (10-minute end-to-end workflow) has no measurable pass/fail criterion

**Artifact**: `acceptance-plan.md`
**Lens**: Standards Compliance / Coverage Gaps

**Evidence**:

- `AT-011-A` / `ATS-011-A1`: "the entire workflow from list generation to order confirmation takes under 10 minutes"
- No definition of: what constitutes "start" (clock starts when?), what constitutes "confirmation" (API response? UI confirmation screen?), whether this is wall-clock time or user-active time, what the test environment baseline is, or how this is measured in CI

**Problem**: REQ-011 is a non-functional performance requirement. The acceptance scenario as written is not executable — it cannot produce a deterministic pass/fail result in an automated or even manual test without a defined measurement protocol. This makes REQ-011 unverifiable as specified.

**Required Action**: Add a measurement protocol to `ATS-011-A1`: define the start event (e.g., "user taps 'Generate Grocery List'"), the end event (e.g., "order confirmation screen renders"), the measurement tool (e.g., Playwright `performance.now()` or manual stopwatch), the environment (e.g., staging with seeded 7-day plan), and the sample size. Alternatively, decompose REQ-011 into sub-requirements with measurable SLAs (REQ-003 already covers the 5-second generation SLA; the remaining steps need similar treatment).

---

## WARNING Findings

---

### PRF-007-B1 — No negative acceptance test for REQ-CN-001 (unauthenticated access)

**Artifact**: `acceptance-plan.md` + `trace.md`
**Lens**: Missing Test Scenarios

**Evidence**:

- `trace.md` Matrix B: `AT-CN-001-A` → "Unauthenticated request to grocery list API → 401"
- `acceptance-plan.md`: `AT-CN-001-A` is listed in Matrix B of `trace.md` but **no corresponding test case appears in `acceptance-plan.md`**
- The acceptance plan covers `AT-NF-003-A`, `AT-NF-004-A`, `AT-CN-002-A` in its text, but `AT-CN-001-A` is absent from the document body

**Problem**: Matrix B references `AT-CN-001-A` as if it exists, but the acceptance plan document does not define it. This is a phantom reference — the traceability matrix claims coverage that the test plan does not provide.

**Required Action**: Add `AT-CN-001-A` to `acceptance-plan.md` with at least one BDD scenario: unauthenticated `GET /grocery-lists` returns HTTP 401 with no data leakage.

---

### PRF-007-B2 — REQ-003 performance test has no defined "maximum expected" recipe/ingredient count

**Artifact**: `acceptance-plan.md` + `requirements.md`
**Lens**: Coverage Gaps / Standards Compliance

**Evidence**:

- `ATS-003-A1`: "I have a 7-day meal plan with the **maximum expected number of recipes and ingredients**"
- `requirements.md`: No definition of maximum recipes per day, maximum ingredients per recipe, or total ingredient ceiling
- No assumption or constraint defines these bounds

**Problem**: "Maximum expected" is undefined. Without a concrete number (e.g., "3 recipes/day × 7 days = 21 recipes, 15 ingredients each = 315 ingredients"), the boundary value test cannot be reproduced consistently. Different testers will use different data sets, making the 5-second SLA unverifiable.

**Required Action**: Add a constraint or assumption to `requirements.md` defining the maximum meal plan scale (e.g., "max 3 recipes per day, max 20 unique ingredients per recipe"). Update `ATS-003-A1` to reference these concrete numbers.

---

### PRF-007-B3 — Unit test MOD-008 (OnlineOrderingController) has only 1 UTP case with 2 scenarios — insufficient branch coverage

**Artifact**: `unit-test.md`
**Lens**: Coverage Gaps / Standards Compliance

**Evidence**:

- `trace.md` Coverage Audit: `MOD-008 | OnlineOrderingController | 1 | 2 | Statement & Branch Coverage, Strict Isolation`
- `UTP-008-A` covers `handleSubmitOrder` with valid UUID and invalid UUID branches
- Missing branches: (a) user is not premium (SubscriptionGuard rejection path at controller level), (b) `listId` exists but belongs to a different user (ownership check), (c) service throws `ServiceUnavailableError` (outage path — REQ-010)

**Problem**: The controller is the entry point for the premium online ordering flow. With only 2 scenarios, the error propagation paths from the service layer (outage, ownership violation, subscription rejection) are not verified at the controller boundary. These are the highest-risk paths for REQ-010 and REQ-CN-001/CN-002.

**Required Action**: Add `UTP-008-B` covering service-thrown `ServiceUnavailableError` → controller returns HTTP 503. Add `UTP-008-C` covering `OwnershipError` → controller returns HTTP 403. Update `trace.md` Coverage Audit for MOD-008.

---

### PRF-007-B4 — No acceptance test for the "free-tier user attempts online ordering" path (REQ-CN-002)

**Artifact**: `acceptance-plan.md` + `trace.md`
**Lens**: Missing Test Scenarios

**Evidence**:

- `trace.md` Matrix B: `AT-CN-002-A` → "Free-tier user calling ordering API → 403"
- `acceptance-plan.md`: No `AT-CN-002-A` test case appears in the document body (same phantom reference issue as PRF-007-B1)
- REQ-CN-002 is a P2 business constraint with revenue implications

**Problem**: The subscription gate is a critical business rule. A free-tier user successfully submitting an order would be a billing defect. The acceptance plan must include a user-facing scenario (not just an API-level check) that verifies the premium gate is enforced end-to-end.

**Required Action**: Add `AT-CN-002-A` to `acceptance-plan.md` with two scenarios: (a) free-tier user taps "Order Online" → sees upgrade prompt, not an order form; (b) free-tier user calls the API directly → receives HTTP 403 with `premium_required` error code.

---

### PRF-007-B5 — REQ-IF-002, REQ-IF-003, REQ-IF-004 marked "Inspection" but no integration test plan exists for these critical data contracts

**Artifact**: `trace.md` + `requirements.md`
**Lens**: Coverage Gaps

**Evidence**:

- `trace.md` Matrix C lists integration tests as "needed" for: `GroceryListService → MealPlanAdapter`, `GroceryListService → RecipeAdapter`, `IngredientAggregator → UsdaAdapter`
- `trace.md` Matrix A: REQ-IF-002, REQ-IF-003, REQ-IF-004 → `*(Inspection — no AT defined)*`
- No integration test plan document exists in the artifact set

**Problem**: These three interface requirements represent the core data pipeline of the feature. If the MealPlan, Recipe, or USDA adapters return unexpected shapes, the entire grocery list generation silently fails or produces incorrect output. Marking them "Inspection" without a concrete integration test plan leaves the most critical cross-service contracts unverified.

**Required Action**: Create an integration test plan (or add an integration test section to `trace.md`) that defines at least contract tests for each adapter boundary. At minimum, add inspection checklist items specifying which TypeScript interface types must be validated against the upstream API schemas.

---

### PRF-007-B6 — IngredientAggregator (MOD-003) missing boundary test for single-ingredient deduplication (n=1)

**Artifact**: `unit-test.md`
**Lens**: Missing Test Scenarios

**Evidence**:

- `UTP-003-A` covers: empty list (0 items), two identical ingredients (n=2), three ingredients with one duplicate
- `UTP-003-B` covers: large list boundary (100 ingredients)
- Missing: single ingredient list (n=1) — the boundary between "no deduplication needed" and "deduplication logic engaged"

**Problem**: The n=1 case is a classic off-by-one boundary. If the deduplication loop has an off-by-one error (e.g., iterates from index 1 instead of 0), a single-ingredient list would return an empty result. This is not covered by any existing scenario.

**Required Action**: Add `UTS-003-A4` (or extend `UTP-003-B`): Arrange a list with exactly 1 ingredient. Assert the output contains exactly that ingredient with its original quantity unchanged and no deduplication side effects.

---

### PRF-007-B7 — Acceptance plan skips AT-004 through AT-008 ordering — AT-009-A appears before AT-004-A in document structure

**Artifact**: `acceptance-plan.md`
**Lens**: Standards Compliance / Internal Consistency

**Evidence**:

- Document structure after `AT-003-A` jumps directly to `AT-009-A` (line 105) before returning to `AT-004-A` (line 126)
- This breaks the sequential ID ordering within the "Grocery List Generation" tier
- `AT-009-A` (empty meal plan guidance) is logically part of the generation feature but is placed out of sequence

**Problem**: Out-of-order test case IDs within a tier make the document harder to audit and suggest `AT-009-A` was added after the initial draft without being repositioned. While not a functional defect, it violates the document's own ID schema convention and could cause confusion during review or when cross-referencing with `trace.md`.

**Required Action**: Move `AT-009-A` to appear after `AT-008-A` in the document, or add a note explaining the non-sequential placement. Ensure the tier grouping in the document matches the logical grouping in `trace.md` Matrix A.

---

### PRF-007-B8 — REQ-011 verification method is "Equivalence Partitioning" in trace.md but the scenario is a workflow timing test

**Artifact**: `trace.md` + `acceptance-plan.md`
**Lens**: Standards Compliance

**Evidence**:

- `trace.md` Matrix A: `REQ-011` → `Verification Method = Equivalence Partitioning`
- `ATS-011-A1` is a single end-to-end timing scenario with no equivalence classes defined
- Equivalence Partitioning requires identifying input partitions (valid/invalid classes); a timing measurement has no such partitions

**Problem**: The technique label is incorrect. A 10-minute end-to-end workflow test is a performance/usability test, not an equivalence partitioning test. Mislabeling the technique misrepresents the test design rationale and could cause a reviewer to expect multiple partition-based scenarios that do not exist.

**Required Action**: Change the verification method for REQ-011 in `trace.md` to `Performance Test` or `Usability Test`. Update `AT-011-A` technique label in `acceptance-plan.md` to match.

---

## PASSED Findings

---

### PRF-007-P1 — Requirements table is complete and well-formed

All 24 requirements (11 FR, 4 NF, 6 IF, 3 CN) include ID, description, priority, rationale with source reference, and verification method. MUST/SHOULD language is used consistently. No orphaned or duplicate IDs detected.

---

### PRF-007-P2 — All P1 functional requirements have executable acceptance tests

REQ-001 through REQ-005 (all P1 functional requirements) each have at least two BDD scenarios covering the happy path and at least one edge case. The Given/When/Then structure is consistently applied.

---

### PRF-007-P3 — All five ISO 29119-4 white-box techniques are applied

The unit test plan applies Statement & Branch Coverage, Boundary Value Analysis, Equivalence Partitioning, Strict Isolation, Error Guessing, and State Transition Testing across the 14 non-external modules. Each test case correctly identifies its technique and anchors it to a specific module design view.

---

### PRF-007-P4 — Dependency and Mock Registry tables are present for every UTP case

Every unit test case includes a Dependency & Mock Registry table identifying the dependency, its source (ARCH interface), the mock/stub strategy, and the rationale for isolation. This is exemplary practice for white-box unit test documentation.

---

### PRF-007-P5 — Optimistic locking is thoroughly tested (MOD-007)

`UTP-007-A` covers all three state transitions (NotFound, Success, VersionConflict) and `UTP-007-B` covers version counter boundary values (version=0, version=1). This is the correct approach for a concurrent-write safety mechanism.

---

### PRF-007-P6 — SubscriptionGuard fail-closed behavior is explicitly tested

`UTP-014-A` and `UTP-014-C` verify that adapter timeout and error both result in `ForbiddenException("premium_required")` rather than allowing access. The fail-closed pattern is correctly specified and tested.

---

### PRF-007-P7 — Hazard analysis (Matrix H) is comprehensive and well-linked

All 12 hazards (HAZ-001 through HAZ-012) include severity, linked REQ-IDs, mitigation strategy, and UTP/AT coverage references. Critical hazards (HAZ-001 IDOR, HAZ-003 credential exposure, HAZ-006 IDOR) are correctly linked to security-focused unit tests.

---

### PRF-007-P8 — Bidirectional traceability is complete across all five matrices

Matrices A through H cover forward (REQ→AT), backward (AT→REQ), integration (MOD boundary), implementation (MOD→UTP), and hazard traceability. No requirement is orphaned in any matrix direction.

---

### PRF-007-P9 — AuthMiddleware token extraction boundary is explicitly tested

`UTP-013-B` verifies the `authHeader.slice(7)` boundary — that exactly 7 characters ("Bearer ") are stripped and the remaining token is passed to the Clerk session-token verifier (ClerkAuthService.verifyToken, networkless). This is a precise boundary value test for a security-critical operation.

---

### PRF-007-P10 — Acceptance plan correctly scopes out infrastructure and schema concerns

The acceptance plan overview explicitly states that "internal component wiring, database schema correctness, and infrastructure provisioning" are out of scope, correctly delegating those concerns to system and unit tests. This prevents scope bleed between test levels.

---

### PRF-007-P11 — Unit normalization dependency is correctly modeled as an assumption

`requirements.md` Assumptions section correctly states that unit normalization (cups → ml) is handled by `003-usda-food-data` and is not re-specified here. This prevents duplicate requirements and correctly models the cross-feature dependency.

---

### PRF-007-P12 — StoreConfigRepository credential encryption is tested at the unit level

`UTP-012-A` verifies that `saveConfig` calls the KMS encryption adapter before persisting credentials, and that the raw credential value is never written to the database. This directly mitigates HAZ-003 at the unit test level.

---

## Action Items Summary

| Finding    | Severity | Artifact(s)                         | Action                                                                                             |
| ---------- | -------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| PRF-007-A1 | CRITICAL | requirements.md, acceptance-plan.md | Align verification method for REQ-006/REQ-007 (Demonstration vs Test)                              |
| PRF-007-A2 | CRITICAL | unit-test.md, trace.md              | Resolve UTS count discrepancy (73 vs 75); establish single authoritative count                     |
| PRF-007-A3 | CRITICAL | requirements.md, trace.md           | Define concrete inspection procedure for REQ-CN-003 or convert to unit test                        |
| PRF-007-A4 | CRITICAL | acceptance-plan.md                  | Add measurement protocol to ATS-011-A1 (start event, end event, tool, environment)                 |
| PRF-007-B1 | WARNING  | acceptance-plan.md                  | Add AT-CN-001-A body to acceptance plan (phantom reference in trace.md)                            |
| PRF-007-B2 | WARNING  | requirements.md, acceptance-plan.md | Define maximum meal plan scale; update ATS-003-A1 with concrete numbers                            |
| PRF-007-B3 | WARNING  | unit-test.md                        | Add UTP-008-B (ServiceUnavailableError) and UTP-008-C (OwnershipError) for MOD-008                 |
| PRF-007-B4 | WARNING  | acceptance-plan.md                  | Add AT-CN-002-A body to acceptance plan (phantom reference in trace.md)                            |
| PRF-007-B5 | WARNING  | trace.md                            | Define integration test plan or inspection checklist for REQ-IF-002/003/004                        |
| PRF-007-B6 | WARNING  | unit-test.md                        | Add UTS-003-A4: single-ingredient list boundary test for IngredientAggregator                      |
| PRF-007-B7 | WARNING  | acceptance-plan.md                  | Reorder AT-009-A to appear after AT-008-A within its tier                                          |
| PRF-007-B8 | WARNING  | trace.md, acceptance-plan.md        | Correct technique label for REQ-011/AT-011-A from "Equivalence Partitioning" to "Performance Test" |
