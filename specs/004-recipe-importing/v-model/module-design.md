# Module Design: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/004-recipe-importing/v-model/architecture-design.md`

## Overview

This document decomposes 18 architecture modules (ARCH-001–ARCH-018) into 18 low-level module specifications (MOD-001–MOD-018). Each module is described with four mandatory views: (1) Algorithmic/Logic View, (2) Internal State & Data Structures View, (3) Error Handling & Return Codes View, and (4) Concurrency & Timing View. The level of detail is sufficient that writing source code is a translation exercise — no further design decisions are required.

## ID Schema

- **Module**: `MOD-NNN` — sequential, one-to-one with ARCH-NNN
- **Parent Architecture Module**: `ARCH-NNN`
- **Traceability**: Each MOD row references its parent ARCH and the SYS components it ultimately serves

## ARCH↔MOD Traceability Table

| MOD ID  | Module Name                  | Parent ARCH | Parent SYS       |
| ------- | ---------------------------- | ----------- | ---------------- |
| MOD-001 | ImportOrchestrator           | ARCH-001    | SYS-009          |
| MOD-002 | ImportController             | ARCH-002    | SYS-009          |
| MOD-003 | WebUrlExtractorService       | ARCH-003    | SYS-001          |
| MOD-004 | SchemaOrgParser              | ARCH-004    | SYS-001          |
| MOD-005 | HeuristicRecipeParser        | ARCH-005    | SYS-001          |
| MOD-006 | InstagramOEmbedAdapter       | ARCH-006    | SYS-002          |
| MOD-007 | OcrPipelineService           | ARCH-007    | SYS-003          |
| MOD-008 | OcrReviewController          | ARCH-008    | SYS-003          |
| MOD-009 | PaywallBlocklistService      | ARCH-009    | SYS-006          |
| MOD-010 | DeduplicationService         | ARCH-010    | SYS-005          |
| MOD-011 | AttributionVisibilityService | ARCH-011    | SYS-004          |
| MOD-012 | CloneService                 | ARCH-012    | SYS-004          |
| MOD-013 | RecipePersistenceAdapter     | ARCH-013    | SYS-007          |
| MOD-014 | AuthMiddleware               | ARCH-014    | SYS-008          |
| MOD-015 | RecipeRepository             | ARCH-015    | SYS-005, SYS-007 |
| MOD-016 | ImportDtoTypes               | ARCH-016    | [CROSS-CUTTING]  |
| MOD-017 | ImportErrorNormalizer        | ARCH-017    | [CROSS-CUTTING]  |
| MOD-018 | ImportLogger                 | ARCH-018    | [CROSS-CUTTING]  |

---

## MOD-001 — ImportOrchestrator

**Parent ARCH**: ARCH-001 | **Type**: Service | **Parent SYS**: SYS-009

### 1. Algorithmic / Logic View

```
function orchestrate(request: OrchestrationRequest): Promise<OrchestrationResult>

  // Step 1 — Paywall gate (synchronous, throws on block)
  paywallService.checkPaywall(request.sourceUrl)          // throws PaywallBlockedError

  // Step 2 — Extract recipe payload based on import type
  let payload: RecipeImportPayload
  switch request.importType
    case 'url':
      payload = await webUrlExtractor.extractFromUrl(request.sourceUrl)
    case 'instagram':
      payload = await instagramAdapter.extractFromPost(request.sourceUrl)
    case 'ocr':
      payload = await ocrPipeline.processPhoto(request.photoBuffer)
    default:
      throw new UnsupportedImportTypeError(request.importType)

  // Step 3 — Deduplication check
  const dupResult = await deduplicationService.findBySourceUrl(request.sourceUrl)
  if dupResult.isDuplicate
    logger.log('duplicate_found', { existingId: dupResult.existingRecipe.id })
    return { status: 'duplicate', existingRecipe: dupResult.existingRecipe }

  // Step 4 — Attribution + visibility enforcement
  const attributed = attributionService.applyAttributionVisibility(payload, request.importType, request.userId)

  // Step 5 — Persist
  const saved = await persistenceAdapter.save(attributed)
  logger.log('import_persisted', { recipeId: saved.id, importType: request.importType })

  return { status: 'created', recipe: saved }

// Top-level error boundary — delegates to ImportErrorNormalizer (ARCH-017)
// All unhandled errors bubble to ImportController (ARCH-002) which calls normalizer
```

**Decision rules**:

- `importType === 'ocr'` skips `sourceUrl` paywall check (no URL); `checkPaywall` is a no-op when `sourceUrl` is undefined.
- Duplicate detection returns early — no persistence, no attribution step.
- The orchestrator does NOT catch errors; it lets them propagate to the controller layer.

### 2. Internal State & Data Structures View

```typescript
// No mutable instance state — all dependencies injected via constructor DI
class ImportOrchestrator {
    constructor(
        private readonly paywallService: PaywallBlocklistService, // MOD-009
        private readonly webUrlExtractor: WebUrlExtractorService, // MOD-003
        private readonly instagramAdapter: InstagramOEmbedAdapter, // MOD-006
        private readonly ocrPipeline: OcrPipelineService, // MOD-007
        private readonly deduplicationService: DeduplicationService, // MOD-010
        private readonly attributionService: AttributionVisibilityService, // MOD-011
        private readonly persistenceAdapter: RecipePersistenceAdapter, // MOD-013
        private readonly logger: ImportLogger, // MOD-018
    ) {}
}

// Input type
interface OrchestrationRequest {
    importType: 'url' | 'instagram' | 'ocr';
    sourceUrl?: string; // undefined for OCR
    photoBuffer?: Buffer; // defined only for OCR
    userId: string; // Clerk sub claim
}

// Output type
type OrchestrationResult =
    | { status: 'created'; recipe: RecipeEntity }
    | { status: 'duplicate'; existingRecipe: RecipeEntity };
```

### 3. Error Handling & Return Codes View

| Error Class                  | Thrown By | Propagates To    | HTTP (via normalizer) |
| ---------------------------- | --------- | ---------------- | --------------------- |
| `PaywallBlockedError`        | MOD-009   | ImportController | 422 Unprocessable     |
| `UrlUnreachableError`        | MOD-003   | ImportController | 502 Bad Gateway       |
| `NoCaptionError`             | MOD-006   | ImportController | 422 Unprocessable     |
| `OcrServiceError`            | MOD-007   | ImportController | 502 Bad Gateway       |
| `PersistenceError`           | MOD-013   | ImportController | 500 Internal          |
| `UnsupportedImportTypeError` | MOD-001   | ImportController | 400 Bad Request       |

All errors are plain `Error` subclasses with a `code: string` discriminant property.

### 4. Concurrency & Timing View

- All async operations use `await` sequentially — no parallel fan-out within a single import.
- No shared mutable state; each request creates an isolated call stack.
- Timeout responsibility delegated to individual service modules (MOD-003, MOD-006, MOD-007).
- NestJS DI scope: `@Injectable()` with default singleton scope (stateless, safe).

---

## MOD-002 — ImportController

**Parent ARCH**: ARCH-002 | **Type**: Component | **Parent SYS**: SYS-009

### 1. Algorithmic / Logic View

```
// Endpoint: POST /import/url
async importUrl(dto: ImportUrlDto, user: AuthUser): Promise<RecipeResponseDto>
  result = await orchestrator.orchestrate({ importType: 'url', sourceUrl: dto.url, userId: user.sub })
  return mapOrchestrationResultToDto(result)

// Endpoint: POST /import/instagram
async importInstagram(dto: ImportInstagramDto, user: AuthUser): Promise<RecipeResponseDto>
  result = await orchestrator.orchestrate({ importType: 'instagram', sourceUrl: dto.postUrl, userId: user.sub })
  return mapOrchestrationResultToDto(result)

// Endpoint: POST /import/photo
async importPhoto(file: Express.Multer.File, user: AuthUser): Promise<OcrDraftResponseDto>
  draft = await ocrPipeline.processPhoto(file.buffer)
  return { draftId: draft.draftId, extractedText: draft.text, confidence: draft.confidence }

// Endpoint: POST /import/photo/save  (delegates to OcrReviewController MOD-008)
// (handled by ARCH-008 / MOD-008 — separate controller class)

// Error mapping (called in catch block)
function mapError(err: unknown): never
  const normalized = errorNormalizer.normalize(err)
  throw new HttpException(normalized.userMessage, normalized.httpStatus)

// DTO mapping
function mapOrchestrationResultToDto(result: OrchestrationResult): RecipeResponseDto
  if result.status === 'duplicate'
    return { ...result.existingRecipe, importStatus: 'duplicate' }
  return { ...result.recipe, importStatus: 'created' }
```

### 2. Internal State & Data Structures View

```typescript
@Controller('import')
// MOD-014 AuthMiddleware applied to these routes via module configure(consumer)
class ImportController {
    constructor(
        private readonly orchestrator: ImportOrchestrator, // MOD-001
        private readonly ocrPipeline: OcrPipelineService, // MOD-007
        private readonly errorNormalizer: ImportErrorNormalizer, // MOD-017
    ) {}
}

// DTOs (defined in MOD-016)
// ImportUrlDto       — { url: string @IsUrl() }
// ImportInstagramDto — { postUrl: string @IsUrl() }
// RecipeResponseDto  — { id, title, importStatus, ... }
// OcrDraftResponseDto — { draftId, extractedText, confidence }
```

### 3. Error Handling & Return Codes View

| Scenario                        | HTTP Status | Response Body                                                  |
| ------------------------------- | ----------- | -------------------------------------------------------------- |
| DTO validation failure          | 400         | `{ message: string[], error: 'Bad Request' }` (NestJS default) |
| Unauthenticated (guard rejects) | 401         | `{ message: 'Unauthorized' }`                                  |
| PaywallBlockedError             | 422         | `{ code: 'PAYWALL_BLOCKED', message }`                         |
| UrlUnreachableError             | 502         | `{ code: 'URL_UNREACHABLE', message }`                         |
| NoCaptionError                  | 422         | `{ code: 'NO_CAPTION', message }`                              |
| OcrServiceError                 | 502         | `{ code: 'OCR_FAILED', message }`                              |
| PersistenceError                | 500         | `{ code: 'PERSISTENCE_ERROR', message }`                       |
| Duplicate found                 | 200         | `{ importStatus: 'duplicate', ... }`                           |

### 4. Concurrency & Timing View

- Stateless singleton; concurrent requests are isolated by NestJS request pipeline.
- File upload handled by `@UseInterceptors(FileInterceptor('photo'))` — Multer buffers in memory (max 10 MB enforced by Multer config).
- No internal timeouts; relies on NestJS global timeout interceptor (configurable, default 30 s).

---

## MOD-003 — WebUrlExtractorService

**Parent ARCH**: ARCH-003 | **Type**: Service | **Parent SYS**: SYS-001

### 1. Algorithmic / Logic View

```
async function extractFromUrl(url: string): Promise<RecipeImportPayload>

  // 1. Fetch HTML
  response = await fetch(url, { timeout: 10_000, headers: { 'User-Agent': SCRAPER_UA } })
  if !response.ok
    throw new UrlUnreachableError(url, response.status)
  html = await response.text()

  // 2. Primary strategy — schema.org parser
  payload = schemaOrgParser.parse(html)
  if payload !== null
    return { ...payload, sourceUrl: url, extractionStrategy: 'schema_org' }

  // 3. Fallback — heuristic parser
  partial = heuristicParser.parse(html)
  if partial.confidence < CONFIDENCE_THRESHOLD   // 0.4
    throw new UrlUnreachableError(url, 'low_confidence')
  return { ...partial, sourceUrl: url, extractionStrategy: 'heuristic' }
```

**Constants**:

- `SCRAPER_UA = 'CommiseBot/1.0 (+https://commise.app/bot)'`
- `CONFIDENCE_THRESHOLD = 0.4`
- Fetch timeout: 10 000 ms

### 2. Internal State & Data Structures View

```typescript
class WebUrlExtractorService {
    constructor(
        private readonly schemaOrgParser: SchemaOrgParser, // MOD-004
        private readonly heuristicParser: HeuristicRecipeParser, // MOD-005
    ) {}
    // No mutable state
}

// Return type (from MOD-016)
interface RecipeImportPayload {
    title: string;
    ingredients: string[];
    instructions: string[];
    sourceUrl: string;
    originalAuthor?: string;
    platform: 'web' | 'instagram' | 'ocr';
    extractionStrategy: 'schema_org' | 'heuristic' | 'oembed' | 'ocr';
    confidence?: number;
}
```

### 3. Error Handling & Return Codes View

| Condition                          | Error Class           | `code` property       |
| ---------------------------------- | --------------------- | --------------------- |
| HTTP 4xx/5xx from target URL       | `UrlUnreachableError` | `'URL_HTTP_ERROR'`    |
| Network timeout (>10 s)            | `UrlUnreachableError` | `'URL_TIMEOUT'`       |
| Both parsers fail / low confidence | `UrlUnreachableError` | `'EXTRACTION_FAILED'` |

`UrlUnreachableError` constructor: `(url: string, reason: string | number)`.

### 4. Concurrency & Timing View

- One `fetch` call per invocation; no internal parallelism.
- `node-fetch` AbortController used for 10 s timeout.
- Stateless singleton — safe for concurrent requests.

---

## MOD-004 — SchemaOrgParser

**Parent ARCH**: ARCH-004 | **Type**: Library | **Parent SYS**: SYS-001

### 1. Algorithmic / Logic View

```
function parse(html: string): RecipeImportPayload | null

  // 1. Extract all <script type="application/ld+json"> blocks
  scriptBlocks = extractLdJsonBlocks(html)   // regex: /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi

  for each block in scriptBlocks
    try
      data = JSON.parse(block)
      // Handle @graph arrays
      candidates = Array.isArray(data['@graph']) ? data['@graph'] : [data]
      for each candidate in candidates
        if candidate['@type'] === 'Recipe'
          return mapSchemaOrgToPayload(candidate)
    catch (SyntaxError)
      continue   // malformed JSON — skip block

  return null   // no valid Recipe schema found

function mapSchemaOrgToPayload(schema: SchemaOrgRecipe): RecipeImportPayload
  title       = schema.name ?? ''
  ingredients = normaliseStringArray(schema.recipeIngredient)
  instructions = extractInstructionSteps(schema.recipeInstructions)
  author      = extractAuthorName(schema.author)
  return { title, ingredients, instructions, originalAuthor: author, platform: 'web', extractionStrategy: 'schema_org' }

function extractInstructionSteps(raw: unknown): string[]
  if Array.isArray(raw)
    return raw.map(step =>
      typeof step === 'string' ? step : (step.text ?? step.name ?? '')
    ).filter(Boolean)
  if typeof raw === 'string'
    return [raw]
  return []
```

### 2. Internal State & Data Structures View

```typescript
// Pure stateless functions — no class instance needed; exported as module-level functions
// or wrapped in a stateless @Injectable() class for NestJS DI

interface SchemaOrgRecipe {
    '@type': 'Recipe';
    name?: string;
    recipeIngredient?: string[];
    recipeInstructions?: unknown; // string | HowToStep[] | string[]
    author?: { name?: string } | string;
}
```

### 3. Error Handling & Return Codes View

- Never throws — all JSON parse errors are caught internally; returns `null` on any failure.
- Malformed or missing fields produce empty strings/arrays (graceful degradation).

### 4. Concurrency & Timing View

- Synchronous; no I/O.
- Pure function — safe for any concurrency level.

---

## MOD-005 — HeuristicRecipeParser

**Parent ARCH**: ARCH-005 | **Type**: Library | **Parent SYS**: SYS-001

### 1. Algorithmic / Logic View

```
function parse(html: string): Partial<RecipeImportPayload> & { confidence: number }

  dom = parseHtml(html)   // using 'node-html-parser' or equivalent

  // Title — ordered selector list, first match wins
  title = firstText(dom, [
    'h1.recipe-title', 'h1[class*="recipe"]', 'h1[itemprop="name"]',
    '.wprm-recipe-name', '.tasty-recipes-title', 'h1'
  ])

  // Ingredients — look for list items inside ingredient containers
  ingredientEls = dom.querySelectorAll([
    '[class*="ingredient"] li',
    '[itemprop="recipeIngredient"]',
    '.wprm-recipe-ingredient',
  ].join(','))
  ingredients = ingredientEls.map(el => el.text.trim()).filter(Boolean)

  // Instructions — look for ordered/unordered lists inside instruction containers
  instructionEls = dom.querySelectorAll([
    '[class*="instruction"] li',
    '[class*="direction"] li',
    '[itemprop="recipeInstructions"] li',
    '.wprm-recipe-instruction-text',
  ].join(','))
  instructions = instructionEls.map(el => el.text.trim()).filter(Boolean)

  // Confidence scoring
  score = 0
  if title.length > 0        score += 0.3
  if ingredients.length >= 3 score += 0.4
  if instructions.length >= 2 score += 0.3

  return { title, ingredients, instructions, platform: 'web', extractionStrategy: 'heuristic', confidence: score }
```

### 2. Internal State & Data Structures View

```typescript
// Stateless — no instance state
// Selector constants defined as module-level readonly arrays
const TITLE_SELECTORS: string[] = [ ... ]
const INGREDIENT_SELECTORS: string[] = [ ... ]
const INSTRUCTION_SELECTORS: string[] = [ ... ]
```

### 3. Error Handling & Return Codes View

- Never throws. If DOM parsing fails, returns `{ title: '', ingredients: [], instructions: [], confidence: 0 }`.
- Caller (MOD-003) checks `confidence < 0.4` and throws `UrlUnreachableError`.

### 4. Concurrency & Timing View

- Synchronous CPU-bound parsing; no I/O.
- Stateless — safe for concurrent use.
- For very large HTML pages (>1 MB), parsing may take ~50–100 ms; acceptable within the 10 s fetch budget.

---

## MOD-006 — InstagramOEmbedAdapter

**Parent ARCH**: ARCH-006 | **Type**: Adapter | **Parent SYS**: SYS-002

### 1. Algorithmic / Logic View

```
async function extractFromPost(postUrl: string): Promise<RecipeImportPayload>

  // 1. Call oEmbed endpoint
  apiUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(postUrl)}&access_token=${INSTAGRAM_ACCESS_TOKEN}`
  response = await fetch(apiUrl, { timeout: 8_000 })
  if !response.ok
    throw new OEmbedApiError(postUrl, response.status)
  data = await response.json()   // type: InstagramOEmbedResponse

  // 2. Validate caption presence
  caption = data.title ?? ''
  if caption.trim().length === 0
    throw new NoCaptionError(postUrl, 'empty_caption')

  // 3. Detect video-only / image-only (no recipe text)
  if isNonRecipeContent(caption)
    throw new NoCaptionError(postUrl, 'non_recipe_content')

  // 4. Map to payload
  return {
    title: extractTitleFromCaption(caption),
    ingredients: [],          // OCR/manual fill — caption rarely has structured ingredients
    instructions: [caption],  // raw caption as single instruction block
    sourceUrl: postUrl,
    originalAuthor: data.author_name,
    platform: 'instagram',
    extractionStrategy: 'oembed',
    confidence: 0.6,
  }

function isNonRecipeContent(caption: string): boolean
  // Heuristic: caption shorter than 50 chars with no ingredient-like words
  if caption.length < 50 return true
  RECIPE_KEYWORDS = ['ingredient', 'cup', 'tbsp', 'tsp', 'oz', 'gram', 'mix', 'stir', 'bake', 'cook', 'heat', 'add', 'combine']
  return !RECIPE_KEYWORDS.some(kw => caption.toLowerCase().includes(kw))

function extractTitleFromCaption(caption: string): string
  // First non-empty line, truncated to 120 chars
  return caption.split('\n').find(l => l.trim().length > 0)?.slice(0, 120) ?? 'Imported Recipe'
```

### 2. Internal State & Data Structures View

```typescript
class InstagramOEmbedAdapter {
    private readonly accessToken: string; // injected from ConfigService env var INSTAGRAM_ACCESS_TOKEN
    constructor(private readonly config: ConfigService) {
        this.accessToken = config.get('INSTAGRAM_ACCESS_TOKEN');
    }
}

interface InstagramOEmbedResponse {
    title?: string;
    author_name?: string;
    author_url?: string;
    html?: string;
    thumbnail_url?: string;
}
```

### 3. Error Handling & Return Codes View

| Condition                   | Error Class      | `code`                 |
| --------------------------- | ---------------- | ---------------------- |
| oEmbed API non-2xx          | `OEmbedApiError` | `'OEMBED_API_ERROR'`   |
| Network timeout (>8 s)      | `OEmbedApiError` | `'OEMBED_TIMEOUT'`     |
| Empty caption               | `NoCaptionError` | `'EMPTY_CAPTION'`      |
| Non-recipe content detected | `NoCaptionError` | `'NON_RECIPE_CONTENT'` |

`OEmbedApiError` extends `Error`; `NoCaptionError` extends `Error`.

### 4. Concurrency & Timing View

- Single async HTTP call; 8 s timeout via AbortController.
- Stateless per-request; singleton DI scope safe.

---

## MOD-007 — OcrPipelineService

**Parent ARCH**: ARCH-007 | **Type**: Service | **Parent SYS**: SYS-003

### 1. Algorithmic / Logic View

```
async function processPhoto(photoBuffer: Buffer): Promise<OcrDraftPayload>

  // 1. Upload buffer to Textract (StartDocumentTextDetection for async, or DetectDocumentText for sync <5MB)
  if photoBuffer.byteLength <= 5_000_000
    // Synchronous path
    result = await textractClient.detectDocumentText({ Document: { Bytes: photoBuffer } })
    lines = extractLines(result.Blocks)
  else
    // Async path — upload to S3 staging bucket, start job, poll
    s3Key = `ocr-staging/${uuid()}`
    await s3Client.putObject({ Bucket: OCR_STAGING_BUCKET, Key: s3Key, Body: photoBuffer })
    jobId = await textractClient.startDocumentTextDetection({ DocumentLocation: { S3Object: { Bucket: OCR_STAGING_BUCKET, Name: s3Key } } })
    lines = await pollTextractJob(jobId, maxAttempts=20, intervalMs=3_000)

  // 2. Assemble draft
  text = lines.join('\n')
  confidence = computeAverageConfidence(result.Blocks)
  draftId = uuid()

  return { draftId, text, confidence, rawBlocks: result.Blocks }

function extractLines(blocks: TextractBlock[]): string[]
  return blocks.filter(b => b.BlockType === 'LINE').map(b => b.Text ?? '').filter(Boolean)

async function pollTextractJob(jobId: string, maxAttempts: int, intervalMs: int): Promise<string[]>
  for attempt in 1..maxAttempts
    await sleep(intervalMs)
    status = await textractClient.getDocumentTextDetection({ JobId: jobId })
    if status.JobStatus === 'SUCCEEDED'
      return extractLines(status.Blocks)
    if status.JobStatus === 'FAILED'
      throw new OcrServiceError(jobId, 'TEXTRACT_JOB_FAILED')
  throw new OcrServiceError(jobId, 'TEXTRACT_TIMEOUT')
```

### 2. Internal State & Data Structures View

```typescript
class OcrPipelineService {
    private readonly textractClient: TextractClient; // @aws-sdk/client-textract
    private readonly s3Client: S3Client;
    private readonly stagingBucket: string;
    constructor(private readonly config: ConfigService) {
        this.textractClient = new TextractClient({ region: config.get('AWS_REGION') });
        this.s3Client = new S3Client({ region: config.get('AWS_REGION') });
        this.stagingBucket = config.get('OCR_STAGING_BUCKET');
    }
}

interface OcrDraftPayload {
    draftId: string;
    text: string;
    confidence: number; // 0.0–1.0 average of Textract block confidences
    rawBlocks: TextractBlock[];
}
```

### 3. Error Handling & Return Codes View

| Condition                         | Error Class       | `code`                  |
| --------------------------------- | ----------------- | ----------------------- |
| Textract API call fails           | `OcrServiceError` | `'TEXTRACT_API_ERROR'`  |
| Async job fails (FAILED status)   | `OcrServiceError` | `'TEXTRACT_JOB_FAILED'` |
| Polling timeout (20 × 3 s = 60 s) | `OcrServiceError` | `'TEXTRACT_TIMEOUT'`    |
| S3 staging upload fails           | `OcrServiceError` | `'S3_STAGING_ERROR'`    |

### 4. Concurrency & Timing View

- Synchronous path: single Textract API call, ~1–3 s.
- Async path: up to 60 s polling (20 attempts × 3 s). NestJS global timeout must be ≥ 65 s for photo endpoints.
- Each request is independent; no shared mutable state.

---

## MOD-008 — OcrReviewController

**Parent ARCH**: ARCH-008 | **Type**: Component | **Parent SYS**: SYS-003

### 1. Algorithmic / Logic View

```
// Endpoint: POST /import/photo/save
async saveOcrDraft(dto: ImportPhotoSaveDto, user: AuthUser): Promise<RecipeResponseDto>

  // 1. Validate DTO (class-validator handles this via NestJS pipe)
  // dto.draftId, dto.title, dto.ingredients[], dto.instructions[]

  // 2. Build RecipeImportPayload from user-corrected OCR draft
  payload: RecipeImportPayload = {
    title: dto.title,
    ingredients: dto.ingredients,
    instructions: dto.instructions,
    sourceUrl: undefined,          // OCR has no source URL
    platform: 'ocr',
    extractionStrategy: 'ocr',
    confidence: 1.0,               // user-reviewed = full confidence
  }

  // 3. Delegate to orchestrator (skips paywall + deduplication for OCR)
  result = await orchestrator.orchestrate({
    importType: 'ocr',
    photoBuffer: undefined,   // already processed; payload provided directly
    userId: user.sub,
    prebuiltPayload: payload, // orchestrator checks this field to skip extraction
  })

  return mapOrchestrationResultToDto(result)
```

**Note**: The orchestrator's `importType === 'ocr'` branch, when `prebuiltPayload` is provided, skips the `ocrPipeline.processPhoto()` call and proceeds directly to attribution/persistence.

### 2. Internal State & Data Structures View

```typescript
@Controller('import')
// MOD-014 AuthMiddleware applied to these routes via module configure(consumer)
class OcrReviewController {
    constructor(
        private readonly orchestrator: ImportOrchestrator, // MOD-001
        private readonly errorNormalizer: ImportErrorNormalizer, // MOD-017
    ) {}
}

// DTO (from MOD-016)
// ImportPhotoSaveDto — { draftId: string, title: string, ingredients: string[], instructions: string[] }
```

### 3. Error Handling & Return Codes View

| Scenario               | HTTP Status | Notes                                     |
| ---------------------- | ----------- | ----------------------------------------- |
| DTO validation failure | 400         | NestJS ValidationPipe                     |
| Unauthenticated        | 401         | AuthMiddleware                            |
| PersistenceError       | 500         | Via errorNormalizer                       |
| Success                | 201         | `{ importStatus: 'created', recipe: {} }` |

### 4. Concurrency & Timing View

- Stateless singleton; concurrent requests isolated.
- No long-running I/O in this controller — OCR already completed in the photo upload step.

---

## MOD-009 — PaywallBlocklistService

**Parent ARCH**: ARCH-009 | **Type**: Service | **Parent SYS**: SYS-006

### 1. Algorithmic / Logic View

```
// Initialisation (called once at module startup via onModuleInit)
function onModuleInit(): void
  raw = configService.get('PAYWALL_BLOCKLIST')   // comma-separated domain string
  this.blockedDomains = new Set(
    raw.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
  )

// Runtime check — synchronous
function checkPaywall(url: string | undefined): void
  if url === undefined return   // OCR imports have no URL
  hostname = new URL(url).hostname.toLowerCase()
  // Strip www. prefix for normalisation
  normalised = hostname.startsWith('www.') ? hostname.slice(4) : hostname
  if this.blockedDomains.has(normalised)
    throw new PaywallBlockedError(url, normalised)

// Manual entry flag (for premium paid-source recipes entered manually)
function flagManualEntry(payload: RecipeImportPayload): RecipeImportPayload
  return { ...payload, visibility: 'private', paywallFlagged: true }
```

### 2. Internal State & Data Structures View

```typescript
@Injectable()
class PaywallBlocklistService implements OnModuleInit {
    private blockedDomains: Set<string> = new Set();
    constructor(private readonly config: ConfigService) {}
}

// PaywallBlockedError
class PaywallBlockedError extends Error {
    readonly code = 'PAYWALL_BLOCKED';
    constructor(
        public readonly url: string,
        public readonly domain: string,
    ) {
        super(`Domain '${domain}' is on the paywall blocklist`);
    }
}
```

### 3. Error Handling & Return Codes View

| Condition                     | Error Class           | `code`              |
| ----------------------------- | --------------------- | ------------------- |
| Domain on blocklist           | `PaywallBlockedError` | `'PAYWALL_BLOCKED'` |
| Malformed URL (URL parse err) | `PaywallBlockedError` | `'INVALID_URL'`     |

Malformed URL: wrap `new URL(url)` in try/catch; throw `PaywallBlockedError` with code `'INVALID_URL'`.

### 4. Concurrency & Timing View

- `blockedDomains` Set is populated once at startup and is read-only thereafter — no locking needed.
- `checkPaywall` is synchronous; zero I/O.
- Blocklist updates require service restart (acceptable for MVP; future: hot-reload via config watcher).

---

## MOD-010 — DeduplicationService

**Parent ARCH**: ARCH-010 | **Type**: Service | **Parent SYS**: SYS-005

### 1. Algorithmic / Logic View

```
async function findBySourceUrl(url: string | undefined): Promise<DuplicateCheckResult>
  if url === undefined
    return { isDuplicate: false, existingRecipe: null }

  existing = await recipeRepository.findBySourceUrl(url)   // MOD-015
  if existing !== null
    return { isDuplicate: true, existingRecipe: existing }
  return { isDuplicate: false, existingRecipe: null }
```

Simple delegation — all query logic lives in MOD-015 (RecipeRepository).

### 2. Internal State & Data Structures View

```typescript
class DeduplicationService {
    constructor(private readonly recipeRepository: RecipeRepository) {} // MOD-015
}

interface DuplicateCheckResult {
    isDuplicate: boolean;
    existingRecipe: RecipeEntity | null;
}
```

### 3. Error Handling & Return Codes View

- Database errors from MOD-015 propagate as `PersistenceError` — not caught here.
- `url === undefined` (OCR) returns `{ isDuplicate: false }` without querying DB.

### 4. Concurrency & Timing View

- Single async DB read per call; no caching.
- Stateless singleton.

---

## MOD-011 — AttributionVisibilityService

**Parent ARCH**: ARCH-011 | **Type**: Service | **Parent SYS**: SYS-004

### 1. Algorithmic / Logic View

```
function applyAttributionVisibility(
  payload: RecipeImportPayload,
  importType: 'url' | 'instagram' | 'ocr',
  userId: string
): AttributedPayload

  // 1. Attribution metadata
  attribution = {
    sourceUrl: payload.sourceUrl ?? null,
    originalAuthor: payload.originalAuthor ?? null,
    platform: payload.platform,
    importedAt: new Date().toISOString(),
    importedBy: userId,
  }

  // 2. Visibility rules
  //    web + instagram → always public
  //    ocr (physical copy) → always private
  visibility = (importType === 'url' || importType === 'instagram') ? 'public' : 'private'

  return { ...payload, attribution, visibility, ownerId: userId }

// Visibility change enforcement (called by CloneService MOD-012 and edit endpoints)
function canMakePrivate(recipe: RecipeEntity, userId: string, isPremium: boolean, editDiff: EditDiff): boolean
  if recipe.visibility !== 'public' return true   // already private — no restriction
  if !isPremium return false                       // non-premium cannot make public imports private
  if !recipe.isClone return false                  // must be a clone
  return editDiff.isSubstantive                    // must have substantive edits
```

**Substantive edit definition** (delegated to `EditDiff`): ≥ 3 ingredient changes OR ≥ 2 instruction step changes OR title change.

### 2. Internal State & Data Structures View

```typescript
class AttributionVisibilityService {
    // No injected dependencies — pure logic
}

interface AttributedPayload extends RecipeImportPayload {
    attribution: {
        sourceUrl: string | null;
        originalAuthor: string | null;
        platform: 'web' | 'instagram' | 'ocr';
        importedAt: string; // ISO 8601
        importedBy: string; // Clerk sub
    };
    visibility: 'public' | 'private';
    ownerId: string;
}
```

### 3. Error Handling & Return Codes View

- `applyAttributionVisibility` never throws — all inputs are validated upstream.
- `canMakePrivate` returns `boolean`; caller throws appropriate domain error on `false`.

### 4. Concurrency & Timing View

- Synchronous pure functions; no I/O.
- Stateless — safe for any concurrency.

---

## MOD-012 — CloneService

**Parent ARCH**: ARCH-012 | **Type**: Service | **Parent SYS**: SYS-004

### 1. Algorithmic / Logic View

```
async function cloneRecipe(recipeId: string, userId: string): Promise<RecipeEntity>

  // 1. Load original
  original = await recipeRepository.findById(recipeId)   // MOD-015
  if original === null
    throw new RecipeNotFoundError(recipeId)

  // 2. Build clone payload — deep copy, new owner, retain attribution
  clonePayload: AttributedPayload = {
    ...original,
    id: undefined,           // new ID assigned by DB
    ownerId: userId,
    isClone: true,
    clonedFromId: original.id,
    visibility: 'public',    // clones start public (REQ-007)
    attribution: {
      ...original.attribution,
      clonedBy: userId,
      clonedAt: new Date().toISOString(),
    },
  }

  // 3. Persist clone
  saved = await recipeRepository.save(clonePayload)   // MOD-015
  return saved

async function applySubstantiveEdit(cloneId: string, editPayload: EditPayload, userId: string, isPremium: boolean): Promise<RecipeEntity>

  clone = await recipeRepository.findById(cloneId)
  if clone === null throw new RecipeNotFoundError(cloneId)
  if clone.ownerId !== userId throw new ForbiddenError('not_owner')

  diff = computeEditDiff(clone, editPayload)
  if isPremium && diff.isSubstantive
    editPayload.visibility = 'private'   // allow privacy change

  updated = await recipeRepository.update(cloneId, editPayload)
  return updated
```

### 2. Internal State & Data Structures View

```typescript
class CloneService {
    constructor(private readonly recipeRepository: RecipeRepository) {} // MOD-015
}

interface EditDiff {
    ingredientChanges: number;
    instructionChanges: number;
    titleChanged: boolean;
    isSubstantive: boolean; // computed: ingredientChanges >= 3 || instructionChanges >= 2 || titleChanged
}
```

### 3. Error Handling & Return Codes View

| Condition                 | Error Class           | HTTP (via normalizer) |
| ------------------------- | --------------------- | --------------------- |
| Original recipe not found | `RecipeNotFoundError` | 404                   |
| User not owner of clone   | `ForbiddenError`      | 403                   |
| DB write failure          | `PersistenceError`    | 500                   |

### 4. Concurrency & Timing View

- Two sequential DB calls (read + write); no transactions needed (clone is a new row).
- Stateless singleton.

---

## MOD-013 — RecipePersistenceAdapter

**Parent ARCH**: ARCH-013 | **Type**: Adapter | **Parent SYS**: SYS-007

### 1. Algorithmic / Logic View

```
async function save(payload: AttributedPayload): Promise<RecipeEntity>
  row = mapPayloadToRow(payload)
  try
    [inserted] = await db.insert(recipesTable).values(row).returning()
    return mapRowToEntity(inserted)
  catch (err)
    throw new PersistenceError('save', err)

async function findBySourceUrl(url: string): Promise<RecipeEntity | null>
  try
    [row] = await db.select().from(recipesTable).where(eq(recipesTable.sourceUrl, url)).limit(1)
    return row ? mapRowToEntity(row) : null
  catch (err)
    throw new PersistenceError('findBySourceUrl', err)

async function updateAttributionNote(recipeId: string, note: string): Promise<void>
  try
    await db.update(recipesTable).set({ attributionNote: note }).where(eq(recipesTable.id, recipeId))
  catch (err)
    throw new PersistenceError('updateAttributionNote', err)

function mapPayloadToRow(payload: AttributedPayload): RecipesInsert
  return {
    title: payload.title,
    ingredients: JSON.stringify(payload.ingredients),
    instructions: JSON.stringify(payload.instructions),
    sourceUrl: payload.attribution.sourceUrl,
    originalAuthor: payload.attribution.originalAuthor,
    platform: payload.attribution.platform,
    visibility: payload.visibility,
    ownerId: payload.ownerId,
    isClone: payload.isClone ?? false,
    clonedFromId: payload.clonedFromId ?? null,
    importedAt: payload.attribution.importedAt,
  }
```

### 2. Internal State & Data Structures View

```typescript
class RecipePersistenceAdapter {
    constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}
}

// Drizzle table schema (from 001-commise-recipe-app)
// recipesTable — columns: id (uuid), title, ingredients (jsonb), instructions (jsonb),
//   sourceUrl, originalAuthor, platform, visibility, ownerId, isClone, clonedFromId,
//   attributionNote, importedAt, createdAt, updatedAt
```

### 3. Error Handling & Return Codes View

| Condition                   | Error Class        | `code`                   |
| --------------------------- | ------------------ | ------------------------ |
| Any Drizzle/pg error        | `PersistenceError` | `'DB_ERROR'`             |
| Unique constraint violation | `PersistenceError` | `'DUPLICATE_SOURCE_URL'` |

`PersistenceError` wraps the original error as `cause`.

### 4. Concurrency & Timing View

- Each method is a single DB round-trip; no transactions spanning multiple calls.
- Connection pooling managed by `pg` pool (configured in 001-commise-recipe-app).
- Stateless singleton.

---

## MOD-014 — AuthMiddleware

**Parent ARCH**: ARCH-014 | **Type**: Component | **Parent SYS**: SYS-008

### 1. Algorithmic / Logic View

```
async function use(request, response, next): Promise<void>

  authHeader = request.headers['authorization'] ?? ''
  if !authHeader.startsWith('Bearer ')
    throw new UnauthorizedException('Missing Bearer token')

  token = authHeader.slice(7)

  // 1. Networkless verification via ClerkAuthService.verifyToken
  //    (@clerk/backend verifyToken using the public CLERK_JWT_KEY).
  //    No JWKS round-trip, no issuer/audience fetch.
  claims = await clerkAuthService.verifyToken(token, {
    jwtKey: CLERK_JWT_KEY,
    authorizedParties: CLERK_AUTHORIZED_PARTIES, // azp allowlist
  })

  // 2. Attach verified Clerk claims to request.
  //    Admin scopes/permissions and subscription tier come from public_metadata.
  request.user = {
    sub: claims.sub,
    email: claims.email,
    publicMetadata: claims.public_metadata,
  }
  next()
```

### 2. Internal State & Data Structures View

```typescript
@Injectable()
class AuthMiddleware implements NestMiddleware {
    constructor(private readonly clerkAuth: ClerkAuthService) {}

    async use(req: Request, res: Response, next: NextFunction): Promise<void> {
        // delegates token verification to ClerkAuthService (networkless)
    }
}

interface VerifiedClerkClaims {
    sub: string; // Clerk user id
    email?: string;
    public_metadata?: Record<string, unknown>; // tier + scopes/permissions
}
```

`CLERK_JWT_KEY` (PEM public key) and `CLERK_AUTHORIZED_PARTIES` (comma-separated `azp`
allowlist) are both non-secret; there is no client secret, audience, or JWKS URI.

### 3. Error Handling & Return Codes View

| Condition                       | Exception               | HTTP |
| ------------------------------- | ----------------------- | ---- |
| Missing/malformed Bearer header | `UnauthorizedException` | 401  |
| Invalid/expired token signature | `UnauthorizedException` | 401  |
| Unauthorized party (`azp`)      | `UnauthorizedException` | 401  |

All auth failures return 401; no 403 from this middleware (authorisation is handled by business logic).

### 4. Concurrency & Timing View

- Verification is **networkless** (signature checked against the local `CLERK_JWT_KEY` public key); no JWKS fetch or cache to share across requests.
- `verifyToken` is CPU-bound (~1–2 ms); no blocking concern.
- Applied via NestJS middleware (`configure(consumer)`) on all import routes.

---

## MOD-015 — RecipeRepository

**Parent ARCH**: ARCH-015 | **Type**: Library | **Parent SYS**: SYS-005, SYS-007

### 1. Algorithmic / Logic View

```
async function findBySourceUrl(url: string): Promise<RecipeEntity | null>
  [row] = await db.select().from(recipesTable).where(eq(recipesTable.sourceUrl, url)).limit(1)
  return row ? mapRowToEntity(row) : null

async function findById(id: string): Promise<RecipeEntity | null>
  [row] = await db.select().from(recipesTable).where(eq(recipesTable.id, id)).limit(1)
  return row ? mapRowToEntity(row) : null

async function save(payload: AttributedPayload | ClonePayload): Promise<RecipeEntity>
  [inserted] = await db.insert(recipesTable).values(mapToRow(payload)).returning()
  return mapRowToEntity(inserted)

async function update(id: string, patch: Partial<RecipeRow>): Promise<RecipeEntity>
  [updated] = await db.update(recipesTable).set({ ...patch, updatedAt: new Date() })
    .where(eq(recipesTable.id, id)).returning()
  return mapRowToEntity(updated)
```

### 2. Internal State & Data Structures View

```typescript
@Injectable()
class RecipeRepository {
    constructor(@InjectDrizzle() private readonly db: DrizzleDb) {}
}

interface RecipeEntity {
    id: string;
    title: string;
    ingredients: string[];
    instructions: string[];
    sourceUrl: string | null;
    originalAuthor: string | null;
    platform: 'web' | 'instagram' | 'ocr';
    visibility: 'public' | 'private';
    ownerId: string;
    isClone: boolean;
    clonedFromId: string | null;
    attribution: AttributionMetadata;
    createdAt: Date;
    updatedAt: Date;
}
```

### 3. Error Handling & Return Codes View

- All Drizzle/pg errors propagate as-is; callers (MOD-013, MOD-012, MOD-010) wrap them in `PersistenceError`.
- `findById` / `findBySourceUrl` return `null` (not throw) when not found.

### 4. Concurrency & Timing View

- Each method is a single SQL statement; no multi-statement transactions.
- Connection pool shared across all repository calls (pg pool, default 10 connections).
- Stateless singleton.

---

## MOD-016 — ImportDtoTypes

**Parent ARCH**: ARCH-016 | **Type**: Library | **Parent SYS**: [CROSS-CUTTING]

### 1. Algorithmic / Logic View

This module contains no runtime logic — it is a pure TypeScript type and DTO definition file. All types are compiled with `strict: true`; no `any` permitted.

```typescript
// Request DTOs (class-validator decorated)
export class ImportUrlDto {
  @IsUrl({ require_protocol: true })
  url: string
}

export class ImportInstagramDto {
  @IsUrl({ require_protocol: true, host_whitelist: ['www.instagram.com', 'instagram.com'] })
  postUrl: string
}

export class ImportPhotoSaveDto {
  @IsUUID()
  draftId: string

  @IsString() @MinLength(1) @MaxLength(200)
  title: string

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  ingredients: string[]

  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  instructions: string[]
}

// Domain interfaces
export interface RecipeImportPayload { ... }   // see MOD-003
export interface OcrDraftPayload { ... }        // see MOD-007
export interface AttributedPayload { ... }      // see MOD-011
export interface DuplicateCheckResult { ... }   // see MOD-010

// Error classes
export class UrlUnreachableError extends Error { readonly code: string; constructor(url: string, reason: string | number) }
export class NoCaptionError extends Error { readonly code: string; constructor(postUrl: string, reason: string) }
export class PaywallBlockedError extends Error { readonly code: string; constructor(url: string, domain: string) }
export class OcrServiceError extends Error { readonly code: string; constructor(jobId: string, reason: string) }
export class OEmbedApiError extends Error { readonly code: string; constructor(postUrl: string, status: number | string) }
export class PersistenceError extends Error { readonly code: string; constructor(operation: string, cause: unknown) }
export class RecipeNotFoundError extends Error { readonly code = 'RECIPE_NOT_FOUND'; constructor(id: string) }
export class ForbiddenError extends Error { readonly code: string; constructor(reason: string) }
export class UnsupportedImportTypeError extends Error { readonly code = 'UNSUPPORTED_IMPORT_TYPE'; constructor(type: string) }
```

### 2. Internal State & Data Structures View

No runtime state. All exports are types, interfaces, classes, or enums.

### 3. Error Handling & Return Codes View

N/A — this module defines error classes; it does not throw them.

### 4. Concurrency & Timing View

N/A — compile-time only.

---

## MOD-017 — ImportErrorNormalizer

**Parent ARCH**: ARCH-017 | **Type**: Utility | **Parent SYS**: [CROSS-CUTTING]

### 1. Algorithmic / Logic View

```
function normalize(err: unknown): ImportErrorResponse

  if err instanceof PaywallBlockedError
    return { httpStatus: 422, code: err.code, userMessage: `This recipe source requires a subscription and cannot be imported.` }

  if err instanceof UrlUnreachableError
    switch err.code
      case 'URL_HTTP_ERROR':   return { httpStatus: 502, code: err.code, userMessage: `The recipe URL returned an error. Please check the URL and try again.` }
      case 'URL_TIMEOUT':      return { httpStatus: 502, code: err.code, userMessage: `The recipe URL timed out. Please try again later.` }
      case 'EXTRACTION_FAILED':return { httpStatus: 422, code: err.code, userMessage: `Could not extract a recipe from this URL. The page may not contain structured recipe data.` }
      case 'INVALID_URL':      return { httpStatus: 400, code: err.code, userMessage: `The URL provided is not valid.` }

  if err instanceof NoCaptionError
    switch err.code
      case 'EMPTY_CAPTION':        return { httpStatus: 422, code: err.code, userMessage: `This Instagram post has no caption text to import.` }
      case 'NON_RECIPE_CONTENT':   return { httpStatus: 422, code: err.code, userMessage: `This Instagram post does not appear to contain a recipe.` }

  if err instanceof OEmbedApiError
    return { httpStatus: 502, code: err.code, userMessage: `Could not retrieve the Instagram post. Please try again later.` }

  if err instanceof OcrServiceError
    return { httpStatus: 502, code: err.code, userMessage: `Photo text extraction failed. Please try again or enter the recipe manually.` }

  if err instanceof PersistenceError
    return { httpStatus: 500, code: err.code, userMessage: `An internal error occurred while saving the recipe. Please try again.` }

  if err instanceof RecipeNotFoundError
    return { httpStatus: 404, code: err.code, userMessage: `Recipe not found.` }

  if err instanceof ForbiddenError
    return { httpStatus: 403, code: err.code, userMessage: `You do not have permission to perform this action.` }

  if err instanceof UnsupportedImportTypeError
    return { httpStatus: 400, code: err.code, userMessage: `Unsupported import type.` }

  // Unknown error — do not leak internals
  return { httpStatus: 500, code: 'INTERNAL_ERROR', userMessage: `An unexpected error occurred.` }
```

### 2. Internal State & Data Structures View

```typescript
// Stateless — pure function or stateless @Injectable() class
interface ImportErrorResponse {
    httpStatus: number;
    code: string;
    userMessage: string;
}
```

### 3. Error Handling & Return Codes View

- Never throws; always returns a structured response.
- Unknown errors map to 500 with a generic message (no stack trace or internal detail exposed).

### 4. Concurrency & Timing View

- Synchronous pure function; no I/O.
- Stateless — safe for any concurrency.

---

## MOD-018 — ImportLogger

**Parent ARCH**: ARCH-018 | **Type**: Utility | **Parent SYS**: [CROSS-CUTTING]

### 1. Algorithmic / Logic View

```
// Lifecycle events emitted by ImportOrchestrator (MOD-001)
function log(event: ImportLifecycleEvent, context: Record<string, unknown>): void
  entry = {
    event,
    correlationId: AsyncLocalStorage.getStore()?.correlationId ?? uuid(),
    timestamp: new Date().toISOString(),
    ...context,
  }
  this.logger.info(entry)

// Event enum
type ImportLifecycleEvent =
  | 'import_started'
  | 'extractor_invoked'
  | 'paywall_blocked'
  | 'duplicate_found'
  | 'attribution_applied'
  | 'import_persisted'
  | 'import_failed'

// Error logging
function logError(event: 'import_failed', err: unknown, context: Record<string, unknown>): void
  this.logger.error({ event, error: { code: (err as any).code, message: (err as Error).message }, ...context })
```

**Correlation ID**: Set once per request by a NestJS middleware that stores a UUID in `AsyncLocalStorage`. The logger reads it from the store.

### 2. Internal State & Data Structures View

```typescript
@Injectable()
class ImportLogger {
    private readonly logger: Logger; // @aws-lambda-powertools/logger or NestJS Logger
    constructor(private readonly config: ConfigService) {
        this.logger = new Logger({ serviceName: 'recipe-importing', logLevel: config.get('LOG_LEVEL', 'INFO') });
    }
}
```

### 3. Error Handling & Return Codes View

- `log()` and `logError()` never throw — logging failures are silently swallowed to avoid masking business errors.
- If the underlying logger throws, the exception is caught and discarded.

### 4. Concurrency & Timing View

- `AsyncLocalStorage` provides per-request correlation ID isolation without thread-local state issues.
- Logger writes are synchronous (NestJS Logger) or buffered (Powertools); no await needed.
- Stateless per-request; singleton DI scope.

---

## Summary

| Count                 | Value                                                    |
| --------------------- | -------------------------------------------------------- |
| Total MOD modules     | **18**                                                   |
| ARCH modules covered  | 18 / 18 (100%)                                           |
| Cross-cutting modules | 3 (MOD-016, MOD-017, MOD-018)                            |
| Service modules       | 6 (MOD-001, MOD-003, MOD-007, MOD-009, MOD-010, MOD-011) |
| Component modules     | 3 (MOD-002, MOD-008, MOD-014)                            |
| Adapter modules       | 2 (MOD-006, MOD-013)                                     |
| Library modules       | 4 (MOD-004, MOD-005, MOD-015, MOD-016)                   |
| Utility modules       | 2 (MOD-017, MOD-018)                                     |
| Clone/edit module     | 1 (MOD-012)                                              |

## Module Mandatory View Completion

### Module: MOD-001 Mandatory View Completion

#### Internal Data Structures

MOD-001 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-001 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-002 Mandatory View Completion

#### Internal Data Structures

MOD-002 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-002 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-003 Mandatory View Completion

#### Internal Data Structures

MOD-003 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-003 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-004 Mandatory View Completion

#### Internal Data Structures

MOD-004 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-004 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-005 Mandatory View Completion

#### Internal Data Structures

MOD-005 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-005 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-006 Mandatory View Completion

#### Internal Data Structures

MOD-006 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-006 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-007 Mandatory View Completion

#### Internal Data Structures

MOD-007 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-007 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-008 Mandatory View Completion

#### Internal Data Structures

MOD-008 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-008 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-009 Mandatory View Completion

#### Internal Data Structures

MOD-009 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-009 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-010 Mandatory View Completion

#### Internal Data Structures

MOD-010 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-010 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-011 Mandatory View Completion

#### Internal Data Structures

MOD-011 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-011 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-012 Mandatory View Completion

#### Internal Data Structures

MOD-012 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-012 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-013 Mandatory View Completion

#### Internal Data Structures

MOD-013 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-013 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-014 Mandatory View Completion

#### Internal Data Structures

MOD-014 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-014 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-015 Mandatory View Completion

#### Internal Data Structures

MOD-015 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-015 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-016 Mandatory View Completion

#### Internal Data Structures

MOD-016 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-016 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-017 Mandatory View Completion

#### Internal Data Structures

MOD-017 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-017 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.

### Module: MOD-018 Mandatory View Completion

#### Internal Data Structures

MOD-018 uses typed request DTOs, validated domain objects, dependency result envelopes, and structured error result objects defined by its target source files. Persistent data changes are performed through the repository or adapter listed for the module.

#### State Machine View

Not applicable: MOD-018 is request-scoped and does not own persistent internal state beyond local variables during one invocation. External persistence state is owned by repository/adapters and documented in the Data Design view.
