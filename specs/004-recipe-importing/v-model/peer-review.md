# V-Model Peer Review: Recipe Importing (004)

**Feature Branch**: `004-recipe-importing`
**Review Date**: 2026-05-09
**Reviewer**: AI Peer Review (speckit.v-model.peer-review)
**Artifacts Reviewed**:

- `specs/004-recipe-importing/v-model/requirements.md`
- `specs/004-recipe-importing/v-model/acceptance-plan.md`
- `specs/004-recipe-importing/v-model/unit-test.md`
- `specs/004-recipe-importing/v-model/trace.md`

**Review Standard**: ISO 29119 / V-Model bidirectional traceability

---

## Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 4     |
| WARNING  | 9     |
| PASSED   | 12    |

**Overall Assessment**: The artifact set is well-structured and demonstrates strong coverage discipline. The requirements are clearly written with consistent RFC-2119 language, the acceptance plan maps cleanly to all 15 functional requirements, and the unit test plan covers all 18 modules with appropriate ISO 29119-4 technique labelling. Four critical gaps require resolution before the artifacts can be considered baseline-ready: a missing integration test plan document, an unverifiable REQ-015 with no test strategy, an unresolved legal dependency (REQ-CN-004) that blocks implementation of REQ-013, and a substantive-edit threshold that is undefined across all artifacts.

---

## CRITICAL Findings

---

### PRF-004-C1 — Integration Test Plan Document Is Absent

**Artifact**: `trace.md` (Matrix C), `unit-test.md`
**Severity**: CRITICAL
**Standard**: ISO 29119-4 §6.4 — Integration testing must be planned as a distinct test level with its own test cases.

**Evidence**: Matrix C in `trace.md` (lines 110–131) correctly identifies 13 integration points requiring dedicated integration tests (e.g., `ImportController → ImportOrchestrator`, `OcrPipelineService → AWS Textract`, `AuthMiddleware → ClerkAuthService (networkless verifyToken)`). Every row is marked `⬜` with the note "Integration test needed." However, no `integration-test.md` artifact exists in the v-model directory. The unit test plan explicitly states it does NOT test module boundaries.

**Impact**: All 13 integration boundaries are unplanned. Cross-module contracts — including the critical `ImportOrchestrator → PaywallBlocklistService` and `AuthMiddleware → ClerkAuthService` paths — have zero test coverage at the integration level. Defects at these seams will not be caught before system test.

**Resolution**: Create `specs/004-recipe-importing/v-model/integration-test.md` covering all 13 integration points in Matrix C. Each integration test case must specify: real vs. stubbed dependencies, environment requirements (DB, S3, Textract sandbox, Clerk test instance / `CLERK_JWT_KEY`), and pass/fail criteria.

---

### PRF-004-C2 — REQ-015 Has No Verification Strategy

**Artifact**: `requirements.md` (REQ-015), `trace.md` (Matrix A, line 50)
**Severity**: CRITICAL
**Standard**: ISO 29119 §5.2 — Every requirement must have a defined, executable verification method.

**Evidence**: REQ-015 ("Preserve imported recipe when source Instagram post is later deleted; update attribution note") is listed in Matrix A with `*(Analysis — no AT defined)*` and verification method `Analysis`. The requirements document lists its verification method as `Test` (requirements.md line ~47), creating a direct contradiction with the trace matrix. No acceptance test, unit test, or integration test covers this requirement.

**Impact**: REQ-015 is a P2 data-integrity requirement. Without a test, the behaviour of the system when an Instagram post is deleted is entirely unverified. The contradiction between `Test` (requirements.md) and `Analysis` (trace.md) also indicates the artifact set is internally inconsistent on this point.

**Resolution**:

1. Resolve the verification method contradiction — choose `Test` or `Analysis` and apply consistently in both documents.
2. If `Test`: add an acceptance test scenario (e.g., `AT-015-A`) that simulates post deletion and verifies the recipe record is preserved with an updated attribution note.
3. If `Analysis`: document the analysis rationale explicitly in requirements.md and trace.md (e.g., "verified by design review of persistence layer; recipe entity is not foreign-keyed to Instagram post ID").

---

### PRF-004-C3 — Substantive-Edit Threshold Is Undefined

**Artifact**: `requirements.md` (REQ-006, REQ-007), `acceptance-plan.md` (AT-006-B, AT-007-B), `unit-test.md` (UTP-011-B, UTP-012-A)
**Severity**: CRITICAL
**Standard**: IEEE 830 §3.6 — Requirements must be verifiable; a requirement is not verifiable if it contains undefined terms that affect pass/fail determination.

**Evidence**: REQ-006 and REQ-007 both gate the privacy change on a "substantive edit" by a premium user. The term "substantive edit" is used in:

- `requirements.md` REQ-006: "unless a premium user completes the cloned-recipe substantive-edit workflow"
- `acceptance-plan.md` AT-007-B pre-condition: "premium user has made a substantive edit to the clone"
- `unit-test.md` UTP-011-B: tests state transition `PUBLIC → PRIVATE` but the trigger condition is described only as "substantive edit flag set"

No artifact defines what constitutes a substantive edit (e.g., minimum character delta, field count, specific field types). The acceptance test AT-007-B cannot be executed without this definition, and UTP-011-B tests the flag transition but not the flag-setting logic.

**Impact**: QA engineers cannot determine pass/fail for AT-007-B. The `AttributionVisibilityService` (MOD-011) has no unit test for the substantive-edit detection logic itself — only for the downstream state transition. This is a testability gap that will surface as ambiguous test results.

**Resolution**:

1. Add a definition of "substantive edit" to `requirements.md` (e.g., as a constraint or assumption).
2. Add a unit test case to MOD-011 or a dedicated `SubstantiveEditDetector` module covering the detection logic (field-level thresholds, minimum change criteria).
3. Update AT-007-B pre-condition to reference the concrete definition.

---

### PRF-004-C4 — REQ-013 / REQ-CN-004 Legal Block Is Unresolved and Untestable

**Artifact**: `requirements.md` (REQ-013, REQ-CN-004), `acceptance-plan.md` (AT-013-A), `trace.md` (Matrix A, line 48)
**Severity**: CRITICAL
**Standard**: ISO 29119 §5.3 — Test items with unresolved external dependencies must be flagged as blocked; blocked items must not be included in a baseline test plan without a resolution path.

**Evidence**: REQ-CN-004 explicitly states: "The exact enforcement mechanism, detection strategy for manually entered paid-source recipes (REQ-013) MUST NOT be finalised without legal review." Despite this, AT-013-A in the acceptance plan defines a test scenario (`ATS-013-A1`) for REQ-013 with a pass criterion ("the system flags the recipe and applies appropriate visibility restrictions per platform policy"). The phrase "per platform policy" is circular — the policy is the unresolved item.

**Impact**: AT-013-A cannot be executed because the expected system behaviour is legally undefined. Including it in the acceptance plan as a peer test case (not a blocked item) creates false confidence in coverage. Any implementation of REQ-013 before legal review is a compliance risk.

**Resolution**:

1. Mark AT-013-A as `BLOCKED — pending legal review` in both `acceptance-plan.md` and `trace.md`.
2. Add a note to `requirements.md` REQ-013 cross-referencing REQ-CN-004 and the legal review dependency.
3. Create a tracking item (GitHub issue or ADR) for the legal review workstream so the block has a resolution path.

---

## WARNING Findings

---

### PRF-004-W1 — Typo: Double Comma in REQ-001 and REQ-004

**Artifact**: `requirements.md`
**Severity**: WARNING

**Evidence**: REQ-001 reads "title, ingredients, instructions,, photos" (double comma). REQ-004 reads "source URL, original author,, platform" (double comma). These appear to be copy-paste artifacts.

**Resolution**: Remove the duplicate commas. Confirm the field lists are complete (REQ-001 should enumerate all extracted fields; REQ-004 should enumerate all attribution fields).

---

### PRF-004-W2 — REQ-NF-003 Accuracy Threshold Has No Acceptance Test or Measurement Protocol

**Artifact**: `requirements.md` (REQ-NF-003), `trace.md` (Matrix A, line 58)
**Severity**: WARNING

**Evidence**: REQ-NF-003 requires "≥85% extraction accuracy for title, ingredients, instructions." The trace matrix marks this as `Analysis — no AT defined`. No artifact specifies: (a) how accuracy is measured (exact match, fuzzy match, field-level scoring), (b) what corpus of test recipes is used, or (c) who performs the analysis and when.

**Impact**: Without a measurement protocol, the 85% threshold is unverifiable. This is a P1 requirement.

**Resolution**: Either (a) define a measurement protocol and add an analysis procedure to the acceptance plan, or (b) downgrade to P2 and document the rationale. If kept as P1, the analysis procedure must be documented before implementation begins.

---

### PRF-004-W3 — REQ-IF-001, REQ-IF-002, REQ-IF-003 Are Inspection-Only with No Acceptance Coverage

**Artifact**: `trace.md` (Matrix A, lines 66–68)
**Severity**: WARNING

**Evidence**: Three P1 interface requirements — Instagram oEmbed integration (REQ-IF-001), OCR service integration (REQ-IF-002), and Recipe entity model conformance (REQ-IF-003) — are marked `Inspection — no AT defined`. Inspection alone is insufficient for P1 integration requirements; these are runtime behaviours that can only be verified by execution.

**Impact**: If the oEmbed API contract changes or the OCR service returns an unexpected schema, no acceptance test will catch the regression.

**Resolution**: Add acceptance test scenarios for each:

- REQ-IF-001: Verify oEmbed API call is made and response is parsed (can be covered by AT-002-A with explicit API call assertion).
- REQ-IF-002: Verify OCR service is invoked and result flows to review screen (can be covered by AT-009-A with explicit service call assertion).
- REQ-IF-003: Verify imported recipe conforms to Recipe entity schema (add a schema validation assertion to AT-001-A, AT-002-A, AT-009-A).

---

### PRF-004-W4 — REQ-CN-002 and REQ-CN-003 Are Inspection-Only Despite Being Testable

**Artifact**: `trace.md` (Matrix A, lines 76–77)
**Severity**: WARNING

**Evidence**: REQ-CN-002 ("Never make public any recipe from a paywalled source") and REQ-CN-003 ("Instagram import limited to caption-text posts") are both marked `Inspection — no AT defined`. REQ-CN-002 is partially covered by AT-012-A (paywalled source rejection), but the constraint that a paywalled recipe cannot be made public through any path (including manual entry) is not tested. REQ-CN-003 is partially covered by AT-003-A but the constraint document is not linked.

**Resolution**:

- REQ-CN-002: Add a cross-reference to AT-012-A in the trace matrix. Add a negative test: attempt to set visibility=public on a recipe flagged as paywalled and verify rejection.
- REQ-CN-003: Cross-reference AT-003-A in the trace matrix. Change verification method from `Inspection` to `Test` with the AT-003-A reference.

---

### PRF-004-W5 — UTP-001-B Uses Non-Standard Technique Label "Statement Coverage + Error Path"

**Artifact**: `unit-test.md` (UTP-001-B, line 77)
**Severity**: WARNING

**Evidence**: The ISO 29119-4 technique table in `unit-test.md` defines six named techniques. UTP-001-B labels its technique as "Statement Coverage + Error Path." "Error Path" is not one of the six defined techniques; the correct label is "Error Guessing" (defined in the technique table as "Negative paths, invalid inputs, dependency exceptions").

**Impact**: Minor — inconsistency in technique labelling reduces traceability auditability.

**Resolution**: Change UTP-001-B technique to "Statement & Branch Coverage + Error Guessing" to match the defined vocabulary.

---

### PRF-004-W6 — AT-013-A Pass Criterion Is Circular and Untestable (Independent of Legal Block)

**Artifact**: `acceptance-plan.md` (AT-013-A, ATS-013-A1)
**Severity**: WARNING (see also PRF-004-C4)

**Evidence**: ATS-013-A1 Then-clause reads: "the system flags the recipe and applies appropriate visibility restrictions per platform policy." The phrase "per platform policy" is undefined in any artifact. Even if the legal block (PRF-004-C4) were resolved, this scenario would still fail the testability criterion because the expected outcome is not specified concretely.

**Resolution**: Replace "per platform policy" with a concrete expected outcome once the legal review is complete (e.g., "the recipe is saved as private and cannot be changed to public by the user").

---

### PRF-004-W7 — No Negative Test for Deduplication Race Condition

**Artifact**: `unit-test.md` (UTP-010-A), `acceptance-plan.md` (AT-008-A)
**Severity**: WARNING

**Evidence**: UTP-010-A covers the deduplication happy path (existing record found → return existing) and the no-duplicate path. AT-008-A covers the user-facing duplicate surfacing flow. Neither artifact addresses the concurrent import race condition: two users submitting the same URL simultaneously before either record is committed.

**Impact**: REQ-CN-001 ("MUST NOT create more than one public recipe record per unique source URL") could be violated under concurrent load if the deduplication check and insert are not atomic (e.g., via a DB unique constraint or advisory lock).

**Resolution**: Add a unit test scenario to UTP-010-A for the race condition path (e.g., mock `findBySourceUrl` returning null on first call but a DB unique constraint violation on insert). Add a note to REQ-CN-001 or REQ-008 specifying that the deduplication constraint must be enforced at the database level (unique index on `source_url`), not only in application logic.

---

### PRF-004-W8 — OCR Confidence Threshold Is Untested at Acceptance Level

**Artifact**: `unit-test.md` (UTP-007-A), `acceptance-plan.md` (AT-009-A, AT-011-A)
**Severity**: WARNING

**Evidence**: UTP-007-A1 asserts `result.confidence === 0.95` and UTP-007-A2 asserts `result.confidence === 0`. The unit tests verify that confidence is computed and returned. However, no acceptance test verifies what happens when confidence is below a threshold (e.g., the system should warn the user or require manual review of low-confidence extractions). The requirements do not define a confidence threshold.

**Impact**: Low-confidence OCR results may be silently presented to users as if they were high-confidence, leading to incorrect recipe data being saved without user awareness.

**Resolution**: Add a requirement (or assumption) defining the minimum acceptable OCR confidence threshold and the system behaviour below it. Add an acceptance test scenario to AT-011-A covering the low-confidence path (e.g., "When OCR confidence is below threshold, the review screen highlights uncertain fields").

---

### PRF-004-W9 — Matrix D UTS Count Discrepancy for MOD-003

**Artifact**: `trace.md` (Matrix D, line ~143), `unit-test.md` (ARCH↔MOD↔UTP table, line 327)
**Severity**: WARNING

**Evidence**: The ARCH↔MOD↔UTP traceability table in `unit-test.md` (line 327) states MOD-003 has "2 (A, B)" UTP cases and "6 (A1-A4, B1-B3)" UTS scenarios (4 + 3 = 7, not 6). The count "A1-A4" is 4 scenarios and "B1-B3" is 3 scenarios, totalling 7. The summary says 6. This is an arithmetic error.

**Resolution**: Correct the UTS count for MOD-003 to 7 in the ARCH↔MOD↔UTP table. Verify all other row counts in the table for similar arithmetic errors.

---

## PASSED Findings

---

### PRF-004-P1 — RFC-2119 Language Used Consistently in Functional Requirements

All 15 functional requirements use SHALL/MUST/MUST NOT correctly and consistently. No ambiguous language (e.g., "should," "may," "might") appears in P1 requirements. **PASSED.**

---

### PRF-004-P2 — All 15 Functional Requirements Have At Least One Acceptance Test

Matrix A forward traceability is complete for all 15 FRs. Every REQ-001 through REQ-015 maps to at least one AT case. REQ-015 is the only gap (no AT), which is flagged as CRITICAL in PRF-004-C2. **PASSED** for REQ-001 through REQ-014.

---

### PRF-004-P3 — BDD Scenario Format Is Consistent Throughout Acceptance Plan

All acceptance test scenarios use the Given/When/Then format correctly. Pre-conditions and pass criteria are stated for every test case. No scenario is missing a Then-clause. **PASSED.**

---

### PRF-004-P4 — All 18 Modules Have Unit Test Coverage

The ARCH↔MOD↔UTP traceability table confirms all 18 modules (MOD-001 through MOD-018) have at least one UTP case and at least one UTS scenario. No module is untested at the unit level. **PASSED.**

---

### PRF-004-P5 — ISO 29119-4 Technique Labels Are Applied to All Unit Test Cases

Every UTP case identifies its technique by name from the defined vocabulary table, with the single exception noted in PRF-004-W5. The technique-to-view mapping (e.g., Boundary Value Analysis → Internal Data Structures) is applied correctly throughout. **PASSED** (with minor exception in PRF-004-W5).

---

### PRF-004-P6 — Strict Isolation Is Applied to All Unit Tests

All unit test scenarios mock external dependencies (database, S3, Textract, Instagram oEmbed, Clerk token verification). No unit test scenario makes real network or database calls. Mock isolation is explicitly documented in every scenario. **PASSED.**

---

### PRF-004-P7 — Backward Traceability (Matrix B) Has No Orphan Acceptance Tests

Matrix B maps every AT case back to a parent requirement. No orphan ATs (acceptance tests without a parent REQ) are present. All AT-NF and AT-IF cases correctly reference their parent non-functional and interface requirements. **PASSED.**

---

### PRF-004-P8 — Deduplication Constraint Is Covered at Both Unit and Acceptance Level

REQ-CN-001 and REQ-008 are covered by UTP-010-A (unit) and AT-008-A (acceptance). The trace matrix correctly cross-references both. **PASSED** (race condition gap noted separately in PRF-004-W7).

---

### PRF-004-P9 — Attribution Requirements Are Covered at Multiple Test Levels

REQ-004 (attribution display) is covered by AT-004-A (acceptance), UTP-011-A (unit — AttributionVisibilityService), and is referenced in the integration matrix (MOD-001 ↔ MOD-011). Multi-level coverage is appropriate for a legal compliance requirement. **PASSED.**

---

### PRF-004-P10 — Accessibility Requirements Have Executable Acceptance Tests

REQ-NF-004 and REQ-NF-005 both have acceptance test cases (AT-NF004-A, AT-NF005-A) with concrete Playwright-executable scenarios. This is above the minimum standard for non-functional requirements. **PASSED.**

---

### PRF-004-P11 — OCR Async Path Is Covered at Unit Level

The large-photo async path (>5 MB → S3 staging → Textract async job → polling) is covered by UTP-007-A3, UTP-007-A4, and UTP-007-B (3 scenarios). Polling timeout and FAILED job status are both tested. **PASSED.**

---

### PRF-004-P12 — Dependency Declarations Are Complete and Consistent

The requirements document lists three feature dependencies (001, 002, 010) with rationale. The acceptance plan header repeats the same three dependencies. The trace matrix interface requirements (REQ-IF-001 through REQ-IF-004) map to these dependencies. No undeclared dependency was found. **PASSED.**

---

## Action Items Summary

| Finding    | Severity | Owner          | Artifact(s)                                                                                |
| ---------- | -------- | -------------- | ------------------------------------------------------------------------------------------ |
| PRF-004-C1 | CRITICAL | Author         | Create `integration-test.md` covering all 13 Matrix C integration points                   |
| PRF-004-C2 | CRITICAL | Author         | Resolve REQ-015 verification method contradiction; add AT or document analysis rationale   |
| PRF-004-C3 | CRITICAL | Author + PO    | Define "substantive edit" threshold; add unit test for detection logic                     |
| PRF-004-C4 | CRITICAL | Author + Legal | Mark AT-013-A as BLOCKED; create legal review tracking item                                |
| PRF-004-W1 | WARNING  | Author         | Fix double commas in REQ-001 and REQ-004                                                   |
| PRF-004-W2 | WARNING  | Author + QA    | Define REQ-NF-003 measurement protocol or downgrade to P2                                  |
| PRF-004-W3 | WARNING  | Author         | Add acceptance test coverage for REQ-IF-001, REQ-IF-002, REQ-IF-003                        |
| PRF-004-W4 | WARNING  | Author         | Cross-reference existing ATs for REQ-CN-002, REQ-CN-003; add negative visibility test      |
| PRF-004-W5 | WARNING  | Author         | Rename UTP-001-B technique to "Statement & Branch Coverage + Error Guessing"               |
| PRF-004-W6 | WARNING  | Author         | Replace circular pass criterion in ATS-013-A1 with concrete expected outcome               |
| PRF-004-W7 | WARNING  | Author + Arch  | Add race condition unit test to UTP-010-A; document DB-level unique constraint requirement |
| PRF-004-W8 | WARNING  | Author + PO    | Define OCR confidence threshold; add low-confidence acceptance test scenario               |
| PRF-004-W9 | WARNING  | Author         | Correct MOD-003 UTS count from 6 to 7 in ARCH↔MOD↔UTP table                                |
