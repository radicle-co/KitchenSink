# Unit Test Plan: Commise Recipe App

**Feature Branch**: `001-commise-recipe-app`
**Created**: 2026-05-02
**Last Updated**: 2026-07-06 (reconciliation pass: realigned Target Source File paths to the canonical `packages/<category>/<name>` layout — recipe backend → `packages/services/recipe-service`, worker Lambdas → `packages/services/recipe-workers/src/{photo-processor,version-archive-worker}`; prior: 2026-05-08 PRF-UTP-001 remediation)
**Status**: Draft
**Source**: `specs/001-commise-recipe-app/v-model/module-design.md`

## Overview

This document defines ISO 29119-4 white-box unit tests for all module designs in `module-design.md`.
Every non-`[EXTERNAL]` module (`MOD-NNN`) has at least one unit test case (`UTP-NNN-X`), and every test
case has at least one executable unit scenario (`UTS-NNN-X#`) in Arrange/Act/Assert form.

Unit tests verify internal code behavior (branches, variable boundaries, enum/boolean partitions, dependency
isolation, and state transitions where applicable). They do not verify user journeys or module integration boundaries.

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}`
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}`
- Example: `UTS-004-A1` → scenario under `UTP-004-A` for `MOD-004`.
- `ARCH-NNN` ancestry is resolved from each module's **Parent Architecture Modules** metadata.

## ISO 29119-4 White-Box Techniques

| Technique                       | Source View                   | What It Tests                                        |
| ------------------------------- | ----------------------------- | ---------------------------------------------------- |
| **Statement & Branch Coverage** | Algorithmic/Logic View        | Internal branch and path coverage                    |
| **Boundary Value Analysis**     | Internal Data Structures      | Scalar boundaries (min-1/min/mid/max/max+1)          |
| **Equivalence Partitioning**    | Internal Data Structures      | Boolean/enum/discrete partitions                     |
| **Strict Isolation**            | Architecture Interface View   | Complete mocking/stubbing of external dependencies   |
| **Error Guessing**              | Error Handling & Return Codes | Anticipated fault/error paths and defensive handling |
| **State Transition Testing**    | State Machine View            | Valid/invalid transitions in explicit state diagrams |

## Unit Tests

### Module: MOD-001 (Clerk Auth Service)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `packages/services/recipe-service/src/auth/clerkAuth.service.ts`

#### Test Case: UTP-001-A (session token verification branch paths)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers missing token, bad signature / unauthorized `azp`, expired token, invalid tier claim, and success return path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `@clerk/backend` `verifyToken` | MOD-001 Algorithmic View | Stub verified claims / throw | Exercise signature/`azp`/expiry and claim branches |
| `config.clerkJwtKey` | MOD-001 Interface View | In-memory fake PEM key | Deterministic networkless verification |

- **Unit Scenario: UTS-001-A1**
    - **Arrange**: Set `bearerToken` to empty string and initialize the service with a fake `CLERK_JWT_KEY`.
    - **Act**: Call `verify(bearerToken)`.
    - **Assert**: Throws `INVALID_TOKEN("missing")` before any `verifyToken` call.

#### Test Case: UTP-001-B (tier claim partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions `public_metadata.tier` claim values: `free`, `premium`, and invalid claim.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `verifyToken` claims | Internal Data Structures (`VerifiedClerkClaims`) | Stub claim variants | Validate enum partitioning |

- **Unit Scenario: UTS-001-B1**
    - **Arrange**: Mock verified claims `public_metadata.tier = "enterprise"`.
    - **Act**: Call `verify(validSignedToken)`.
    - **Assert**: Throws `INVALID_TOKEN("tier claim missing/invalid")`.

#### Test Case: UTP-001-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Verifies that token verification is networkless — it uses only the local `CLERK_JWT_KEY` public key and never performs any outbound network I/O (no JWKS fetch, no Backend API round trip).

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `@clerk/backend` `verifyToken` | ARCH-001 Interface View | Spy + stub verified claims | Verify invocation contract |
| `config.clerkJwtKey` | MOD-001 Algorithmic View | In-memory fake PEM key | Deterministic local verification |
| outbound HTTP transport | ARCH-001 Interface View | Spy on network function | Block + assert zero network I/O |

- **Unit Scenario: UTS-001-C1**
    - **Arrange**: Inject the fake `CLERK_JWT_KEY` and spy on the outbound HTTP function.
    - **Act**: Call `verify(validSignedToken)`.
    - **Assert**: Returns `Principal` and outbound HTTP spy invocation count remains `0`.

---

### Module: MOD-002 (Owner & Tier Authorization Guard)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `packages/services/recipe-service/src/auth/owner-tier.guard.ts`

#### Test Case: UTP-002-A (authorization decision branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers write/delete owner check, read owner/public check, clone public check, tier check, allow path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `repository.loadByKind` | MOD-002 Algorithmic View | Stub resource rows | Drive owner/public/action branches |

- **Unit Scenario: UTS-002-A1**
    - **Arrange**: Set `resourceRef.action="delete"`, `resource.ownerId != principal.userId`.
    - **Act**: Call `authorize(principal, resourceRef)`.
    - **Assert**: Throws `FORBIDDEN_OWNER` with `ruleId="OWNER_ONLY_WRITE"`.

#### Test Case: UTP-002-B (action/tier partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions `action` enum and `tier` enum combinations for required tier checks.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `repository.loadByKind` | MOD-002 Algorithmic View | Stub deterministic resource object | Ensure unit isolation while exercising action/tier partitions |

- **Unit Scenario: UTS-002-B1**
    - **Arrange**: Set `required="premium"`, `principal.tier="free"`.
    - **Act**: Execute authorization branch after owner/public validation passes.
    - **Assert**: Throws `FORBIDDEN_TIER` with `requiredTier="premium"`.

#### Test Case: UTP-002-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Isolates repository loading and verifies no external persistence access beyond mocked repository.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Resource repository | ARCH-002 Interface View | Stub `loadByKind` | Prevent live DB usage |

- **Unit Scenario: UTS-002-C1**
    - **Arrange**: Inject stub repository that returns deterministic resource object.
    - **Act**: Call `authorize(principal, {kind:"recipe",id:"r1",action:"read"})`.
    - **Assert**: Returns `{allowed:true}` and only stubbed repository call is observed.

#### Test Case: UTP-002-D (authorization input boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Probes `resourceRef.id` length and action/kind boundary partitions used by `TIER_REQUIREMENTS`.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `repository.loadByKind` | MOD-002 Algorithmic View | Stub deterministic resource for each action/kind probe | Keep boundary probes isolated from persistence |

- **Unit Scenario: UTS-002-D1**
    - **Arrange**: Use boundary `resourceRef.id` samples (`""`, minimum valid id, long id) with `action`/`kind` combinations at tier-threshold boundaries.
    - **Act**: Call `authorize(principal, resourceRef)` for each boundary probe.
    - **Assert**: Invalid id boundary is rejected; valid boundary ids evaluate against expected tier requirements deterministically.

---

### Module: MOD-003 (Recipe HTTP Controller)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/recipes.controller.ts`

#### Test Case: UTP-003-A (route delegation branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers create, update, delete, clone, and list route handlers with command/query construction.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-005.validateCreate/Update` | MOD-003 Algorithmic View | Stub DTO validation outputs | Isolate controller orchestration |
| `MOD-004.execute` | MOD-003 Algorithmic View | Spy + stub command results | Verify command payload shape |
| `MOD-010.search` | MOD-003 Algorithmic View | Stub page result | Verify header calculation |

- **Unit Scenario: UTS-003-A1**
    - **Arrange**: Set `id="r42"`, `rowVersion="v3"`, and validator stub returning `dto`.
    - **Act**: Call `update(id, rawBody, rowVersion, principal)`.
    - **Assert**: Invokes `execute` with `expectedRowVersion="v3"` and returns status `200`.

#### Test Case: UTP-003-B (command-kind partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions command kinds delegated by each route (`create/update/delete/clone/list`).

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-005.validateCreate/Update` | MOD-003 Algorithmic View | Stub validator outputs | Keep routing-partition tests at controller unit scope |
| `MOD-004.execute` | MOD-003 Algorithmic View | Spy + stub command result | Verify command-kind delegation only |
| `MOD-010.search` | MOD-003 Algorithmic View | Stub paged search result | Avoid repository/network behavior in unit test |

- **Unit Scenario: UTS-003-B1**
    - **Arrange**: Prepare clone route parameter `id="r9"`.
    - **Act**: Call `clone(id, principal)`.
    - **Assert**: Calls `execute` with `kind="clone"` and payload `{sourceId:"r9"}`.

#### Test Case: UTP-003-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures controller unit tests run with all collaborator services mocked.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| DTO validator module | ARCH-003 Interface View | Stub class methods | Avoid validation library internals |
| Recipe command service | ARCH-003 Interface View | Spy object | Validate delegation only |
| Recipe search service | ARCH-003 Interface View | Stub paged response | No repository/network calls |

- **Unit Scenario: UTS-003-C1**
    - **Arrange**: Inject all collaborators as jest mocks into controller constructor.
    - **Act**: Call each route handler once.
    - **Assert**: No unmocked dependency access occurs; only injected mocks are invoked.

---

### Module: MOD-004 (Recipe Command Service)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/recipes.command.service.ts`

#### Test Case: UTP-004-A (command-match branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers `create/update/delete/clone` branches, policy deny, concurrency conflict, and success transaction paths.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| MOD-002 authorize | MOD-004 Algorithmic View | Stub allow/deny | Drive authorization branches |
| MOD-006 evaluate | MOD-004 Algorithmic View | Stub decision object | Drive `POLICY_DENIED` path |
| MOD-007 detect | MOD-004 Algorithmic View | Stub substantive edit result | Update flow branch control |
| MOD-008 resolve | MOD-004 Algorithmic View | Stub resolved ingredients | Isolate resolver logic |
| MOD-009 calculate | MOD-004 Algorithmic View | Stub nutrition totals | Isolate nutrition logic |
| MOD-015 write | MOD-004 Algorithmic View | Stub version results | Verify version chaining |
| MOD-016 guard | MOD-004 Algorithmic View | Stub pass/conflict throw | Drive concurrency branch |
| MOD-024 repositories | MOD-004 Algorithmic View | Fake transaction wrapper | Avoid DB side effects |

- **Unit Scenario: UTS-004-A1**
    - **Arrange**: Set `command.kind="update"`; stub policy allow and `guard` throw `CONCURRENCY_CONFLICT`.
    - **Act**: Call `execute(command)`.
    - **Assert**: Propagates `CONCURRENCY_CONFLICT` and does not call `MOD-015.write`.

#### Test Case: UTP-004-B (command-kind partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions `RecipeCommand` union members and tier-dependent nutrition branch.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-004-B1**
    - **Arrange**: Build create command with `principal.tier="free"`.
    - **Act**: Execute create branch.
    - **Assert**: `nutrition` internal variable is `null` and command returns `RecipeView`.

#### Test Case: UTP-004-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Enforces complete mocking for all collaborating modules in command orchestration.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Authorization guard | ARCH-004 Interface View | Stub function | No guard integration testing |
| Visibility policy engine | ARCH-004 Interface View | Stub decision return | Isolated policy control |
| Ingredient resolver | ARCH-004 Interface View | Stub array return | Isolate ingredient module |
| Nutrition calculator | ARCH-004 Interface View | Stub totals return | Isolate nutrition module |
| Version snapshot writer | ARCH-004 Interface View | Stub version result | Isolate versioning |
| Concurrency guard | ARCH-004 Interface View | Stub pass/fail | Isolate CAS logic |
| Repository layer | ARCH-004 Interface View | Fake transaction + repository spies | Prevent live DB I/O |

- **Unit Scenario: UTS-004-C1**
    - **Arrange**: Inject stubs for every collaborator and spy on unexpected imports.
    - **Act**: Execute all four `kind` branches.
    - **Assert**: No real repository/network call occurs; only injected stubs are used.

#### Test Case: UTP-004-D (error guessing for policy/concurrency/version failure matrix)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Injects high-risk fault combinations to verify normalization/propagation of `POLICY_DENIED`, `CONCURRENCY_CONFLICT`, and `VERSION_WRITE_FAILED`.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-006.evaluate` | MOD-004 Error Handling View | Stub deny decision with `ruleId` | Assert deterministic `POLICY_DENIED` mapping |
| `MOD-016.guard` | MOD-004 Error Handling View | Stub `CONCURRENCY_CONFLICT` throw | Verify conflict propagation contract |
| `MOD-015.write` | MOD-004 Error Handling View | Stub storage exception on write | Verify `VERSION_WRITE_FAILED` defensive path |

- **Unit Scenario: UTS-004-D1**
    - **Arrange**: Run three fault-injection subcases (policy deny, guard conflict, writer failure) with all other collaborators stubbed success.
    - **Act**: Call `execute(command)` for each injected fault.
    - **Assert**: Service emits/propagates the expected domain code for each fault path with no hidden side effects.

---

### Module: MOD-005 (Recipe DTO Validator)

**Parent Architecture Modules**: ARCH-005
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/recipes.dto.ts`

#### Test Case: UTP-005-A (validation success/failure branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers validation success path and aggregated `VALIDATION_FAILED` throw path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `plainToInstance` | MOD-005 Algorithmic View | Stub DTO conversion | Isolate transformer behavior |
| `validateSync` | MOD-005 Algorithmic View | Stub errors/no errors | Drive branch coverage |

- **Unit Scenario: UTS-005-A1**
    - **Arrange**: Stub `validateSync` to return two field errors.
    - **Act**: Call `validateCreate(raw)`.
    - **Assert**: Throws `VALIDATION_FAILED` with flattened `fieldErrors.length = 2`.

#### Test Case: UTP-005-B (numeric/string boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies `title` length, `instructions` max size, `servings` min/max, and `quantity` min boundary handling.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-005-B1**
    - **Arrange**: Set `servings=101` in a create payload.
    - **Act**: Call `validateCreate(payload)`.
    - **Assert**: Returns `VALIDATION_FAILED` with path `servings` and max-bound violation code.

#### Test Case: UTP-005-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Confirms validator unit tests run with mocked class-validator/class-transformer APIs only.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `class-transformer` | ARCH-005 Interface View | Stub `plainToInstance` | Deterministic instance creation |
| `class-validator` | ARCH-005 Interface View | Stub `validateSync` | No library internals under test |

- **Unit Scenario: UTS-005-C1**
    - **Arrange**: Replace validator and transformer imports with test doubles.
    - **Act**: Invoke create/update validators.
    - **Assert**: Only stubs are called; no runtime metadata reflection side effects leak.

---

### Module: MOD-006 (Visibility Policy Engine)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/visibility.policy.ts`

#### Test Case: UTP-006-A (policy branch logic)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers invalid enum throws, R2 deny branch, and allow branch.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-006-A1**
    - **Arrange**: Set `source="cloned"`, `targetVisibility="public"`, `isSubstantiveEdit=false`.
    - **Act**: Call `evaluate(ctx)`.
    - **Assert**: Returns `{allowed:false, ruleId:"R2_CLONED_NEEDS_SUBSTANTIVE_EDIT"}`.

#### Test Case: UTP-006-B (enum/boolean partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions `tier`, `source`, `targetVisibility`, and `isSubstantiveEdit` discrete domains.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-006-B1**
    - **Arrange**: Set `tier="gold" as unknown as any` and valid remaining context fields.
    - **Act**: Call `evaluate(ctx)`.
    - **Assert**: Throws `POLICY_INTERNAL` with `ruleId="ENUM_TIER"`.

#### Test Case: UTP-006-C (error guessing for unexpected source enum)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Probes `POLICY_INTERNAL` defensive branch with unexpected `source` enum value.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-006-C1**
    - **Arrange**: Build context with valid tier/target flags and `source="legacy_import" as unknown as any`.
    - **Act**: Call `evaluate(ctx)`.
    - **Assert**: Throws `POLICY_INTERNAL` with source-enum diagnostics and no allow decision.

#### Test Case: UTP-006-D (R2 boundary analysis)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Probes R2 threshold boundary around `isSubstantiveEdit=false/true` for cloned→public transitions.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-006-D1**
    - **Arrange**: Prepare two contexts differing only by `isSubstantiveEdit` (`false` then `true`) at cloned→public boundary.
    - **Act**: Call `evaluate(ctx)` for both boundary points.
    - **Assert**: `false` yields deny with `R2_CLONED_NEEDS_SUBSTANTIVE_EDIT`; `true` yields allow.

---

### Module: MOD-007 (Substantive Edit Detector)

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/substantive-edit.detector.ts`

#### Test Case: UTP-007-A (diff detection branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers ingredient diff, instruction diff, title-only diff, and no-change path.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-007-A1**
    - **Arrange**: Keep ingredients/instructions identical and change `title` whitespace.
    - **Act**: Call `detect(before, after)`.
    - **Assert**: Returns `changedFields=["title"]` and `isSubstantive=false`.

#### Test Case: UTP-007-B (boolean partition for substantive flag)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions `isSubstantive` into true vs false based on changed-fields set.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-007-B1**
    - **Arrange**: Change one ingredient quantity from `1` to `1.5`.
    - **Act**: Call `detect(before, after)`.
    - **Assert**: Returns `isSubstantive=true` and includes `"ingredients"` in `changedFields`.

#### Test Case: UTP-007-C (ingredient-array and precision boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Probes empty vs single-element ingredient/instruction arrays and `roundTo3` precision boundary.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-007-C1**
    - **Arrange**: Compare payloads at boundaries: empty arrays, single-element arrays, and quantity deltas around `0.001` precision.
    - **Act**: Call `detect(before, after)` for each boundary pair.
    - **Assert**: Boundary-only rounding noise is non-substantive while material boundary changes set `isSubstantive=true`.

---

### Module: MOD-008 (Ingredient Resolver Service)

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `packages/services/recipe-service/src/ingredients/ingredient.resolver.service.ts`

#### Test Case: UTP-008-A (resolver branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers linked-hit, linked-miss throw, freeform path, and loop ordering behavior.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.ingredients.loadByIds` | MOD-008 Algorithmic View | Stub catalog map | Control linked lookup results |
| `normalize(...)` conversion | MOD-008 Algorithmic View | Stub normalize function | Isolate unit conversion logic |

- **Unit Scenario: UTS-008-A1**
    - **Arrange**: Provide one linked item whose id is absent in catalog map.
    - **Act**: Call `resolve(items)`.
    - **Assert**: Throws `INGREDIENT_NOT_FOUND` with `inputIndex=0`.

#### Test Case: UTP-008-B (quantity boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies scalar `quantity` handling at minimum boundary value and below-minimum rejection path.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-008-B1**
    - **Arrange**: Set linked item `quantity=0` and canonical unit available.
    - **Act**: Call `resolve(items)`.
    - **Assert**: Returns normalized quantity object with `quantity=0` and no rejection.

- **Unit Scenario: UTS-008-B2**
    - **Arrange**: Set linked item `quantity=-0.001` with canonical unit available.
    - **Act**: Call `resolve(items)`.
    - **Assert**: Resolver rejects sub-zero quantity with validation/domain error for lower-bound violation.

#### Test Case: UTP-008-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures resolver uses only mocked repository and conversion helpers.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Ingredients repository | ARCH-008 Interface View | Stub `loadByIds` | Prevent live DB access |
| Unit normalizer | MOD-008 Algorithmic View | Stub deterministic output | Isolate algorithm branches |

- **Unit Scenario: UTS-008-C1**
    - **Arrange**: Inject repository stub and normalize stub.
    - **Act**: Call `resolve(mixedLinkedAndFreeform)`.
    - **Assert**: Repository called once with linked IDs; no external I/O occurs.

#### Test Case: UTP-008-D (error guessing for mixed invalid linked payload)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Exercises malformed mixed payload paths to ensure deterministic `INGREDIENT_NOT_FOUND` and validation error behavior.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.ingredients.loadByIds` | MOD-008 Error Handling View | Stub partial catalog misses | Force unresolved linked-id error path |
| `normalize(...)` conversion | MOD-008 Error Handling View | Stub converter throw on invalid unit tuple | Verify defensive fallback/propagation path |

- **Unit Scenario: UTS-008-D1**
    - **Arrange**: Provide linked payload with one missing ingredient id and one invalid unit conversion tuple.
    - **Act**: Call `resolve(items)`.
    - **Assert**: Resolver surfaces deterministic domain error code and reports offending item index.

---

### Module: MOD-009 (Nutrition Calculator)

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `packages/services/recipe-service/src/nutrition/nutrition.calculator.ts`

#### Test Case: UTP-009-A (nutrition accumulation branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers freeform skip, missing fact skip, convertible fact accumulation, rounding path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.nutritionFacts.loadByIds` | MOD-009 Algorithmic View | Stub facts map | Control hit/miss conditions |
| `convertToGrams` | MOD-009 Algorithmic View | Stub conversions | Isolate conversion behavior |

- **Unit Scenario: UTS-009-A1**
    - **Arrange**: Provide one freeform item and one linked item without facts.
    - **Act**: Call `calculate(resolvedItems)`.
    - **Assert**: `missingItems` contains both indexes and macro totals remain `0`.

#### Test Case: UTP-009-B (numeric boundary handling)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Tests near-zero and high scalar quantities through `factor = grams/100` path.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-009-B1**
    - **Arrange**: Set converted grams to `0` for a linked ingredient with valid facts.
    - **Act**: Call `calculate([item])`.
    - **Assert**: Returns totals all `0.0` and no error thrown.

#### Test Case: UTP-009-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Isolates repository lookup and converter calls.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Nutrition facts repository | ARCH-009 Interface View | Stub `loadByIds` | Avoid DB access |
| Unit converter | MOD-009 Algorithmic View | Stub deterministic values | Repeatable arithmetic assertions |

- **Unit Scenario: UTS-009-C1**
    - **Arrange**: Mock repository and converter to deterministic outputs.
    - **Act**: Execute `calculate(resolvedItems)`.
    - **Assert**: No unmocked data access; arithmetic uses stubbed inputs only.

---

### Module: MOD-010 (Recipe Search Service)

**Parent Architecture Modules**: ARCH-010
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/recipes.search.service.ts`

#### Test Case: UTP-010-A (search validation and pagination branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers bad query rejection and successful page computation path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-011.build` | MOD-010 Algorithmic View | Stub `spec` object | Isolate query builder behavior |
| `MOD-024.recipes.searchPage` | MOD-010 Algorithmic View | Stub rows | Deterministic item mapping |
| `MOD-024.recipes.searchCount` | MOD-010 Algorithmic View | Stub total count | Deterministic totalPages |

- **Unit Scenario: UTS-010-A1**
    - **Arrange**: Set `query.page=0` and `pageSize=10`.
    - **Act**: Call `search(query, principal)`.
    - **Assert**: Throws `BAD_QUERY` before query builder invocation.

#### Test Case: UTP-010-B (pagination boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies `page >=1` and `pageSize <=50` limits.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-010-B1**
    - **Arrange**: Set `pageSize=51`.
    - **Act**: Invoke `search(query, principal)`.
    - **Assert**: Throws `BAD_QUERY` with pagination field error.

#### Test Case: UTP-010-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures search logic uses only mocked builder/repository collaborators.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Search query builder | ARCH-010 Interface View | Stub `build` | Isolate service logic |
| Recipes repository page/count methods | ARCH-010 Interface View | Stub rows/count | Avoid real DB scans |

- **Unit Scenario: UTS-010-C1**
    - **Arrange**: Inject stubs returning fixed rows and total `25`.
    - **Act**: Call `search({page:2,pageSize:10,...}, principal)`.
    - **Assert**: Returns `totalPages=3` without any live persistence call.

#### Test Case: UTP-010-D (error guessing for invalid query parameter combinations)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies robust handling of malformed query parameters that bypass basic validation but trigger edge cases in query construction.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-011.build` | MOD-010 Error Handling View | Stub query construction with edge-case parameter combinations | Validate defensive handling of malformed inputs |

- **Unit Scenario: UTS-010-D1**
    - **Arrange**: Build query with `ownerScope="invalid"` and stub `MOD-011.build` to throw on unknown enum value.
    - **Act**: Call `search(query, principal)`.
    - **Assert**: Throws `BAD_QUERY` with descriptive error message about invalid ownerScope value.

---

### Module: MOD-011 (Search Query Builder)

**Parent Architecture Modules**: ARCH-011
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/search-query.builder.ts`

#### Test Case: UTP-011-A (query string assembly branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers owner-scope branches (`mine/public/all`) and optional text/ingredient filters.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-011-A1**
    - **Arrange**: Set `ownerScope="all"`, `q="soup"`, `ingredients=["ing1"]`, `page=1`, `pageSize=20`.
    - **Act**: Call `build(query, principal)`.
    - **Assert**: `where` contains visibility-owner OR clause and parameter placeholders (`:uid`,`:q`,`:ings`).

#### Test Case: UTP-011-B (limit/offset boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies offset arithmetic at low and high page values.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-011-B1**
    - **Arrange**: Set `page=1`, `pageSize=50`.
    - **Act**: Call `build(query, principal)`.
    - **Assert**: Returns `offset=0` and `limit=50`.

> **Strict Isolation Applicability Note (PRF-UTP-011):** MOD-011 is a pure function with no external dependencies. Intentional two-case pattern is retained; Strict Isolation technique is not applicable for this module.

---

### Module: MOD-012 (Photo Presign Service)

**Parent Architecture Modules**: ARCH-012
**Target Source File(s)**: `packages/services/recipe-service/src/photos/photo.presign.service.ts`

#### Test Case: UTP-012-A (presign workflow branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers validate failure, authorization failure, presign success, and pending-row insert path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `validate(req)` | MOD-012 Algorithmic View | Stub pass/fail | Drive input validation branch |
| `MOD-002.authorize` | MOD-012 Algorithmic View | Stub allow/deny | Drive authorization path |
| `MOD-025.getPresignedPutUrl` | MOD-012 Algorithmic View | Stub URL output | Avoid AWS signing calls |
| `MOD-024.photoUploads.insertPending` | MOD-012 Algorithmic View | Spy insert call | Verify persistence payload |

- **Unit Scenario: UTS-012-A1**
    - **Arrange**: Set valid request with `contentType="image/jpeg"`, `byteSize=1024` and stubs for authorize/sign/insert.
    - **Act**: Call `presign(req, principal)`.
    - **Assert**: Returns `uploadUrl/objectKey/headers` and inserts pending row with same `objectKey`.

#### Test Case: UTP-012-B (size/content boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies byte-size ceiling and accepted MIME set edge values.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-012-B1**
    - **Arrange**: Set `byteSize=10485761` (10MB+1).
    - **Act**: Call `presign(req, principal)`.
    - **Assert**: Throws `INVALID_PHOTO` due to size overflow.

#### Test Case: UTP-012-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures photo presign unit tests run with mocked auth, S3 adapter, and repository.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Owner/tier guard | ARCH-012 Interface View | Stub authorize | No guard integration |
| S3 adapter presign call | ARCH-012 Interface View | Stub signed URL | No AWS SDK/network |
| Photo upload repository | ARCH-012 Interface View | Spy insertPending | No live DB writes |

- **Unit Scenario: UTS-012-C1**
    - **Arrange**: Inject stubs for all collaborators.
    - **Act**: Call `presign(req, principal)`.
    - **Assert**: No unmocked external call occurs.

#### Test Case: UTP-012-D (error guessing for S3 adapter unavailable scenarios)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies graceful handling when S3 presign adapter throws unexpected errors during URL generation.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-025.getPresignedPutUrl` | MOD-012 Error Handling View | Stub unexpected error throw | Validate defensive error propagation |

- **Unit Scenario: UTS-012-D1**
    - **Arrange**: Stub S3 adapter to throw `S3_UNAVAILABLE` error during presign call.
    - **Act**: Call `presign(req, principal)`.
    - **Assert**: Throws `INVALID_PHOTO` with wrapped S3 error context and does not insert pending row.

---

### Module: MOD-013 (Photo Confirm Service)

**Parent Architecture Modules**: ARCH-013
**Target Source File(s)**: `packages/services/recipe-service/src/photos/photo.confirm.service.ts`

#### Test Case: UTP-013-A (confirm flow branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers pending-missing, owner mismatch, object missing, etag mismatch, and transaction success.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.photoUploads.findPendingByKey` | MOD-013 Algorithmic View | Stub row/null | Drive not-found branch |
| `MOD-025.headObject` | MOD-013 Algorithmic View | Stub metadata/null | Drive S3 missing branch |
| `MOD-024.photos.insert` | MOD-013 Algorithmic View | Stub inserted photo | Verify output mapping |
| `MOD-024.photoUploads.markConfirmed` | MOD-013 Algorithmic View | Spy call | Verify state transition |

- **Unit Scenario: UTS-013-A1**
    - **Arrange**: Stub pending row exists; headObject returns `etag="abc"`; input etag `"xyz"`.
    - **Act**: Call `confirm({objectKey,etag:"xyz"}, principal)`.
    - **Assert**: Throws `INVALID_PHOTO("etag mismatch")`.

#### Test Case: UTP-013-B (photo status partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions `status` enum handling around `pending_processing` output contract.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-013-B1**
    - **Arrange**: Stub successful insert path.
    - **Act**: Call `confirm(c, principal)`.
    - **Assert**: Returns `PhotoView.status="pending_processing"`.

#### Test Case: UTP-013-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Confirms isolation of repository and S3 adapter dependencies.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Photo upload repository | ARCH-013 Interface View | Stub/spy methods | Avoid DB I/O |
| Photos repository | ARCH-013 Interface View | Stub insert | Isolate persistence logic |
| S3 adapter `headObject` | ARCH-013 Interface View | Stub metadata | Avoid real S3 HEAD |

- **Unit Scenario: UTS-013-C1**
    - **Arrange**: Inject repository and S3 stubs.
    - **Act**: Execute `confirm`.
    - **Assert**: Only mocked dependencies are touched.

#### Test Case: UTP-013-E (photo confirm lifecycle transitions)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies `pending_processing → ready | failed` transition behavior, including invalid transition guard.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.photoUploads.markConfirmed` | MOD-013 State Machine View | Spy success/failure writes | Assert pending→ready transition side effects |
| `MOD-025.headObject` | MOD-013 State Machine View | Stub success and mismatch metadata | Drive ready vs failed transition outcomes |

- **Unit Scenario: UTS-013-E1**
    - **Arrange**: Start from pending upload row; run one valid etag confirmation and one invalid/mismatch confirmation path.
    - **Act**: Call `confirm` for both paths.
    - **Assert**: Valid path finalizes as `ready`; invalid path enters failure handling and blocks illegal direct `pending_processing → ready` skip without verification.

---

### Module: MOD-014 (Photo Processing Lambda Handler)

**Parent Architecture Modules**: ARCH-014
**Target Source File(s)**: `packages/services/recipe-workers/src/photo-processor/handler.ts`

#### Test Case: UTP-014-A (processing branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers photo missing no-op, ready idempotent no-op, success rendition path, catch/fail path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.photos.findByObjectKey` | MOD-014 Algorithmic View | Stub photo/null/ready | Drive branch outcomes |
| Sharp pipeline | MOD-014 Algorithmic View | Stub chain methods | Avoid image processing runtime |
| `MOD-025.getObject/putObject` | MOD-014 Algorithmic View | Stub buffers + spy puts | Avoid S3 I/O |
| `MOD-024.photos.markReady/markFailed` | MOD-014 Algorithmic View | Spy updates | Verify status transitions |

- **Unit Scenario: UTS-014-A1**
    - **Arrange**: Set `photo.status="pending_processing"` and force `putObject` to throw.
    - **Act**: Call `handle(event)`.
    - **Assert**: Calls `markFailed(photo.id, message)` then rethrows error.

#### Test Case: UTP-014-B (state/status partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions photo status behavior (`pending_processing`, `ready`, missing).

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-014-B1**
    - **Arrange**: Stub `findByObjectKey` returning status `ready`.
    - **Act**: Process one record.
    - **Assert**: Returns without calling `getObject` or `putObject`.

#### Test Case: UTP-014-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures all storage/image/persistence dependencies are mocked in unit tests.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| S3 adapter (`getObject`, `putObject`) | ARCH-014 Interface View | Stub object/buffer methods | Prevent external storage calls |
| Photos repository | ARCH-014 Interface View | Stub find/update methods | Prevent DB writes |
| Sharp image processor | MOD-014 Algorithmic View | Mock fluent API object | Deterministic image pipeline |

- **Unit Scenario: UTS-014-C1**
    - **Arrange**: Inject mocked S3, Sharp, and repository modules.
    - **Act**: Execute handler with synthetic S3 event.
    - **Assert**: No external service invocation beyond mocks.

#### Test Case: UTP-014-D (error guessing for Sharp image processing failures)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies robust handling when Sharp image processor throws unexpected errors during rendition generation.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Sharp pipeline | MOD-014 Error Handling View | Stub unexpected error during image processing | Validate defensive error handling |

- **Unit Scenario: UTS-014-D1**
    - **Arrange**: Stub Sharp processor to throw `SharpProcessingError` during resize operation.
    - **Act**: Call `handle(event)` with valid photo in pending_processing state.
    - **Assert**: Calls `markFailed(photo.id, error)` and rethrows wrapped error with processing context.

---

### Module: MOD-015 (Version Snapshot Writer)

**Parent Architecture Modules**: ARCH-015
**Target Source File(s)**: `packages/services/recipe-service/src/recipes/version-snapshot.writer.ts`

#### Test Case: UTP-015-A (write path branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers successful next-number+insert path and insert failure propagation.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.recipeVersions.nextNumber` | MOD-015 Algorithmic View | Stub number | Control version increment path |
| `MOD-024.recipeVersions.insert` | MOD-015 Algorithmic View | Stub row/throw | Cover success/failure branches |

- **Unit Scenario: UTS-015-A1**
    - **Arrange**: Stub `nextNumber=11` and insert returning `{id:"ver_11"}`.
    - **Act**: Call `write({recipeId,snapshot,txn})`.
    - **Assert**: Returns `{versionNumber:11,versionId:"ver_11"}`.

#### Test Case: UTP-015-B (version number boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies lower boundary (first version) and monotonic increment handling.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-015-B1**
    - **Arrange**: Stub `nextNumber=1` for recipe with no prior versions.
    - **Act**: Call `write(...)`.
    - **Assert**: Returns `versionNumber=1` and does not underflow.

#### Test Case: UTP-015-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Isolates writer from repository transaction internals.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Recipe versions repository | ARCH-015 Interface View | Stub `nextNumber` and `insert` | No DB access |
| Transaction handle | MOD-015 Interface View | Fake txn token | Deterministic call signatures |

- **Unit Scenario: UTS-015-C1**
    - **Arrange**: Inject fake tx object and repository stubs.
    - **Act**: Invoke `write(request)`.
    - **Assert**: All operations execute through stubs only.

---

### Module: MOD-016 (Optimistic Concurrency Guard)

**Parent Architecture Modules**: ARCH-016
**Target Source File(s)**: `packages/services/recipe-service/src/persistence/concurrency.guard.ts`

#### Test Case: UTP-016-A (guard branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers row missing path, stale rowVersion conflict path, and success match path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024[table].loadRowVersion` | MOD-016 Algorithmic View | Stub row/null | Control existence/match branches |
| `MOD-024[table].loadById` | MOD-016 Algorithmic View | Stub snapshot | Populate conflict payload |

- **Unit Scenario: UTS-016-A1**
    - **Arrange**: Stub current row version `"v5"`; set expected `"v4"`.
    - **Act**: Call `guard(req)`.
    - **Assert**: Throws `CONCURRENCY_CONFLICT` containing `currentRowVersion="v5"`.

#### Test Case: UTP-016-B (table enum partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions `table` enum values (`recipes`, `collections`, `photos`).

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-016-B1**
    - **Arrange**: Set `req.table="collections"` with matching row version.
    - **Act**: Call `guard(req)`.
    - **Assert**: Returns `true`.

#### Test Case: UTP-016-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Confirms all table repository access is mocked.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Table repositories (recipes/collections/photos) | ARCH-016 Interface View | Stub per-table methods | Avoid DB reads |

- **Unit Scenario: UTS-016-C1**
    - **Arrange**: Inject mocked repository lookup map.
    - **Act**: Call `guard` for each table variant.
    - **Assert**: No live repository implementation is invoked.

#### Test Case: UTP-016-D (error guessing for deleted-row race and stale snapshots)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Injects race conditions where row exists during version read but disappears before snapshot load to validate deterministic `NOT_FOUND`/conflict handling.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024[table].loadRowVersion` | MOD-016 Error Handling View | Stub value then mismatch | Simulate stale optimistic-lock comparison |
| `MOD-024[table].loadById` | MOD-016 Error Handling View | Stub `null` on follow-up read | Reproduce deleted-row race fault |

- **Unit Scenario: UTS-016-D1**
    - **Arrange**: Configure race sequence where expected row version is stale and subsequent snapshot lookup returns missing row.
    - **Act**: Call `guard(req)`.
    - **Assert**: Emits deterministic conflict/not-found error contract with no undefined state.

---

### Module: MOD-017 (Archive Queue Producer)

**Parent Architecture Modules**: ARCH-017
**Target Source File(s)**: `packages/services/recipe-service/src/archive/archive-queue.producer.ts`

#### Test Case: UTP-017-A (enqueue branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers send success, transient retry path leading to `QUEUE_UNAVAILABLE`, and non-transient throw path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-025.sqs.sendMessage` | MOD-017 Algorithmic View | Stub resolve/reject | Control branch outcomes |
| `isTransient`/`backoffRetry` | MOD-017 Algorithmic View | Stub transient classification | Deterministic retry branch |

- **Unit Scenario: UTS-017-A1**
    - **Arrange**: Stub sendMessage transient failure for two attempts.
    - **Act**: Call `enqueue(job)`.
    - **Assert**: Throws `QUEUE_UNAVAILABLE` with `retryAfter=30`.

#### Test Case: UTP-017-B (attempt boundary)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies minimum valid `attempt` (`>=1`) handling in message payload.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-017-B1**
    - **Arrange**: Build `ArchiveJob` with `attempt=1`.
    - **Act**: Call `enqueue(job)` with successful send stub.
    - **Assert**: Serialized body includes `"attempt":1` unchanged.

#### Test Case: UTP-017-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures queue producer uses mocked SQS adapter and no live AWS interactions.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| SQS adapter via MOD-025 | ARCH-017 Interface View | Stub `sendMessage` | Prevent external queue operations |
| Archive queue config | MOD-017 Interface View | Stub config object | Deterministic queue URL |

- **Unit Scenario: UTS-017-C1**
    - **Arrange**: Inject fake queue URL and SQS stub.
    - **Act**: Call `enqueue(job)`.
    - **Assert**: Exactly one call to stubbed `sendMessage`; no network access.

#### Test Case: UTP-017-D (error guessing for non-transient SQS failure classification)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies non-transient SQS provider errors bypass retry and preserve deterministic failure classification.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-025.sqs.sendMessage` | MOD-017 Error Handling View | Stub provider error with non-retryable code | Exercise non-transient branch explicitly |
| `isTransient`/`backoffRetry` | MOD-017 Error Handling View | Stub `isTransient=false` | Assert no retry scheduling occurs |

- **Unit Scenario: UTS-017-D1**
    - **Arrange**: Stub `sendMessage` to throw non-transient provider error and classifier to return false.
    - **Act**: Call `enqueue(job)`.
    - **Assert**: Error propagates immediately without retry loop or altered code mapping.

---

### Module: MOD-018 (Archive Worker Lambda)

**Parent Architecture Modules**: ARCH-018
**Target Source File(s)**: `packages/services/recipe-workers/src/version-archive-worker/handler.ts`

#### Test Case: UTP-018-A (batch record branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers already-archived skip, successful archive path, failure recording and `batchItemFailures` population.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.archiveJobs.isAlreadyArchived` | MOD-018 Algorithmic View | Stub bool | Idempotency branch coverage |
| `MOD-024.recipeVersions.loadSnapshot` | MOD-018 Algorithmic View | Stub snapshot | Control payload source |
| `MOD-025.putObject` | MOD-018 Algorithmic View | Stub success/failure | Drive failure branch |
| `MOD-024.recipeVersions.markArchived` | MOD-018 Algorithmic View | Spy method | Verify archived transition |
| `MOD-024.archiveJobs.markCompleted/recordFailure` | MOD-018 Algorithmic View | Spy methods | Verify completion/failure bookkeeping |

- **Unit Scenario: UTS-018-A1**
    - **Arrange**: Create one SQS record; stub `putObject` to throw.
    - **Act**: Call `handle(sqsEvent)`.
    - **Assert**: Returns `batchItemFailures` with record `messageId` and calls `recordFailure`.

#### Test Case: UTP-018-B (response partitioning)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions empty vs non-empty `batchItemFailures` outcomes.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-018-B1**
    - **Arrange**: Stub all record operations as successful.
    - **Act**: Execute `handle`.
    - **Assert**: Returns `{batchItemFailures:[]}`.

#### Test Case: UTP-018-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Isolates worker from AWS S3 and repository persistence.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| S3 adapter (`putObject`) | ARCH-018 Interface View | Stub write call | Avoid real S3 |
| Archive job repository | ARCH-018 Interface View | Stub status calls | Avoid DB access |
| Version repository | ARCH-018 Interface View | Stub snapshot load | Deterministic inputs |

- **Unit Scenario: UTS-018-C1**
    - **Arrange**: Replace all adapter/repository imports with fakes.
    - **Act**: Invoke `handle` with one synthetic job.
    - **Assert**: No external service call occurs.

#### Test Case: UTP-018-D (error guessing for malformed SQS body and requeue failure)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Injects malformed queue payload and downstream bookkeeping failures to verify deterministic `batchItemFailures` handling.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| SQS record parser | MOD-018 Error Handling View | Stub parse throw for malformed JSON/body | Validate malformed-message defensive path |
| `MOD-024.archiveJobs.recordFailure` | MOD-018 Error Handling View | Stub secondary failure on bookkeeping | Ensure worker still returns failed message ids |

- **Unit Scenario: UTS-018-D1**
    - **Arrange**: Provide malformed SQS record body and failure recorder that also throws once.
    - **Act**: Call `handle(event)`.
    - **Assert**: Handler returns `batchItemFailures` containing the malformed record id and avoids silent drops.

---

### Module: MOD-019 (Pending Archive Reconciler)

**Parent Architecture Modules**: ARCH-019
**Target Source File(s)**: `packages/services/recipe-service/src/archive/pending-archive.reconciler.ts`

#### Test Case: UTP-019-A (reconciler loop branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers dead-letter branch (`attempt >= MAX_ATTEMPTS`), successful requeue path, and requeue catch/log path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.archiveJobs.findPending` | MOD-019 Algorithmic View | Stub pending rows | Control loop content |
| `MOD-017.enqueue` | MOD-019 Algorithmic View | Stub success/failure | Drive requeue/catch branch |
| `MOD-024.archiveJobs.markDeadLettered/bumpAttempt` | MOD-019 Algorithmic View | Spy methods | Verify state transitions |
| `MOD-030.warn/metric` | MOD-019 Algorithmic View | Spy logger/metric | Verify observability calls |

- **Unit Scenario: UTS-019-A1**
    - **Arrange**: Pending row with `attempt=8` and `MAX_ATTEMPTS=8`.
    - **Act**: Call `tick()`.
    - **Assert**: `markDeadLettered(jobId)` called and `report.deadLettered` increments.

#### Test Case: UTP-019-B (attempt boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies behavior at `attempt=7` (requeue) and `attempt=8` (dead-letter).

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-019-B1**
    - **Arrange**: Use one row with `attempt=7` and successful enqueue stub.
    - **Act**: Run `tick()`.
    - **Assert**: `bumpAttempt` called and `report.requeued=1`.

#### Test Case: UTP-019-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures reconciler unit tests isolate queue producer, repository, and telemetry.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Archive job repository | ARCH-019 Interface View | Stub pending/state methods | Avoid DB interactions |
| Archive queue producer | ARCH-019 Interface View | Stub enqueue | Avoid SQS calls |
| Telemetry/logger module | ARCH-019 Interface View | Spy metric/warn | Validate side effects only |

- **Unit Scenario: UTS-019-C1**
    - **Arrange**: Inject stubs for repository, producer, and telemetry.
    - **Act**: Execute `tick()`.
    - **Assert**: No unmocked I/O occurs.

#### Test Case: UTP-019-D (error guessing for requeue failure scenarios)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies robust handling when archive queue producer throws unexpected errors during requeue operations.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-017.enqueue` | MOD-019 Error Handling View | Stub unexpected error during requeue | Validate defensive error propagation |

- **Unit Scenario: UTS-019-D1**
    - **Arrange**: Stub queue producer to throw `QUEUE_UNAVAILABLE` during requeue attempt.
    - **Act**: Call `tick()` with pending job that should be requeued.
    - **Assert**: Logs error via telemetry spy and calls `recordFailure` without crashing reconciler loop.

---

### Module: MOD-020 (Collection Service)

**Parent Architecture Modules**: ARCH-020
**Target Source File(s)**: `packages/services/recipe-service/src/collections/collections.service.ts`

#### Test Case: UTP-020-A (collection command branches)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers `create/update/delete/addItem/removeItem` branches and concurrency/authorization paths.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-002.authorize` | MOD-020 Algorithmic View | Stub allow/deny | Drive guard branches |
| `MOD-016.guard` | MOD-020 Algorithmic View | Stub pass/fail | Drive conflict handling |
| `MOD-024.collections/recipes` | MOD-020 Algorithmic View | Fake repository methods | Isolate persistence |

- **Unit Scenario: UTS-020-A1**
    - **Arrange**: Update command with stale `expectedRowVersion`; stub `MOD-016.guard` to throw conflict.
    - **Act**: Call `execute(cmd)`.
    - **Assert**: Propagates `CONCURRENCY_CONFLICT` and does not call `collections.update`.

#### Test Case: UTP-020-B (command partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions `CollectionCommand.kind` union values.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-020-B1**
    - **Arrange**: Build `addItem` command.
    - **Act**: Call `execute(cmd)`.
    - **Assert**: Invokes recipe read authorization then `collections.addItem`.

#### Test Case: UTP-020-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Confirms all collaborators are mocked.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Authorization guard | ARCH-020 Interface View | Stub authorize | No guard integration |
| Concurrency guard | ARCH-020 Interface View | Stub guard | No CAS integration |
| Collections repository | ARCH-020 Interface View | Stub CRUD methods | No live DB |
| Recipes repository | ARCH-020 Interface View | Stub `loadById` | No live DB |

- **Unit Scenario: UTS-020-C1**
    - **Arrange**: Inject full mocked repository/guards.
    - **Act**: Execute each command kind.
    - **Assert**: Only mocked dependencies are called.

#### Test Case: UTP-020-D (error guessing for duplicate item scenarios)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies robust handling when repository throws duplicate constraint violations during addItem operations.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Collections repository | MOD-020 Error Handling View | Stub duplicate constraint error | Validate defensive error handling |

- **Unit Scenario: UTS-020-D1**
    - **Arrange**: Stub repository to throw `DUPLICATE_ITEM` during addItem operation.
    - **Act**: Call `execute(addItemCommand)`.
    - **Assert**: Throws `COLLECTION_VALIDATION_FAILED` with duplicate item context.

---

### Module: MOD-021 (Collection Clone & Pull Service)

**Parent Architecture Modules**: ARCH-021
**Target Source File(s)**: `packages/services/recipe-service/src/collections/collections.clone.service.ts`

#### Test Case: UTP-021-A (clone/pull branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers source missing, clone branch, pull branch, non-public skip, already-cloned skip, and add path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.collections` methods | MOD-021 Algorithmic View | Stub source/target/member operations | Control list/diff behavior |
| `MOD-024.recipes` methods | MOD-021 Algorithmic View | Stub visibility and cloned-from checks | Drive skip/add branches |
| `MOD-002.authorize` | MOD-021 Algorithmic View | Stub allow/deny | Control permissions |
| `MOD-004.execute` | MOD-021 Algorithmic View | Stub clone command result | Isolate recipe cloning service |

- **Unit Scenario: UTS-021-A1**
    - **Arrange**: Provide source with one private recipe entry.
    - **Act**: Call `execute({kind:"clone",sourceId}, principal)`.
    - **Assert**: Recipe id is added to `skippedRecipeIds` and not cloned.

#### Test Case: UTP-021-B (kind partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions command kind `clone` vs `pull` behavior.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-021-B1**
    - **Arrange**: Set command `kind="pull"` with owned target.
    - **Act**: Execute service.
    - **Assert**: Reads target collection and does not create a new collection row.

#### Test Case: UTP-021-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Isolates clone/pull orchestration from repositories and command service.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Collection repository | ARCH-021 Interface View | Stub load/insert/list/add methods | No DB integration |
| Recipe repository | ARCH-021 Interface View | Stub visibility/clone-check methods | Deterministic branch control |
| Authorization guard | ARCH-021 Interface View | Stub authorize | Isolated policy enforcement |
| Recipe command service | ARCH-021 Interface View | Stub `execute` clone command | No nested service integration |

- **Unit Scenario: UTS-021-C1**
    - **Arrange**: Inject all dependencies as stubs.
    - **Act**: Run clone and pull commands.
    - **Assert**: No unmocked external calls occur.

#### Test Case: UTP-021-D (error guessing for already-cloned scenarios)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies robust handling when recipe repository indicates a recipe was already cloned into the target collection.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Recipe repository | MOD-021 Error Handling View | Stub already-cloned detection | Validate defensive skip behavior |

- **Unit Scenario: UTS-021-D1**
    - **Arrange**: Stub recipe repository to return `alreadyCloned=true` for a recipe in source collection.
    - **Act**: Call `execute(cloneCommand)`.
    - **Assert**: Recipe id added to `skippedRecipeIds` and clone operation continues without error.

---

### Module: MOD-022 (GDPR Erasure Orchestrator)

**Parent Architecture Modules**: ARCH-022
**Target Source File(s)**: `packages/services/recipe-service/src/gdpr/erasure.orchestrator.ts`

#### Test Case: UTP-022-A (erasure flow branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers requester authorization check, in-flight erasure conflict, and successful transaction orchestration.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `isAdmin` check | MOD-022 Algorithmic View | Stub bool outcome | Drive owner/admin branch |
| `MOD-024.erasures.*` | MOD-022 Algorithmic View | Stub ledger methods | Isolate persistence state machine |
| `MOD-024.photos.collectKeysForUser` | MOD-022 Algorithmic View | Stub key list | Deterministic output |
| `MOD-024.applyErasureMutations` | MOD-022 Algorithmic View | Stub counts | Isolate mutation details |
| `MOD-023.purge` | MOD-022 Algorithmic View | Spy async call | Verify storage phase handoff |

- **Unit Scenario: UTS-022-A1**
    - **Arrange**: Set `requestedBy` different from subject and `isAdmin=false`.
    - **Act**: Call `erase(req)`.
    - **Assert**: Throws `FORBIDDEN_OWNER` before transaction start.

#### Test Case: UTP-022-B (state/role partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions requester role (`subject`, `admin`, `other`) and in-flight erasure state.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-022-B1**
    - **Arrange**: Stub `findInFlight` returning existing job id.
    - **Act**: Call `erase(req)` as subject user.
    - **Assert**: Throws `ERASURE_IN_PROGRESS` with `existingErasureId`.

#### Test Case: UTP-022-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures orchestrator tests mock repositories and storage purger.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Erasures/photos repository methods | ARCH-022 Interface View | Stub all called methods | Avoid DB transactions |
| Storage purger service | ARCH-022 Interface View | Spy stub | Avoid external deletion operations |
| Transaction wrapper | MOD-022 Algorithmic View | Fake transaction context | Deterministic orchestration |

- **Unit Scenario: UTS-022-C1**
    - **Arrange**: Inject fake tx wrapper and stubs.
    - **Act**: Call `erase(req)` success path.
    - **Assert**: `purge` called exactly once with emitted `erasureId` and collected keys.

#### Test Case: UTP-022-D (in-flight erasure count boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Probes `findInFlight` count boundary at `0` vs `1` existing erasure records.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.erasures.findInFlight` | MOD-022 Internal Data Structures View | Stub empty list then single existing erasure | Assert boundary behavior for concurrency guard |

- **Unit Scenario: UTS-022-D1**
    - **Arrange**: Execute erase with `findInFlight` returning `[]` then `[existingErasure]`.
    - **Act**: Call `erase(req)` for both boundary conditions.
    - **Assert**: `0` proceeds to orchestration; `1` throws `ERASURE_IN_PROGRESS`.

#### Test Case: UTP-022-E (erasure orchestration state transitions)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies `requested → db_done → storage_done → completed | failed` transition graph including invalid/skipped transitions.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.erasures.*` ledger methods | MOD-022 State Machine View | Stateful fake ledger with transition assertions | Deterministically assert allowed/forbidden transitions |
| `MOD-023.purge` | MOD-022 State Machine View | Stub success/failure variants | Drive terminal completed vs failed states |

- **Unit Scenario: UTS-022-E1**
    - **Arrange**: Start erasure in `requested`; run success path through db/storage completion and failure path during storage stage.
    - **Act**: Execute orchestrator transitions.
    - **Assert**: Allowed transitions complete; skipped/invalid transitions are rejected with deterministic error metadata.

#### Test Case: UTP-022-F (error guessing for purge/mutation partial failures)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Injects mutation and purge faults to validate robust `ERASURE_IN_PROGRESS`/failure reporting behavior.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.applyErasureMutations` | MOD-022 Error Handling View | Stub partial mutation failure | Exercise defensive rollback/failure branch |
| `MOD-023.purge` | MOD-022 Error Handling View | Stub storage purge failure | Validate error propagation and ledger consistency |

- **Unit Scenario: UTS-022-F1**
    - **Arrange**: Inject mutation fault and purge fault in separate subcases with deterministic stubs.
    - **Act**: Call `erase(req)`.
    - **Assert**: Orchestrator records failure state deterministically and surfaces expected domain error contract.

---

### Module: MOD-023 (Erasure Storage Purger)

**Parent Architecture Modules**: ARCH-023
**Target Source File(s)**: `packages/services/recipe-service/src/gdpr/erasure.storage-purger.ts`

#### Test Case: UTP-023-A (purge branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers all-success path (`markStorageDone`) and partial-failure path (`recordPartial`).

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `chunk(...)` | MOD-023 Algorithmic View | Stub chunk outputs | Control batching behavior |
| `MOD-025.deleteObjects` | MOD-023 Algorithmic View | Stub Deleted/Errors arrays | Drive success vs partial branch |
| `MOD-025.cloudFront.invalidate` | MOD-023 Algorithmic View | Spy invalidate call | Verify CDN purge behavior |
| `MOD-024.erasures.markStorageDone/recordPartial` | MOD-023 Algorithmic View | Spy methods | Verify state update |

- **Unit Scenario: UTS-023-A1**
    - **Arrange**: Stub one delete batch with `Errors=[{Key:"k1"}]`.
    - **Act**: Call `purge(req)`.
    - **Assert**: Calls `recordPartial(erasureId,["k1"])` and returns `failed=["k1"]`.

#### Test Case: UTP-023-B (batch-size boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies chunking around boundary `1000` keys per batch.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-023-B1**
    - **Arrange**: Provide `photoKeys.length=1001`.
    - **Act**: Execute `purge(req)`.
    - **Assert**: `deleteObjects` invoked twice (1000 + 1 batch behavior).

#### Test Case: UTP-023-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Isolates purger from S3/CloudFront and repository services.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| S3 delete adapter | ARCH-023 Interface View | Stub `deleteObjects` | Avoid object store writes |
| CloudFront adapter | ARCH-023 Interface View | Stub `invalidate` | Avoid CDN API calls |
| Erasure repository | ARCH-023 Interface View | Spy status update methods | Avoid DB I/O |

- **Unit Scenario: UTS-023-C1**
    - **Arrange**: Inject all external adapters as stubs.
    - **Act**: Call `purge(req)`.
    - **Assert**: No live cloud API call occurs.

#### Test Case: UTP-023-D (error guessing for CloudFront invalidation failures)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies robust handling when CloudFront invalidation API throws unexpected errors during purge operations.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| CloudFront adapter | MOD-023 Error Handling View | Stub unexpected error during invalidation | Validate defensive error handling |

- **Unit Scenario: UTS-023-D1**
    - **Arrange**: Stub CloudFront adapter to throw `CloudFrontUnavailable` during invalidation call.
    - **Act**: Call `purge(req)` after successful S3 deletion.
    - **Assert**: Calls `recordPartial` with failed keys and logs error without crashing purge operation.

---

### Module: MOD-024 (Drizzle Repository Layer)

**Parent Architecture Modules**: ARCH-024
**Target Source File(s)**: `packages/services/recipe-service/src/persistence/*.repository.ts`

#### Test Case: UTP-024-A (repository branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers `loadById` miss path, insert/update success, transaction commit and rollback branches.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Drizzle db client/pool | MOD-024 Algorithmic View | Fake pool + query stubs | Control DB responses/errors |
| UUID generator for row_version | MOD-024 Algorithmic View | Stub UUID values | Deterministic update assertions |

- **Unit Scenario: UTS-024-A1**
    - **Arrange**: Stub `loadById` query to return empty rows.
    - **Act**: Call `loadById(id)`.
    - **Assert**: Throws `NOT_FOUND`.

#### Test Case: UTP-024-B (repository method partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions key repository methods (`loadById`,`insert`,`update`,`softDelete`,`searchPage`).

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Drizzle db client/pool | MOD-024 Algorithmic View | Reuse fake pool from UTP-024-A | Maintain strict isolation across all repository partition scenarios |
| UUID generator for row_version | MOD-024 Algorithmic View | Reuse UUID stub from UTP-024-A | Deterministic update assertions across partitions |

- **Unit Scenario: UTS-024-B1**
    - **Arrange**: Execute `update` with valid row and deterministic UUID stub.
    - **Act**: Call `update(tx,id,...)`.
    - **Assert**: Returned row contains new `row_version` from stubbed UUID.

#### Test Case: UTP-024-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures all repository tests use mocked DB driver/pool only.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Drizzle ORM query executor | ARCH-024 Interface View | Stub query builder/execute | Avoid real DB |
| PostgreSQL connection pool | ARCH-024 Interface View | Fake pool object | Isolate transaction behavior |

- **Unit Scenario: UTS-024-C1**
    - **Arrange**: Inject fake pool and fake drizzle adapter.
    - **Act**: Run `transaction(fn)` with controlled success and failure closures.
    - **Assert**: Calls `COMMIT` on success branch and `ROLLBACK` on failure branch in stubs.

---

### Module: MOD-026 (Web Recipe & Collection UI)

**Parent Architecture Modules**: ARCH-026
**Target Source File(s)**: `packages/apps/commise/web/src/app/(recipes)/**`, `…/(collections)/**`

#### Test Case: UTP-026-A (UI orchestration branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers save success, 409 conflict branch, upload pipeline branch, and auth redirect branch.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `fetch` API client | MOD-026 Algorithmic View | Stub response codes/bodies | Control network outcomes |
| Clerk session provider (`@clerk/nextjs`) | MOD-026 Interface View | Stub authenticated/unauthenticated | Drive redirect branch |

- **Unit Scenario: UTS-026-A1**
    - **Arrange**: Stub PATCH response `409` with conflict payload and local `rowVersion`.
    - **Act**: Invoke `saveRecipe(form,rowVersion)` action.
    - **Assert**: Internal conflict state transitions to `conflict_detected`.

#### Test Case: UTP-026-B (state partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions `RecipeFormState.conflict` present/absent and photo widget states.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-026-B1**
    - **Arrange**: Initialize form state with `conflict` undefined.
    - **Act**: Process successful save response.
    - **Assert**: Keeps `conflict` undefined and updates `rowVersion` value.

#### Test Case: UTP-026-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures web UI unit tests mock auth/session, API client, and upload endpoints.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `@clerk/nextjs` SDK | ARCH-026 Interface View | Stub session hook | No live auth interactions |
| API fetch layer | ARCH-026 Interface View | Stub fetch responses | No real HTTP calls |
| Presign/confirm endpoints | MOD-026 Algorithmic View | Stub deterministic responses | Isolate upload state machine |

- **Unit Scenario: UTS-026-C1**
    - **Arrange**: Inject mocked session and fetch adapters.
    - **Act**: Execute `uploadPhoto(file)`.
    - **Assert**: Progresses through internal states using mocks only.

#### Test Case: UTP-026-D (web UI state-machine transitions)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies photo widget and conflict resolver transitions `idle → presigning → uploading → confirming → processing → ready | failed` and `clean → editing → conflict_detected → resolved`.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Presign/upload/confirm API calls | MOD-026 State Machine View | Stub deterministic success/failure responses by stage | Assert valid/invalid transition behavior without network |

- **Unit Scenario: UTS-026-D1**
    - **Arrange**: Initialize widget in `idle` and resolver in `clean`; prepare staged API responses for success and failure paths.
    - **Act**: Execute upload and save/conflict flows.
    - **Assert**: Valid transitions reach `ready`/`resolved`; skipped transitions are rejected and failure path reaches `failed`/`conflict_detected`.

---

### Module: MOD-027 (Mobile Recipe & Collection UI)

**Parent Architecture Modules**: ARCH-027
**Target Source File(s)**: `packages/apps/commise/mobile/src/screens/**`
**Coverage Adequacy**: UTP-027-A/B/C/D provide full branch, partition, isolation, and state-transition coverage per module-design.md Algorithmic/Logic View and State Machine View — no additional techniques required.

#### Test Case: UTP-027-A (mobile orchestration branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers token bootstrap success/failure, photo capture upload flow, and invalid token recovery branch.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `SecureStore.getItem` | MOD-027 Algorithmic View | Stub token/empty | Drive auth bootstrap branches |
| `@clerk/expo` login | MOD-027 Algorithmic View | Stub login result | Avoid auth network |
| API fetch client | MOD-027 Algorithmic View | Stub responses | Control flow outcomes |

- **Unit Scenario: UTS-027-A1**
    - **Arrange**: Stub secure-store token as expired and login function as success.
    - **Act**: Call `authBootstrap()`.
    - **Assert**: Internal auth state transitions from `bootstrapping` to `authenticated`.

#### Test Case: UTP-027-B (auth/UI state partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions auth state (`authenticated`, `needs_login`) and conflict modal visibility state.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-027-B1**
    - **Arrange**: Mock API response code `INVALID_TOKEN`.
    - **Act**: Process response in screen state reducer.
    - **Assert**: Clears token and transitions to `needs_login`.

#### Test Case: UTP-027-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures mobile unit tests fully mock SecureStore, Clerk SDK (`@clerk/expo`), and network adapter.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Expo SecureStore | ARCH-027 Interface View | Stub get/set/remove | No device keychain access |
| `@clerk/expo` | ARCH-027 Interface View | Stub login/token methods | No OAuth network |
| API fetch layer | ARCH-027 Interface View | Stub HTTP client | No backend calls |

- **Unit Scenario: UTS-027-C1**
    - **Arrange**: Inject mocked storage/auth/network modules.
    - **Act**: Run auth bootstrap and photo upload handlers.
    - **Assert**: No unmocked device/network dependency used.

#### Test Case: UTP-027-D (mobile auth state transitions)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies auth state transitions `bootstrapping → authenticated | needs_login` including invalid transition handling.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| SecureStore/Clerk (`@clerk/expo`) bootstrap dependencies | MOD-027 State Machine View | Stub token present/expired/missing and login outcomes | Deterministically drive auth transition graph |

- **Unit Scenario: UTS-027-D1**
    - **Arrange**: Run bootstrap with three variants: valid token, expired token with successful login, and missing token with login failure.
    - **Act**: Call `authBootstrap()`.
    - **Assert**: State settles to `authenticated` for valid/renewed credentials and `needs_login` for unrecoverable path; invalid jumps are blocked.

---

### Module: MOD-028 (API Error Mapper)

**Parent Architecture Modules**: ARCH-028
**Target Source File(s)**: `packages/services/recipe-service/src/errors/api-error.filter.ts`
**Coverage Adequacy**: UTP-028-A/B/C/D provide full branch, partition, isolation, and error-guessing coverage per module-design.md Algorithmic/Logic View and Error Handling table — no additional techniques required.

#### Test Case: UTP-028-A (error mapping branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers DomainError mapping, HttpException mapping, unknown error fallback to INTERNAL.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Nest `ArgumentsHost` response objects | MOD-028 Algorithmic View | Fake req/res objects | Deterministic response assertions |
| `MOD-030.error` logger | MOD-028 Algorithmic View | Spy logger call | Verify unknown-error logging |

- **Unit Scenario: UTS-028-A1**
    - **Arrange**: Pass unknown `Error("boom")` and request without `x-request-id`.
    - **Act**: Call `catch(err, host)`.
    - **Assert**: Responds `500` with `code="INTERNAL"` and generated `requestId`.

#### Test Case: UTP-028-B (error-code partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions domain code mapping table (`400/401/403/404/409/500/503`).

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-028-B1**
    - **Arrange**: Build DomainError with `code="CONCURRENCY_CONFLICT"`.
    - **Act**: Execute filter `catch`.
    - **Assert**: Writes response status `409` and body code `CONCURRENCY_CONFLICT`.

#### Test Case: UTP-028-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Confirms mapper is tested with mocked HTTP host and logger only.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| NestJS host/request/response | ARCH-028 Interface View | Fakes for `getRequest/getResponse` | No framework runtime boot |
| Telemetry logger | ARCH-028 Interface View | Spy `error` method | Verify side effects |

- **Unit Scenario: UTS-028-C1**
    - **Arrange**: Inject fake host and logger stubs.
    - **Act**: Run catch for all error classes.
    - **Assert**: No app bootstrap or network interaction required.

#### Test Case: UTP-028-D (error guessing for HttpException edge payloads)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Exercises uncommon HttpException payload shapes to ensure mapper emits stable fallback contracts.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Nest `HttpException` object | MOD-028 Error Handling View | Stub atypical response payloads (string/object/missing code) | Validate defensive mapping branch robustness |
| `MOD-030.error` logger | MOD-028 Error Handling View | Spy logging for malformed exception payloads | Ensure observability on fallback branches |

- **Unit Scenario: UTS-028-D1**
    - **Arrange**: Feed mapper HttpException variants with missing/malformed response bodies.
    - **Act**: Call `catch(exception, host)`.
    - **Assert**: Mapper returns deterministic status/body contract and logs malformed payload fallback path.

---

### Module: MOD-029 (Config Loader)

**Parent Architecture Modules**: ARCH-029
**Target Source File(s)**: `packages/services/recipe-service/src/config/config.module.ts`, `…/config.schema.ts`

#### Test Case: UTP-029-A (config load branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers parse success freeze path and parse failure path with process exit.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `schema.safeParse` | MOD-029 Algorithmic View | Stub success/failure results | Drive both branches |
| `process.exit` | MOD-029 Algorithmic View | Spy/stub exit | Prevent real process termination |

- **Unit Scenario: UTS-029-A1**
    - **Arrange**: Stub `safeParse` with `{success:false,error:...}`.
    - **Act**: Call `load()`.
    - **Assert**: Calls `process.exit(1)` after printing formatted error.

#### Test Case: UTP-029-B (port/schema boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies numeric boundary `PORT >= 1` and optional/required env handling.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-029-B1**
    - **Arrange**: Set `PORT=0` in env input and parse through schema.
    - **Act**: Execute `load()`.
    - **Assert**: Fails validation and triggers non-zero boot exit branch.

#### Test Case: UTP-029-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures tests isolate environment and process globals.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `process.env` | ARCH-029 Interface View | Inject cloned env map | Avoid host-environment coupling |
| `process.exit`/`console` | ARCH-029 Interface View | Stub side-effect functions | Safe failure-path verification |

- **Unit Scenario: UTS-029-C1**
    - **Arrange**: Provide isolated env object and process stubs.
    - **Act**: Run `load()` for success case.
    - **Assert**: Returns frozen config and does not touch real process state.

---

### Module: MOD-030 (Telemetry & Logger `[CROSS-CUTTING]`)

**Parent Architecture Modules**: ARCH-030
**Target Source File(s)**: `packages/services/recipe-service/src/observability/logger.ts`, `…/metrics.ts`

#### Test Case: UTP-030-A (telemetry branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers redaction path, correlation attachment path, and swallowed internal logger error path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Powertools logger | MOD-030 Interface View | Stub emit methods | Isolate logging backend |
| Sentry emitter | MOD-030 Interface View | Stub breadcrumb/capture | Avoid external telemetry network |

- **Unit Scenario: UTS-030-A1**
    - **Arrange**: Input fields include `email`, `token`, and `presignedUrl` keys.
    - **Act**: Call logger emit function.
    - **Assert**: Output fields mask sensitive values before sink invocation.

#### Test Case: UTP-030-B (level partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions level enum values (`debug/info/warn/error`).

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-030-B1**
    - **Arrange**: Set event level `warn`.
    - **Act**: Emit event.
    - **Assert**: Routes through warning sink path and preserves request correlation field.

#### Test Case: UTP-030-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures all telemetry sinks are mocked.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Powertools logger backend | ARCH-030 Interface View | Stub logger object | No stdout/cloud side effects |
| Sentry SDK | ARCH-030 Interface View | Stub capture functions | No outbound telemetry |
| CloudWatch EMF metrics sink | ARCH-030 Interface View | Stub metric publisher | Isolate metric serialization |

- **Unit Scenario: UTS-030-C1**
    - **Arrange**: Inject mocked sink implementations.
    - **Act**: Emit log + metric events.
    - **Assert**: No live telemetry endpoint interaction.

---

### Module: MOD-031 (Archive Backlog Alarm `[CROSS-CUTTING]`)

**Parent Architecture Modules**: ARCH-031
**Target Source File(s)**: `packages/infra/cdk/lib/archive-backlog-alarm.ts`

#### Test Case: UTP-031-A (alarm construct branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers all three alarm definitions and SNS action attachments.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| CDK `Alarm` construct | MOD-031 Algorithmic View | Stub construct factory | Verify threshold config without synth |
| SNS action wrapper | MOD-031 Algorithmic View | Spy action assignment | Validate wiring behavior |

- **Unit Scenario: UTS-031-A1**
    - **Arrange**: Instantiate construct with fake queue/dlq/topic resources.
    - **Act**: Build alarms.
    - **Assert**: Creates age, visible-count, and DLQ alarms with configured thresholds.

#### Test Case: UTP-031-B (threshold boundaries)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures
**Description**: Verifies boundary constants `600s` age and `1000` visible count.

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-031-B1**
    - **Arrange**: Extract generated alarm config from construct.
    - **Act**: Inspect threshold properties.
    - **Assert**: Age threshold equals `600`, backlog threshold equals `1000`.

#### Test Case: UTP-031-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures CDK resources are represented by fakes only.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| CloudWatch CDK constructs | ARCH-031 Interface View | Fake construct classes | No AWS deploy/synth required |
| SNS action construct | ARCH-031 Interface View | Stub action class | Verify attachment calls only |

- **Unit Scenario: UTS-031-C1**
    - **Arrange**: Provide fake CDK scope/resources.
    - **Act**: Instantiate `ArchiveBacklogAlarm`.
    - **Assert**: Construct composes alarms without contacting AWS APIs.

---

### Module: MOD-032 (CI & Test Governance Harness `[CROSS-CUTTING]`)

**Parent Architecture Modules**: ARCH-032
**Target Source File(s)**: `packages/tools/test-governance/*`

#### Test Case: UTP-032-A (pipeline branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers governance script pass path, check-failure path, and traceability-gate failure path in TypeScript harness logic.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Turbo command runner | MOD-032 Algorithmic View | Stub exit codes | Drive pipeline outcomes |
| Coverage/traceability scripts | MOD-032 Algorithmic View | Stub pass/fail outputs | Validate gate behavior |

- **Unit Scenario: UTS-032-A1**
    - **Arrange**: Stub `validate-module-coverage.sh` result as failure.
    - **Act**: Execute governance script main function.
    - **Assert**: Returns non-zero and marks `v-model-traceability` gate as failed.

> Workflow/YAML validation is intentionally tracked in integration test planning (ITP), not this unit-test artifact.

#### Test Case: UTP-032-B (result partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions pipeline terminal states (`success`, `failure`, `cancelled`).

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-032-B1**
    - **Arrange**: Inject command results with all checks passing.
    - **Act**: Run governance harness evaluator.
    - **Assert**: Emits terminal status `success`.

#### Test Case: UTP-032-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures CI governance tests isolate shell/process execution dependencies.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Shell command executor | ARCH-032 Interface View | Stub process runner | No real CI command execution |
| File-system readers for workflow files | ARCH-032 Interface View | Stub in-memory fixtures | Deterministic parsing |
| Coverage validators | ARCH-032 Interface View | Stub script outputs | Control gate branching |

- **Unit Scenario: UTS-032-C1**
    - **Arrange**: Inject fake runner and fixture files.
    - **Act**: Evaluate pipeline checks.
    - **Assert**: All interactions occur against stubs only.

---

### Module: MOD-033 (NestJS Module Wiring `[CROSS-CUTTING]`)

**Parent Architecture Modules**: ARCH-033
**Target Source File(s)**: `packages/services/recipe-service/src/app.module.ts`, `…/main.ts`

#### Test Case: UTP-033-A (bootstrap branch coverage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Covers successful app creation/listen path and bootstrap failure path.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `NestFactory.create` | MOD-033 Algorithmic View | Stub app instance/throw | Drive success/failure branches |
| App logger (MOD-030) | MOD-033 Algorithmic View | Stub logger object | Verify wiring call |
| Config loader (MOD-029) | MOD-033 Algorithmic View | Stub config values | Deterministic port binding |

- **Unit Scenario: UTS-033-A1**
    - **Arrange**: Stub `NestFactory.create` returning fake app with spies for `useLogger`, `listen`.
    - **Act**: Run `main.ts` bootstrap routine.
    - **Assert**: Calls `useLogger` then `listen(config.PORT)`.

#### Test Case: UTP-033-B (lifecycle partitions)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures
**Description**: Partitions lifecycle states (`bootstrapping`, `listening`, `draining`, `stopped`).

**Dependency & Mock Registry:**
None — module is self-contained

- **Unit Scenario: UTS-033-B1**
    - **Arrange**: Simulate SIGTERM signal callback with fake app hooks.
    - **Act**: Trigger shutdown sequence.
    - **Assert**: App transitions from `listening` to `draining` and then `stopped` via hook calls.

#### Test Case: UTP-033-C (Strict dependency isolation)

**Technique**: Strict Isolation
**Target View**: Architecture Interface View
**Description**: Ensures module wiring tests use only mocked Nest factory and DI tokens.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| NestFactory/bootstrap runtime | ARCH-033 Interface View | Stub create/listen methods | No real server startup |
| Feature modules/providers | ARCH-033 Interface View | Stub DI token registry | Isolate composition behavior |
| Observability logger | ARCH-033 Interface View | Stub logger sink | Avoid real logging side effects |

- **Unit Scenario: UTS-033-C1**
    - **Arrange**: Replace Nest runtime and module imports with fakes.
    - **Act**: Initialize `AppModule` and run bootstrap.
    - **Assert**: No network socket bind or actual provider initialization occurs.

#### Test Case: UTP-033-D (bootstrap lifecycle state transitions)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies app lifecycle transitions `bootstrapping → listening → draining → stopped` and rejects invalid transition ordering.

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `NestFactory.create` app hooks | MOD-033 State Machine View | Stateful fake app with lifecycle guards | Explicitly assert allowed transition edges |
| Process signal handlers | MOD-033 State Machine View | Stub signal dispatch callbacks | Deterministically trigger draining/stopped transitions |

- **Unit Scenario: UTS-033-D1**
    - **Arrange**: Initialize fake app in `bootstrapping`, then trigger listen and SIGTERM callbacks.
    - **Act**: Execute bootstrap then shutdown flow.
    - **Assert**: Observed sequence matches `bootstrapping → listening → draining → stopped`; skipped transitions are rejected.

---

## Peer-Review Remediation Addendum

#### Test Case: UTP-001-D (MOD-001 auth verifier error guessing for malformed header)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies defensive handling when a token's protected header is malformed, so networkless signature verification against the local `CLERK_JWT_KEY` cannot proceed and the verifier fails closed. (Closes: MOD-001 error-guessing gap)

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `jose.decodeProtectedHeader` | MOD-001 Algorithmic View | Stub malformed header `{}` | Simulate real-world malformed token metadata |
| `@clerk/backend.verifyToken` | MOD-001 Algorithmic View | Stub reject on malformed/unverifiable token | Drive networkless fail-closed `INVALID_TOKEN` error path |

- **Unit Scenario: UTS-001-D1**
    - **Arrange**: Use non-empty bearer token, stub header decode to return a malformed object, and stub `verifyToken` to reject because the local-key signature check cannot complete.
    - **Act**: Call `verify(bearerToken)`.
    - **Assert**: Throws `INVALID_TOKEN` (HTTP 401) with no `Principal` return and no outbound network I/O (no JWKS fetch attempted).

#### Test Case: UTP-005-D (MOD-005 validator error guessing for null ingredients element)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Ensures unexpected `null` array member in `ingredients[]` is flattened into deterministic `VALIDATION_FAILED` output. (Closes: MOD-005 error-guessing gap)

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `validateSync` | MOD-005 Algorithmic View | Stub nested validation error for `ingredients[1]` | Reproduce malformed client payload edge case |

- **Unit Scenario: UTS-005-D1**
    - **Arrange**: Build create payload with `ingredients=[validItem,null]` and validator stub returning nested constraint errors.
    - **Act**: Call `validateCreate(payload)`.
    - **Assert**: Throws `VALIDATION_FAILED` including flattened path `ingredients[1]` and constraint message.

#### Test Case: UTP-013-D (MOD-013 confirm error guessing for S3 metadata shape mismatch)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Verifies confirm flow rejects object metadata missing required `etag` despite object presence. (Closes: MOD-013 error-guessing gap)

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| `MOD-024.photoUploads.findPendingByKey` | MOD-013 Algorithmic View | Stub valid pending row | Reach metadata checks |
| `MOD-025.headObject` | MOD-013 Algorithmic View | Stub object metadata with empty `etag` | Model inconsistent provider response |

- **Unit Scenario: UTS-013-D1**
    - **Arrange**: Stub pending upload row owned by principal; stub headObject result with `contentLength/contentType` but missing `etag` value.
    - **Act**: Call `confirm({objectKey, etag:"expected"}, principal)`.
    - **Assert**: Throws `INVALID_PHOTO("etag mismatch")` and does not call `MOD-024.photos.insert`.

#### Test Case: UTP-024-D (MOD-024 repository error guessing for unique constraint violation)

**Technique**: Error Guessing
**Target View**: Error Handling & Return Codes
**Description**: Confirms Postgres `23505` is normalized to domain-level `UNIQUE_VIOLATION` with constraint context. (Closes: MOD-024 error-guessing gap)

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Drizzle query executor | MOD-024 Algorithmic View | Stub insert reject `{ code:"23505", constraint:"recipes_owner_title_key" }` | Validate error-code translation contract |

- **Unit Scenario: UTS-024-D1**
    - **Arrange**: Prepare insert payload that collides on owner/title unique key and stub db driver to throw `23505`.
    - **Act**: Call repository `insert(tx, row)`.
    - **Assert**: Throws `UNIQUE_VIOLATION` with `constraint="recipes_owner_title_key"`.

#### Test Case: UTP-001-E (MOD-001 networkless verification and key-rotation handling)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Validates that networkless verification holds no key cache and performs no key-refresh state transitions — there is no `EMPTY → POPULATED → STALE → REFRESHING` lifecycle because the verifier reads the local `CLERK_JWT_KEY` directly. Key rotation is handled by configuration (overlapping old/new key acceptance during cutover) and boot-time key validation, not by a runtime cache. (Closes: MOD-001 state-transition gap)

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| Network I/O (fetch) | MOD-001 Algorithmic View | Spy/assert no outbound calls | Prove verification is networkless (no JWKS round trip) |
| `CLERK_JWT_KEY` config | MOD-001 Algorithmic View | Provide valid then rotated key fixtures | Verify rotation handled at config/boot, not via runtime cache |

- **Unit Scenario: UTS-001-E1**
    - **Arrange**: Configure a valid local `CLERK_JWT_KEY` and a token signed by the corresponding signing key; install a network spy.
    - **Act**: Verify the token multiple times in sequence.
    - **Assert**: Each verification succeeds using only the local key, the network spy records zero outbound calls (no JWKS fetch), and no key-cache state transition is observable.

- **Unit Scenario: UTS-001-E2**
    - **Arrange**: Simulate Clerk key rotation by configuring an overlapping-key set (old + new `CLERK_JWT_KEY` accepted during cutover); present tokens signed by each.
    - **Act**: Verify a token signed by the old key and one signed by the new key during the overlap window.
    - **Assert**: Both verify successfully via local keys with no network I/O; a token signed by neither configured key fails closed with `INVALID_TOKEN` (HTTP 401).

#### Test Case: UTP-024-E (MOD-024 connection-pool lifecycle transitions)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies pool lifecycle `idle → in_use → broken → recreated → idle` when transaction branch experiences connection failure and recovery. (Closes: MOD-024 state-transition gap)

**Dependency & Mock Registry:**
| Dependency | Source | Mock/Stub Strategy | Rationale |
| --- | --- | --- | --- |
| PostgreSQL pool client | MOD-024 State Machine View | Fake pool stateful test double | Explicitly assert pool-state transitions |
| `transaction(fn)` wrapper | MOD-024 Algorithmic View | Stub closure throw then subsequent success | Exercise broken/recreated recovery path |

- **Unit Scenario: UTS-024-E1**
    - **Arrange**: Start fake pool in `idle`, make first `transaction(fn)` acquire client and throw simulated connection reset during `BEGIN`.
    - **Act**: Invoke recovery path that recreates pool, then run second transaction successfully.
    - **Assert**: State sequence follows `idle → in_use → broken → recreated → idle`, with first call surfacing `DB_UNAVAILABLE` and second call committing.

---

## External Module Bypass

### External Module Bypass: MOD-025 (S3 & CloudFront Adapter `[EXTERNAL]`)

> Module MOD-025 is [EXTERNAL] — wrapper behavior tested at integration level.

---

## Coverage Summary

| Metric                         | Count                    |
| ------------------------------ | ------------------------ |
| Total Modules (MOD)            | 33                       |
| Modules tested                 | 32 (excludes [EXTERNAL]) |
| Modules bypassed ([EXTERNAL])  | 1                        |
| Total Test Cases (UTP)         | 116                      |
| Total Scenarios (UTS)          | 117                      |
| Modules with ≥1 UTP            | 32 / 32 (100%)           |
| Test Cases with ≥1 UTS         | 116 / 116 (100%)         |
| **Overall Coverage (MOD→UTP)** | **100%**                 |

### Technique Distribution

| Technique                   | Test Cases | Percentage |
| --------------------------- | ---------- | ---------- |
| Statement & Branch Coverage | 32         | 27.6%      |
| Boundary Value Analysis     | 16         | 13.8%      |
| Equivalence Partitioning    | 20         | 17.2%      |
| Strict Isolation            | 29         | 25.0%      |
| Error Guessing              | 12         | 10.3%      |
| State Transition Testing    | 7          | 6.0%       |

_Strict Isolation not applicable to pure-function modules (MOD-006, MOD-007, MOD-011); technique count reflects testable modules only._

## Uncovered Modules

None — full coverage achieved.

## Peer-Review Remediation Log

| Finding ID  | Action Taken                                                                                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-UTP-001 | Renumbered addendum IDs to schema-compliant IDs: `UTP-094→UTP-001-D`, `UTP-095→UTP-005-D`, `UTP-096→UTP-013-D`, `UTP-097→UTP-024-D`, `UTP-098→UTP-001-E`, `UTP-099→UTP-024-E`; updated all scenario IDs and coverage summary references.                                                                       |
| PRF-UTP-002 | Added state transition test cases for all missing stateful modules: `UTP-013-E`, `UTP-022-E`, `UTP-026-D`, `UTP-027-D`, `UTP-033-D` with valid/invalid/terminal transition assertions.                                                                                                                         |
| PRF-UTP-003 | Added `Coverage Adequacy` notes to MOD-027 and MOD-028 module headers documenting that UTP-A/B/C/D provide full coverage per module-design.md — addresses observation that MOD-027 and MOD-028 have only 4 test cases each.                                                                                    |
| PRF-UTP-003 | Added Dependency & Mock Registry tables to `UTP-002-B` and `UTP-003-B` with explicit stubs for repository/controller collaborators.                                                                                                                                                                            |
| PRF-UTP-004 | Added targeted Error Guessing cases across high-risk modules: `UTP-004-D`, `UTP-008-D`, `UTP-016-D`, `UTP-017-D`, `UTP-018-D`, `UTP-022-F`, `UTP-028-D` (plus renumbered addendum error-guessing cases).                                                                                                       |
| PRF-UTP-005 | Added Boundary Value Analysis where missing: `UTP-002-D`, `UTP-006-D`, `UTP-007-C`, `UTP-022-D`.                                                                                                                                                                                                               |
| PRF-UTP-006 | Raised MOD-006 and MOD-007 above minimum technique coverage by adding `UTP-006-C`, `UTP-006-D`, and `UTP-007-C`.                                                                                                                                                                                               |
| PRF-UTP-007 | Updated `UTP-008-B` description to minimum-boundary wording and added below-minimum scenario `UTS-008-B2` (`quantity=-0.001`).                                                                                                                                                                                 |
| PRF-UTP-008 | Removed unresolved forward-reference heading by renaming section to `## Peer-Review Remediation Addendum` and added inline closure notes to addendum descriptions.                                                                                                                                             |
| PRF-UTP-009 | Recounted actual `UTP` headings and updated Coverage Summary totals/percentages to match current artifact contents.                                                                                                                                                                                            |
| PRF-UTP-010 | Added accurate Dependency & Mock Registry for `UTP-024-B`, reusing fake pool/UUID stubs from `UTP-024-A`.                                                                                                                                                                                                      |
| PRF-UTP-011 | Documented intentional pure-function deviation for MOD-011 via explicit strict-isolation applicability note under MOD-011 section.                                                                                                                                                                             |
| PRF-UTP-012 | Added networkless verification state-transition scenario `UTS-001-E2` covering key-rotation via overlapping `CLERK_JWT_KEY` acceptance with fail-closed `INVALID_TOKEN` assertions and no outbound network I/O. (Re-grounded from the prior JWKS cache-refresh scenario to match the networkless Clerk model.) |
| PRF-UTP-013 | Clarified MOD-032 unit scope to TypeScript governance scripts only and moved workflow/YAML validation to integration scope note.                                                                                                                                                                               |
| PRF-UTP-014 | Added Technique Distribution footnote explaining strict-isolation applicability for pure-function modules and recalculated percentages against corrected totals.                                                                                                                                               |
