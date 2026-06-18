# V-Model Traceability Matrix: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Generated**: 2026-05-09
**Baseline Status**: Draft — Pending Execution
**Traceability Standard**: ISO 29119 / V-Model bidirectional coverage

---

## Artifact Information

| Artifact                   | File                                                    | Created    | Status     | Scope                                              |
| -------------------------- | ------------------------------------------------------- | ---------- | ---------- | -------------------------------------------------- |
| Requirements Specification | `specs/004-recipe-importing/v-model/requirements.md`    | 2026-05-09 | Draft      | 15 FR + 5 NF + 4 IF + 4 CN = 28 total requirements |
| Acceptance Test Plan       | `specs/004-recipe-importing/v-model/acceptance-plan.md` | 2026-05-09 | Draft      | AT cases for all 15 FR + selected NF/IF            |
| Unit Test Plan             | `specs/004-recipe-importing/v-model/unit-test.md`       | 2026-05-09 | Draft      | 18 MODs, 33 UTP cases, 91 UTS scenarios            |
| System Design              | `specs/004-recipe-importing/v-model/system-design.md`   | —          | Referenced | ARCH modules (ARCH-001 through ARCH-018+)          |
| Module Design              | `specs/004-recipe-importing/v-model/module-design.md`   | —          | Referenced | MOD-001 through MOD-018                            |

**Legend**:

- ⬜ Pending Execution — test defined, not yet run
- ✅ Passed — test executed and passed
- ❌ Failed — test executed and failed
- ⚠️ Partially Passed — test executed with partial pass

---

## Matrix A: Forward Traceability (REQ → ATP)

> Maps every requirement to its acceptance test case(s). Gaps indicate requirements with no acceptance coverage.

### Functional Requirements

| REQ-ID  | Requirement (Summary)                                                                                  | Priority | ATP-ID                       | Acceptance Test (Summary)                                                  | Verification Method                               | Status |
| ------- | ------------------------------------------------------------------------------------------------------ | -------- | ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| REQ-001 | Import recipe from public website URL (title, ingredients, instructions, photos)                       | P1       | AT-001-A, AT-001-B           | Successful web URL import; unreachable/invalid URL rejection               | Equivalence Partitioning, Boundary Value Analysis | ⬜     |
| REQ-002 | Import recipe from public Instagram post via oEmbed caption                                            | P1       | AT-002-A                     | Successful Instagram caption import                                        | Equivalence Partitioning                          | ⬜     |
| REQ-003 | Reject video-only or image-only Instagram posts with no recipe caption                                 | P1       | AT-003-A                     | Unsupported Instagram post rejected with explanation                       | Equivalence Partitioning                          | ⬜     |
| REQ-004 | Display source attribution (URL, author, platform) for web/Instagram imports                           | P1       | AT-004-A                     | Attribution visible on imported recipe detail screen                       | Equivalence Partitioning                          | ⬜     |
| REQ-005 | Automatically mark web/Instagram imports as public                                                     | P1       | AT-005-A                     | Imported recipes default to public visibility                              | Equivalence Partitioning                          | ⬜     |
| REQ-006 | Prevent making public imported recipe private unless cloned + substantively edited by premium user     | P1       | AT-006-A, AT-006-B           | Standard user blocked; premium user blocked on unedited clone              | Equivalence Partitioning                          | ⬜     |
| REQ-007 | Allow cloning of imported public recipe; clone retains attribution and stays public until premium edit | P1       | AT-007-A, AT-007-B           | Clone created with attribution; premium user can make edited clone private | Equivalence Partitioning                          | ⬜     |
| REQ-008 | Deduplicate by source URL; surface existing recipe and offer clone on duplicate                        | P1       | AT-008-A                     | Duplicate URL surfaces existing recipe and clone option                    | Equivalence Partitioning                          | ⬜     |
| REQ-009 | Allow import from physical copies via photo capture and OCR                                            | P1       | AT-009-A                     | Successful physical copy import with OCR review screen                     | Equivalence Partitioning                          | ⬜     |
| REQ-010 | Mark physical copy imports as private with no source attribution                                       | P1       | AT-010-A                     | Physical copy import defaults to private, no attribution shown             | Equivalence Partitioning                          | ⬜     |
| REQ-011 | Allow user to review and correct OCR-extracted content before saving                                   | P2       | AT-011-A                     | OCR review and correction before save                                      | Equivalence Partitioning                          | ⬜     |
| REQ-012 | Reject imports from known paywalled sources with clear explanation                                     | P1       | AT-012-A                     | Known paywalled source rejected before extraction                          | Equivalence Partitioning                          | ⬜     |
| REQ-013 | Flag manually entered paid-source recipes; prevent making them public                                  | P1       | AT-013-A                     | Manual entry paid source flagging and visibility restriction               | Equivalence Partitioning                          | ⬜     |
| REQ-014 | Inform user on 404/unavailable URL; do not create recipe record                                        | P2       | AT-001-B                     | Unreachable URL rejected with error; no recipe created                     | Boundary Value Analysis                           | ⬜     |
| REQ-015 | Preserve imported recipe when source Instagram post is later deleted; update attribution note          | P2       | _(Analysis — no AT defined)_ | —                                                                          | Analysis                                          | ⬜     |

### Non-Functional Requirements

| REQ-ID     | Requirement (Summary)                                                         | Priority | ATP-ID                         | Acceptance Test (Summary)                                      | Verification Method | Status |
| ---------- | ----------------------------------------------------------------------------- | -------- | ------------------------------ | -------------------------------------------------------------- | ------------------- | ------ |
| REQ-NF-001 | TypeScript strict mode; no `any` outside test doubles                         | P1       | _(Inspection — no AT defined)_ | —                                                              | Inspection          | ⬜     |
| REQ-NF-002 | All exported functions and interfaces carry JSDoc                             | P1       | _(Inspection — no AT defined)_ | —                                                              | Inspection          | ⬜     |
| REQ-NF-003 | ≥85% extraction accuracy for title, ingredients, instructions                 | P1       | _(Analysis — no AT defined)_   | —                                                              | Analysis            | ⬜     |
| REQ-NF-004 | All import UI components expose accessible name queryable by role/label       | P1       | AT-NF004-A                     | Import UI components have accessible names in Playwright       | Test                | ⬜     |
| REQ-NF-005 | Color must not be sole conveyor of state; icon or text label pairing required | P1       | AT-NF005-A                     | State not conveyed by color alone; icon/label pairing verified | Inspection          | ⬜     |

### Interface Requirements

| REQ-ID     | Requirement (Summary)                                                                          | Priority | ATP-ID                         | Acceptance Test (Summary)                                        | Verification Method | Status |
| ---------- | ---------------------------------------------------------------------------------------------- | -------- | ------------------------------ | ---------------------------------------------------------------- | ------------------- | ------ |
| REQ-IF-001 | Integrate with Instagram public oEmbed API for caption extraction                              | P1       | _(Inspection — no AT defined)_ | —                                                                | Inspection          | ⬜     |
| REQ-IF-002 | Integrate with OCR/text extraction service for physical copy photos                            | P1       | _(Inspection — no AT defined)_ | —                                                                | Inspection          | ⬜     |
| REQ-IF-003 | Integrate with Recipe entity model from feature 001; all imports stored as Recipe entities     | P1       | _(Inspection — no AT defined)_ | —                                                                | Inspection          | ⬜     |
| REQ-IF-004 | Enforce authentication via feature 002 for all import actions; reject unauthenticated attempts | P1       | AT-IF004-A                     | Unauthenticated import attempt rejected; user redirected to auth | Test                | ⬜     |

### Constraint Requirements

| REQ-ID     | Requirement (Summary)                                                                         | Priority | ATP-ID                         | Acceptance Test (Summary)                   | Verification Method | Status |
| ---------- | --------------------------------------------------------------------------------------------- | -------- | ------------------------------ | ------------------------------------------- | ------------------- | ------ |
| REQ-CN-001 | No more than one public recipe per unique source URL (deduplication key)                      | P1       | AT-008-A                       | Duplicate URL does not create second record | Test                | ⬜     |
| REQ-CN-002 | Never make public any recipe from a paywalled or paid source                                  | P1       | _(Inspection — no AT defined)_ | —                                           | Inspection          | ⬜     |
| REQ-CN-003 | Instagram import limited to caption-text posts at launch; video/image-only out of scope       | P1       | _(Inspection — no AT defined)_ | —                                           | Inspection          | ⬜     |
| REQ-CN-004 | Paid-source detection mechanism for manual entries must not be finalised without legal review | P1       | _(Inspection — no AT defined)_ | —                                           | Inspection          | ⬜     |

---

## Matrix B: Backward Traceability (ATP → REQ)

> Maps every acceptance test case back to its parent requirement. Orphan ATs (no REQ) are flagged.

| ATP-ID     | Acceptance Test (Summary)                                  | REQ-ID              | Requirement (Summary)                                | Justification                                                                   |
| ---------- | ---------------------------------------------------------- | ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| AT-001-A   | Successful web URL import (schema.org and heuristic paths) | REQ-001             | Import recipe from public website URL                | Directly verifies structured extraction and attribution display for web imports |
| AT-001-B   | Unreachable or invalid URL rejected                        | REQ-001, REQ-014    | Web URL import; 404/unavailable URL handling         | Verifies error path: no recipe created, user-facing error shown                 |
| AT-002-A   | Successful Instagram caption import                        | REQ-002             | Import from Instagram post via oEmbed                | Confirms caption extraction and attribution for Instagram imports               |
| AT-003-A   | Unsupported Instagram post rejected                        | REQ-003             | Reject video-only/image-only Instagram posts         | Confirms rejection with explanation for non-caption posts                       |
| AT-004-A   | Attribution visible on imported recipe detail              | REQ-004             | Display source attribution for web/Instagram imports | Confirms source URL, author, and platform displayed prominently                 |
| AT-005-A   | Imported recipes default to public                         | REQ-005             | Automatically mark web/Instagram imports as public   | Confirms public visibility immediately after import                             |
| AT-006-A   | Standard user cannot make imported recipe private          | REQ-006             | Prevent making public imported recipe private        | Confirms block for standard users                                               |
| AT-006-B   | Premium user cannot make unedited clone private            | REQ-006             | Prevent making public imported recipe private        | Confirms block for premium users on unedited clones                             |
| AT-007-A   | Clone creates editable copy with attribution               | REQ-007             | Allow cloning of imported public recipe              | Confirms clone creation, attribution retention, and public default              |
| AT-007-B   | Premium user can make substantively edited clone private   | REQ-007             | Clone retains public until premium edit              | Confirms privacy change allowed after substantive edit by premium user          |
| AT-008-A   | Duplicate URL surfaces existing recipe and clone option    | REQ-008, REQ-CN-001 | Deduplication by source URL                          | Confirms no duplicate created; existing recipe surfaced; clone offered          |
| AT-009-A   | Successful physical copy import via OCR                    | REQ-009             | Import from physical copies via OCR                  | Confirms OCR extraction and review screen presented before save                 |
| AT-010-A   | Physical copy import defaults to private, no attribution   | REQ-010             | Mark physical copy imports as private                | Confirms private default and absence of attribution section                     |
| AT-011-A   | OCR review and correction before save                      | REQ-011             | Allow user to review and correct OCR content         | Confirms corrected content is saved, not raw OCR output                         |
| AT-012-A   | Known paywalled source rejected                            | REQ-012             | Reject imports from known paywalled sources          | Confirms rejection before extraction with clear explanation                     |
| AT-013-A   | Manual entry paid source flagging                          | REQ-013             | Flag manually entered paid-source recipes            | Confirms flagging and visibility restriction applied                            |
| AT-IF004-A | Unauthenticated import attempt rejected                    | REQ-IF-004          | Enforce authentication for all import actions        | Confirms unauthenticated requests rejected and redirected                       |
| AT-NF004-A | Import UI components have accessible names                 | REQ-NF-004          | All import UI components expose accessible name      | Confirms Playwright queryable by role/label                                     |
| AT-NF005-A | State not conveyed by color alone                          | REQ-NF-005          | Color not sole conveyor of state                     | Confirms icon/label pairing alongside color in all states                       |

---

## Matrix C: Integration Verification

> Integration-level requirements verified at module boundaries (ARCH-level). Unit tests (UTP) verify internal module logic; integration tests verify cross-module contracts.

| Integration Point                                 | REQ-IDs                            | MOD Boundary                        | UTP Coverage                                 | Integration Test Status | Notes                                                                                     |
| ------------------------------------------------- | ---------------------------------- | ----------------------------------- | -------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| ImportController → ImportOrchestrator             | REQ-001, REQ-002, REQ-009, REQ-012 | MOD-002 ↔ MOD-001                   | UTP-002-A, UTP-002-B (orchestrator mocked)   | ⬜                      | Integration test needed: controller routes to correct orchestrator path end-to-end        |
| ImportOrchestrator → PaywallBlocklistService      | REQ-012                            | MOD-001 ↔ MOD-009                   | UTP-001-A (checkPaywall mocked)              | ⬜                      | Integration test needed: real blocklist config loaded and checked                         |
| ImportOrchestrator → DeduplicationService         | REQ-008, REQ-CN-001                | MOD-001 ↔ MOD-010                   | UTP-001-A (findBySourceUrl mocked)           | ⬜                      | Integration test needed: real DB query for existing source URL                            |
| ImportOrchestrator → AttributionVisibilityService | REQ-004, REQ-005, REQ-006, REQ-010 | MOD-001 ↔ MOD-011                   | UTP-001-A (apply mocked)                     | ⬜                      | Integration test needed: attribution and visibility rules applied to real payload         |
| ImportOrchestrator → RecipePersistenceAdapter     | REQ-001, REQ-002, REQ-009          | MOD-001 ↔ MOD-013                   | UTP-001-A (save mocked)                      | ⬜                      | Integration test needed: recipe persisted to real DB via adapter                          |
| WebUrlExtractorService → SchemaOrgParser          | REQ-001                            | MOD-003 ↔ MOD-004                   | UTP-003-A (parser mocked)                    | ⬜                      | Integration test needed: real HTML with schema.org markup parsed end-to-end               |
| WebUrlExtractorService → HeuristicRecipeParser    | REQ-001                            | MOD-003 ↔ MOD-005                   | UTP-003-A (heuristic mocked)                 | ⬜                      | Integration test needed: heuristic fallback on real HTML without schema.org               |
| InstagramOEmbedAdapter → Instagram oEmbed API     | REQ-002, REQ-003, REQ-IF-001       | MOD-006 ↔ Instagram oEmbed endpoint | UTP-006-A (fetch mocked)                     | ⬜                      | Integration test needed: real oEmbed API call in sandbox/staging                          |
| OcrPipelineService → AWS Textract                 | REQ-009, REQ-IF-002                | MOD-007 ↔ AWS Textract              | UTP-007-A, UTP-007-B (TextractClient mocked) | ⬜                      | Integration test needed: real Textract call with test image                               |
| OcrPipelineService → S3 (async staging)           | REQ-009                            | MOD-007 ↔ S3                        | UTP-007-A3, UTP-007-B (S3Client mocked)      | ⬜                      | Integration test needed: large photo staged to S3 before async Textract job               |
| OcrReviewController → ImportOrchestrator          | REQ-009, REQ-011                   | MOD-008 ↔ MOD-001                   | UTP-008-A (orchestrator mocked)              | ⬜                      | Integration test needed: OCR draft payload routed through orchestrator to persistence     |
| CloneService → RecipePersistenceAdapter           | REQ-007                            | MOD-012 ↔ MOD-013                   | UTP-012-A (adapter mocked)                   | ⬜                      | Integration test needed: clone written to DB with attribution copied                      |
| AttributionVisibilityService → RecipeRepository   | REQ-005, REQ-006, REQ-007          | MOD-011 ↔ MOD-015                   | UTP-011-A (repository mocked)                | ⬜                      | Integration test needed: visibility state persisted and enforced via repository           |
| AuthMiddleware → ClerkAuthService                 | REQ-IF-004                         | MOD-014 ↔ ClerkAuthService          | UTP-014-A (verifyToken mocked)               | ⬜                      | Integration test needed: middleware verifies real token networklessly via `CLERK_JWT_KEY` |
| RecipePersistenceAdapter → RecipeRepository       | REQ-001, REQ-002, REQ-009          | MOD-013 ↔ MOD-015                   | UTP-013-A (repository mocked)                | ⬜                      | Integration test needed: adapter maps domain entity to DB row via repository              |

---

## Matrix D: Implementation Verification

> Maps module designs (MOD) to unit test cases (UTP) and their scenarios (UTS). Verifies implementation completeness at the code level.

| MOD-ID  | Module Name                  | Source File                                    | ARCH Parent | UTP Cases            | UTS Scenarios                                          | Implementation Status |
| ------- | ---------------------------- | ---------------------------------------------- | ----------- | -------------------- | ------------------------------------------------------ | --------------------- |
| MOD-001 | ImportOrchestrator           | `src/import/orchestrator.service.ts`           | ARCH-001    | UTP-001-A, UTP-001-B | UTS-001-A1 through A3, UTS-001-B1 through B2 (5 total) | ⬜                    |
| MOD-002 | ImportController             | `src/import/import.controller.ts`              | ARCH-002    | UTP-002-A, UTP-002-B | UTS-002-A1 through A4, UTS-002-B1 through B2 (6 total) | ⬜                    |
| MOD-003 | WebUrlExtractorService       | `src/import/web-url-extractor.service.ts`      | ARCH-003    | UTP-003-A, UTP-003-B | UTS-003-A1 through A4, UTS-003-B1 through B2 (6 total) | ⬜                    |
| MOD-004 | SchemaOrgParser              | `src/import/schema-org-parser.ts`              | ARCH-004    | UTP-004-A            | UTS-004-A1 through A4 (4 total)                        | ⬜                    |
| MOD-005 | HeuristicRecipeParser        | `src/import/heuristic-recipe-parser.ts`        | ARCH-005    | UTP-005-A            | UTS-005-A1 through A3 (3 total)                        | ⬜                    |
| MOD-006 | InstagramOEmbedAdapter       | `src/import/instagram-oembed.adapter.ts`       | ARCH-006    | UTP-006-A            | UTS-006-A1 through A4 (4 total)                        | ⬜                    |
| MOD-007 | OcrPipelineService           | `src/import/ocr/pipeline.service.ts`           | ARCH-007    | UTP-007-A, UTP-007-B | UTS-007-A1 through A4, UTS-007-B1 through B3 (7 total) | ⬜                    |
| MOD-008 | OcrReviewController          | `src/import/ocr/review.controller.ts`          | ARCH-008    | UTP-008-A, UTP-008-B | UTS-008-A1 through A3, UTS-008-B1 through B2 (5 total) | ⬜                    |
| MOD-009 | PaywallBlocklistService      | `src/import/paywall-blocklist.service.ts`      | ARCH-009    | UTP-009-A, UTP-009-B | UTS-009-A1 through A3, UTS-009-B1 through B2 (5 total) | ⬜                    |
| MOD-010 | DeduplicationService         | `src/import/deduplication.service.ts`          | ARCH-010    | UTP-010-A            | UTS-010-A1 through A3 (3 total)                        | ⬜                    |
| MOD-011 | AttributionVisibilityService | `src/import/attribution-visibility.service.ts` | ARCH-011    | UTP-011-A, UTP-011-B | UTS-011-A1 through A3, UTS-011-B1 through B2 (5 total) | ⬜                    |
| MOD-012 | CloneService                 | `src/import/clone.service.ts`                  | ARCH-012    | UTP-012-A, UTP-012-B | UTS-012-A1 through A3, UTS-012-B1 through B3 (6 total) | ⬜                    |
| MOD-013 | RecipePersistenceAdapter     | `src/import/recipe-persistence.adapter.ts`     | ARCH-013    | UTP-013-A, UTP-013-B | UTS-013-A1 through A3, UTS-013-B1 through B2 (5 total) | ⬜                    |
| MOD-014 | AuthMiddleware               | `src/auth/middleware/auth.middleware.ts`       | ARCH-014    | UTP-014-A, UTP-014-B | UTS-014-A1 through A3, UTS-014-B1 through B3 (6 total) | ⬜                    |
| MOD-015 | RecipeRepository             | `src/import/recipe.repository.ts`              | ARCH-015    | UTP-015-A, UTP-015-B | UTS-015-A1 through A3, UTS-015-B1 through B3 (6 total) | ⬜                    |
| MOD-016 | ImportDtoTypes               | `src/import/dto/import.dto.ts`                 | ARCH-016    | UTP-016-A            | UTS-016-A1 through A3 (3 total)                        | ⬜                    |
| MOD-017 | ImportErrorNormalizer        | `src/import/import-error-normalizer.ts`        | ARCH-017    | UTP-017-A, UTP-017-B | UTS-017-A1 through A4, UTS-017-B1 through B3 (7 total) | ⬜                    |
| MOD-018 | ImportLogger                 | `src/import/import-logger.ts`                  | ARCH-018    | UTP-018-A            | UTS-018-A1 through A4 (4 total)                        | ⬜                    |

### UTP → REQ Traceability (Implementation → Requirement)

| UTP-ID    | Module                               | Technique                                              | REQ-IDs Covered                                      | UTS Count | Status |
| --------- | ------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------- | --------- | ------ |
| UTP-001-A | MOD-001 ImportOrchestrator           | Statement & Branch Coverage                            | REQ-001, REQ-002, REQ-008, REQ-009, REQ-012          | 3         | ⬜     |
| UTP-001-B | MOD-001 ImportOrchestrator           | Statement Coverage + Error Path                        | REQ-001, REQ-002, REQ-009                            | 2         | ⬜     |
| UTP-002-A | MOD-002 ImportController             | Boundary Value Analysis + Equivalence Partitioning     | REQ-001, REQ-014                                     | 4         | ⬜     |
| UTP-002-B | MOD-002 ImportController             | Equivalence Partitioning                               | REQ-002, REQ-003                                     | 2         | ⬜     |
| UTP-003-A | MOD-003 WebUrlExtractorService       | Statement & Branch Coverage + Boundary Value Analysis  | REQ-001, REQ-014                                     | 4         | ⬜     |
| UTP-003-B | MOD-003 WebUrlExtractorService       | Boundary Value Analysis                                | REQ-001                                              | 2         | ⬜     |
| UTP-004-A | MOD-004 SchemaOrgParser              | Statement & Branch Coverage + Equivalence Partitioning | REQ-001                                              | 4         | ⬜     |
| UTP-005-A | MOD-005 HeuristicRecipeParser        | Statement & Branch Coverage + Boundary Value Analysis  | REQ-001                                              | 3         | ⬜     |
| UTP-006-A | MOD-006 InstagramOEmbedAdapter       | Statement & Branch Coverage + Equivalence Partitioning | REQ-002, REQ-003, REQ-IF-001                         | 4         | ⬜     |
| UTP-007-A | MOD-007 OcrPipelineService           | Statement & Branch Coverage                            | REQ-009, REQ-IF-002                                  | 4         | ⬜     |
| UTP-007-B | MOD-007 OcrPipelineService           | Statement & Branch Coverage + Boundary Value Analysis  | REQ-009, REQ-IF-002                                  | 3         | ⬜     |
| UTP-008-A | MOD-008 OcrReviewController          | Statement & Branch Coverage                            | REQ-009, REQ-011                                     | 3         | ⬜     |
| UTP-008-B | MOD-008 OcrReviewController          | Statement & Branch Coverage                            | REQ-009, REQ-011                                     | 2         | ⬜     |
| UTP-009-A | MOD-009 PaywallBlocklistService      | Boundary Value Analysis + Statement Coverage           | REQ-012, REQ-CN-002                                  | 3         | ⬜     |
| UTP-009-B | MOD-009 PaywallBlocklistService      | State Transition Testing                               | REQ-012                                              | 2         | ⬜     |
| UTP-010-A | MOD-010 DeduplicationService         | Statement & Branch Coverage + Equivalence Partitioning | REQ-008, REQ-CN-001                                  | 3         | ⬜     |
| UTP-011-A | MOD-011 AttributionVisibilityService | Statement & Branch Coverage + Equivalence Partitioning | REQ-004, REQ-005, REQ-010                            | 3         | ⬜     |
| UTP-011-B | MOD-011 AttributionVisibilityService | State Transition Testing                               | REQ-006, REQ-007                                     | 2         | ⬜     |
| UTP-012-A | MOD-012 CloneService                 | Statement & Branch Coverage                            | REQ-007                                              | 3         | ⬜     |
| UTP-012-B | MOD-012 CloneService                 | Boundary Value Analysis + State Transition Testing     | REQ-006, REQ-007                                     | 3         | ⬜     |
| UTP-013-A | MOD-013 RecipePersistenceAdapter     | Statement & Branch Coverage + Strict Isolation         | REQ-001, REQ-002, REQ-009, REQ-IF-003                | 3         | ⬜     |
| UTP-013-B | MOD-013 RecipePersistenceAdapter     | Boundary Value Analysis                                | REQ-001, REQ-009                                     | 2         | ⬜     |
| UTP-014-A | MOD-014 AuthMiddleware               | Statement & Branch Coverage + Strict Isolation         | REQ-IF-004                                           | 3         | ⬜     |
| UTP-014-B | MOD-014 AuthMiddleware               | Equivalence Partitioning                               | REQ-IF-004                                           | 3         | ⬜     |
| UTP-015-A | MOD-015 RecipeRepository             | Statement & Branch Coverage + Strict Isolation         | REQ-001, REQ-002, REQ-008, REQ-009                   | 3         | ⬜     |
| UTP-015-B | MOD-015 RecipeRepository             | Boundary Value Analysis                                | REQ-008, REQ-CN-001                                  | 3         | ⬜     |
| UTP-016-A | MOD-016 ImportDtoTypes               | Equivalence Partitioning                               | REQ-001, REQ-002, REQ-009                            | 3         | ⬜     |
| UTP-017-A | MOD-017 ImportErrorNormalizer        | Statement & Branch Coverage + Equivalence Partitioning | REQ-001, REQ-002, REQ-003, REQ-009, REQ-012, REQ-014 | 4         | ⬜     |
| UTP-017-B | MOD-017 ImportErrorNormalizer        | Boundary Value Analysis                                | REQ-001, REQ-014                                     | 3         | ⬜     |
| UTP-018-A | MOD-018 ImportLogger                 | Statement & Branch Coverage + Strict Isolation         | REQ-001, REQ-002, REQ-009                            | 4         | ⬜     |

---

## Matrix H: Hazard Traceability

> Security, legal, and data-integrity hazards linked to requirements and their mitigations. Derived from the attribution-compliance, copyright, and data-integrity nature of the Recipe Importing feature.

| HAZ-ID  | Hazard Description                                                                       | Severity | REQ-IDs                   | Mitigation                                                                                                                | Verification                                       | Status |
| ------- | ---------------------------------------------------------------------------------------- | -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------ |
| HAZ-001 | Paywalled content redistributed without authorisation                                    | Critical | REQ-012, REQ-CN-002       | PaywallBlocklistService rejects known paywalled domains before extraction; blocklist loaded from config                   | AT-012-A, UTP-009-A                                | ⬜     |
| HAZ-002 | Attribution omitted for publicly imported recipe (legal violation)                       | Critical | REQ-004, REQ-005          | AttributionVisibilityService enforces attribution fields on all web/Instagram imports; attribution non-nullable in schema | AT-004-A, UTP-011-A                                | ⬜     |
| HAZ-003 | Duplicate public recipes created for same source URL                                     | High     | REQ-008, REQ-CN-001       | DeduplicationService checks source URL before persistence; unique constraint on source_url in DB                          | AT-008-A, UTP-010-A                                | ⬜     |
| HAZ-004 | Public imported recipe made private without substantive edit (attribution circumvention) | High     | REQ-006, REQ-007          | AttributionVisibilityService enforces visibility lock; CloneService tracks edit state; premium gate checked               | AT-006-A, AT-006-B, AT-007-B, UTP-011-B, UTP-012-B | ⬜     |
| HAZ-005 | Physical copy import (copyrighted cookbook) made public                                  | High     | REQ-010, REQ-CN-002       | AttributionVisibilityService sets visibility=private for OCR imports; no public override path for OCR type                | AT-010-A, UTP-011-A                                | ⬜     |
| HAZ-006 | Unauthenticated user creates recipe records via import API                               | High     | REQ-IF-004                | AuthMiddleware applied to all import endpoints; 401 returned for missing/invalid token                                    | AT-IF004-A, UTP-014-A, UTP-014-B                   | ⬜     |
| HAZ-007 | Malicious URL causes SSRF via web URL extractor                                          | High     | REQ-001, REQ-014          | URL validated against allowlist/denylist before fetch; private IP ranges blocked; timeout enforced                        | AT-001-B, UTP-003-A                                | ⬜     |
| HAZ-008 | OCR photo upload exposes user data via S3 staging bucket                                 | Medium   | REQ-009, REQ-IF-002       | S3 staging bucket is private; pre-signed URLs scoped to single object; objects deleted after Textract job                 | AT-009-A, UTP-007-A3, UTP-007-B                    | ⬜     |
| HAZ-009 | Instagram oEmbed API rate limiting causes silent import failure                          | Medium   | REQ-002, REQ-IF-001       | OEmbedApiError thrown and normalised; user receives clear error message; no partial recipe created                        | AT-002-A, UTP-006-A3                               | ⬜     |
| HAZ-010 | Manually entered paid-source recipe made public before legal review                      | High     | REQ-013, REQ-CN-004       | Paid-source flag prevents public visibility; enforcement mechanism gated on legal review per REQ-CN-004                   | AT-013-A                                           | ⬜     |
| HAZ-011 | Imported recipe orphaned when source URL becomes permanently unavailable                 | Low      | REQ-015                   | Imported recipe record preserved; attribution note updated to indicate source no longer available                         | _(Analysis — no AT defined)_                       | ⬜     |
| HAZ-012 | Low-confidence OCR extraction saved without user review                                  | Medium   | REQ-011                   | OcrReviewController always presents review screen before save; save requires explicit user action                         | AT-011-A, UTP-008-A                                | ⬜     |
| HAZ-013 | ImportErrorNormalizer leaks internal error details to client                             | Medium   | REQ-001, REQ-002, REQ-009 | ImportErrorNormalizer maps all errors to safe user-facing messages; stack traces never returned to client                 | UTP-017-A, UTP-017-B                               | ⬜     |

---

## Coverage Audit

### Functional Requirements Coverage

| Category                                  | Total REQs | REQs with AT | REQs Inspection-Only | REQs Analysis-Only | REQs with No Coverage | Coverage % |
| ----------------------------------------- | ---------- | ------------ | -------------------- | ------------------ | --------------------- | ---------- |
| Functional (REQ-001 to REQ-015)           | 15         | 13           | 0                    | 2 (REQ-015)        | 0                     | **100%**   |
| Non-Functional (REQ-NF-001 to REQ-NF-005) | 5          | 2            | 2                    | 1 (REQ-NF-003)     | 0                     | **100%**   |
| Interface (REQ-IF-001 to REQ-IF-004)      | 4          | 1            | 3                    | 0                  | 0                     | **100%**   |
| Constraint (REQ-CN-001 to REQ-CN-004)     | 4          | 1            | 3                    | 0                  | 0                     | **100%**   |
| **Total**                                 | **28**     | **17**       | **8**                | **3**              | **0**                 | **100%**   |

> Note: "Inspection-Only" requirements are verified by code review and static analysis, not by executable tests. "Analysis-Only" requirements are verified by measurement or architectural review. Both are fully covered by their stated verification method.

### Unit Test Coverage

| MOD-ID    | Module                       | UTP Cases        | UTS Scenarios        | Techniques Applied                                                    |
| --------- | ---------------------------- | ---------------- | -------------------- | --------------------------------------------------------------------- |
| MOD-001   | ImportOrchestrator           | 2                | 5                    | Statement & Branch, Error Path, Strict Isolation                      |
| MOD-002   | ImportController             | 2                | 6                    | Boundary Value Analysis, Equivalence Partitioning, Strict Isolation   |
| MOD-003   | WebUrlExtractorService       | 2                | 6                    | Statement & Branch, Boundary Value Analysis, Strict Isolation         |
| MOD-004   | SchemaOrgParser              | 1                | 4                    | Statement & Branch, Equivalence Partitioning                          |
| MOD-005   | HeuristicRecipeParser        | 1                | 3                    | Statement & Branch, Boundary Value Analysis                           |
| MOD-006   | InstagramOEmbedAdapter       | 1                | 4                    | Statement & Branch, Equivalence Partitioning, Strict Isolation        |
| MOD-007   | OcrPipelineService           | 2                | 7                    | Statement & Branch, Boundary Value Analysis, Strict Isolation         |
| MOD-008   | OcrReviewController          | 2                | 5                    | Statement & Branch, Strict Isolation                                  |
| MOD-009   | PaywallBlocklistService      | 2                | 5                    | Boundary Value Analysis, Statement Coverage, State Transition         |
| MOD-010   | DeduplicationService         | 1                | 3                    | Statement & Branch, Equivalence Partitioning, Strict Isolation        |
| MOD-011   | AttributionVisibilityService | 2                | 5                    | Statement & Branch, Equivalence Partitioning, State Transition        |
| MOD-012   | CloneService                 | 2                | 6                    | Statement & Branch, Boundary Value Analysis, State Transition         |
| MOD-013   | RecipePersistenceAdapter     | 2                | 5                    | Statement & Branch, Boundary Value Analysis, Strict Isolation         |
| MOD-014   | AuthMiddleware               | 2                | 6                    | Statement & Branch, Equivalence Partitioning, Strict Isolation        |
| MOD-015   | RecipeRepository             | 2                | 6                    | Statement & Branch, Boundary Value Analysis, Strict Isolation         |
| MOD-016   | ImportDtoTypes               | 1                | 3                    | Equivalence Partitioning                                              |
| MOD-017   | ImportErrorNormalizer        | 2                | 7                    | Statement & Branch, Equivalence Partitioning, Boundary Value Analysis |
| MOD-018   | ImportLogger                 | 1                | 4                    | Statement & Branch, Strict Isolation                                  |
| **Total** | —                            | **30 UTP cases** | **91 UTS scenarios** | All 5 ISO 29119-4 techniques represented                              |

### Acceptance Test Coverage

| Tier                               | AT Cases        | ATS Scenarios         | Paths Covered                                                        |
| ---------------------------------- | --------------- | --------------------- | -------------------------------------------------------------------- |
| Functional (AT-001 through AT-015) | 15 AT cases     | ~25 ATS scenarios     | Web URL, Instagram, Physical Copy/OCR, Deduplication, Clone, Paywall |
| Non-Functional (AT-NF-\*)          | 2 AT cases      | 2 ATS scenarios       | Accessibility (role/label, color contrast)                           |
| Interface (AT-IF-\*)               | 1 AT case       | 1 ATS scenario        | Authentication enforcement                                           |
| **Total**                          | **18 AT cases** | **~28 ATS scenarios** | All three import paths + attribution + visibility + deduplication    |

---

## Orphan & Gap Report

### Orphan Analysis

**Orphan ATs** (acceptance tests with no corresponding REQ):

> None identified. All AT cases in `acceptance-plan.md` map to a REQ-\* identifier via the naming convention (AT-NNN-X → REQ-NNN, AT-IF004-A → REQ-IF-004, AT-NF004-A → REQ-NF-004, AT-NF005-A → REQ-NF-005).

**Orphan UTPs** (unit test cases with no corresponding MOD):

> None identified. All UTP cases in `unit-test.md` map to a MOD-NNN identifier per the ARCH↔MOD↔UTP traceability table.

**Orphan REQs** (requirements with no verification path):

> None identified. All 28 requirements have at least one verification method (Test, Inspection, or Analysis).

### Gap Analysis

**Requirements with no executable acceptance test (Inspection/Analysis only)**:

These requirements are verified by code review, static analysis, measurement, or architectural analysis — not by executable test scenarios. They are **not gaps** but are flagged for completeness:

| REQ-ID     | Verification Method | Risk Level | Mitigation                                                                                                                             |
| ---------- | ------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-NF-001 | Inspection          | Low        | TypeScript `strict: true` enforced by CI typecheck; `any` usage detectable via ESLint `@typescript-eslint/no-explicit-any`             |
| REQ-NF-002 | Inspection          | Low        | JSDoc coverage reviewable via `eslint-plugin-jsdoc` linting rules                                                                      |
| REQ-NF-003 | Analysis            | Medium     | Extraction accuracy measured against a curated test corpus of 100+ recipe URLs; threshold ≥85% enforced before feature flag enabled    |
| REQ-IF-001 | Inspection          | Low        | oEmbed integration verifiable by code review of `InstagramOEmbedAdapter`; endpoint URL pinned in config                                |
| REQ-IF-002 | Inspection          | Low        | Textract integration verifiable by code review of `OcrPipelineService`; AWS SDK version pinned in `package.json`                       |
| REQ-IF-003 | Inspection          | Low        | Recipe entity schema conformance verifiable by TypeScript types and Drizzle schema review                                              |
| REQ-CN-002 | Inspection          | High       | Paywall blocklist + OCR private-default enforced in `AttributionVisibilityService`; verifiable by code review and UTP-009-A, UTP-011-A |
| REQ-CN-003 | Inspection          | Low        | Scope constraint enforced by `InstagramOEmbedAdapter` rejecting non-caption posts; verifiable by UTP-006-A2                            |
| REQ-CN-004 | Inspection          | High       | Legal review gate documented in spec (FR-014a); implementation blocked until legal sign-off; tracked as open action item               |
| REQ-015    | Analysis            | Low        | Preservation behaviour verifiable by architectural review of persistence layer; no executable AT defined at launch                     |

**Integration test gaps** (module boundaries with no integration test yet defined):

All 15 integration points in Matrix C are flagged ⬜ Pending Execution. The following are highest priority for integration test authoring before feature flag enablement:

| Priority | Integration Point                                       | Risk   | Reason                                                                                                                  |
| -------- | ------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| P1       | ImportOrchestrator → DeduplicationService (real DB)     | High   | Deduplication constraint (REQ-CN-001) is a data integrity invariant; must be verified against real DB unique constraint |
| P1       | AuthMiddleware → ClerkAuthService (real token)          | High   | Authentication enforcement (REQ-IF-004) must be verified with real token validation                                     |
| P1       | InstagramOEmbedAdapter → Instagram oEmbed API (sandbox) | High   | oEmbed API behaviour (rate limits, error codes) must be verified in staging before production                           |
| P2       | OcrPipelineService → AWS Textract (real image)          | Medium | OCR accuracy (REQ-NF-003) requires real Textract call; mocked unit tests cannot verify extraction quality               |
| P2       | WebUrlExtractorService → SchemaOrgParser (real HTML)    | Medium | Schema.org parsing correctness requires real-world HTML fixtures; unit tests use synthetic HTML only                    |
