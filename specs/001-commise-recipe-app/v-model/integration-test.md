# Integration Test Plan: Commise Recipe App

**Feature Branch**: `001-commise-recipe-app`
**Created**: 2026-05-02
**Status**: Draft
**Source**: `specs/001-commise-recipe-app/v-model/architecture-design.md`

## Overview

This document defines ISO 29119-4 integration testing for Commise Recipe App architecture modules. It validates module boundaries, interface handshakes, error propagation, data-flow seams, and concurrent interactions across ARCH-001..ARCH-033.

Integration scenarios are module-boundary-only (Given/When/Then) and avoid user-journey and internal-logic phrasing.

## ID Schema

- **Integration Test Case**: `ITP-NNN-X` where `NNN` maps directly to `ARCH-NNN`
- **Integration Test Scenario**: `ITS-NNN-X#` where `#` indexes executable scenarios per ITP
- Example: `ITP-018-D` verifies ARCH-018; `ITS-018-D1` is scenario 1 for that test case

## ISO 29119-4 Integration Test Techniques

| Technique                                   | Source View                     | What It Tests                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Interface Contract Testing**              | Interface View                  | Module API contracts, data format compliance, error responses                                                                                                                                                                                                                                                                                                                                                               |
| **Data Flow Testing**                       | Data Flow View                  | End-to-end data transformation chain validation                                                                                                                                                                                                                                                                                                                                                                             |
| **Interface Fault Injection**               | Interface View + Process View   | Malformed payloads, timeouts, graceful failure                                                                                                                                                                                                                                                                                                                                                                              |
| **Concurrency & Race Condition Testing**    | Process View                    | Simultaneous access, lock handling, queue ordering                                                                                                                                                                                                                                                                                                                                                                          |
| **Consumer-Driven Contract Testing (CDCT)** | Interface View + Data Flow View | Consumer-driven contract expectations across producer/consumer boundaries. **Convention**: for CDCT scenarios, the consuming module and producing module are explicitly named in the scenario header (e.g., `'ARCH-003↔ARCH-004 contract'` in ITP-003-E, `'ARCH-004↔ARCH-024 contract'` in ITP-004-E, `'ARCH-017↔ARCH-018 queue contract'` in ITP-017-E). All consumer-producer pairs follow this `ARCH-M→↔ARCH-N` pattern. |

## Integration Tests

### Module: ARCH-001: ClerkAuthService (Session-Token Verifier)

#### Test Case: ITP-001-A (JWT principal contract to authorization guard)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-001 returns the `Principal` contract consumed by ARCH-002.

- **Integration Scenario: ITS-001-A1**
    - **Given** ARCH-003 sends a bearer token to ARCH-001 for route authentication
    - **When** ARCH-001 returns `principal { userId, sub, email, tier, iat, exp }` to ARCH-002, where `userId` is the app-user ULID read from the verified token's `external_id` claim (`sub` is the Clerk subject, retained for trace/audit only)
    - **Then** the interface between ARCH-001 and ARCH-002 accepts the principal with `tier ∈ {"free","premium"}` and a non-empty `userId` (the ULID owner key against which ownership compares `owner_id == principal.userId`); `sub` is never used as the owner key

#### Test Case: ITP-001-B (networkless verification fail-closed propagation contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies fail-closed 401 handling from ARCH-001 through ARCH-003/ARCH-028 boundary chain. Verification is networkless (local `CLERK_JWT_KEY`, no JWKS endpoint), so there is no remote-dependency outage path — a rejected token surfaces as `INVALID_TOKEN` with HTTP 401, never a 503.

- **Integration Scenario: ITS-001-B1**
    - **Given** ARCH-003 sends a token to ARCH-001 whose signature fails verification against the local `CLERK_JWT_KEY` (e.g. tampered/bad-signature or disallowed `azp`)
    - **When** the interface between ARCH-001 and ARCH-003 returns `INVALID_TOKEN` with HTTP 401
    - **Then** ARCH-028 maps the propagated boundary error to `{ code, message, traceId }` without contract drift, and no outbound network I/O occurs during verification

### Module: ARCH-002: Owner & Tier Authorization Guard

#### Test Case: ITP-002-A (owner/tier decision contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-002 consumes principal/resourceRef and returns deterministic allow/deny contracts to ARCH-003.

- **Integration Scenario: ITS-002-A1**
    - **Given** ARCH-003 sends `{ kind: "recipe", id, action: "write" }` and principal from ARCH-001 to ARCH-002
    - **When** ARCH-002 queries ownership and tier through ARCH-024 and evaluates policy
    - **Then** ARCH-002 returns `{ allowed: true }` or `{ code, ruleId, requiredTier }` to ARCH-003 per interface contract

#### Test Case: ITP-002-B (forbidden contract passthrough)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies ARCH-002 emits bounded 403 contracts for owner/tier violations.

- **Integration Scenario: ITS-002-B1**
    - **Given** ARCH-003 sends an action where principal is not owner for target resource
    - **When** the interface between ARCH-002 and ARCH-003 returns `FORBIDDEN_OWNER`
    - **Then** the returned payload contains `{ code, ruleId }` and no unrelated module receives mutated authorization state

### Module: ARCH-003: Recipe HTTP Controller

#### Test Case: ITP-003-A (controller route-to-service contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-003 boundary contracts with ARCH-001/002/005/004 and JSON response envelope.

- **Integration Scenario: ITS-003-A1**
    - **Given** ARCH-026 sends `PATCH /v1/recipes/{id}` to ARCH-003 with bearer token and DTO body
    - **When** ARCH-003 chains calls to ARCH-001, ARCH-002, ARCH-005, and ARCH-004
    - **Then** ARCH-003 returns 2xx JSON resource response and preserves pagination/headers contract where applicable

#### Test Case: ITP-003-B (domain error mapping path)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies ARCH-003 forwards thrown domain errors to ARCH-028 without boundary loss.

- **Integration Scenario: ITS-003-B1**
    - **Given** ARCH-004 returns `CONCURRENCY_CONFLICT` to ARCH-003
    - **When** ARCH-003 forwards the boundary error to ARCH-028
    - **Then** the interface between ARCH-003 and ARCH-028 returns HTTP 409 with `{ code, currentRowVersion, currentSnapshot }`

#### Test Case: ITP-003-C (request/response data flow continuity)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies request payload from ARCH-026/027 reaches downstream command pipeline without schema drift.

- **Integration Scenario: ITS-003-C1**
    - **Given** ARCH-026 sends JSON `UpdateRecipeRequest` to ARCH-003
    - **When** ARCH-003 forwards the payload to ARCH-005 and ARCH-004
    - **Then** data flowing from ARCH-003 to ARCH-005 is transformed from raw JSON to typed command without dropping required fields

#### Test Case: ITP-003-D (parallel request isolation)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent controller requests isolate per-request principal and command context.

- **Integration Scenario: ITS-003-D1**
    - **Given** ARCH-026 and ARCH-027 send concurrent update requests for distinct recipes to ARCH-003
    - **When** ARCH-003 invokes ARCH-001/002/004 concurrently
    - **Then** the handshake between ARCH-003 and downstream modules keeps request contexts isolated and returns correct recipe-scoped responses

#### Test Case: ITP-003-E (consumer-driven contract at controller-service seam)

**Technique**: CDCT
**Target View**: Interface View + Data Flow View
**Boundary**: ARCH-003 (producer) ↔ ARCH-004 (consumer)
**Description**: Verifies consumer-driven contract expectations from ARCH-004 are enforced on ARCH-003 route-to-command output.

- **Integration Scenario: ITS-003-E1**
    - **Given** contract fixtures authored by ARCH-004 define required command fields and error envelope shape consumed from ARCH-003
    - **When** ARCH-003 transforms authenticated HTTP request input into command payload and forwards it to ARCH-004
    - **Then** the consumer-driven contract between ARCH-003 and ARCH-004 is satisfied for required fields, enum values, and error code schema

### Module: ARCH-004: Recipe Command Service

#### Test Case: ITP-004-A (command orchestration contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-004 integrates ARCH-006/016/015/017/024 and returns versioned `RecipeView` contract.

- **Integration Scenario: ITS-004-A1**
    - **Given** ARCH-003 sends a validated update command to ARCH-004
    - **When** ARCH-004 calls ARCH-006, ARCH-016, ARCH-024, ARCH-015, and ARCH-017 in the defined boundary sequence
    - **Then** ARCH-004 returns `RecipeView` containing monotonic `versionNumber` and updated `rowVersion` to ARCH-003

#### Test Case: ITP-004-B (policy/concurrency failure contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies ARCH-004 propagates bounded 403/409 contracts from policy and CAS seams.

- **Integration Scenario: ITS-004-B1**
    - **Given** ARCH-016 detects row-version mismatch for ARCH-004 update flow
    - **When** the interface between ARCH-016 and ARCH-004 returns `CONCURRENCY_CONFLICT`
    - **Then** ARCH-004 sends HTTP 409 contract fields to ARCH-003 without mutating persisted state contract

#### Test Case: ITP-004-C (recipe-save data chain integrity)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies typed command transforms into persisted recipe row and snapshot handoff.

- **Integration Scenario: ITS-004-C1**
    - **Given** ARCH-005 sends typed `UpdateRecipeCommand` to ARCH-004
    - **When** ARCH-004 persists through ARCH-024 and hands snapshot to ARCH-015
    - **Then** data flowing from ARCH-004 to ARCH-015 preserves recipe identity and version ordering

#### Test Case: ITP-004-D (transaction boundary race control)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies ARCH-004 transaction + CAS synchronization under concurrent updates.

- **Integration Scenario: ITS-004-D1**
    - **Given** two ARCH-003 requests send updates for the same recipe to ARCH-004
    - **When** both requests reach ARCH-016 compare-and-set at the transaction boundary
    - **Then** one ARCH-004 path commits and one path returns 409 conflict with current snapshot contract

#### Test Case: ITP-004-E (consumer-driven contract at service-adapter seam)

**Technique**: CDCT
**Target View**: Interface View + Data Flow View
**Boundary**: ARCH-004 (producer) ↔ ARCH-024 (consumer)
**Description**: Verifies consumer-driven contract expectations from ARCH-024 are enforced on ARCH-004 repository interaction shape.

- **Integration Scenario: ITS-004-E1**
    - **Given** contract fixtures authored by ARCH-024 require typed transactional payloads, row-version fields, and deterministic repository method signatures from ARCH-004
    - **When** ARCH-004 issues save and lookup operations to ARCH-024 during recipe update orchestration
    - **Then** the consumer-driven contract between ARCH-004 and ARCH-024 is satisfied with schema-stable payloads and bounded repository error codes

### Module: ARCH-005: Recipe DTO Validator

#### Test Case: ITP-005-A (DTO validation output contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-005 transforms raw request body from ARCH-003 into typed DTO contract.

- **Integration Scenario: ITS-005-A1**
    - **Given** ARCH-003 sends unsanitized JSON body to ARCH-005
    - **When** ARCH-005 applies whitelist, trim, and range rules
    - **Then** ARCH-005 returns typed request DTO to ARCH-003 with normalized fields matching contract

#### Test Case: ITP-005-B (validation error aggregation contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies invalid payload boundary produces complete `fieldErrors[]` contract.

- **Integration Scenario: ITS-005-B1**
    - **Given** ARCH-003 sends a body with missing required fields and invalid numeric ranges to ARCH-005
    - **When** ARCH-005 validates the payload
    - **Then** the interface between ARCH-005 and ARCH-003 returns `VALIDATION_FAILED` with aggregated `{ path, code, message }[]`

#### Test Case: ITP-005-C (save-flow DTO chain)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies DTO emitted by ARCH-005 flows into ARCH-004/ARCH-015 chain unchanged where required.

- **Integration Scenario: ITS-005-C1**
    - **Given** ARCH-026 serialized `UpdateRecipeRequest` enters ARCH-005 via ARCH-003
    - **When** ARCH-005 emits `UpdateRecipeCommand` to ARCH-004
    - **Then** data flowing from ARCH-005 to ARCH-004 keeps ingredient, instruction, and visibility fields required for ARCH-015 snapshot

### Module: ARCH-006: Visibility Policy Engine

#### Test Case: ITP-006-A (visibility decision contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-006 returns `{ allowed, reason, ruleId }` for ARCH-004 and ARCH-021 consumers.

- **Integration Scenario: ITS-006-A1**
    - **Given** ARCH-004 sends `{ tier, source, currentVisibility, targetVisibility, isSubstantiveEdit }` to ARCH-006
    - **When** ARCH-006 evaluates the policy matrix
    - **Then** ARCH-006 returns deterministic `{ allowed, reason, ruleId }` to ARCH-004 with no missing fields

#### Test Case: ITP-006-B (enum mismatch fail-closed contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies ARCH-006 fail-closed behavior for unsupported enum values.

- **Integration Scenario: ITS-006-B1**
    - **Given** ARCH-021 sends a policy context containing an unsupported visibility enum to ARCH-006
    - **When** ARCH-006 rejects the invalid enum input
    - **Then** the interface between ARCH-006 and ARCH-021 returns `POLICY_INTERNAL` contract and denies transition

#### Test Case: ITP-006-C (visibility policy decision data-flow continuity)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies `{ allowed, reason, ruleId }` from ARCH-006 flows to ARCH-004 and ARCH-021 without field loss.

- **Integration Scenario: ITS-006-C1**
    - **Given** ARCH-006 evaluates policy context from ARCH-004 and ARCH-021 and emits `{ allowed, reason, ruleId }`
    - **When** ARCH-004 and ARCH-021 consume the returned policy decision object for save/clone orchestration
    - **Then** data flowing from ARCH-006 to ARCH-004 and ARCH-021 preserves `allowed`, `reason`, and `ruleId` exactly, including downstream audit `ruleId`

#### Test Case: ITP-006-D (simultaneous policy evaluations)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent evaluations from ARCH-004 and ARCH-021 remain isolated.

- **Integration Scenario: ITS-006-D1**
    - **Given** ARCH-004 and ARCH-021 concurrently send independent policy contexts to ARCH-006
    - **When** ARCH-006 evaluates both calls in parallel
    - **Then** each interface response returns the correct `{ allowed, reason, ruleId }` for its originating module context

### Module: ARCH-007: Substantive Edit Detector

#### Test Case: ITP-007-A (substantive-edit classification contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-007 boundary contract consumed by ARCH-004/ARCH-006 for privacy unlock decisions.

- **Integration Scenario: ITS-007-A1**
    - **Given** ARCH-004 sends `beforeRecipe` and `afterRecipe` snapshots to ARCH-007
    - **When** ARCH-007 compares ingredient and instruction boundaries
    - **Then** ARCH-007 returns `{ isSubstantive, changedFields[] }` to ARCH-004 with changed field paths matching interface schema

#### Test Case: ITP-007-B (changed-fields data-flow to policy context)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies `changedFields[]` and `isSubstantive` from ARCH-007 propagate into ARCH-006 policy context without coercion.

- **Integration Scenario: ITS-007-B1**
    - **Given** ARCH-004 sends `beforeRecipe` and `afterRecipe` snapshots to ARCH-007 and receives `{ isSubstantive, changedFields[] }`
    - **When** ARCH-004 forwards `isSubstantiveEdit` policy context to ARCH-006
    - **Then** data flowing from ARCH-007 through ARCH-004 to ARCH-006 preserves `changedFields[]` paths and `isSubstantive` semantics with no field loss or type drift

#### Test Case: ITP-007-C (concurrent substantive-check isolation)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies parallel ARCH-004 calls to ARCH-007 return isolated, non-interleaved classification results.

- **Integration Scenario: ITS-007-C1**
    - **Given** two ARCH-004 update flows concurrently send different `beforeRecipe`/`afterRecipe` pairs to ARCH-007
    - **When** ARCH-007 evaluates both comparisons in parallel
    - **Then** each interface response returns its own `{ isSubstantive, changedFields[] }` result with no crossover between concurrent calls

### Module: ARCH-008: Ingredient Resolver Service

#### Test Case: ITP-008-A (ingredient resolution contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-008 transforms mixed linked/freeform inputs into stable ordered resolved output.

- **Integration Scenario: ITS-008-A1**
    - **Given** ARCH-004 sends ingredient items with mixed `linked` and `freeform` kinds to ARCH-008
    - **When** ARCH-008 resolves IDs and normalizes quantities
    - **Then** ARCH-008 returns ordered `resolved[]` to ARCH-004 with `inputIndex` aligned to request order

#### Test Case: ITP-008-B (missing linked ingredient contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies boundary error contract for unresolved linked ingredient IDs.

- **Integration Scenario: ITS-008-B1**
    - **Given** ARCH-004 sends an item with `kind="linked"` and unknown ingredient id to ARCH-008
    - **When** ARCH-008 queries lookup dependency through ARCH-024 and cannot resolve
    - **Then** the interface between ARCH-008 and ARCH-004 returns `INGREDIENT_NOT_FOUND` with `{ inputIndex, attemptedId }`

#### Test Case: ITP-008-C (ingredient data-flow continuity)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies resolved ingredient payload can feed downstream nutrition and persistence seams.

- **Integration Scenario: ITS-008-C1**
    - **Given** ARCH-004 sends ingredient chain inputs to ARCH-008
    - **When** ARCH-008 emits `resolved[]` to ARCH-004 and ARCH-009
    - **Then** data flowing from ARCH-008 to ARCH-009 preserves normalized quantity units and ingredient identifiers

#### Test Case: ITP-008-D (parallel ingredient resolution isolation)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent ingredient resolution calls keep per-request `resolved[]` state and `inputIndex` alignment isolated.

- **Integration Scenario: ITS-008-D1**
    - **Given** two ARCH-004 save paths concurrently send distinct ingredient arrays to ARCH-008
    - **When** ARCH-008 resolves linked/freeform items for both requests in parallel
    - **Then** each response preserves request-local `resolved[]` ordering and correct `inputIndex` mapping without cross-request contamination

### Module: ARCH-009: Nutrition Calculator

#### Test Case: ITP-009-A (nutrition aggregate contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-009 aggregate output schema consumed by ARCH-004 and UI responders.

- **Integration Scenario: ITS-009-A1**
    - **Given** ARCH-008 sends resolved ingredient items to ARCH-009
    - **When** ARCH-009 computes per-serving and per-recipe aggregates
    - **Then** ARCH-009 returns `{ perServing, perRecipe, missingItems[] }` to ARCH-004 with missing indexes bounded to unresolved nutrition inputs

#### Test Case: ITP-009-B (unit conversion fault contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies ARCH-009 returns bounded 422 contract for non-convertible unit seams.

- **Integration Scenario: ITS-009-B1**
    - **Given** ARCH-008 sends resolved item units that cannot convert to nutrition base unit
    - **When** ARCH-009 performs quantity conversion
    - **Then** the interface between ARCH-009 and ARCH-004 returns `UNIT_INCONVERTIBLE` with `{ inputIndex, fromUnit, toUnit }`

#### Test Case: ITP-009-C (parallel nutrition calculation isolation)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent nutrition calculations do not share intermediate conversion state across recipe payloads.

- **Integration Scenario: ITS-009-C1**
    - **Given** ARCH-004 concurrently sends two resolved ingredient payloads for different recipes to ARCH-009
    - **When** ARCH-009 performs unit conversions and aggregate calculations in parallel
    - **Then** each result contract remains scoped to its originating payload with no leaked intermediate conversion state

### Module: ARCH-010: Recipe Search Service

#### Test Case: ITP-010-A (search service response contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-010 response envelope to ARCH-003 including pagination and latency fields.

- **Integration Scenario: ITS-010-A1**
    - **Given** ARCH-003 sends `SearchQueryDto` and principal scope to ARCH-010
    - **When** ARCH-010 receives rows from ARCH-024 via ARCH-011 plan
    - **Then** ARCH-010 returns `{ items[], page, totalPages, latencyMs }` to ARCH-003 with `pageSize ≤ 100`

#### Test Case: ITP-010-B (search timeout contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies timeout error propagation from query path to caller boundary.

- **Integration Scenario: ITS-010-B1**
    - **Given** ARCH-010 sends a planned query to ARCH-024 and the query exceeds configured timeout (timeout=5000ms ±100ms)
    - **When** ARCH-010 handles the timeout boundary
    - **Then** the interface between ARCH-010 and ARCH-003 returns `SEARCH_TIMEOUT` with `{ code, queryHash }`

#### Test Case: ITP-010-C (search query data-flow chain)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies `SearchQueryDto` transforms to SQL and back to result envelope.

- **Integration Scenario: ITS-010-C1**
    - **Given** ARCH-026 sends filter controls that ARCH-003 forwards to ARCH-010
    - **When** ARCH-010 sends normalized query to ARCH-011 and receives rows from ARCH-024
    - **Then** data flowing from ARCH-010 to ARCH-003 preserves filter semantics and page metadata

### Module: ARCH-011: Search Query Builder

#### Test Case: ITP-011-A (parameterized SQL contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-011 emits `{ text, params[] }` parameterized SQL contract to ARCH-010/ARCH-024.

- **Integration Scenario: ITS-011-A1**
    - **Given** ARCH-010 sends normalized search filters to ARCH-011
    - **When** ARCH-011 builds the query plan
    - **Then** ARCH-011 sends parameterized `{ text, params[] }` to ARCH-024 with no string interpolation placeholders outside params

#### Test Case: ITP-011-B (invalid filter rejection contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies whitelist enforcement at ARCH-011 boundary.

- **Integration Scenario: ITS-011-B1**
    - **Given** ARCH-010 sends a filter key outside whitelist to ARCH-011 (malformed filter: invalid field name, e.g., `{"invalidField": "value"}`)
    - **When** ARCH-011 validates filter keys
    - **Then** the interface between ARCH-011 and ARCH-010 returns `INVALID_FILTER` with offending `field`

#### Test Case: ITP-011-C (search planning data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies normalized query transforms into executable SQL plan for repository.

- **Integration Scenario: ITS-011-C1**
    - **Given** ARCH-010 sends `NormalizedSearchQuery` to ARCH-011
    - **When** ARCH-011 emits SQL plan to ARCH-024
    - **Then** data flowing from ARCH-011 to ARCH-024 includes aligned parameter positions and matching filter cardinality

### Module: ARCH-012: Photo Presign Service

#### Test Case: ITP-012-A (presign response contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-012 contract to ARCH-003/ARCH-026 includes URL, fields, key, and bounded expiry.

- **Integration Scenario: ITS-012-A1**
    - **Given** ARCH-003 sends `{ recipeId, mime, sizeBytes }` to ARCH-012
    - **When** ARCH-012 signs upload via ARCH-025 and records presigned row through ARCH-024
    - **Then** ARCH-012 returns `{ url, fields, key, expiresAt }` to ARCH-003 with expiry inside configured window

#### Test Case: ITP-012-B (upload quota fault contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies throttling and retry-after contract when quota is exceeded.

- **Integration Scenario: ITS-012-B1**
    - **Given** ARCH-003 sends a presign request to ARCH-012 after per-user quota is exhausted
    - **When** ARCH-012 evaluates quota limits
    - **Then** the interface between ARCH-012 and ARCH-003 returns `UPLOAD_QUOTA_EXCEEDED` with `{ code, retryAfter }`

#### Test Case: ITP-012-C (photo upload data-flow stage contract)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies stage-2 output from photo chain feeds direct S3 upload and confirm stage.

- **Integration Scenario: ITS-012-C1**
    - **Given** ARCH-026 sends file metadata to ARCH-012 through ARCH-003
    - **When** ARCH-012 emits presign contract and key
    - **Then** data flowing from ARCH-012 to ARCH-026 and ARCH-013 preserves identical object key reference

### Module: ARCH-013: Photo Confirm Service

#### Test Case: ITP-013-A (confirm response contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-013 returns `photoView` contract after magic-byte validation.

- **Integration Scenario: ITS-013-A1**
    - **Given** ARCH-003 sends `{ recipeId, key }` to ARCH-013 and key matches presign record
    - **When** ARCH-013 validates object through ARCH-025 and updates state through ARCH-024
    - **Then** ARCH-013 returns `{ photoId, key, state, mime }` with `state="confirmed"` to ARCH-003

#### Test Case: ITP-013-B (invalid upload contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies malformed/missing object contracts at confirm boundary.

- **Integration Scenario: ITS-013-B1**
    - **Given** ARCH-003 sends a confirm request with key not matching presigned ownership to ARCH-013
    - **When** ARCH-013 performs HEAD and magic-byte checks via ARCH-025
    - **Then** the interface between ARCH-013 and ARCH-003 returns `UPLOAD_INVALID` or `UPLOAD_NOT_FOUND` contract with reasoned payload

#### Test Case: ITP-013-C (confirm-to-processing data-flow seam)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies confirmed key state flows to S3 event processing path.

- **Integration Scenario: ITS-013-C1**
    - **Given** ARCH-013 stores confirmed photo key through ARCH-024
    - **When** ARCH-025 emits the corresponding ObjectCreated event consumed by ARCH-014
    - **Then** data flowing from ARCH-013 state to ARCH-014 event references the same key without mismatch

### Module: ARCH-014: Photo Processing Lambda Handler

#### Test Case: ITP-014-A (rendition processing contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-014 consumes S3 event and updates processed rendition contract via ARCH-024.

- **Integration Scenario: ITS-014-A1**
    - **Given** ARCH-025 sends S3 ObjectCreated event to ARCH-014
    - **When** ARCH-014 reads object, writes rendition keys through ARCH-025, and persists state through ARCH-024
    - **Then** ARCH-014 emits `{ photoId, renditionKeys[] }` boundary result with all rendition keys present

#### Test Case: ITP-014-B (processing failure redrive contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies retry/DLQ path on processing stage failure.

- **Integration Scenario: ITS-014-B1**
    - **Given** ARCH-014 receives an S3 event and ARCH-025 returns non-retryable write error for rendition output
    - **When** ARCH-014 signals failure for Lambda retry handling
    - **Then** the interface between ARCH-014 and invocation runtime emits `PROCESSING_FAILED` containing `{ photoId, stage }`

#### Test Case: ITP-014-C (photo chain data-flow integrity)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies object-key lineage from confirm stage to processed state persistence.

- **Integration Scenario: ITS-014-C1**
    - **Given** ARCH-013 confirmed key exists in storage and metadata tables
    - **When** ARCH-014 transforms original object and sends rendition keys to ARCH-024
    - **Then** data flowing from ARCH-014 to ARCH-024 persists `state="processed"` with key lineage tied to original object id

#### Test Case: ITP-014-D (parallel event race handling)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent S3 events for distinct keys do not cross-write photo state.

- **Integration Scenario: ITS-014-D1**
    - **Given** ARCH-025 sends concurrent ObjectCreated events for two photo keys to ARCH-014
    - **When** ARCH-014 processes both events in parallel
    - **Then** the interfaces between ARCH-014 and ARCH-024 update each photo row with its own rendition set without cross-assignment

### Module: ARCH-015: Version Snapshot Writer

#### Test Case: ITP-015-A (snapshot write contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-015 writes version + pending archive rows in caller transaction and returns IDs.

- **Integration Scenario: ITS-015-A1**
    - **Given** ARCH-004 sends `{ recipeId, snapshot, txn }` to ARCH-015
    - **When** ARCH-015 inserts `recipe_versions` and `recipe_version_pending_archives` through ARCH-024
    - **Then** ARCH-015 returns `{ versionNumber, pendingArchiveId }` to ARCH-004 with monotonic version

#### Test Case: ITP-015-B (snapshot write failure contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies DB constraint failure is surfaced as write-failed boundary contract.

- **Integration Scenario: ITS-015-B1**
    - **Given** ARCH-004 sends snapshot input to ARCH-015 and ARCH-024 returns a constraint violation
    - **When** ARCH-015 handles the repository exception
    - **Then** the interface between ARCH-015 and ARCH-004 returns `VERSION_WRITE_FAILED` and caller transaction is aborted

#### Test Case: ITP-015-C (version-archive data-flow handoff)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies snapshot payload transitions to queue message input shape.

- **Integration Scenario: ITS-015-C1**
    - **Given** ARCH-004 passes latest recipe snapshot to ARCH-015
    - **When** ARCH-015 returns `pendingArchiveId` to ARCH-004 and ARCH-017 receives enqueue input
    - **Then** data flowing from ARCH-015 to ARCH-017 contains matching `{ pendingArchiveId, recipeId, versionNumber }`

### Module: ARCH-016: Optimistic Concurrency Guard

#### Test Case: ITP-016-A (CAS success contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-016 compare-and-set success response consumed by ARCH-004.

- **Integration Scenario: ITS-016-A1**
    - **Given** ARCH-004 sends `{ table, id, expectedRowVersion }` to ARCH-016
    - **When** ARCH-016 validates expected row version against current repository state
    - **Then** ARCH-016 returns `{ ok: true, newRowVersion }` to ARCH-004

#### Test Case: ITP-016-B (CAS conflict boundary contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies stale-version rejection carries current snapshot payload.

- **Integration Scenario: ITS-016-B1**
    - **Given** ARCH-004 sends stale `expectedRowVersion` to ARCH-016
    - **When** ARCH-016 compares against newer persisted version
    - **Then** the interface between ARCH-016 and ARCH-004 returns `CONCURRENCY_CONFLICT` with `{ currentRowVersion, currentSnapshot }`

#### Test Case: ITP-016-C (CAS row-version data-flow continuity)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies `newRowVersion` from ARCH-016 propagates through ARCH-004 into ARCH-015 snapshot input and `RecipeView` response.

- **Integration Scenario: ITS-016-C1**
    - **Given** ARCH-016 returns `{ ok: true, newRowVersion }` to ARCH-004 during recipe update orchestration
    - **When** ARCH-004 forwards version state to ARCH-015 and returns `RecipeView` to ARCH-003
    - **Then** data flowing from ARCH-016 through ARCH-004 preserves `newRowVersion` in ARCH-015 snapshot input and response `rowVersion` without truncation or type coercion

#### Test Case: ITP-016-D (concurrent CAS race arbitration)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies simultaneous CAS attempts result in single winner contract.

- **Integration Scenario: ITS-016-D1**
    - **Given** two ARCH-004 update paths send identical `expectedRowVersion` to ARCH-016 concurrently
    - **When** ARCH-016 evaluates both compare-and-set operations
    - **Then** one interface returns `{ ok: true, newRowVersion }` and one returns `CONCURRENCY_CONFLICT`

### Module: ARCH-017: Archive Queue Producer

#### Test Case: ITP-017-A (queue enqueue ack contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-017 emits enqueue acknowledgement to ARCH-004 on SQS success.

- **Integration Scenario: ITS-017-A1**
    - **Given** ARCH-004 sends `{ pendingArchiveId, recipeId, versionNumber }` to ARCH-017
    - **When** ARCH-017 submits message to queue via ARCH-025/AWS adapter boundary
    - **Then** ARCH-017 returns `{ messageId, sentAt }` to ARCH-004

#### Test Case: ITP-017-B (queue send failure tolerance contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies send failures are reported without invalidating prior commit boundary.

- **Integration Scenario: ITS-017-B1**
    - **Given** ARCH-004 committed version snapshot and then sends enqueue request to ARCH-017
    - **When** the queue interface returns send failure
    - **Then** the interface between ARCH-017 and ARCH-004 returns `QUEUE_SEND_FAILED` and pending archive row remains for ARCH-019 replay

#### Test Case: ITP-017-C (archive message data-flow format)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies pending archive identifiers are serialized into SQS message contract.

- **Integration Scenario: ITS-017-C1**
    - **Given** ARCH-015 produced `{ pendingArchiveId, recipeId, versionNumber }`
    - **When** ARCH-017 serializes and sends to queue consumed by ARCH-018
    - **Then** data flowing from ARCH-017 to ARCH-018 preserves all three required identifiers

#### Test Case: ITP-017-D (post-commit enqueue concurrency)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies parallel enqueue operations remain recipe/version-scoped.

- **Integration Scenario: ITS-017-D1**
    - **Given** ARCH-004 emits concurrent enqueue requests for different pendingArchiveIds to ARCH-017
    - **When** ARCH-017 dispatches all messages to the queue
    - **Then** each queue message consumed by ARCH-018 maps to the original pendingArchiveId without duplication

#### Test Case: ITP-017-E (consumer-driven contract at SQS producer-worker seam)

**Technique**: CDCT
**Target View**: Interface View + Data Flow View
**Boundary**: ARCH-017 (producer) ↔ ARCH-018 (consumer)
**Description**: Verifies ARCH-018-authored queue contract fixtures are satisfied by ARCH-017 message serialization and runtime response shape.

- **Integration Scenario: ITS-017-E1**
    - **Given** contract fixtures authored by ARCH-018 define required SQS message body fields `{ pendingArchiveId, recipeId, versionNumber }`, JSON serialization format, and expected `batchItemFailures[]` shape for queue runtime handling
    - **When** ARCH-017 serializes enqueue payloads and ARCH-018 consumes them through the queue boundary
    - **Then** the consumer-driven contract between ARCH-017 and ARCH-018 is satisfied for required fields, field names, serialization format, and runtime failure-envelope compatibility

### Module: ARCH-018: Archive Worker Lambda

#### Test Case: ITP-018-A (archive worker processing contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-018 consumes queue messages, writes archives, and updates pending state.

- **Integration Scenario: ITS-018-A1**
    - **Given** ARCH-017 sends message with `pendingArchiveId` to queue consumed by ARCH-018
    - **When** ARCH-018 loads snapshot via ARCH-024 and writes S3 object via ARCH-025
    - **Then** ARCH-018 returns SQS batch result with empty `batchItemFailures[]` and marks pending row archived

#### Test Case: ITP-018-B (archive write failure contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies write-stage failures produce redrive-compatible contract.

- **Integration Scenario: ITS-018-B1**
    - **Given** ARCH-018 receives archive work and ARCH-025 returns S3 error on putObject
    - **When** ARCH-018 handles the storage boundary failure
    - **Then** the interface between ARCH-018 and queue runtime returns partial batch failure identifying the failed `pendingArchiveId`

#### Test Case: ITP-018-C (archive object data-flow verification)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies message input becomes `versions/{recipeId}/v{n}.json` archive object and state transition.

- **Integration Scenario: ITS-018-C1**
    - **Given** ARCH-018 receives SQS message from ARCH-017 containing `{ recipeId, versionNumber }`
    - **When** ARCH-018 serializes snapshot payload and writes archive object via ARCH-025
    - **Then** data flowing from ARCH-018 to ARCH-025 follows key format `versions/{recipeId}/v{n}.json`

#### Test Case: ITP-018-D (worker/reconciler lock race prevention)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies ARCH-018 processing and ARCH-019 re-enqueue do not double-process locked rows.

- **Integration Scenario: ITS-018-D1**
    - **Given** ARCH-018 processes a pending archive row while ARCH-019 sweep runs concurrently
    - **When** both modules access pending rows through `FOR UPDATE SKIP LOCKED`
    - **Then** concurrent access by ARCH-018 and ARCH-019 resolves with single processor ownership per row

### Module: ARCH-019: Pending Archive Reconciler

#### Test Case: ITP-019-A (reconcile report contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-019 emits `{ reEnqueued, ageHistogram }` and increments attempts contract.

- **Integration Scenario: ITS-019-A1**
    - **Given** ARCH-019 receives schedule trigger and ARCH-024 returns pending rows older than threshold
    - **When** ARCH-019 re-enqueues each row to queue consumed by ARCH-018
    - **Then** ARCH-019 returns report contract with `reEnqueued` count matching queued message count

#### Test Case: ITP-019-B (lock-lost warning contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies concurrent-runner lock loss emits bounded warning contract.

- **Integration Scenario: ITS-019-B1**
    - **Given** two schedule invocations trigger ARCH-019 for the same backlog window
    - **When** one invocation loses row lock lease
    - **Then** the interface between ARCH-019 and telemetry boundary emits `RECONCILER_LOCK_LOST` warning with safe retry semantics

#### Test Case: ITP-019-C (pending-row replay data-flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies pending-row identity is preserved from DB selection to queue replay.

- **Integration Scenario: ITS-019-C1**
    - **Given** ARCH-024 sends aged pending rows to ARCH-019
    - **When** ARCH-019 sends replay messages to queue for ARCH-018
    - **Then** data flowing from ARCH-019 to ARCH-018 preserves each `pendingArchiveId` and increments attempt metadata

#### Test Case: ITP-019-D (parallel sweep and worker ordering)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies out-of-order replay does not violate archive state machine.

- **Integration Scenario: ITS-019-D1**
    - **Given** ARCH-019 enqueues replay messages while ARCH-018 is consuming existing queue backlog
    - **When** message delivery order differs from creation order
    - **Then** ARCH-018 and ARCH-019 interfaces maintain idempotent state transitions with no premature archived marking

### Module: ARCH-020: Collection Service

#### Test Case: ITP-020-A (collection command contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-020 command contract with ARCH-003 and ARCH-024 for CRUD/membership operations.

- **Integration Scenario: ITS-020-A1**
    - **Given** ARCH-003 sends `{ kind, payload }` command to ARCH-020
    - **When** ARCH-020 executes repository operations through ARCH-024 and policy checks through ARCH-006
    - **Then** ARCH-020 returns `CollectionView` with member count and visibility contract fields to ARCH-003

#### Test Case: ITP-020-B (collection policy/not-found fault contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies ARCH-020 bounded error contracts for unavailable resources and denied visibility changes.

- **Integration Scenario: ITS-020-B1**
    - **Given** ARCH-003 sends collection mutation command to ARCH-020 for missing collection id
    - **When** ARCH-020 resolves repository and policy boundaries
    - **Then** the interface between ARCH-020 and ARCH-003 returns `NOT_FOUND` or `POLICY_DENIED` with stable `{ code, id|ruleId }`

### Module: ARCH-021: Collection Clone & Pull Service

#### Test Case: ITP-021-A (clone/pull report contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-021 clone and pull response schema and source-link requirements.

- **Integration Scenario: ITS-021-A1**
    - **Given** ARCH-003 sends clone request `{ sourceCollectionId, userId }` to ARCH-021
    - **When** ARCH-021 validates visibility via ARCH-006 and persists clone metadata via ARCH-024
    - **Then** ARCH-021 returns `{ added[], removed[], skipped[], snapshotAt }` contract aligned to pull-report schema

#### Test Case: ITP-021-B (pull lock held contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies advisory-lock contention returns deterministic 409 boundary contract.

- **Integration Scenario: ITS-021-B1**
    - **Given** one ARCH-021 pull operation holds advisory lock for `targetCollectionId`
    - **When** a second ARCH-003 request sends pull for the same target to ARCH-021
    - **Then** the interface between ARCH-021 and ARCH-003 returns `PULL_LOCK_HELD` with `targetCollectionId`

#### Test Case: ITP-021-C (pull reconciliation data-flow chain)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies snapshot diff data flows to single-TX membership updates in ARCH-024.

- **Integration Scenario: ITS-021-C1**
    - **Given** ARCH-021 loads source and target snapshots from ARCH-024
    - **When** ARCH-021 computes `PullPlan` and sends it to ARCH-024
    - **Then** data flowing from ARCH-021 to ARCH-024 applies add/remove/skipped sets without overwriting user-added members

#### Test Case: ITP-021-D (concurrent pull race control)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies advisory lock enforces single active pull per target collection.

- **Integration Scenario: ITS-021-D1**
    - **Given** ARCH-026 and ARCH-027 trigger pull for the same target collection concurrently through ARCH-003
    - **When** both requests reach ARCH-021 lock boundary
    - **Then** exactly one interface path proceeds and one path returns `PULL_LOCK_HELD`

### Module: ARCH-022: GDPR Erasure Orchestrator

#### Test Case: ITP-022-A (erasure job lifecycle contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-022 enqueues/leases/completes jobs and exposes stateful `jobView` contract.

- **Integration Scenario: ITS-022-A1**
    - **Given** admin trigger sends `{ userId, requestedBy, reason }` to ARCH-022
    - **When** ARCH-022 creates or retrieves job and coordinates purge via ARCH-024 and ARCH-023
    - **Then** ARCH-022 returns `{ jobId, state, createdAt, completedAt? }` with state in allowed enum

#### Test Case: ITP-022-B (erasure stage failure contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies failed stage reporting at orchestrator boundaries.

- **Integration Scenario: ITS-022-B1**
    - **Given** ARCH-022 leased a job and ARCH-023 returns partial purge warning
    - **When** ARCH-022 updates ledger state for retry progression
    - **Then** the interface between ARCH-022 and job ledger contract records `ERASURE_FAILED` with `{ jobId, stage }`

#### Test Case: ITP-022-C (RDS-before-S3 purge data flow)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies inventory and purge report transformations across orchestrator, repository, and storage purger.

- **Integration Scenario: ITS-022-C1**
    - **Given** ARCH-022 leases job and sends inventory purge operations to ARCH-024 and user storage purge to ARCH-023
    - **When** ARCH-023 returns `{ deletedCount, retriedCount }`
    - **Then** data flowing from ARCH-022 to ARCH-023 and back transitions job state to `completed` only after both boundaries succeed

#### Test Case: ITP-022-D (job leasing concurrency)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies `FOR UPDATE SKIP LOCKED` lease semantics prevent duplicate erasure processing.

- **Integration Scenario: ITS-022-D1**
    - **Given** two ARCH-022 worker ticks run concurrently against `account_erasure_jobs`
    - **When** both request next job lease from ARCH-024
    - **Then** concurrent access by ARCH-022 workers yields unique leased job ownership with no duplicate purge dispatch

#### Test Case: ITP-022-E (consumer-driven contract at erasure orchestrator-purger seam)

**Technique**: CDCT
**Target View**: Interface View + Data Flow View
**Boundary**: ARCH-022 (producer) ↔ ARCH-023 (consumer)
**Description**: Verifies ARCH-023-authored purge contract fixtures are satisfied by ARCH-022 request shape and ARCH-023 response semantics.

- **Integration Scenario: ITS-022-E1**
    - **Given** contract fixtures authored by ARCH-023 define required `{ userId }` input, prefix resolution behavior, and `{ deletedCount, retriedCount, remaining[] }` response including partial-failure semantics
    - **When** ARCH-022 invokes ARCH-023 storage purge boundary for leased erasure jobs
    - **Then** the consumer-driven contract between ARCH-022 and ARCH-023 is satisfied for request schema, response fields, and partial-failure behavior

### Module: ARCH-023: Erasure Storage Purger

#### Test Case: ITP-023-A (storage purge report contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-023 lists and deletes user prefixes via ARCH-025 and returns purge report.

- **Integration Scenario: ITS-023-A1**
    - **Given** ARCH-022 sends `{ userId }` to ARCH-023
    - **When** ARCH-023 performs list and batch delete calls through ARCH-025 for photos and versions prefixes
    - **Then** ARCH-023 returns `{ deletedCount, retriedCount }` to ARCH-022

#### Test Case: ITP-023-B (partial purge warning contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies partial deletion boundary emits warning contract with remaining keys.

- **Integration Scenario: ITS-023-B1**
    - **Given** ARCH-023 sends delete batch to ARCH-025 and subset delete operations fail
    - **When** ARCH-023 finalizes purge attempt for ARCH-022
    - **Then** the interface between ARCH-023 and ARCH-022 returns `STORAGE_PURGE_PARTIAL` with `remaining[]`

#### Test Case: ITP-023-C (prefix purge data-flow correctness)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies `{ userId }` maps to required photos/versions prefixes across storage boundary.

- **Integration Scenario: ITS-023-C1**
    - **Given** ARCH-022 sends erasure request for user id to ARCH-023
    - **When** ARCH-023 computes prefixes and dispatches calls to ARCH-025
    - **Then** data flowing from ARCH-023 to ARCH-025 uses `users/{userId}/photos/` and `users/{userId}/versions/` paths

#### Test Case: ITP-023-D (parallel batch purge contention)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies parallel purge batches preserve per-user key partitioning.

- **Integration Scenario: ITS-023-D1**
    - **Given** ARCH-022 dispatches concurrent erasure operations for different user ids to ARCH-023
    - **When** ARCH-023 issues batch deletes through ARCH-025 in parallel
    - **Then** concurrent access to storage prefixes by ARCH-023 operations resolves without cross-user key deletion

### Module: ARCH-024: Drizzle Repository Layer

#### Test Case: ITP-024-A (typed repository contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies typed method interfaces and row contracts consumed by service modules.

- **Integration Scenario: ITS-024-A1**
    - **Given** ARCH-004 sends transactional repository calls with typed payloads to ARCH-024
    - **When** ARCH-024 executes queries and returns entity rows
    - **Then** the interface between ARCH-024 and ARCH-004 returns typed rows with no `any` contract holes

#### Test Case: ITP-024-B (database failure contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies DB outages and constraint failures are surfaced with bounded error contracts.

- **Integration Scenario: ITS-024-B1**
    - **Given** ARCH-018 requests pending archive row from ARCH-024 while DB connection is unavailable
    - **When** ARCH-024 fails to execute query
    - **Then** the interface between ARCH-024 and ARCH-018 returns `DB_UNAVAILABLE` or `DB_CONSTRAINT` contract as applicable

#### Test Case: ITP-024-C (cross-flow data transformation integrity)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies repository seam preserves field mapping across save, search, archive, and erasure chains.

- **Integration Scenario: ITS-024-C1**
    - **Given** ARCH-011 sends parameterized SQL and ARCH-015 sends snapshot inserts to ARCH-024
    - **When** ARCH-024 executes both chains in sequence
    - **Then** data flowing from ARCH-024 to ARCH-010 and ARCH-018 preserves IDs, version numbers, and pagination totals accurately

#### Test Case: ITP-024-D (transaction and lock concurrency)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent transactional calls and `SKIP LOCKED` semantics across worker/orchestrator paths.

- **Integration Scenario: ITS-024-D1**
    - **Given** ARCH-018 and ARCH-019 concurrently request pending rows and ARCH-022 workers concurrently lease erasure jobs through ARCH-024
    - **When** ARCH-024 applies transaction isolation and row locks
    - **Then** concurrent access by module pairs resolves with no double-lease and no deadlock exposure

### Module: ARCH-025: S3 & CloudFront Adapter

#### Test Case: ITP-025-A (storage adapter method contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies typed adapter contracts for `putObject`, `signUrl`, `headObject`, and `deleteObjects`.

- **Integration Scenario: ITS-025-A1**
    - **Given** ARCH-012, ARCH-013, ARCH-014, ARCH-018, and ARCH-023 send typed storage operations to ARCH-025
    - **When** ARCH-025 executes each operation using enforced bucket/key conventions
    - **Then** ARCH-025 returns typed method results with UTC ISO-8601 timestamps where defined

#### Test Case: ITP-025-B (S3 error/throttle contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies non-retryable and throttled AWS errors map to explicit boundary contracts.

- **Integration Scenario: ITS-025-B1**
    - **Given** ARCH-018 sends archive putObject request to ARCH-025 and S3 returns throttling response
    - **When** ARCH-025 maps the AWS error to adapter contract
    - **Then** the interface between ARCH-025 and ARCH-018 returns `S3_THROTTLED` with `retryAfter` and key context

#### Test Case: ITP-025-C (key-path data flow contract)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies key naming conventions across photo, version archive, and erasure flows.

- **Integration Scenario: ITS-025-C1**
    - **Given** ARCH-012 generates upload key and ARCH-018 generates archive key inputs for ARCH-025
    - **When** ARCH-025 signs or writes objects
    - **Then** data flowing from caller modules to ARCH-025 preserves required key prefixes and version segments

#### Test Case: ITP-025-D (parallel storage operation isolation)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent adapter calls from multiple modules do not interleave key contracts.

- **Integration Scenario: ITS-025-D1**
    - **Given** ARCH-014 rendition writes and ARCH-023 delete batches execute concurrently through ARCH-025
    - **When** ARCH-025 processes both operation streams in parallel
    - **Then** concurrent access to storage APIs by ARCH-014 and ARCH-023 resolves without key-space collision

### Module: ARCH-026: Web Recipe & Collection UI

#### Test Case: ITP-026-A (web-to-api request contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-026 emits authenticated JSON contracts expected by ARCH-003.

- **Integration Scenario: ITS-026-A1**
    - **Given** ARCH-026 has a Clerk session token and validated recipe payload
    - **When** ARCH-026 sends API request to ARCH-003
    - **Then** the interface between ARCH-026 and ARCH-003 includes bearer token and DTO-conformant JSON body

#### Test Case: ITP-026-B (conflict payload fault rendering contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies ARCH-026 consumes 409 conflict contract from ARCH-003/ARCH-028 boundary.

- **Integration Scenario: ITS-026-B1**
    - **Given** ARCH-003 returns `CONCURRENCY_CONFLICT` payload to ARCH-026
    - **When** ARCH-026 processes response contract fields
    - **Then** the interface between ARCH-026 and ARCH-003 preserves `{ currentRowVersion, currentSnapshot }` for downstream resolution action dispatch

#### Test Case: ITP-026-C (web save/search data-flow serialization)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies web payload shapes across save and search chains.

- **Integration Scenario: ITS-026-C1**
    - **Given** ARCH-026 prepares `UpdateRecipeRequest` and `SearchQueryDto`
    - **When** ARCH-026 sends these payloads to ARCH-003
    - **Then** data flowing from ARCH-026 to ARCH-003 preserves required schema fields consumed by ARCH-005 and ARCH-010

#### Test Case: ITP-026-D (parallel web requests race behavior)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies simultaneous web requests maintain independent correlation and response contracts.

- **Integration Scenario: ITS-026-D1**
    - **Given** ARCH-026 sends concurrent update and photo-presign requests to ARCH-003
    - **When** ARCH-003 routes to ARCH-004 and ARCH-012 concurrently
    - **Then** responses returned to ARCH-026 keep endpoint-specific contract envelopes without correlation mix-up

#### Test Case: ITP-026-E (consumer-driven contract at UI-API seam)

**Technique**: CDCT
**Target View**: Interface View + Data Flow View
**Boundary**: ARCH-003 (producer) ↔ ARCH-026 (consumer)
**Description**: Verifies consumer-driven contract expectations from ARCH-026 are enforced on ARCH-003 HTTP response and error envelope shape.

- **Integration Scenario: ITS-026-E1**
    - **Given** contract fixtures authored by ARCH-026 define expected success/error payload fields for recipe update and search endpoints exposed by ARCH-003
    - **When** ARCH-026 invokes authenticated API requests and receives responses from ARCH-003
    - **Then** the consumer-driven contract between ARCH-003 and ARCH-026 is satisfied for status codes, response body schema, and conflict payload fields

### Module: ARCH-027: Mobile Recipe & Collection UI

#### Test Case: ITP-027-A (mobile-to-api request contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-027 emits authenticated request contracts equivalent to web parity.

- **Integration Scenario: ITS-027-A1**
    - **Given** ARCH-027 loads bearer token from secure storage and validates payload
    - **When** ARCH-027 sends API request to ARCH-003
    - **Then** the interface between ARCH-027 and ARCH-003 carries token + JSON contract equivalent to ARCH-026 boundary

#### Test Case: ITP-027-B (mobile conflict/error contract handling)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies mobile client consumes mapped errors without contract field loss.

- **Integration Scenario: ITS-027-B1**
    - **Given** ARCH-003 returns mapped error payload from ARCH-028 to ARCH-027
    - **When** ARCH-027 parses the error response contract
    - **Then** the interface between ARCH-027 and ARCH-003 preserves `code` and `details` fields required for mobile conflict flow

#### Test Case: ITP-027-C (mobile data-flow serialization)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies mobile-generated payloads align with DTO and search flow contracts.

- **Integration Scenario: ITS-027-C1**
    - **Given** ARCH-027 prepares save and search payloads for ARCH-003
    - **When** ARCH-027 sends payloads over mobile API boundary
    - **Then** data flowing from ARCH-027 to ARCH-003 is transformed into valid DTO/query structures used by ARCH-005 and ARCH-010

#### Test Case: ITP-027-D (mobile concurrent request isolation)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent mobile interactions produce deterministic module responses.

- **Integration Scenario: ITS-027-D1**
    - **Given** ARCH-027 sends concurrent collection pull and recipe update requests to ARCH-003
    - **When** ARCH-003 dispatches to ARCH-021 and ARCH-004 concurrently
    - **Then** response contracts returned to ARCH-027 remain scoped to originating request/route pair

#### Test Case: ITP-027-E (consumer-driven contract at mobile UI-API seam)

**Technique**: CDCT
**Target View**: Interface View + Data Flow View
**Boundary**: ARCH-003 (producer) ↔ ARCH-027 (consumer)
**Description**: Verifies ARCH-027-authored contract expectations for bearer token format, response schema parity, conflict payloads, and mobile error codes are enforced at the boundary.

- **Integration Scenario: ITS-027-E1**
    - **Given** contract fixtures authored by ARCH-027 define required session-token format from `@clerk/expo`, success/error response envelope schema parity with web, conflict fields `{ currentRowVersion, currentSnapshot }`, and mobile-specific error code handling
    - **When** ARCH-027 sends authenticated API requests to ARCH-003 and receives success/conflict/error responses
    - **Then** the consumer-driven contract between ARCH-003 and ARCH-027 is satisfied for auth token shape, response schema parity, conflict payload fields, and mobile error-code mapping

### Module: ARCH-028: API Error Mapper

#### Test Case: ITP-028-A (error mapping contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-028 maps domain errors into stable `{ code, message, details?, traceId }` HTTP contract.

- **Integration Scenario: ITS-028-A1**
    - **Given** ARCH-003 forwards thrown domain errors from ARCH-004/005/002 to ARCH-028
    - **When** ARCH-028 maps the error boundary
    - **Then** ARCH-028 returns stable HTTP error envelope with deterministic `code` and optional `details`

#### Test Case: ITP-028-B (unknown error fallback contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies fallback 500 mapping for untyped exceptions.

- **Integration Scenario: ITS-028-B1**
    - **Given** ARCH-003 sends an unknown `Error` subtype to ARCH-028
    - **When** ARCH-028 cannot match a domain-specific code
    - **Then** the interface between ARCH-028 and ARCH-003 returns fallback 500 contract without throwing new boundary exceptions

#### Test Case: ITP-028-C (traceId data-flow propagation)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies `traceId` from ARCH-030 is preserved through ARCH-028 envelope and delivered to ARCH-026/ARCH-027 consumers.

- **Integration Scenario: ITS-028-C1**
    - **Given** ARCH-030 injects correlation `traceId` into request context forwarded through ARCH-003 to ARCH-028
    - **When** ARCH-028 maps a domain error into `{ code, message, details?, traceId }`
    - **Then** data flowing from ARCH-028 to ARCH-026 and ARCH-027 preserves `traceId` exactly with no truncation or omission

#### Test Case: ITP-028-D (parallel error mapping consistency)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent errors from different request paths map consistently.

- **Integration Scenario: ITS-028-D1**
    - **Given** ARCH-003 concurrently forwards `VALIDATION_FAILED` and `CONCURRENCY_CONFLICT` errors to ARCH-028
    - **When** ARCH-028 maps both boundaries in parallel
    - **Then** each mapped response preserves its originating error code and status contract without crossover

### Module: ARCH-029: Config Loader

#### Test Case: ITP-029-A (typed config contract to module wiring)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-029 provides immutable typed config tokens consumed by ARCH-033 and service modules.

- **Integration Scenario: ITS-029-A1**
    - **Given** ARCH-033 requests configuration tokens from ARCH-029 at bootstrap
    - **When** ARCH-029 validates environment values with schema rules
    - **Then** ARCH-029 returns typed frozen config objects to ARCH-033 with expected API/web/mobile defaults

#### Test Case: ITP-029-B (invalid config startup failure contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies invalid environment values produce startup failure contract.

- **Integration Scenario: ITS-029-B1**
    - **Given** ARCH-033 sends bootstrap request to ARCH-029 with missing required environment fields
    - **When** ARCH-029 performs schema validation
    - **Then** the interface between ARCH-029 and ARCH-033 returns `CONFIG_INVALID` with `fieldErrors[]` and startup stops

#### Test Case: ITP-029-C (concurrent immutable config read contract)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies post-bootstrap concurrent reads from ARCH-029 return identical immutable config token values.

- **Integration Scenario: ITS-029-C1**
    - **Given** ARCH-029 has produced frozen config tokens consumed by ARCH-033 and runtime providers
    - **When** concurrent request handlers read the same config tokens through resolved providers
    - **Then** each read returns identical immutable values and no caller can mutate shared config state

### Module: ARCH-030: Telemetry & Logger

#### Test Case: ITP-030-A (structured telemetry contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-030 accepts structured events from services and emits sink-compatible records.

- **Integration Scenario: ITS-030-A1**
    - **Given** ARCH-018 sends success/failure archive metrics and logs to ARCH-030
    - **When** ARCH-030 enriches events with correlation id and sink metadata
    - **Then** the interface between ARCH-030 and downstream sinks emits structured JSON records without PII fields

#### Test Case: ITP-030-B (telemetry sink data-flow continuity)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies correlation IDs emitted by ARCH-030 appear in sink records consumed by ARCH-031 alarm evaluation.

- **Integration Scenario: ITS-030-B1**
    - **Given** ARCH-018 emits archive telemetry events to ARCH-030 with correlation metadata
    - **When** ARCH-030 forwards structured telemetry to CloudWatch/Sentry sinks and ARCH-031 consumes derived metrics/events
    - **Then** data flowing from ARCH-030 to sink-consumed records preserves correlation identifiers and required metric dimensions used by ARCH-031

#### Test Case: ITP-030-C (sink unavailability fault-tolerance contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies sink outages are swallowed by ARCH-030 and no exception is propagated to caller modules.

- **Integration Scenario: ITS-030-C1**
    - **Given** ARCH-018 sends telemetry/log events to ARCH-030 while CloudWatch/Sentry sink boundary is unavailable
    - **When** ARCH-030 attempts sink emission and receives sink-side error
    - **Then** the interface between ARCH-030 and ARCH-018 returns no propagated exception while recording bounded internal sink-failure telemetry

### Module: ARCH-031: Archive Backlog Alarm

#### Test Case: ITP-031-A (alarm threshold contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-031 consumes metrics from ARCH-030 and evaluates backlog/failure thresholds.

- **Integration Scenario: ITS-031-A1**
    - **Given** ARCH-030 sends backlog depth and oldest-age metrics sourced from ARCH-018/019 to ARCH-031
    - **When** ARCH-031 evaluates configured threshold rules
    - **Then** ARCH-031 emits alarm state transition contract to notification boundary when thresholds are breached

#### Test Case: ITP-031-B (missing metric fault tolerance contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies ARCH-031 handles incomplete metric updates without invalid alarm payloads.

- **Integration Scenario: ITS-031-B1**
    - **Given** ARCH-030 sends metric update to ARCH-031 missing one expected dimension
    - **When** ARCH-031 processes the incomplete metric envelope
    - **Then** the interface between ARCH-031 and alarm sink retains valid alarm schema and rejects malformed transition payload

### Module: ARCH-032: CI & Test Governance Harness

#### Test Case: ITP-032-A (CI gate execution contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-032 runs required check categories and returns deterministic pass/fail exit contract.

- **Integration Scenario: ITS-032-A1**
    - **Given** CI invocation sends `typecheck`, `lint`, `format:check`, `test`, and `test:e2e` tasks to ARCH-032
    - **When** ARCH-032 executes pipeline against configured toolchain and LocalStack dependencies
    - **Then** ARCH-032 returns exit code `0` only when all check interfaces report success

#### Test Case: ITP-032-B (gate failure propagation contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies failing check category propagates merge-blocking CI contract.

- **Integration Scenario: ITS-032-B1**
    - **Given** CI invocation sends test suite to ARCH-032 and one check category fails
    - **When** ARCH-032 aggregates check results
    - **Then** the interface between ARCH-032 and merge gate returns `CI_GATE_FAILED` with non-zero exit code

### Module: ARCH-033: NestJS Module Wiring

#### Test Case: ITP-033-A (bootstrap wiring contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies ARCH-033 resolves provider graph across guards, filters, services, adapters, and config tokens.

- **Integration Scenario: ITS-033-A1**
    - **Given** bootstrap invokes ARCH-033 with modules requiring ARCH-029 config and ARCH-028/002/003 providers
    - **When** ARCH-033 composes and resolves dependency tokens
    - **Then** ARCH-033 returns running application contract with all required providers bound

#### Test Case: ITP-033-B (dependency resolution fault contract)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies unresolved provider token produces startup failure contract.

- **Integration Scenario: ITS-033-B1**
    - **Given** ARCH-033 attempts bootstrap with a missing provider token required by ARCH-003
    - **When** dependency resolution is executed
    - **Then** the interface between ARCH-033 and startup runtime returns `DI_RESOLUTION_FAILED` with trace payload

#### Test Case: ITP-033-C (post-bootstrap provider graph concurrency stability)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies concurrent request handling does not mutate resolved provider graph after bootstrap.

- **Integration Scenario: ITS-033-C1**
    - **Given** ARCH-033 has completed bootstrap and resolved provider graph for guards, services, and filters
    - **When** concurrent requests execute across ARCH-003/004/028 boundaries using shared providers
    - **Then** provider resolution remains stable and no runtime path mutates provider bindings post-bootstrap

## Test Harness & Mocking Strategy

| Test Scope                                                                                                                                        | External Dependency                                                                                         | Mock/Stub Strategy                                                                                                   | Rationale                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| API route and command seams (ARCH-001..006, 028, 033)                                                                                             | Clerk session-token verification (`@clerk/backend` `verifyToken` + `CLERK_JWT_KEY`), Nest bootstrap runtime | Test `CLERK_JWT_KEY` keypair signing fixture tokens + DI token resolver                                              | Deterministic auth/wiring behavior; networkless verification needs no live key endpoint                   |
| Recipe persistence seams (ARCH-004, 015, 016, 024)                                                                                                | PostgreSQL via Drizzle                                                                                      | Transactional test DB + fault-injection hooks on repository methods                                                  | Verify commit/CAS/error contracts and lock behavior                                                       |
| Search seams (ARCH-010, 011, 024)                                                                                                                 | PostgreSQL full-text indexes                                                                                | Seeded fixture dataset + SQL plan assertions                                                                         | Validate filter contracts and latency envelope fields                                                     |
| Photo upload seams (ARCH-012, 013, 014, 025)                                                                                                      | S3, ObjectCreated events                                                                                    | LocalStack S3 + signed URL simulator + event fixture generator                                                       | Preserve key/mime/magic-byte boundary realism                                                             |
| Archive async seams (ARCH-017, 018, 019, 025, 030, 031)                                                                                           | SQS, S3, CloudWatch metrics                                                                                 | LocalStack queues/buckets + deterministic clock + metric sink spy                                                    | Validate redrive/DLQ/alarm contracts and concurrency behavior                                             |
| Collection clone/pull seams (ARCH-020, 021, 024, 006)                                                                                             | DB advisory locks                                                                                           | Integration DB with lock-session harness                                                                             | Exercise pull-lock contention and deterministic pull report contracts                                     |
| GDPR seams (ARCH-022, 023, 024, 025, 030)                                                                                                         | DB + S3 deletion APIs                                                                                       | LocalStack storage purger stubs + idempotent ledger fixtures                                                         | Validate RDS-before-S3 sequencing and partial purge handling                                              |
| Client boundary seams (ARCH-026, 027 ↔ ARCH-003)                                                                                                  | Auth token providers, network transport                                                                     | Mock token providers + HTTP contract harness                                                                         | Verify mobile/web parity and conflict payload consumption                                                 |
| Consumer-driven contract seams (ARCH-003↔ARCH-004, ARCH-004↔ARCH-024, ARCH-003↔ARCH-026, ARCH-003↔ARCH-027, ARCH-017↔ARCH-018, ARCH-022↔ARCH-023) | HTTP/service and queue/storage producer-consumer boundaries                                                 | Versioned contract fixtures in `tests/contracts/` + custom TypeScript CDCT verifier in CI (`npm run test:contracts`) | Execute consumer-authored fixtures deterministically, prevent producer schema drift across all CDCT seams |
| CI governance seam (ARCH-032)                                                                                                                     | Turborepo, lint/type/test tools                                                                             | Pipeline executor stub + per-check fail toggles                                                                      | Validate merge-blocking contract and category aggregation                                                 |

Test data management uses deterministic fixture factories keyed by module boundary contracts (`principal`, `UpdateRecipeCommand`, `SearchQueryDto`, `pendingArchiveId`, `jobId`). Fault-injection fixtures explicitly target Interface View exception codes and Process View timing/ordering seams.

---

## Coverage Summary

| Metric                            | Count            |
| --------------------------------- | ---------------- |
| Total Architecture Modules (ARCH) | 33               |
| Total Test Cases (ITP)            | 117              |
| Total Scenarios (ITS)             | 117              |
| Modules with ≥1 ITP               | 33 / 33 (100%)   |
| Test Cases with ≥1 ITS            | 117 / 117 (100%) |
| **Overall Coverage (ARCH→ITP)**   | **100%**         |

### Technique Distribution

| Technique                               | Test Cases | Percentage |
| --------------------------------------- | ---------- | ---------- |
| Interface Contract Testing              | 33         | 28.2%      |
| Data Flow Testing                       | 25         | 21.4%      |
| Interface Fault Injection               | 32         | 27.4%      |
| Concurrency & Race Condition Testing    | 21         | 17.9%      |
| Consumer-Driven Contract Testing (CDCT) | 6          | 5.1%       |

## Peer-Review Remediation Log

| Finding ID  | Action Taken                                                                                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-ITP-001 | Added `ITP-027-E` (CDCT) with boundary `ARCH-003 ↔ ARCH-027`, including fixtures for session-token format (`@clerk/expo`), web-parity response envelope, conflict payload fields (`currentRowVersion`, `currentSnapshot`), and mobile-specific error-code handling. |
| PRF-ITP-002 | Added `ITP-017-E` (CDCT) with boundary `ARCH-017 ↔ ARCH-018`, covering required SQS message fields, JSON serialization format, and `batchItemFailures[]` runtime contract shape.                                                                                    |
| PRF-ITP-003 | Added `ITP-007-B` (Data Flow) for `changedFields[]`/`isSubstantive` propagation into ARCH-006 context and `ITP-007-C` (Concurrency) for isolated concurrent comparisons.                                                                                            |
| PRF-ITP-004 | Added `ITP-030-B` (Data Flow) for correlation-id continuity to sink records consumed by ARCH-031 and `ITP-030-C` (Fault Injection) validating sink unavailability does not propagate exceptions to callers.                                                         |
| PRF-ITP-005 | Added `ITP-006-C` (Data Flow) verifying `{ allowed, reason, ruleId }` continuity from ARCH-006 to ARCH-004/ARCH-021, including `ruleId` audit preservation.                                                                                                         |
| PRF-ITP-006 | Added `ITP-016-C` (Data Flow) verifying `newRowVersion` propagation from ARCH-016 through ARCH-004 into ARCH-015 snapshot input and `RecipeView` output.                                                                                                            |
| PRF-ITP-007 | Added `ITP-028-C` (Data Flow) verifying `traceId` propagation from ARCH-030 through ARCH-028 to ARCH-026/ARCH-027 response consumers.                                                                                                                               |
| PRF-ITP-008 | Added `ITP-008-D` (Concurrency) for per-request `resolved[]`/`inputIndex` isolation and `ITP-009-C` (Concurrency) for nutrition-calculation isolation across concurrent payloads.                                                                                   |
| PRF-ITP-009 | Added `ITP-022-E` (CDCT) with boundary `ARCH-022 ↔ ARCH-023`, including `{ userId }` input fixture, prefix resolution behavior, and `{ deletedCount, retriedCount, remaining[] }` response with partial-failure semantics.                                          |
| PRF-ITP-010 | Updated Technique Distribution percentages to sum to exactly 100.0%.                                                                                                                                                                                                |
| PRF-ITP-011 | Added Test Harness row for CDCT seams specifying fixture format/location (`tests/contracts/`) and execution mechanism (`npm run test:contracts`).                                                                                                                   |
| PRF-ITP-012 | Added low-priority concurrency coverage via `ITP-029-C` (immutable config reads) and `ITP-033-C` (post-bootstrap provider graph immutability).                                                                                                                      |

## Uncovered Modules

None — full coverage achieved.
