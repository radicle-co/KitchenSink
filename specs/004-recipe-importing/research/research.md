# Phase 0 Research: Recipe Importing

> **SUPERSEDED IN PART (2026-08-02).** Retained as a historical record. Two conclusions no longer hold:
> (1) **RQ Instagram** — the public unauthenticated oEmbed endpoint assumed here was withdrawn on 2020-10-24;
> oEmbed now requires a Meta app credential and App Review (owner decision D-002).
> (2) **RQ-9 comparator set** — superseded by `research/competitors.md` for import comparison (W-003).
> Where this document and the regenerated `codebase-analysis.md` / `tech-stack.md` disagree, those win.

**Branch**: `004-recipe-importing` | **Date**: 2026-05-08
**Spec**: [spec.md](../spec.md) | **Status**: Complete

## Research Questions

| #    | Question                                                                                 | Status      |
| ---- | ---------------------------------------------------------------------------------------- | ----------- |
| RQ-1 | Best TypeScript library for URL-based recipe extraction (Schema.org / JSON-LD)           | ✅ Answered |
| RQ-2 | Extraction fallback strategy: JSON-LD → Microdata → RDFa → heuristic HTML                | ✅ Answered |
| RQ-3 | Instagram import: oEmbed API capabilities, caption extraction, auth requirements         | ✅ Answered |
| RQ-4 | Physical copy OCR: AWS Textract vs alternatives for recipe photo scanning                | ✅ Answered |
| RQ-5 | Deduplication strategy: source URL as unique key, shared public recipe model             | ✅ Answered |
| RQ-6 | Paywalled source detection: blocklist approach and enforcement                           | ✅ Answered |
| RQ-7 | Import-to-data-model mapping: how scraped fields map to 001 `recipes` schema             | ✅ Answered |
| RQ-8 | NestJS service architecture for import pipeline (async, queueing, error handling)        | ✅ Answered |
| RQ-9 | Competitor patterns: Paprika, Mealime, Whisk, Saffron import UX and technical approaches | ✅ Answered |

---

## RQ-1: TypeScript Library for URL-Based Recipe Extraction

### Primary Recommendation: `recipe-scrapers` (npm)

**Package**: [`recipe-scrapers`](https://www.npmjs.com/package/recipe-scrapers) v1.8.0 (Apr 20, 2026)
**Repo**: [nerdstep/recipe-scrapers-js](https://github.com/nerdstep/recipe-scrapers-js) — TypeScript port of the Python `recipe-scrapers` library
**Peer deps**: `cheerio`, `zod`

```bash
npm install recipe-scrapers cheerio zod
```

**Core API**:

```typescript
import { scrapeRecipe } from 'recipe-scrapers';

// Provide pre-fetched HTML + source URL
const result = await scrapeRecipe(html, url);
// result is validated against built-in Zod schema

// Safe parse (no throw on validation failure)
const result = await scrapeRecipe(html, url, { safeParse: true });

// With ingredient parsing (quantity/unit/description breakdown)
const result = await scrapeRecipe(html, url, { parseIngredients: true });
```

**Key capabilities**:

- Auto-detects site-specific parser from URL hostname
- Falls back to Schema.org JSON-LD extraction for unsupported hosts (`SCHEMA_ORG_ONLY_HOSTS`)
- Zod-validated output (Standard Schema compatible — can swap in custom schema)
- `extraExtractors` / `extraPostProcessors` plugin API for custom sites
- `parse-ingredient` integration for structured ingredient parsing (quantity, unit, description)
- Actively maintained: 12 releases Feb–Apr 2026

**Extending for custom sites**:

```typescript
import { AbstractScraper } from 'recipe-scrapers';

export class AllRecipesScraper extends AbstractScraper {
    static host() {
        return 'www.allrecipes.com';
    }

    extractors = {
        ingredients: this.extractIngredients.bind(this),
    };

    protected extractIngredients() {
        return this.$('.ingredients-item-name')
            .map((_, el) => this.$(el).text().trim())
            .get();
    }
}
```

### Decision

Use `recipe-scrapers` (npm) as the primary extraction library. It handles the full extraction pipeline (HTML parsing, JSON-LD, Microdata, site-specific scrapers) with TypeScript types and Zod validation out of the box. The application layer is responsible only for HTTP fetching — the library receives `(html, url)`.

---

## RQ-2: Extraction Fallback Strategy

The library applies extractors in priority order. The recommended fallback chain is:

| Priority | Strategy                  | Coverage                                                  |
| -------- | ------------------------- | --------------------------------------------------------- |
| 1        | Site-specific scraper     | ~200+ popular sites (AllRecipes, Food Network, NYT, etc.) |
| 2        | Schema.org JSON-LD        | ~75% of recipe sites (Google-recommended format)          |
| 3        | Microdata (`itemprop`)    | Older sites, some WordPress themes                        |
| 4        | RDFa                      | Rare; some European recipe sites                          |
| 5        | OpenGraph + heuristic DOM | Last resort; lower accuracy                               |

**JSON-LD extraction pattern** (for reference / custom fallback):

```typescript
// Cheerio-based JSON-LD extraction
const scripts = $("script[type='application/ld+json']");
scripts.each((_, el) => {
    const content = JSON.parse($(el).children().first().text());
    // Handle array, @graph, or direct Recipe object
    const recipe = Array.isArray(content)
        ? content.find((n) => n['@type'] === 'Recipe')
        : (content['@graph']?.find((n: any) => n['@type'] === 'Recipe') ?? content);
});
```

**JS-rendered pages** (client-side rendering): `recipe-scrapers` is HTML-only. For JS-rendered pages (e.g., some modern recipe sites), a headless browser (Playwright/Puppeteer) or a managed scraping service (Firecrawl) would be needed. This is **out of scope for v1** — the system should detect empty extraction results and surface a "could not extract recipe" error to the user.

**Paywalled detection** happens before extraction (see RQ-6).

---

## RQ-3: Instagram Import — oEmbed API

### Current State (May 2026)

Instagram oEmbed is now under the **Meta oEmbed Read** feature (migrated from legacy `oembed_read` on Nov 3, 2025).

**Endpoint**:

```
GET https://graph.facebook.com/v25.0/instagram_oembed
  ?url=<INSTAGRAM_POST_URL>
  &access_token=<APP_ID>|<APP_SECRET>
```

**Auth**: App-level token only (`{app_id}|{app_secret}`) — no user token required.

**Response** (post-Oct 2025 deprecation):

```json
{
    "version": "1.0",
    "provider_name": "Instagram",
    "provider_url": "https://www.instagram.com/",
    "type": "rich",
    "width": 658,
    "html": "<blockquote class=\"instagram-media\" ..."
}
```

> ⚠️ **Breaking change (Oct 2025)**: `thumbnail_url`, `thumbnail_width`, `thumbnail_height`, and `author_name` fields were removed from the oEmbed response. Attribution must be extracted from the post HTML or the Instagram URL itself.

**Supported post types**: Public photos, carousels, Reels, Feed posts. **NOT** stories, private accounts, or profiles.

**Rate limit**: 200 calls/user/hour (app-level).

**App Review required**: Meta oEmbed Read requires App Review before accessing live data. This is a **parallel workstream** — submit the review application early (review process is slow, per spec assumption).

### Caption Extraction for Recipe Content

The oEmbed `html` field contains an embedded `<blockquote>` with `data-instgrm-*` attributes. The caption text is embedded in the blockquote HTML. Parsing strategy:

```typescript
import * as cheerio from 'cheerio';

function extractInstagramCaption(oembedHtml: string): string {
    const $ = cheerio.load(oembedHtml);
    // Caption is in the last <p> inside the blockquote before the attribution link
    return $('blockquote p').first().text().trim();
}
```

After extracting the caption, the recipe text must be parsed from free-form text. This is inherently lower accuracy than structured JSON-LD. The import pipeline should:

1. Extract caption text
2. Attempt heuristic parsing (look for ingredient lists, numbered steps)
3. Present the user with a review/correction UI before saving

### Attribution

Since `author_name` is no longer returned by oEmbed, attribution must be derived from the Instagram URL:

- URL format: `https://www.instagram.com/p/{shortcode}/` or `https://www.instagram.com/{username}/...`
- Extract `username` from URL path as the attribution handle
- Store as `source_attribution` = `@{username}` and `source_url` = original post URL

### Decision

Instagram import is feasible via the Meta oEmbed API with an app-level token. Caption-based recipe extraction will have lower accuracy than URL scraping — users must review extracted content before saving. Submit Meta App Review as a parallel workstream immediately. At launch, support only posts where the recipe is in the caption text (per spec assumption).

---

## RQ-4: Physical Copy OCR — AWS Textract

### Recommendation: AWS Textract via `@aws-sdk/client-textract`

**Package**: `@aws-sdk/client-textract` v3.1010.0 (Mar 2026)

**Flow**:

1. User uploads photo via mobile app → presigned S3 PUT URL (reuses 001 photo upload pattern)
2. Lambda function triggered (or NestJS service calls Textract directly)
3. Textract `AnalyzeDocument` with `FORMS` + `TABLES` feature types extracts structured text
4. Post-processing: parse extracted text blocks into recipe fields (title, ingredients, steps)
5. Return draft recipe to user for review/correction

**Synchronous API** (single-page images, < 5 MB):

```typescript
import { TextractClient, AnalyzeDocumentCommand, FeatureType } from '@aws-sdk/client-textract';

const client = new TextractClient({ region: process.env.AWS_REGION });

const response = await client.send(
    new AnalyzeDocumentCommand({
        Document: {
            S3Object: { Bucket: bucketName, Name: s3Key },
        },
        FeatureTypes: [FeatureType.FORMS, FeatureType.TABLES],
    }),
);

// Extract LINE blocks for plain text
const lines = response.Blocks?.filter((b) => b.BlockType === 'LINE').map((b) => b.Text ?? '') ?? [];
```

**Asynchronous API** (multi-page PDFs, large images): Use `StartDocumentAnalysis` + `GetDocumentAnalysis` with SQS/SNS notification. For recipe photos (single-page), synchronous is sufficient.

**IAM permissions required**:

```
textract:DetectDocumentText
textract:AnalyzeDocument
```

**Post-processing challenge**: Textract returns raw text blocks with bounding boxes — not structured recipe fields. A post-processing step must heuristically identify:

- Title (large text, top of page, or first line)
- Ingredients (lines containing quantities + units: "2 cups flour", "1 tsp salt")
- Steps (numbered or bulleted lines with instructional verbs)

This is inherently imperfect. The spec explicitly acknowledges "variable accuracy" and requires a user review/correction UI.

**Cost**: ~$1.50 per 1,000 pages (synchronous). Negligible at launch scale.

### Decision

Use AWS Textract `AnalyzeDocument` (synchronous, S3-sourced) for physical copy OCR. Post-process LINE blocks with heuristic ingredient/step detection. Always present extracted content to the user for review before saving. Physical copy imports are always `source_type = 'imported_physical'` and `visibility = 'private'`.

---

## RQ-5: Deduplication Strategy

Per spec clarification C-001: when multiple users import the same URL, the system creates **one shared public recipe** — not per-user copies. Users who import the same URL receive a reference to the existing public recipe and are offered the option to clone it.

### Implementation

The `recipes` table already has `source_url TEXT` (from 001 data model). Deduplication key = normalized `source_url`.

**URL normalization** (before lookup and storage):

- Lowercase scheme + host
- Remove tracking parameters (`utm_*`, `fbclid`, `ref`, etc.)
- Remove trailing slash
- Decode percent-encoding

```typescript
function normalizeSourceUrl(raw: string): string {
    const url = new URL(raw);
    // Remove tracking params
    const TRACKING_PARAMS = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_content',
        'utm_term',
        'fbclid',
        'ref',
        'source',
    ];
    TRACKING_PARAMS.forEach((p) => url.searchParams.delete(p));
    return url.toString().replace(/\/$/, '').toLowerCase();
}
```

**Deduplication query**:

```sql
SELECT id FROM recipes
WHERE source_url = $1
  AND source_type = 'imported_public'
  AND deleted_at IS NULL
LIMIT 1;
```

**Index** (add to 001 migration):

```sql
CREATE UNIQUE INDEX idx_recipes_source_url_public
  ON recipes (source_url)
  WHERE source_type = 'imported_public' AND deleted_at IS NULL;
```

**Flow**:

1. Normalize URL
2. Check deduplication index
3. If exists → return existing recipe ID + offer clone
4. If not → proceed with extraction, create new recipe with `source_type = 'imported_public'`

---

## RQ-6: Paywalled Source Detection

### Approach: Maintained Blocklist

A static blocklist of known paywalled recipe domains, checked before any HTTP fetch is attempted.

**Initial blocklist** (non-exhaustive, requires legal/product review):

```typescript
const PAYWALLED_DOMAINS = new Set([
    'cooking.nytimes.com',
    'www.epicurious.com', // some content paywalled
    'www.bonappetit.com', // some content paywalled
    'www.seriouseats.com', // some content paywalled
    'www.delish.com',
    'www.foodandwine.com',
    // cookbooks / subscription services
    'www.americastestkitchen.com',
    'www.cooksillustrated.com',
]);

function isPaywalledSource(url: string): boolean {
    try {
        const { hostname } = new URL(url);
        return PAYWALLED_DOMAINS.has(hostname);
    } catch {
        return false;
    }
}
```

**Notes**:

- The blocklist is a starting point — many sites have mixed free/paywalled content. The spec acknowledges "edge cases may require manual review."
- A secondary runtime check: if the HTTP response returns a 402, 401, or a known paywall redirect pattern, treat as paywalled.
- FR-014a (manual copy from paid source) requires legal review — enforcement mechanism TBD.

**User-facing error**: When a paywalled URL is detected, return HTTP 422 with a clear message explaining why the import was rejected (legal/TOS compliance).

---

## RQ-7: Import-to-Data-Model Mapping

### Schema.org Recipe → `recipes` table

| Schema.org Field       | `recipes` Column       | Notes                                             |
| ---------------------- | ---------------------- | ------------------------------------------------- |
| `name`                 | `title`                | Required                                          |
| `description`          | `description`          |                                                   |
| `prepTime` (ISO 8601)  | `prep_time_minutes`    | Parse PT duration → integer minutes               |
| `cookTime` (ISO 8601)  | `cook_time_minutes`    | Parse PT duration → integer minutes               |
| `totalTime` (ISO 8601) | `total_time_minutes`   | Parse PT duration → integer minutes               |
| `recipeYield`          | `servings`             | Extract integer from string ("4 servings" → 4)    |
| `recipeCuisine`        | `cuisine`              | First value if array                              |
| `recipeCategory`       | `tags`                 | Append to tags array                              |
| `keywords`             | `tags`                 | Append to tags array                              |
| `image`                | `recipe_photos`        | Download + upload to S3 (async, best-effort)      |
| `recipeIngredient[]`   | `recipe_ingredients`   | Each string → ingredient row (parsed if enabled)  |
| `recipeInstructions[]` | `recipe_steps`         | Each HowToStep.text → step row                    |
| Source URL             | `source_url`           | Normalized, used as dedup key                     |
| Author / site name     | `source_attribution`   | Display string: "From AllRecipes" or "@handle"    |
| —                      | `source_type`          | `'imported_public'` for URL/Instagram imports     |
| —                      | `visibility`           | `'public'` for URL/Instagram; `'private'` for OCR |
| —                      | `owner_id`             | Authenticated user's ID                           |
| —                      | `has_substantive_edit` | `false` on import                                 |

**ISO 8601 duration parsing** (PT15M → 15, PT1H30M → 90):

```typescript
function parseDurationMinutes(iso: string | undefined): number | null {
    if (!iso) return null;
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return null;
    return parseInt(match[1] ?? '0') * 60 + parseInt(match[2] ?? '0');
}
```

### `recipe_ingredients` rows

Each `recipeIngredient` string (e.g., `"2 cups all-purpose flour"`) maps to one row. With `parseIngredients: true` in `recipe-scrapers`, the library returns structured `{ quantity, unit, description }` via `parse-ingredient`. Map to:

```typescript
{
  recipe_id: recipeId,
  ingredient_id: null,       // resolved later via ingredient lookup/create
  raw_text: "2 cups all-purpose flour",
  quantity: "2",
  unit: "cups",
  preparation_note: null,
  sort_order: index,
}
```

### `recipe_steps` rows

Each `HowToStep` or plain string maps to one row:

```typescript
{
  recipe_id: recipeId,
  step_number: index + 1,
  instruction: step.text ?? step,  // HowToStep has .text; plain string is direct
  duration_minutes: null,           // not reliably available from schema
}
```

---

## RQ-8: NestJS Service Architecture

### Module Structure

```
src/
  import/
    import.module.ts
    import.controller.ts       # POST /import/url, POST /import/instagram, POST /import/photo
    import.service.ts          # orchestrates import pipeline
    strategies/
      url-import.strategy.ts   # HTTP fetch + recipe-scrapers extraction
      instagram-import.strategy.ts  # oEmbed API + caption parsing
      ocr-import.strategy.ts   # S3 upload + Textract + post-processing
    dto/
      import-url.dto.ts
      import-instagram.dto.ts
      import-photo.dto.ts
    guards/
      paywall-check.guard.ts   # checks blocklist before processing
    mappers/
      scraped-recipe.mapper.ts # ScrapedRecipe → CreateRecipeDto
```

### Import Pipeline (URL)

```
POST /import/url { url }
  │
  ├─ 1. Validate URL format
  ├─ 2. Check paywalled blocklist → 422 if blocked
  ├─ 3. Normalize URL
  ├─ 4. Deduplication check → return existing recipe if found
  ├─ 5. HTTP GET (with timeout, User-Agent, redirect follow)
  ├─ 6. scrapeRecipe(html, url) → ScrapedRecipe
  ├─ 7. Validate extraction quality (title + ingredients required)
  ├─ 8. Map ScrapedRecipe → CreateRecipeDto
  ├─ 9. Create recipe (owner_id = auth user, source_type = 'imported_public', visibility = 'public')
  ├─ 10. Create recipe_ingredients + recipe_steps rows
  ├─ 11. Sync ingredient_names_text (triggers search_vector update)
  └─ 12. Async: download + upload cover photo to S3 (best-effort, non-blocking)
```

### HTTP Fetch Considerations

- **Timeout**: 10 seconds (configurable)
- **User-Agent**: Set a descriptive UA string (e.g., `Commise-Importer/1.0`)
- **Redirects**: Follow up to 5 redirects
- **Error handling**: 4xx → "recipe not found at URL"; 5xx → "source site unavailable"; timeout → "request timed out"
- **JS-rendered pages**: Return "could not extract recipe" if extraction yields no title/ingredients

### Async Photo Import

Photo download and S3 upload should be **fire-and-forget** (non-blocking) to keep import response fast. Use NestJS `EventEmitter2` or a lightweight queue:

```typescript
// After recipe is created, emit event
this.eventEmitter.emit('recipe.import.photo', { recipeId, imageUrl })

// Listener handles async S3 upload
@OnEvent('recipe.import.photo')
async handlePhotoImport({ recipeId, imageUrl }: PhotoImportEvent) {
  // download imageUrl → upload to S3 → create recipe_photos row
}
```

---

## RQ-9: Competitor Patterns

### Paprika (iOS/Android/Mac)

- URL import via in-app browser: user navigates to recipe page, taps "Import" — Paprika scrapes the current page
- Supports 200+ sites with site-specific parsers
- Falls back to generic JSON-LD extraction
- No Instagram import
- Physical copy: manual entry only (no OCR)

**Lesson**: In-app browser import (navigate → tap import) is a strong UX pattern for mobile. Consider for the Expo app.

### Mealime

- URL paste import: user pastes URL into a text field
- Extracts recipe via JSON-LD / site-specific scrapers
- Shows extraction preview before saving
- No Instagram import
- No OCR

**Lesson**: Preview before save is important for user trust, especially when extraction quality is uncertain.

### Whisk (Samsung Food)

- URL import + browser extension
- Instagram import via share sheet (mobile)
- Photo import with OCR (uses Google Vision API)
- Deduplication: shows "already in your collection" if URL was previously imported

**Lesson**: Share sheet integration on mobile is the primary Instagram import UX. Deduplication feedback ("already imported") is expected by users.

### Saffron

- URL import with JSON-LD + heuristic DOM fallback
- Heuristic scoring for ingredient/instruction detection (depth-first tree traversal, scoring nodes on cooking vocabulary, text length, punctuation)
- ~75% success rate on arbitrary sites; ~25% require manual correction
- No Instagram import

**Lesson**: Heuristic fallback is necessary for sites without structured data. Always show a review/edit step after import.

---

## Implementation Guidance

### Recommended Package Versions

| Package                    | Version  | Purpose                            |
| -------------------------- | -------- | ---------------------------------- |
| `recipe-scrapers`          | `^1.8.0` | URL recipe extraction              |
| `cheerio`                  | `^1.0.0` | HTML parsing (peer dep)            |
| `zod`                      | `^3.x`   | Schema validation (peer dep + 001) |
| `@aws-sdk/client-textract` | `^3.x`   | OCR for physical copy import       |
| `parse-ingredient`         | bundled  | Ingredient quantity/unit parsing   |

### Key Risks

| Risk                                         | Likelihood | Mitigation                                                          |
| -------------------------------------------- | ---------- | ------------------------------------------------------------------- |
| Recipe site blocks scraper User-Agent        | Medium     | Rotate UA strings; respect `robots.txt`; graceful failure           |
| JS-rendered recipe pages (no static HTML)    | Medium     | Detect empty extraction; surface error to user; v2 headless option  |
| Instagram oEmbed App Review delay            | High       | Submit review immediately; launch without Instagram if not approved |
| Textract OCR accuracy on handwritten recipes | High       | Always require user review/correction before saving                 |
| Paywalled site blocklist incomplete          | Medium     | Runtime 402/401 detection as secondary check; manual review queue   |
| `author_name` removed from Instagram oEmbed  | Confirmed  | Extract username from URL path for attribution                      |

### Migration Notes (extends 001 schema)

The 001 `recipes` table already includes all required columns for import:

- `source_type` (CHECK constraint includes `'imported_public'`, `'imported_physical'`, `'imported_paid'`)
- `source_url` (TEXT, nullable)
- `source_attribution` (TEXT, nullable)
- `cloned_from_id` (UUID FK, nullable)
- `has_substantive_edit` (BOOLEAN, default false)
- `visibility` (TEXT, default `'public'`)

**One new index** is recommended for deduplication performance:

```sql
CREATE UNIQUE INDEX idx_recipes_source_url_public
  ON recipes (source_url)
  WHERE source_type = 'imported_public' AND deleted_at IS NULL;
```

No new tables are required for v1. Attribution metadata is stored in `source_url` + `source_attribution` columns on `recipes`.

---

## Open Questions / Legal Review Required

- **FR-014a**: Detection and enforcement for manually-entered recipes from paid sources. Exact mechanism requires legal review.
- **Paywalled blocklist**: Final list of blocked domains requires product + legal sign-off.
- **Instagram App Review**: Timeline and approval probability for Meta oEmbed Read feature.
- **Copyright**: Recipe attribution is a display requirement only — the system does not host or redistribute copyrighted content beyond recipe metadata (title, ingredient list, instruction summaries). Legal review recommended before launch.
