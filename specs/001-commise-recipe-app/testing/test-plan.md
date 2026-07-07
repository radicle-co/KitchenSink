# Test Plan: Commise Recipe Management Core

**Feature**: `001-commise-recipe-app`
**Testing Strategy**: TDD (tests written before implementation)
**Testing Directory**: `specs/001-commise-recipe-app/testing/`
**Source Artifacts**:

- V-Model (ISO 29119): `v-model/unit-test.md`, `v-model/integration-test.md`, `v-model/system-test.md`, `v-model/acceptance-plan.md`
- Requirements: `v-model/requirements.md`
- Traceability: `v-model/traceability-matrix.md`
- Architecture: `v-model/architecture-design.md`, `v-model/system-design.md`
- Module Design: `v-model/module-design.md`
- Spec: `spec.md`
- Plan: `plan.md`
- Tasks: `tasks.md` (172 tasks)

---

## 1. Test Levels & Strategy

This test plan follows the V-Model lifecycle with four independent test levels,
each verified against its corresponding design artifact:

| Level           | Document Source          | Test Type                               | ID Schema                          | Count             |
| --------------- | ------------------------ | --------------------------------------- | ---------------------------------- | ----------------- |
| **Unit**        | `module-design.md`       | White-box, per-module                   | `UTP-{NNN}-{X}` / `UTS-{NNN}-{X}#` | 47 modules        |
| **Integration** | `architecture-design.md` | Module boundary, interface contracts    | `ITP-{NNN}-{X}` / `ITS-{NNN}-{X}#` | 33 ARCH modules   |
| **System**      | `system-design.md`       | Architectural behavior, API contracts   | `STP-{NNN}-{X}` / `STS-{NNN}-{X}#` | 17 SYS components |
| **Acceptance**  | `requirements.md`        | User-observable behavior, BDD scenarios | `ATP-{NNN}-{X}` / `SCN-{NNN}-{X}#` | 134 requirements  |

Every test case is traceable to at least one requirement and one architecture
element via the traceability matrix (`v-model/traceability-matrix.md`).

---

## 2. Test Case Inventory

### 2.1 Unit Tests (v-model/unit-test.md)

**Total**: 47 modules with unit test cases.
**Source**: `v-model/module-design.md` — each `MOD-NNN` maps to a TypeScript source file.

| Category             | Modules                                                         | Techniques                                                          |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Auth modules         | MOD-001 (JWT Verifier), MOD-002 (Auth Guard), MOD-003 (Session) | Statement/branch coverage, error guessing                           |
| Recipe CRUD          | MOD-004..MOD-012                                                | Boundary value analysis, equivalence partitioning, state transition |
| Ingredient           | MOD-013..MOD-016                                                | Boundary value (macro boundaries), error guessing                   |
| Photo                | MOD-017..MOD-019                                                | Error guessing, fault injection                                     |
| Versioning           | MOD-020..MOD-023                                                | State transition, concurrency                                       |
| Collections          | MOD-024..MOD-027                                                | Equivalence partitioning, decision table                            |
| Search               | MOD-028..MOD-031                                                | Statement coverage, boundary analysis                               |
| API / Infrastructure | MOD-032..MOD-040                                                | Interface contract, error propagation                               |

**Key technique per module type**:

- **Statement & Branch Coverage**: All algorithmic modules (search, version conflict detection)
- **Boundary Value Analysis**: Ingredient macros, tag counts, photo limits
- **Equivalence Partitioning**: Recipe visibility (private/public), collection membership
- **State Transition Testing**: Recipe versioning (draft→published→archived), photo upload state machine
- **Error Guessing**: Photo upload failures, S3 archive failures, JWT validation failures
- **Strict Isolation**: All modules mock external dependencies (DB, S3, Clerk)

### 2.2 Integration Tests (v-model/integration-test.md)

**Total**: 33 ARCH modules with integration test cases.
**Source**: `v-model/architecture-design.md` — module boundary contracts.

| Contract Type                | ARCH Pairs          | Technique                       |
| ---------------------------- | ------------------- | ------------------------------- |
| JWT Principal → Auth Guard   | ARCH-001 → ARCH-002 | Interface contract testing      |
| Recipe DAL → Service         | ARCH-003 → ARCH-004 | Data flow testing               |
| Ingredient → Food Service Client | ARCH-013 → ARCH-014 | Consumer-driven contract (CDCT) against `@kitchensink/food-service-client` |
| Version → S3 Archive         | ARCH-017 → ARCH-018 | Interface fault injection       |
| SQS Queue → Archive Consumer | ARCH-018 → ARCH-019 | Concurrency & race condition    |
| Search → PostgreSQL FTS      | ARCH-024 → ARCH-025 | Interface contract testing      |
| Photo Upload → S3 + Lambda   | ARCH-028 → ARCH-029 | Interface fault injection       |
| Shared ALB → NestJS Service  | ARCH-030 → ARCH-031 | Interface contract testing      |

**Key scenarios**:

- `ITS-001-A1`: Clerk session token verified by AuthMiddleware (networkless) → principal injected into `req.user`
- `ITS-004-B1`: Recipe create → DAL insert → version snapshot created in same transaction
- `ITS-018-E1`: SQS message received → Clerk delete → success → message deleted
- `ITS-018-E2`: SQS message received → Clerk delete → failure → visibility timeout extended with backoff
- `ITS-024-E1`: PostgreSQL tsvector search returns recipe IDs in relevance rank order

### 2.3 System Tests (v-model/system-test.md)

**Total**: 17 SYS components with system test cases.
**Source**: `v-model/system-design.md`.

| Component  | Focus                                             | Key Scenarios                                                     |
| ---------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| SYS-001    | Clerk session-token verification (AuthMiddleware) | Valid token → 200, expired → 401, suspended → 403                 |
| SYS-002    | Recipe CRUD endpoint contracts                    | Create/read/update/delete with auth + ownership                   |
| SYS-003    | Full-text search interface                        | Query → ranked results, empty query → 400                         |
| SYS-004    | Version snapshot archival                         | Save → version row → SQS → S3 confirmed                           |
| SYS-005    | Photo upload pipeline                             | Presigned URL → direct S3 upload → Lambda Sharp → CloudFront      |
| SYS-006    | Collection clone with source-pull                 | Clone → reconcile with source without overwriting local additions |
| SYS-NF-004 | Performance — search response time                | p95 < 200ms for FTS queries                                       |

### 2.4 Acceptance Tests (v-model/acceptance-plan.md)

**Total**: 129 ATP test cases (134 requirement baseline minus 5 umbrella entries).
**Source**: `v-model/requirements.md` (134 normative requirements).

| Category              | Requirement IDs        | ATP Count |
| --------------------- | ---------------------- | --------- |
| Auth & Security       | REQ-001..REQ-025       | ~25 ATPs  |
| Recipe CRUD           | REQ-026..REQ-055       | ~30 ATPs  |
| Photo Management      | REQ-056..REQ-065       | ~10 ATPs  |
| Versioning            | REQ-066..REQ-075       | ~10 ATPs  |
| Collections & Sharing | REQ-076..REQ-090       | ~15 ATPs  |
| Search                | REQ-091..REQ-105       | ~15 ATPs  |
| Non-functional        | REQ-NF-001..REQ-NF-029 | ~29 ATPs  |
| Interface             | REQ-IF-001..REQ-IF-010 | ~10 ATPs  |
| Constraints           | REQ-CN-001..REQ-CN-007 | ~7 ATPs   |

**Entry Criteria** (per acceptance-plan.md):

1. `system-test.md` execution evidence shows all P1 system tests passing
2. UAT/staging environment is deployed and reachable
3. Seed data and test harness assets available

**Exit Criteria**:

1. All P1 ATPs pass
2. Zero open Critical/Major defects
3. Coverage Summary shows 100% requirement coverage

---

## 3. Traceability Matrix Summary

**Source**: `v-model/traceability-matrix.md` (Matrix A = User View, Matrix B = System Verification)

| Matrix   | Maps                        | To                                       |
| -------- | --------------------------- | ---------------------------------------- |
| Matrix A | Requirements → ATP/SCN      | Validation by user-observable behavior   |
| Matrix B | System Components → STP/STS | Verification by architectural test       |
| Matrix C | Integration → ITP/ITS       | Verification of module boundaries        |
| Matrix D | Implementation → UTP/UTS    | Verification of module internals         |
| Matrix H | Hazard Traceability         | Safety requirements traced to test cases |

---

## 4. Test Execution Order (TDD)

Since this is a TDD approach, tests must be written **before** implementation.
The dependency order respects architecture layers:

```
Unit Tests (MOD-NNN source files)
    ↓
Integration Tests (ARCH-NNN module boundaries)
    ↓
System Tests (SYS-NNN API components)
    ↓
Acceptance Tests (ATP user scenarios — run against live system)
```

### Phase 1: Write Unit Tests First

- Generate `UTP-{NNN}-{X}` test cases for each module BEFORE writing the module
- Use red-green-refactor: write failing test → implement → test passes
- Mock all external dependencies (PostgreSQL, S3, Clerk, SQS)

### Phase 2: Write Integration Tests

- Generate `ITP-{NNN}-{X}` test cases for module interaction contracts
- These validate that module boundaries work as designed

### Phase 3: Write System Tests

- Generate `STP-{NNN}-{X}` test cases for API endpoint contracts
- These validate the full request/response lifecycle

### Phase 4: Write Acceptance Tests

- Generate `ATP-{NNN}-{X}` / `SCN-{NNN}-{X}#` BDD scenarios
- These validate user-facing behavior from the spec

---

## 5. Test Environment

| Component      | Value                                             |
| -------------- | ------------------------------------------------- |
| Frontend       | `http://localhost:5173` (Next.js dev server)      |
| API            | `http://localhost:3000` (NestJS on Fargate local) |
| Database       | PostgreSQL 16 (local Docker or RDS)               |
| S3             | LocalStack or AWS sandbox                         |
| Clerk          | Clerk sandbox instance                            |
| Test Framework | Vitest (unit/integration), Playwright (E2E)       |
| API Testing    | Supertest or Playwright API                       |

---

## 6. Test Case File Mapping

| Test Level       | Source Document               | Output File                        |
| ---------------- | ----------------------------- | ---------------------------------- |
| Unit             | `v-model/unit-test.md`        | `testing/unit-cases.md`            |
| Integration      | `v-model/integration-test.md` | `testing/integration-cases.md`     |
| System           | `v-model/system-test.md`      | `testing/system-cases.md`          |
| Acceptance       | `v-model/acceptance-plan.md`  | `testing/acceptance-cases.md`      |
| **Master index** | (this file)                   | `testing/test-cases.md` (combined) |

All test cases are in `testing/test-cases.md` (see that file for the full
executable case list). Playwright `.spec.ts` files live in `testing/playwright-tests/`.

---

## 7. Coverage Summary

| Requirement Type                | Total   | Covered by ATP | Missing |
| ------------------------------- | ------- | -------------- | ------- |
| Functional (REQ-NNN / REQ-NNNx) | 91      | 91             | 0       |
| Non-functional (REQ-NF-NNN)     | 29      | 29             | 0       |
| Interface (REQ-IF-NNN)          | 10      | 10             | 0       |
| Constraint (REQ-CN-NNN)         | 7       | 7              | 0       |
| **Total**                       | **134** | **129**        | **0**   |

> Note: 5 ATP entries are linked to decomposed atomic sub-IDs (REQ-035a/b,
> REQ-038a/b/c, REQ-049a/b) bringing the actual ATP count to 129 while
> maintaining 100% normative requirement coverage.

---

## 8. Entry Criteria (Pre-Test)

- [ ] All unit tests `UTP-*` written before module implementation
- [ ] All integration test scenarios `ITS-*` written before module integration
- [ ] All system test scenarios `STS-*` written before API implementation
- [ ] All acceptance scenarios `SCN-*` written before feature implementation
- [ ] Playwright installed: `npx playwright install`
- [ ] Vitest configured: `vitest.config.ts` in each workspace
- [ ] Clerk test instance credentials in `testing/env.md`
- [ ] Database migrations run in test environment
- [ ] Seed data script (`packages/services/recipe-service/src/database/seed/`) ready

---

## 9. Exit Criteria (Test Complete)

- [ ] 100% unit test pass rate (all `UTP-*`)
- [ ] 100% integration test pass rate (all `ITS-*`)
- [ ] 100% system test pass rate (all `STS-*`)
- [ ] All P1 acceptance tests pass (all `ATP-*` P1)
- [ ] ≥ 90% P2/P3 acceptance tests pass
- [ ] Zero P0/P1 open bugs
- [ ] Traceability matrix updated (all `⬜ Untested` → `✅ Pass`)

---

## 10. Bug Severity

| Severity | Definition                                  | Must Block Release? |
| -------- | ------------------------------------------- | ------------------- |
| P0       | System crash, auth broken, data loss        | ✅ Yes              |
| P1       | Core feature completely broken              | ✅ Yes              |
| P2       | Feature partially broken, workaround exists | No                  |
| P3       | Cosmetic, minor UX issue                    | No                  |
| P4       | Typo, pixel misalignment                    | No                  |

---

## 11. How to Run

### TDD Red-Green Loop

```bash
# Run unit tests in watch mode (TDD workflow)
cd packages/services/recipe-service
npx vitest --watch

# Run single test file
npx vitest run src/recipes/dal/__tests__/recipes.dal.test.ts

# Run integration tests
npx vitest run --config vitest.integration.config.ts

# Run system tests (requires running API)
npx playwright test testing/playwright-tests/001-commise-recipe-app/system-tests.spec.ts

# Run acceptance tests (requires full environment)
npx playwright test testing/playwright-tests/001-commise-recipe-app/acceptance-tests.spec.ts
```

### Full Test Suite

```bash
# Unit + Integration (fast, no browser)
npm run test:unit && npm run test:integration

# System + Acceptance (requires environment)
npm run test:e2e

# All tests
npm test
```
