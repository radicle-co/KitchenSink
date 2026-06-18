# Unit Test Plan: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/004-recipe-importing/v-model/module-design.md`

## Overview

This document defines the Unit Test Plan for the Recipe Importing feature. Every module design (`MOD-NNN`) in `module-design.md` has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one or more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

Unit tests verify **internal module logic** — control flow, data transformations, state transitions, and variable boundaries. They do NOT test module boundaries (integration), user journeys (acceptance), or system-level behavior (system tests).

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}` — where NNN matches the parent MOD, X is a letter suffix (A, B, C...)
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}` — nested under the parent UTP, with numeric suffix (1, 2, 3...)
- Example: `UTS-001-A1` → Scenario 1 of Test Case A verifying MOD-001
- ID lineage: from `UTS-001-A1`, a regex extracts `UTP-001-A` and `MOD-001`. To find the `ARCH-NNN` ancestor, consult the "Parent Architecture Modules" field in `module-design.md`.

## ISO 29119-4 White-Box Techniques

Each test case MUST identify its technique by name and anchor to a specific module design view:

| Technique                       | Source View                   | What It Tests                                           |
| ------------------------------- | ----------------------------- | ------------------------------------------------------- |
| **Statement & Branch Coverage** | Algorithmic/Logic View        | Every line and every True/False branch outcome          |
| **Boundary Value Analysis**     | Internal Data Structures      | Scalar variable boundaries: min-1, min, mid, max, max+1 |
| **Equivalence Partitioning**    | Internal Data Structures      | Discrete non-scalar types: Booleans, Enums              |
| **Strict Isolation**            | Architecture Interface View   | Every external dependency mocked/stubbed                |
| **Error Guessing**              | Error Handling & Return Codes | Negative paths, invalid inputs, dependency exceptions   |
| **State Transition Testing**    | State Machine View            | Every transition including invalid ones                 |

---

## Unit Tests

---

### Module: MOD-001 (ImportOrchestrator)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `src/import/orchestrator.service.ts`

---

#### Test Case: UTP-001-A (orchestrateImport — happy path sequencing)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies the orchestrator calls each step in correct order: paywall check → deduplication → attribution → persistence, and returns result.

**Scenarios:**

**UTS-001-A1** — Happy path, all steps succeed

- Arrange: mock PaywallBlocklistService.checkPaywall() → void; mock DeduplicationService.findBySourceUrl() → null; mock AttributionVisibilityService.apply() → AttributedPayload; mock RecipePersistenceAdapter.save() → RecipeEntity
- Act: orchestrator.orchestrateImport(payload)
- Assert: verify checkPaywall called first, then deduplication, then attribution, then save; result.status === "success"
- Mock isolation: all external calls stubbed

**UTS-001-A2** — Paywall blocked

- Arrange: mock checkPaywall() → throws PaywallBlockedError
- Act: orchestrator.orchestrateImport(payload)
- Assert: result.status === "blocked"; verify deduplication not called
- Mock isolation: PaywallBlocklistService stubbed

**UTS-001-A3** — Duplicate found

- Arrange: mock checkPaywall() → void; mock findBySourceUrl() → existingRecipe; mock CloneService.clone() → clonedRecipe
- Act: orchestrator.orchestrateImport(payload)
- Assert: result.status === "duplicate"; result.existingRecipe === existingRecipe
- Mock isolation: DeduplicationService stubbed

---

#### Test Case: UTP-001-B (orchestrateImport — error normalisation)

**Technique**: Statement Coverage + Error Path
**Target View**: Algorithmic/Logic View
**Description**: Verifies that exceptions from any step are caught and delegated to ImportErrorNormalizer.

**Scenarios:**

**UTS-001-B1** — Persistence error normalised

- Arrange: mock save() → throws PersistenceError; mock normalizer.normalize() → ImportErrorResponse
- Act: orchestrator.orchestrateImport(payload)
- Assert: verify normalizer.normalize called with PersistenceError; result.status === "error"
- Mock isolation: RecipePersistenceAdapter stubbed; ImportErrorNormalizer stubbed

**UTS-001-B2** — Unknown error rethrown as-is

- Arrange: mock save() → throws RangeError("unexpected")
- Act/Assert: orchestrator.orchestrateImport(payload) throws RangeError
- Mock isolation: RecipePersistenceAdapter stubbed

---

### Module: MOD-002 (ImportController)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `src/import/import.controller.ts`

---

#### Test Case: UTP-002-A (POST /import/url — DTO validation)

**Technique**: Boundary Value Analysis + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies DTO validation rejects invalid URLs and accepts valid ones.

**Scenarios:**

**UTS-002-A1** — Valid URL accepted

- Arrange: ImportUrlDto { url: "https://www.example.com/recipe" }
- Act: controller.importUrl(dto)
- Assert: response.status === 202; verify orchestrator called
- Mock isolation: ImportOrchestrator stubbed

**UTS-002-A2** — Invalid URL (missing protocol) rejected

- Arrange: ImportUrlDto { url: "www.example.com/recipe" }
- Act: controller.importUrl(dto)
- Assert: response.status === 400; @IsUrl validation error returned
- Mock isolation: none (fails before orchestrator)

**UTS-002-A3** — Empty URL rejected

- Arrange: ImportUrlDto { url: "" }
- Act: controller.importUrl(dto)
- Assert: response.status === 400
- Mock isolation: none

**UTS-002-A4** — URL exceeds max length rejected

- Arrange: ImportUrlDto { url: "https://example.com/" + "a".repeat(2049) }
- Act: controller.importUrl(dto)
- Assert: response.status === 400; @MaxLength validation error
- Mock isolation: none

---

#### Test Case: UTP-002-B (POST /import/instagram — DTO validation)

**Technique**: Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies Instagram-specific DTO validation for Instagram post URLs.

**Scenarios:**

**UTS-002-B1** — Valid Instagram URL accepted

- Arrange: ImportInstagramDto { postUrl: "https://www.instagram.com/p/ABC123/" }
- Act: controller.importInstagram(dto)
- Assert: response.status === 202
- Mock isolation: ImportOrchestrator stubbed

**UTS-002-B2** — Non-Instagram URL rejected

- Arrange: ImportInstagramDto { postUrl: "https://www.google.com/" }
- Act: controller.importInstagram(dto)
- Assert: response.status === 400; error message indicates Instagram required
- Mock isolation: ImportOrchestrator stubbed

---

### Module: MOD-003 (WebUrlExtractorService)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `src/import/web-url-extractor.service.ts`

---

#### Test Case: UTP-003-A (extract — schema.org parsing path)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View
**Description**: Verifies schema.org extraction as primary path, heuristic fallback on null, and error handling for unreachable URLs.

**Scenarios:**

**UTS-003-A1** — Valid schema.org JSON-LD extracted

- Arrange: mock fetch() → { status: 200, html: "<html><script type=application/ld+json>{\"@type\":\"Recipe\",...}</script></html>" }
- Act: extractor.extract("https://example.com/recipe")
- Assert: result.payload.recipeName === "Test Recipe"; result.extractorUsed === "schema"
- Mock isolation: node-fetch stubbed

**UTS-003-A2** — No schema.org found → heuristic fallback invoked

- Arrange: mock fetch() → { status: 200, html: "<html><h1>My Recipe</h1></html>" }
- Act: extractor.extract("https://example.com/recipe")
- Assert: result.extractorUsed === "heuristic"; result.payload !== null
- Mock isolation: node-fetch stubbed; HeuristicRecipeParser stubbed

**UTS-003-A3** — URL returns 404 → UrlUnreachableError thrown

- Arrange: mock fetch() → { status: 404 }
- Act/Assert: extractor.extract("https://example.com/nonexistent") throws UrlUnreachableError
- Mock isolation: node-fetch stubbed

**UTS-003-A4** — Network timeout → UrlUnreachableError thrown

- Arrange: mock fetch() → throws TimeoutError
- Act/Assert: extractor.extract("https://example.com/slow") throws UrlUnreachableError
- Mock isolation: node-fetch stubbed

---

#### Test Case: UTP-003-B (extract — confidence scoring)

**Technique**: Boundary Value Analysis
**Target View**: Algorithmic/Logic View
**Description**: Verifies confidence score thresholds are applied correctly.

**Scenarios:**

**UTS-003-B1** — High-confidence schema extraction (>= 0.8) → returns full payload

- Arrange: mock fetch() → HTML with complete schema.org Recipe object
- Act: result = extractor.extract(url)
- Assert: result.confidence >= 0.8; result.payload.complete === true

**UTS-003-B2** — Low-confidence heuristic (0.3–0.7) → partial payload with warning

- Arrange: mock HeuristicRecipeParser.extract() → { recipeName: "Vaguely Structured Recipe", confidence: 0.45 }
- Act: result = extractor.extract(url)
- Assert: result.confidence === 0.45; result.partial === true

---

### Module: MOD-004 (SchemaOrgParser)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `src/import/schema-org-parser.ts`

---

#### Test Case: UTP-004-A (parse — valid schema extraction)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies valid schema.org JSON-LD is parsed into a RecipeImportPayload; null is returned for invalid/missing schema.

**Scenarios:**

**UTS-004-A1** — Complete Recipe schema extracted

- Arrange: html = `<html><script type="application/ld+json">{"@type":"Recipe","name":"Test Recipe","recipeIngredient":["1 cup flour"],"recipeInstructions":[{"@type":"HowToStep","text":"Mix ingredients"}]}</script></html>`
- Act: result = parser.parse(html)
- Assert: result !== null; result.recipeName === "Test Recipe"; result.ingredients.length === 1; result.instructions.length === 1

**UTS-004-A2** — No JSON-LD script tag → null returned

- Arrange: html = `<html><body><p>Plain HTML page</p></body></html>`
- Act: result = parser.parse(html)
- Assert: result === null

**UTS-004-A3** — Malformed JSON-LD → null returned (no crash)

- Arrange: html = `<html><script type="application/ld+json">{"@type":"Recipe","name": invalid json here</script></html>`
- Act: result = parser.parse(html)
- Assert: result === null; no exception thrown

**UTS-004-A4** — Non-Recipe schema type (e.g., Article) → null returned

- Arrange: html = `<html><script type="application/ld+json">{"@type":"Article","headline":"News Article"}</script></html>`
- Act: result = parser.parse(html)
- Assert: result === null

---

### Module: MOD-005 (HeuristicRecipeParser)

**Parent Architecture Modules**: ARCH-005
**Target Source File(s)**: `src/import/heuristic-recipe-parser.ts`

---

#### Test Case: UTP-005-A (parse — CSS selector heuristics)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View
**Description**: Verifies CSS selector heuristics extract title, ingredients, and instructions from raw HTML when schema is absent.

**Scenarios:**

**UTS-005-A1** — Standard recipe blog structure parsed

- Arrange: html with `<h1 class="recipe-title">`, `<li class="ingredient">`, `<div class="instructions">` structure
- Act: result = parser.parse(html)
- Assert: result.recipeName === "My Recipe"; result.ingredients.length > 0; result.confidence > 0

**UTS-005-A2** — No recognizable selectors → returns null

- Arrange: html = `<html><body><p>Nothing structured here</p></body></html>`
- Act: result = parser.parse(html)
- Assert: result === null

**UTS-005-A3** — Partial structure (title only) → confidence <= 0.5

- Arrange: html with `<h1 class="recipe-title">` but no ingredients or instructions
- Act: result = parser.parse(html)
- Assert: result !== null; result.confidence <= 0.5; result.partial === true

---

### Module: MOD-006 (InstagramOEmbedAdapter)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `src/import/instagram-oembed.adapter.ts`

---

#### Test Case: UTP-006-A (fetchInstagramPost — oEmbed flow)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies oEmbed API call, caption validation (recipe vs. non-recipe), and error mapping.

**Scenarios:**

**UTS-006-A1** — Valid recipe caption extracted

- Arrange: mock fetch() → { status: 200, data: { title: "Chocolate Cake Recipe", html: "<blockquote>Ingredients: flour, sugar..." } }
- Act: result = adapter.fetchInstagramPost("https://www.instagram.com/p/ABC123/")
- Assert: result.recipeName === "Chocolate Cake Recipe"; result.source === "instagram"

**UTS-006-A2** — Video-only post (no caption) → NoCaptionError thrown

- Arrange: mock fetch() → { status: 200, data: { title: "", html: "<blockquote>Check out this video!</blockquote>" }
- Act/Assert: adapter.fetchInstagramPost(url) throws NoCaptionError

**UTS-006-A3** — oEmbed API returns non-200 → OEmbedApiError thrown

- Arrange: mock fetch() → { status: 429, message: "Rate limited" }
- Act/Assert: adapter.fetchInstagramPost(url) throws OEmbedApiError

**UTS-006-A4** — Invalid Instagram URL format → validation error thrown

- Arrange: url = "not-a-instagram-url"
- Act/Assert: adapter.fetchInstagramPost(url) throws ValidationError

---

## ARCH↔MOD↔UTP Traceability

| MOD ID  | MOD Name                     | UTP Count | UTS Count        |
| ------- | ---------------------------- | --------- | ---------------- |
| MOD-001 | ImportOrchestrator           | 2 (A, B)  | 5 (A1-A3, B1-B2) |
| MOD-002 | ImportController             | 2 (A, B)  | 6 (A1-A4, B1-B2) |
| MOD-003 | WebUrlExtractorService       | 2 (A, B)  | 6 (A1-A4, B1-B3) |
| MOD-004 | SchemaOrgParser              | 1 (A)     | 4 (A1-A4)        |
| MOD-005 | HeuristicRecipeParser        | 1 (A)     | 3 (A1-A3)        |
| MOD-006 | InstagramOEmbedAdapter       | 1 (A)     | 4 (A1-A4)        |
| MOD-007 | OcrPipelineService           | 2 (A, B)  | 7 (A1-A4, B1-B3) |
| MOD-008 | OcrReviewController          | 2 (A, B)  | 5 (A1-A3, B1-B2) |
| MOD-009 | PaywallBlocklistService      | 2 (A, B)  | 5 (A1-A3, B1-B2) |
| MOD-010 | DeduplicationService         | 1 (A)     | 3 (A1-A3)        |
| MOD-011 | AttributionVisibilityService | 2 (A, B)  | 5 (A1-A3, B1-B2) |
| MOD-012 | CloneService                 | 2 (A, B)  | 6 (A1-A3, B1-B3) |
| MOD-013 | RecipePersistenceAdapter     | 2 (A, B)  | 5 (A1-A3, B1-B2) |
| MOD-014 | AuthMiddleware               | 2 (A, B)  | 6 (A1-A3, B1-B3) |
| MOD-015 | RecipeRepository             | 2 (A, B)  | 6 (A1-A3, B1-B3) |
| MOD-016 | ImportDtoTypes               | 1 (A)     | 3 (A1-A3)        |
| MOD-017 | ImportErrorNormalizer        | 2 (A, B)  | 7 (A1-A4, B1-B3) |
| MOD-018 | ImportLogger                 | 1 (A)     | 4 (A1-A4)        |

---

### Module: MOD-007 (OcrPipelineService)

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `src/import/ocr/pipeline.service.ts`

---

#### Test Case: UTP-007-A (processPhoto — sync path, ≤5 MB)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies synchronous path (<5 MB) calls Textract DetectDocumentText, extracts lines, computes confidence, returns OcrDraftPayload.

**Scenarios:**

**UTS-007-A1** — Happy path, sync detection, lines extracted

- Arrange: mock textractClient.detectDocumentText() → { Blocks: [{ BlockType: 'LINE', Text: '1 cup flour', Confidence: 0.95 }, { BlockType: 'WORD', Text: 'not-a-line' }] }
- Act: result = await service.processPhoto(Buffer.from('fake-image'))
- Assert: result.text === '1 cup flour'; result.confidence === 0.95; result.draftId is UUID
- Mock isolation: TextractClient stubbed

**UTS-007-A2** — Empty response (no LINE blocks)

- Arrange: mock detectDocumentText() → { Blocks: [{ BlockType: 'WORD', Text: 'orphan' }] }
- Act: result = await service.processPhoto(Buffer.from('fake-image'))
- Assert: result.text === ''; result.confidence === 0; result.rawBlocks.length === 1
- Mock isolation: TextractClient stubbed

**UTS-007-A3** — Photo too large → async path triggered (branch)

- Arrange: photoBuffer.byteLength = 6_000_000; mock s3Client.putObject() → success; mock textractClient.startDocumentTextDetection() → { JobId: 'job-123' }; mock pollTextractJob() → ['line 1', 'line 2']
- Act: result = await service.processPhoto(photoBuffer)
- Assert: verify s3Client.putObject called once; startDocumentTextDetection called once; result.text includes 'line 1'
- Mock isolation: S3Client stubbed; TextractClient stubbed; pollTextractJob stubbed

**UTS-007-A4** — Textract API error thrown → OcrServiceError(code: 'TEXTRACT_API_ERROR')

- Arrange: mock detectDocumentText() → throws new Error('connection refused')
- Act/Assert: service.processPhoto(Buffer.from('image')) throws OcrServiceError with code 'TEXTRACT_API_ERROR'
- Mock isolation: TextractClient stubbed

---

#### Test Case: UTP-007-B (processPhoto — async path, S3 staging, polling)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View
**Description**: Verifies async path uploads to S3, starts Textract job, polls until SUCCEEDED or timeout, propagates errors on FAILED or timeout.

**Scenarios:**

**UTS-007-B1** — Async job SUCCEEDED after 3 polls

- Arrange: mock s3Client.putObject() → success; mock startDocumentTextDetection() → { JobId: 'job-456' }; mock getDocumentTextDetection() on call 1→{JobStatus:'IN_PROGRESS'}, on call 2→{JobStatus:'IN_PROGRESS'}, on call 3→{JobStatus:'SUCCEEDED', Blocks:[{BlockType:'LINE',Text:'ingredient 1'},{BlockType:'LINE',Text:'ingredient 2'}]}
- Act: result = await service.processPhoto(Buffer.alloc(6_000_000))
- Assert: result.text includes 'ingredient 1'; verify putObject called once
- Mock isolation: S3Client stubbed; TextractClient stubbed

**UTS-007-B2** — Async job FAILED → OcrServiceError(code: 'TEXTRACT_JOB_FAILED')

- Arrange: mock s3Client.putObject() → success; mock startDocumentTextDetection() → { JobId: 'job-789' }; mock getDocumentTextDetection() → { JobStatus: 'FAILED' }
- Act/Assert: service.processPhoto(Buffer.alloc(6_000_000)) throws OcrServiceError with code 'TEXTRACT_JOB_FAILED'
- Mock isolation: S3Client stubbed; TextractClient stubbed

**UTS-007-B3** — Polling timeout (20 attempts exhausted) → OcrServiceError(code: 'TEXTRACT_TIMEOUT')

- Arrange: mock s3Client.putObject() → success; mock startDocumentTextDetection() → { JobId: 'job-timeout' }; mock getDocumentTextDetection() always → { JobStatus: 'IN_PROGRESS' }
- Act/Assert: service.processPhoto(Buffer.alloc(6_000_000)) throws OcrServiceError with code 'TEXTRACT_TIMEOUT'
- Mock isolation: S3Client stubbed; TextractClient stubbed; poll limits to 20 via maxAttempts=20

---

### Module: MOD-008 (OcrReviewController)

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `src/import/ocr/review.controller.ts`

---

#### Test Case: UTP-008-A (saveOcrDraft — happy path)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies POST /import/photo/save builds payload from DTO, calls orchestrator with importType='ocr' and prebuiltPayload, maps result to 201.

**Scenarios:**

**UTS-008-A1** — Valid DTO, orchestrator returns success → 201 created

- Arrange: mock orchestrator.orchestrate() → { status: 'success', recipe: { id: 'uuid-123', title: 'Test Recipe' } }
- Act: result = await controller.saveOcrDraft({ draftId: 'draft-1', title: 'Test Recipe', ingredients: ['1 cup'], instructions: ['Mix'] }, mockUser)
- Assert: result.status === 201; result.body.importStatus === 'created'; result.body.recipe.id === 'uuid-123'
- Mock isolation: ImportOrchestrator stubbed; ImportErrorNormalizer stubbed

**UTS-008-A2** — OCR skip flag set (prebuiltPayload passed, no extraction call)

- Arrange: mock orchestrator.orchestrate() → { status: 'success' }
- Act: await controller.saveOcrDraft(validDto, mockUser)
- Assert: orchestrator.orchestrate called with importType='ocr' and prebuiltPayload defined; verify ocrPipeline.processPhoto NOT called
- Mock isolation: ImportOrchestrator stubbed

**UTS-008-A3** — Null sourceUrl in payload (OCR has no URL)

- Arrange: mock orchestrator.orchestrate() → { status: 'success' }
- Act: const result = await controller.saveOcrDraft({ draftId: 'd1', title: 'T', ingredients: ['i'], instructions: ['s'] }, mockUser)
- Assert: orchestrator called with request where sourceUrl is undefined in payload
- Mock isolation: ImportOrchestrator stubbed

---

#### Test Case: UTP-008-B (saveOcrDraft — error handling)

**Technique**: Statement & Branch Coverage
**Target View**: Error Handling & Return Codes View
**Description**: Verifies that errors from orchestrator are normalised and mapped to appropriate HTTP statuses.

**Scenarios:**

**UTS-008-B1** — PersistenceError → 500 via normalizer

- Arrange: mock orchestrator.orchestrate() → throws new PersistenceError('save', err); mock normalizer.normalize() → { httpStatus: 500, code: 'DB_ERROR', userMessage: '...' }
- Act/Assert: controller.saveOcrDraft(validDto, mockUser) returns 500 response
- Mock isolation: ImportOrchestrator stubbed; ImportErrorNormalizer stubbed

**UTS-008-B2** — RecipeNotFoundError → 404 via normalizer

- Arrange: mock orchestrator.orchestrate() → throws new RecipeNotFoundError('missing-id'); mock normalizer.normalize() → { httpStatus: 404, code: 'RECIPE_NOT_FOUND', userMessage: '...' }
- Act/Assert: controller.saveOcrDraft(validDto, mockUser) returns 404 response
- Mock isolation: ImportOrchestrator stubbed; ImportErrorNormalizer stubbed

---

### Module: MOD-009 (PaywallBlocklistService)

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `src/import/paywall-blocklist.service.ts`

---

#### Test Case: UTP-009-A (checkPaywall — blocklist matching)

**Technique**: Boundary Value Analysis + Statement Coverage
**Target View**: Internal State & Data Structures View
**Description**: Verifies blocklist initialisation, URL parsing, www. stripping, and blocklist hit throws PaywallBlockedError.

**Scenarios:**

**UTS-009-A1** — Domain on blocklist → PaywallBlockedError thrown

- Arrange: mock configService.get('PAYWALL_BLOCKLIST') → 'bbc.com,guardian.co.uk,nytimes.com'; service.onModuleInit()
- Act/Assert: service.checkPaywall('https://www.bbc.com/food/recipes/pasta') throws PaywallBlockedError with domain 'bbc.com'
- Mock isolation: ConfigService stubbed

**UTS-009-A2** — Domain not on blocklist → no throw

- Arrange: mock configService.get('PAYWALL_BLOCKLIST') → 'bbc.com,guardian.co.uk'; service.onModuleInit()
- Act: service.checkPaywall('https://example.com/recipe')
- Assert: no throw; returns undefined
- Mock isolation: ConfigService stubbed

**UTS-009-A3** — www. prefix stripped before matching

- Arrange: mock configService.get('PAYWALL_BLOCKLIST') → 'bbc.com'; service.onModuleInit()
- Act/Assert: service.checkPaywall('https://www.bbc.com/recipe') throws PaywallBlockedError; verify hostname 'bbc.com' (www. stripped)
- Mock isolation: ConfigService stubbed

---

#### Test Case: UTP-009-B (checkPaywall + flagManualEntry)

**Technique**: Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies that undefined URL (OCR path) returns early without checking blocklist, and flagManualEntry marks payload as private/paywallFlagged.

**Scenarios:**

**UTS-009-B1** — url is undefined (OCR) → early return, no blocklist check

- Arrange: mock configService.get('PAYWALL_BLOCKLIST') → 'nytimes.com'; service.onModuleInit()
- Act: service.checkPaywall(undefined)
- Assert: no throw; blockedDomains NOT accessed (verify getDomain never called)
- Mock isolation: ConfigService stubbed

**UTS-009-B2** — flagManualEntry sets visibility=private and paywallFlagged=true

- Arrange: payload = { title: 'Recipe', ingredients: [], instructions: [], sourceUrl: 'https://premium.com/recipe', platform: 'url', extractionStrategy: 'web', confidence: 0.9 }
- Act: result = service.flagManualEntry(payload)
- Assert: result.visibility === 'private'; result.paywallFlagged === true
- Mock isolation: none (pure function)

**UTS-009-B3** — Malformed URL → PaywallBlockedError(code: 'INVALID_URL')

- Arrange: mock configService.get('PAYWALL_BLOCKLIST') → ''; service.onModuleInit()
- Act/Assert: service.checkPaywall('not-a-valid-url') throws PaywallBlockedError with code 'INVALID_URL'
- Mock isolation: ConfigService stubbed

---

### Module: MOD-010 (DeduplicationService)

**Parent Architecture Modules**: ARCH-010
**Target Source File(s)**: `src/import/deduplication.service.ts`

---

#### Test Case: UTP-010-A (findBySourceUrl — duplicate detection logic)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies URL undefined returns no duplicate, URL defined queries repository, and found/not-found results returned correctly.

**Scenarios:**

**UTS-010-A1** — URL undefined (OCR path) → { isDuplicate: false }

- Arrange: url = undefined
- Act: result = await service.findBySourceUrl(undefined)
- Assert: result.isDuplicate === false; result.existingRecipe === null; verify recipeRepository.findBySourceUrl NOT called
- Mock isolation: RecipeRepository stubbed

**UTS-010-A2** — URL not in DB → { isDuplicate: false }

- Arrange: mock recipeRepository.findBySourceUrl('https://example.com/recipe') → null
- Act: result = await service.findBySourceUrl('https://example.com/recipe')
- Assert: result.isDuplicate === false; result.existingRecipe === null
- Mock isolation: RecipeRepository stubbed

**UTS-010-A3** — URL found in DB → { isDuplicate: true, existingRecipe }

- Arrange: mockRecipe = { id: 'existing-id', title: 'Existing Recipe' }; mock recipeRepository.findBySourceUrl('https://example.com/recipe') → mockRecipe
- Act: result = await service.findBySourceUrl('https://example.com/recipe')
- Assert: result.isDuplicate === true; result.existingRecipe === mockRecipe
- Mock isolation: RecipeRepository stubbed

---

### Module: MOD-011 (AttributionVisibilityService)

**Parent Architecture Modules**: ARCH-011
**Target Source File(s)**: `src/import/attribution-visibility.service.ts`

---

#### Test Case: UTP-011-A (applyAttributionVisibility — attribution population)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies attribution metadata is populated from payload fields, and visibility is set to public for url/instagram, private for ocr.

**Scenarios:**

**UTS-011-A1** — url import → visibility = public

- Arrange: payload = { title: 'T', ingredients: ['i'], instructions: ['s'], sourceUrl: 'https://ex.com', originalAuthor: 'Chef', platform: 'web', extractionStrategy: 'web', confidence: 0.9 }
- Act: result = service.applyAttributionVisibility(payload, 'url', 'user-123')
- Assert: result.visibility === 'public'; result.attribution.platform === 'web'; result.attribution.importedBy === 'user-123'
- Mock isolation: none (pure function)

**UTS-011-A2** — instagram import → visibility = public

- Arrange: payload with platform='instagram'
- Act: result = service.applyAttributionVisibility(payload, 'instagram', 'user-456')
- Assert: result.visibility === 'public'; result.attribution.platform === 'instagram'
- Mock isolation: none

**UTS-011-A3** — ocr import → visibility = private

- Arrange: payload = { title: 'T', ingredients: ['i'], instructions: ['s'], sourceUrl: undefined, originalAuthor: undefined, platform: 'ocr', extractionStrategy: 'ocr', confidence: 1.0 }
- Act: result = service.applyAttributionVisibility(payload, 'ocr', 'user-789')
- Assert: result.visibility === 'private'; result.ownerId === 'user-789'; result.attribution.importedBy === 'user-789'
- Mock isolation: none

---

#### Test Case: UTP-011-B (canMakePrivate — premium clone edit enforcement)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies canMakePrivate rules: already-private → true; non-premium → false; non-clone → false; substantive edit → true.

**Scenarios:**

**UTS-011-B1** — Recipe already private → true

- Arrange: recipe = { visibility: 'private', isClone: true }; isPremium = false; editDiff = { isSubstantive: false }
- Act: result = service.canMakePrivate(recipe, 'user-1', isPremium, editDiff)
- Assert: result === true
- Mock isolation: none

**UTS-011-B2** — Non-premium user → false

- Arrange: recipe = { visibility: 'public', isClone: true }; isPremium = false; editDiff = { isSubstantive: true }
- Act: result = service.canMakePrivate(recipe, 'user-1', isPremium, editDiff)
- Assert: result === false
- Mock isolation: none

**UTS-011-B3** — Non-clone recipe → false

- Arrange: recipe = { visibility: 'public', isClone: false }; isPremium = true; editDiff = { isSubstantive: true }
- Act: result = service.canMakePrivate(recipe, 'user-1', isPremium, editDiff)
- Assert: result === false
- Mock isolation: none

---

### Module: MOD-012 (CloneService)

**Parent Architecture Modules**: ARCH-012
**Target Source File(s)**: `src/import/clone.service.ts`

---

#### Test Case: UTP-012-A (cloneRecipe — happy path)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies cloneRecipe loads original, builds clone payload with isClone=true and new ownerId, persists, and returns entity.

**Scenarios:**

**UTS-012-A1** — Clone succeeds, visibility=public, attribution updated

- Arrange: mock original = { id: 'orig-1', title: 'Original', visibility: 'public', isClone: false, attribution: { sourceUrl: 'https://ex.com', importedBy: 'user-old' }, ownerId: 'user-old' }; mock recipeRepository.findById('orig-1') → mock original; mock recipeRepository.save() → savedClone
- Act: result = await service.cloneRecipe('orig-1', 'user-new')
- Assert: result.isClone === true; result.clonedFromId === 'orig-1'; result.ownerId === 'user-new'; result.visibility === 'public'; verify save called with isClone: true
- Mock isolation: RecipeRepository stubbed

**UTS-012-A2** — Original not found → RecipeNotFoundError

- Arrange: mock recipeRepository.findById('nonexistent') → null
- Act/Assert: service.cloneRecipe('nonexistent', 'user-new') throws RecipeNotFoundError
- Mock isolation: RecipeRepository stubbed

**UTS-012-A3** — User not owner → ForbiddenError

- Arrange: mock recipe = { id: 'id', ownerId: 'other-user' }; mock recipeRepository.findById('id') → mock recipe
- Act/Assert: service.cloneRecipe('id', 'user-new') throws ForbiddenError with reason 'not_owner'
- Mock isolation: RecipeRepository stubbed

---

#### Test Case: UTP-012-B (applySubstantiveEdit — privacy downgrade for premium clones)

**Technique**: Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View
**Description**: Verifies that premium users can downgrade public clones to private only when edits are substantive (≥3 ingredient or ≥2 instruction or title change).

**Scenarios:**

**UTS-012-B1** — Non-substantive edit → visibility change NOT applied

- Arrange: mock clone = { id: 'clone-1', visibility: 'public', isClone: true, ownerId: 'user-1' }; editDiff = { ingredientChanges: 1, instructionChanges: 0, titleChanged: false, isSubstantive: false }; editPayload = { visibility: 'private' }
- Act: result = await service.applySubstantiveEdit('clone-1', editPayload, 'user-1', true)
- Assert: result.visibility === 'public'; verify recipeRepository.update called with visibility unchanged
- Mock isolation: RecipeRepository stubbed

**UTS-012-B2** — Substantive edit + premium → visibility downgraded to private

- Arrange: editDiff = { ingredientChanges: 5, instructionChanges: 0, titleChanged: false, isSubstantive: true }; editPayload = { visibility: 'private' }
- Act: result = await service.applySubstantiveEdit('clone-1', editPayload, 'user-1', true)
- Assert: result.visibility === 'private'; verify update called with payload.visibility = 'private'
- Mock isolation: RecipeRepository stubbed

**UTS-012-B3** — Substantive edit + non-premium → 403

- Arrange: editDiff = { ingredientChanges: 5, instructionChanges: 0, titleChanged: false, isSubstantive: true }; isPremium = false
- Act/Assert: service.applySubstantiveEdit('clone-1', editPayload, 'user-1', false) throws ForbiddenError
- Mock isolation: RecipeRepository stubbed

---

### Module: MOD-013 (RecipePersistenceAdapter)

**Parent Architecture Modules**: ARCH-013
**Target Source File(s)**: `src/import/adapters/recipe-persistence.adapter.ts`

---

#### Test Case: UTP-013-A (save — happy path, mapPayloadToRow)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Internal State & Data Structures View
**Description**: Verifies save() maps AttributedPayload to row, inserts, and returns mapped entity. Also tests mapPayloadToRow field coverage.

**Scenarios:**

**UTS-013-A1** — Save successful → entity returned

- Arrange: mock db.insert().values().returning() → [{ id: 'new-id', title: 'Test', ingredients: '[]', instructions: '[]', sourceUrl: null, originalAuthor: null, platform: 'web', visibility: 'public', ownerId: 'user-1', isClone: false, clonedFromId: null, attributionNote: null, importedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]
- Act: result = await adapter.save(mockAttributedPayload)
- Assert: result.id === 'new-id'; result.title === 'Test'
- Mock isolation: DrizzleDb stubbed

**UTS-013-A2** — Unique constraint violation → PersistenceError(code: 'DUPLICATE_SOURCE_URL')

- Arrange: mock db.insert().values().returning() → throws { code: '23505' } // pg unique violation
- Act/Assert: adapter.save(payload) throws PersistenceError with code 'DUPLICATE_SOURCE_URL'
- Mock isolation: DrizzleDb stubbed

**UTS-013-A3** — mapPayloadToRow serialises ingredients/instructions as JSON strings

- Arrange: payload with ingredients=['a','b'], instructions=['step1']
- Act: row = adapter.mapPayloadToRow(payload)
- Assert: row.ingredients === '["a","b"]' (JSON string); row.instructions === '["step1"]'
- Mock isolation: none (pure function test)

---

#### Test Case: UTP-013-B (findBySourceUrl + updateAttributionNote)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies findBySourceUrl returns entity or null; updateAttributionNote calls update and propagates errors.

**Scenarios:**

**UTS-013-B1** — findBySourceUrl returns entity when found

- Arrange: mock db.select().from().where().limit(1) → [mockRow]
- Act: result = await adapter.findBySourceUrl('https://ex.com/recipe')
- Assert: result !== null; result.sourceUrl === 'https://ex.com/recipe'
- Mock isolation: DrizzleDb stubbed

**UTS-013-B2** — findBySourceUrl returns null when not found

- Arrange: mock db.select().from().where().limit(1) → []
- Act: result = await adapter.findBySourceUrl('https://nonexistent.com/recipe')
- Assert: result === null
- Mock isolation: DrizzleDb stubbed

**UTS-013-B3** — updateAttributionNote throws PersistenceError on DB failure

- Arrange: mock db.update().set().where() → throws new Error('connection lost')
- Act/Assert: adapter.updateAttributionNote('recipe-id', 'note') throws PersistenceError
- Mock isolation: DrizzleDb stubbed

---

### Module: MOD-014 (AuthMiddleware)

**Parent Architecture Modules**: ARCH-014
**Target Source File(s)**: `src/auth/middleware/auth.middleware.ts` (backed by `src/auth/clerk-auth.service.ts`)

---

#### Test Case: UTP-014-A (use — happy path token verification)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies the middleware delegates to `ClerkAuthService.verifyToken` (networkless), attaches the verified claims to the request, and calls `next()`.

**Scenarios:**

**UTS-014-A1** — Valid token → user attached, `next()` called

- Arrange: mock clerkAuthService.verifyToken(token) → { sub: 'user-123', email: 'test@example.com', public_metadata: {} }
- Act: await middleware.use(req, res, next)
- Assert: next called with no error; verify req.user = { sub: 'user-123', email: 'test@example.com', publicMetadata: {} }
- Mock isolation: ClerkAuthService.verifyToken stubbed (no network)

**UTS-014-A2** — Missing Authorization header → 401 UnauthorizedException

- Arrange: req = { headers: {} }
- Act/Assert: middleware.use(req, res, next) throws UnauthorizedException with message 'Missing Bearer token'
- Mock isolation: none

**UTS-014-A3** — Malformed Bearer token (no 'Bearer ' prefix) → 401

- Arrange: req = { headers: { authorization: 'Basic abc123' } }
- Act/Assert: middleware.use(req, res, next) throws UnauthorizedException
- Mock isolation: none

---

#### Test Case: UTP-014-B (use — error cases)

**Technique**: Branch Coverage + Equivalence Partitioning
**Target View**: Error Handling & Return Codes View
**Description**: Verifies expired token, invalid signature, and unauthorized party (`azp`) all return 401.

**Scenarios:**

**UTS-014-B1** — Expired token → 401

- Arrange: mock clerkAuthService.verifyToken() → throws new Error('token expired')
- Act/Assert: middleware.use(req, res, next) throws UnauthorizedException
- Mock isolation: ClerkAuthService.verifyToken stubbed

**UTS-014-B2** — Invalid token signature → 401

- Arrange: mock clerkAuthService.verifyToken() → throws new Error('signature verification failed')
- Act/Assert: middleware.use(req, res, next) throws UnauthorizedException
- Mock isolation: ClerkAuthService.verifyToken stubbed

**UTS-014-B3** — Unauthorized party (`azp` not in `CLERK_AUTHORIZED_PARTIES`) → 401

- Arrange: mock clerkAuthService.verifyToken() → throws Error('Invalid authorized party')
- Act/Assert: middleware.use(req, res, next) throws UnauthorizedException
- Mock isolation: ClerkAuthService.verifyToken stubbed

---

### Module: MOD-015 (RecipeRepository)

**Parent Architecture Modules**: ARCH-015
**Target Source File(s)**: `src/recipes/recipe.repository.ts`

---

#### Test Case: UTP-015-A (findBySourceUrl + findById — query logic)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies findBySourceUrl and findById both use .limit(1) and return null when no rows found.

**Scenarios:**

**UTS-015-A1** — findBySourceUrl returns entity when found

- Arrange: mockRow = { id: 'id-1', title: 'Found', ingredients: '[]', instructions: '[]', sourceUrl: 'https://ex.com', originalAuthor: null, platform: 'web', visibility: 'public', ownerId: 'u1', isClone: false, clonedFromId: null, attributionNote: null, importedAt: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' }; mock db.select().from().where().limit(1) → [mockRow]
- Act: result = await repo.findBySourceUrl('https://ex.com')
- Assert: result.id === 'id-1'; result.title === 'Found'
- Mock isolation: DrizzleDb stubbed

**UTS-015-A2** — findById returns null when not found

- Arrange: mock db.select().from().where().limit(1) → []
- Act: result = await repo.findById('nonexistent-id')
- Assert: result === null
- Mock isolation: DrizzleDb stubbed

**UTS-015-A3** — findById returns entity when found

- Arrange: mock db.select().from().where().limit(1) → [mockRow]
- Act: result = await repo.findById('existing-id')
- Assert: result !== null; result.id === 'existing-id'
- Mock isolation: DrizzleDb stubbed

---

#### Test Case: UTP-015-B (save + update — persistence logic)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies save inserts with mapToRow, update sets patch plus updatedAt, both return mapped entity.

**Scenarios:**

**UTS-015-B1** — save returns entity with new ID

- Arrange: mockInsertRow = { id: 'new-id', title: 'Saved', ingredients: '[]', instructions: '[]', sourceUrl: null, originalAuthor: null, platform: 'web', visibility: 'public', ownerId: 'u1', isClone: false, clonedFromId: null, attributionNote: null, importedAt: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' }; mock db.insert().values().returning() → [mockInsertRow]
- Act: result = await repo.save(mockAttributedPayload)
- Assert: result.id === 'new-id'; result.title === 'Saved'
- Mock isolation: DrizzleDb stubbed

**UTS-015-B2** — update sets patch + updatedAt and returns updated entity

- Arrange: mock db.update().set().where().returning() → [{ ...mockRow, title: 'Updated', updatedAt: '2026-05-09T00:00:00Z' }]
- Act: result = await repo.update('id-1', { title: 'Updated' })
- Assert: result.title === 'Updated'; verify set includes updatedAt: new Date()
- Mock isolation: DrizzleDb stubbed

**UTS-015-B3** — update on non-existent row → null returned (no row matching where clause)

- Arrange: mock db.update().set().where().returning() → []
- Act: result = await repo.update('nonexistent-id', { title: 'X' })
- Assert: result === null
- Mock isolation: DrizzleDb stubbed

---

### Module: MOD-016 (ImportDtoTypes)

**Parent Architecture Modules**: ARCH-016
**Target Source File(s)**: `src/import/dto/types.ts` (pure type file)

---

#### Test Case: UTP-016-A (DTO type compilation + validation decorators)

**Technique**: Strict Isolation
**Target View**: Internal State & Data Structures View
**Description**: Verifies all DTO classes compile under strict: true, and class-validator decorators produce expected validation constraints.

**Scenarios:**

**UTS-016-A1** — ImportUrlDto: @IsUrl rejects invalid URLs

- Arrange: dto = new ImportUrlDto(); dto.url = 'not-a-url'
- Act/Assert: validate(dto) fails with IsUrl error
- Mock isolation: none (type-level test)

**UTS-016-A2** — ImportInstagramDto: host_whitelist rejects non-Instagram URLs

- Arrange: dto = new ImportInstagramDto(); dto.postUrl = 'https://facebook.com/post/123'
- Act/Assert: validate(dto) fails (not on Instagram whitelist)
- Mock isolation: none

**UTS-016-A3** — ImportPhotoSaveDto: @IsUUID, @MinLength, @ArrayMinSize enforce constraints

- Arrange: dto = new ImportPhotoSaveDto(); dto.draftId = 'not-a-uuid'; dto.title = ''; dto.ingredients = []; dto.instructions = []
- Act/Assert: validate(dto) fails with multiple errors (uuid, minLength, array min size)
- Mock isolation: none

---

### Module: MOD-017 (ImportErrorNormalizer)

**Parent Architecture Modules**: ARCH-017
**Target Source File(s)**: `src/import/error-normalizer.ts`

---

#### Test Case: UTP-017-A (normalize — all known error types)

**Technique**: Branch Coverage (all branches)
**Target View**: Error Handling & Return Codes View
**Description**: Verifies every known error class maps to the correct httpStatus, code, and userMessage.

**Scenarios:**

**UTS-017-A1** — PaywallBlockedError → 422, code 'PAYWALL_BLOCKED'

- Arrange: err = new PaywallBlockedError('https://nytimes.com/recipe', 'nytimes.com')
- Act: result = normalizer.normalize(err)
- Assert: result.httpStatus === 422; result.code === 'PAYWALL_BLOCKED'; result.userMessage includes 'subscription'
- Mock isolation: none (pure function)

**UTS-017-A2** — UrlUnreachableError code 'URL_HTTP_ERROR' → 502

- Arrange: err = new UrlUnreachableError('https://bad.com', 'URL_HTTP_ERROR')
- Act: result = normalizer.normalize(err)
- Assert: result.httpStatus === 502; result.code === 'URL_HTTP_ERROR'
- Mock isolation: none

**UTS-017-A3** — NoCaptionError code 'NON_RECIPE_CONTENT' → 422

- Arrange: err = new NoCaptionError('https://ig.com/p/x', 'NON_RECIPE_CONTENT')
- Act: result = normalizer.normalize(err)
- Assert: result.httpStatus === 422; result.code === 'NON_RECIPE_CONTENT'; result.userMessage includes 'not appear to contain a recipe'
- Mock isolation: none

**UTS-017-A4** — PersistenceError → 500, generic message

- Arrange: err = new PersistenceError('save', new Error('db connection lost'))
- Act: result = normalizer.normalize(err)
- Assert: result.httpStatus === 500; result.code === 'DB_ERROR'; result.userMessage does NOT include 'db connection lost' (no leak)
- Mock isolation: none

---

#### Test Case: UTP-017-B (normalize — unknown error + fallback)

**Technique**: Branch Coverage
**Target View**: Error Handling & Return Codes View
**Description**: Verifies unknown errors (not instance of any known class) fall through to 500 INTERNAL_ERROR with generic message.

**Scenarios:**

**UTS-017-B1** — Plain Error → 500 INTERNAL_ERROR (no detail leaked)

- Arrange: err = new Error('some internal detail')
- Act: result = normalizer.normalize(err)
- Assert: result.httpStatus === 500; result.code === 'INTERNAL_ERROR'; result.userMessage === 'An unexpected error occurred.'
- Mock isolation: none

**UTS-017-B2** — null passed → 500 INTERNAL_ERROR

- Arrange: err = null
- Act: result = normalizer.normalize(err)
- Assert: result.httpStatus === 500; result.code === 'INTERNAL_ERROR'
- Mock isolation: none

**UTS-017-B3** — RecipeNotFoundError → 404

- Arrange: err = new RecipeNotFoundError('missing-id')
- Act: result = normalizer.normalize(err)
- Assert: result.httpStatus === 404; result.code === 'RECIPE_NOT_FOUND'; result.userMessage === 'Recipe not found.'
- Mock isolation: none

---

### Module: MOD-018 (ImportLogger)

**Parent Architecture Modules**: ARCH-018
**Target Source File(s)**: `src/import/import-logger.ts`

---

#### Test Case: UTP-018-A (log — all lifecycle events + correlation ID)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies log() formats entry with event, correlationId (from AsyncLocalStorage), timestamp, context, and calls logger.info.

**Scenarios:**

**UTS-018-A1** — log('import_started') → entry with event + correlationId + timestamp

- Arrange: mock AsyncLocalStorage.getStore() → { correlationId: 'corr-123' }; mock logger.info = jest.fn()
- Act: logger.log('import_started', { userId: 'user-1', importType: 'url' })
- Assert: logger.info called with object containing event: 'import_started', correlationId: 'corr-123', timestamp is ISO string, userId: 'user-1'
- Mock isolation: Logger stubbed; AsyncLocalStorage stubbed

**UTS-018-A2** — log('duplicate_found') with context

- Arrange: mock AsyncLocalStorage.getStore() → undefined; mock logger.info = jest.fn()
- Act: logger.log('duplicate_found', { existingId: 'existing-1', sourceUrl: 'https://ex.com' })
- Assert: logger.info called with entry where event === 'duplicate_found'; correlationId is UUID (generated fresh); timestamp is ISO
- Mock isolation: Logger stubbed; AsyncLocalStorage stubbed

**UTS-018-A3** — logError('import_failed') → error.code and error.message extracted, logger.error called

- Arrange: err = new PersistenceError('save', new Error('connection lost')); mock logger.error = jest.fn()
- Act: logger.logError('import_failed', err, { correlationId: 'corr-456' })
- Assert: logger.error called with object where event === 'import_failed'; error.code === 'DB_ERROR'; error.message is present; correlationId === 'corr-456'
- Mock isolation: Logger stubbed

**UTS-018-A4** — logger.info throws → silently swallowed (log never propagates)

- Arrange: mock logger.info = jest.fn().mockImplementation(() => { throw new Error('logger broken') })
- Act: logger.log('import_started', {})
- Assert: no exception propagated (logError catches its own logger exceptions)
- Mock isolation: Logger stubbed with throw behaviour

## Mock Registry

Each UTP that touches an external dependency MUST list the dependency mock in its setup. Mock entries identify the dependency name, mock type (stub, fake, spy, or in-memory adapter), owning MOD-NNN, and reset behavior between scenarios.
