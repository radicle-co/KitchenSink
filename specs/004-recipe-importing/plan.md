# Technical Plan: Feature 004 — Recipe Importing

**Feature**: `004-recipe-importing`
**Last revised**: 2026-08-02
**Status**: Ready for implementation
**Source of truth**: the shipped codebase. Where this plan and `main` disagree, `main` wins and this plan is wrong.

---

## 0. Pattern register _(CLAUDE.md — design-pattern-first)_

The patterns in force for this feature, the ones deliberately preserved from 001, and the shapes where a
pattern's intent is **already satisfied** so nobody adds redundant machinery.

| Pattern                     | Where                                                                                                 | Why it fits                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strategy**                | `RecipeExtractor` implementations (JSON-LD, microdata, heuristic)                                     | One interface, interchangeable extraction algorithms selected at runtime by what the page actually contains.                                             |
| **Chain of Responsibility** | `ExtractorChain` running the Strategy set in order, first non-null wins                               | Each extractor either handles the page or passes it on; adding one is additive.                                                                          |
| **Ports & Adapters**        | `OcrProvider` (→ Textract), `OEmbedProvider` (→ Meta), `SourceFetcher` (→ undici)                     | Every third-party dependency is a domain-declared port with an edge adapter, so the core is testable without the vendor and D-001/D-002 stay reversible. |
| **Policy / Specification**  | `PaywallPolicy`, `ProvenancePolicy` (pure classification)                                             | Import policy is a pure decision over inputs, separable from I/O and exhaustively testable.                                                              |
| **State machine**           | `ImportJob` (`queued → running → succeeded \| failed`), `ImportDraft` (`open → confirmed \| expired`) | Makes illegal lifecycle transitions unrepresentable rather than validated after the fact.                                                                |
| **Facade**                  | `ImportService` over fetch → extract → normalize → classify → dedup                                   | One entry point per channel; the orchestration sequence lives in exactly one place (HAZ-026).                                                            |
| **Value object**            | `CanonicalSourceUrl`                                                                                  | Canonicalization is a property of the type, not a step a caller can forget (HAZ-019).                                                                    |

**Already satisfied — do NOT add machinery for these:**

- **Visibility policy** — `evaluateVisibility` in `@kitchensink/recipe-core` is the Policy module for C-004. 004
  calls it. It does **not** get an `AttributionVisibilityService` of its own; the previous revision of this plan
  proposed one, which would have forked the C-004 rule into two authorities — exactly the D7 drift 001 closed.
- **Clone** — `recipes.service.ts` `clone()` is the shipped Command. 004 adds no clone endpoint.
- **Error mapping** — `ApiExceptionFilter` + `RecipeErrorCode` is the shipped boundary translator. 004 adds
  codes to the enum; it does **not** add an error normalizer.
- **Rate limiting** — `@nestjs/throttler` with `@Throttle` overrides is shipped. 004 adds a decorator, not a limiter.
- **Discriminated union + exhaustive switch** is TypeScript's Visitor; the draft-field-confidence render map is a
  union, not a class hierarchy.

---

## 1. Architecture overview

Every channel converges on one pipeline. **No channel writes a recipe directly** — see spec.md
_The draft-and-confirm model_ for why the shipped schema forces this.

```
 ┌── URL ──────────┐   ┌── Instagram ────┐   ┌── File ────────┐   ┌── Photo ───────┐
 │ blocklist check │   │ blocklist check │   │ magic-byte     │   │ upload to S3   │
 │ SSRF guard      │   │ oEmbed (gated)  │   │ sniff          │   │ Textract       │
 │ fetch (bounded) │   │ caption text    │   │ JSON/YAML/MD   │   │ raw text       │
 │ extractor chain │   │ heuristic parse │   │ parse          │   │ heuristic parse│
 └────────┬────────┘   └────────┬────────┘   └───────┬────────┘   └───────┬────────┘
          └─────────────────────┴────────────────────┴────────────────────┘
                                          │
                    ┌─────────────────────▼─────────────────────┐
                    │ NORMALIZE  ingredient lines → {qty,unit,name}
                    │            ISO-8601 duration → minutes
                    │            servings text → integer
                    │ SANITIZE   strip all markup from extracted text
                    │ CLASSIFY   provenance → sourceType (pure policy)
                    │ DEDUPE     canonical URL → existing recipe?
                    └─────────────────────┬─────────────────────┘
                                          │
                              ┌───────────▼───────────┐
                              │  ImportDraft (staged)  │  ← user reviews / completes
                              └───────────┬───────────┘
                                          │ confirm
                              ┌───────────▼───────────────────────┐
                              │ 001 shipped write path:            │
                              │ RecipesService.create(...)         │
                              │ + evaluateVisibility (C-004)       │
                              │ + food-catalog ingredient resolve  │
                              └────────────────────────────────────┘
```

---

## 2. Data model — **delta against the shipped schema**

> The previous revision of this plan proposed adding `import_source`, `source_url`, `source_platform`,
> `attribution_html`, `is_attribution_locked`, and `cloned_from_id`. **Four of those already exist under
> different names, and two are duplicates of shipped columns.** Applying it would have created a rival
> attribution model. What follows is the actual delta.

### Already present on `recipes` — reuse, do not re-add

| Shipped column         | Purpose                             | The name the old plan wrongly proposed |
| ---------------------- | ----------------------------------- | -------------------------------------- |
| `source_type`          | Policy classification driving C-004 | `import_source` (different concept)    |
| `source_url`           | Raw source URL                      | `source_url` (already exists)          |
| `source_attribution`   | Display attribution string          | `attribution_html`                     |
| `cloned_from_id`       | Clone lineage                       | `cloned_from_id` (already exists)      |
| `has_substantive_edit` | Gate for clone-to-private           | `is_attribution_locked`                |

### New — genuinely new knowledge

**`recipes.import_channel TEXT NULL`** — the provenance _channel_ (`url`/`instagram`/`file`/`ocr`/`manual`).
This is **not** a duplicate of `source_type`: `source_type` is the _policy_ classification (what visibility
rules apply), `import_channel` is _how the content arrived_ (drives per-channel success metrics for SC-002/SC-003
and error routing). Two facts that change for different reasons — per CLAUDE.md's DRY rule, not duplication.

**`recipes.source_url_canonical TEXT NULL`** — the canonicalized dedup key (C-001). Separate from `source_url`,
which keeps the URL the user actually submitted for display and re-fetch.

```sql
-- Dedup: a partial unique index that EXCLUDES soft-deleted rows, so a tombstoned import can be
-- re-imported. This is the only reliable dedup under concurrency — a read-then-write check races.
CREATE UNIQUE INDEX recipes_source_url_canonical_unique
    ON recipes (source_url_canonical)
    WHERE source_url_canonical IS NOT NULL AND deleted_at IS NULL;
```

**`import_drafts`** — owner-scoped staging, expiring, holds no recipe row.

| Column                    | Type                    | Notes                                                                            |
| ------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `id`                      | `uuid` PK               |                                                                                  |
| `owner_id`                | `varchar(255)` NOT NULL | App-user ULID, matching `recipes.owner_id` (D2 — no FK)                          |
| `status`                  | `text` NOT NULL         | `open`/`confirmed`/`expired`, CHECK-constrained                                  |
| `import_channel`          | `text` NOT NULL         | CHECK-constrained to the channel set                                             |
| `source_type`             | `text` NOT NULL         | Provenance classification decided at draft time                                  |
| `source_url`              | `text` NULL             |                                                                                  |
| `source_url_canonical`    | `text` NULL             |                                                                                  |
| `source_citation`         | `text` NULL             | FR-014a free-text citation when no URL exists                                    |
| `extracted`               | `jsonb` NOT NULL        | Normalized draft payload (title, lines, steps, times, photos)                    |
| `field_confidence`        | `jsonb` NOT NULL        | Per-field extraction confidence                                                  |
| `missing_required`        | `text[]` NOT NULL       | Required fields still absent                                                     |
| `ocr_object_key`          | `text` NULL             | S3 key of the source image; deleted no later than expiry                         |
| `expires_at`              | `timestamptz` NOT NULL  | FR-018 — `created_at + 7 days` (D-005); stage-configurable, capped at 7d in prod |
| `created_at`/`updated_at` | `timestamptz` NOT NULL  |                                                                                  |

**`import_jobs`** — async job state for the fetch/OCR channels (`queued`/`running`/`succeeded`/`failed`),
carrying `draft_id` on success and a `RecipeErrorCode` on failure, plus the `idempotency_key`.

**`paywalled_domains`** _(D-004)_ — the blocklist as data.

| Column       | Type                    | Notes                                        |
| ------------ | ----------------------- | -------------------------------------------- |
| `domain`     | `text` PK               | Stored lowercased, `www.` stripped           |
| `reason`     | `text` NOT NULL         | Shown to admins, never to end users verbatim |
| `added_by`   | `varchar(255)` NOT NULL | Admin ULID — audit trail                     |
| `created_at` | `timestamptz` NOT NULL  |                                              |

Matching is exact-host or registrable-suffix, never substring (HAZ-022 — a substring match blocks
`notnytimes.com`).

### Migrations

Next free number is **`0019`** (`0018_erasure_audit_trigger_source.sql` is the current head). Expand/contract:
every added column is nullable or defaulted, so the migration is deployable ahead of the code that uses it.

---

## 3. API contract

**Contract-first.** These endpoints are added **before** any handler is written, and the typed client
`@kitchensink/recipe-service-client` is extended from the contract.

> The recipe service has ONE OpenAPI document, at `specs/001-commise-recipe-app/contracts/api.openapi.yaml`
> (service code refers to it relatively as `contracts/api.openapi.yaml`). 004 extends that document — one
> service, one contract — rather than starting a second one under this feature's folder.

| Method | Path                                              | Auth        | Success | Notes                                   |
| ------ | ------------------------------------------------- | ----------- | ------- | --------------------------------------- |
| POST   | `/api/v1/recipes/import/url`                      | user        | `202`   | Async job; `Idempotency-Key` required   |
| POST   | `/api/v1/recipes/import/instagram`                | user        | `202`   | Gated by capability flag (D-002)        |
| POST   | `/api/v1/recipes/import/file`                     | user        | `201`   | Sync — local parse, no outbound call    |
| POST   | `/api/v1/recipes/import/photo`                    | user        | `202`   | Async OCR                               |
| GET    | `/api/v1/recipes/import/jobs/{id}`                | user, owner | `200`   | Job status → `draftId` or error code    |
| GET    | `/api/v1/recipes/import/drafts/{id}`              | user, owner | `200`   | Draft for review                        |
| PATCH  | `/api/v1/recipes/import/drafts/{id}`              | user, owner | `200`   | User corrections                        |
| POST   | `/api/v1/recipes/import/drafts/{id}/confirm`      | user, owner | `201`   | Creates the Recipe; the only write path |
| DELETE | `/api/v1/recipes/import/drafts/{id}`              | user, owner | `204`   | Discard                                 |
| GET    | `/api/v1/recipes/import/sources`                  | user        | `200`   | Enabled channels + blocklist summary    |
| GET    | `/api/v1/admin/import/paywalled-domains`          | admin scope | `200`   | D-004                                   |
| POST   | `/api/v1/admin/import/paywalled-domains`          | admin scope | `201`   | D-004                                   |
| DELETE | `/api/v1/admin/import/paywalled-domains/{domain}` | admin scope | `204`   | D-004                                   |

**Clone is NOT here** — `POST /api/v1/recipes/{id}/clone` already ships in 001.

`confirm-bulk` returns **`207 Multi-Status`**: a 187-recipe migration where 3 fail is neither a success nor a
failure, and collapsing it to one status would force the client to guess. The body carries one entry per draft
with `created` / `already_existed` / `failed` plus a reason.

### Change required in 001's recipes vertical (D-011)

`RecipesService.create` hardcodes `sourceType: USER_CREATED`, so it cannot create an imported recipe. 004 needs:

| Method                                     | Change                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(principal, dto, provenance?)`      | Accept provenance; pass the **actual** `sourceType` to `evaluateVisibility` instead of the hardcoded constant. Omitted ⇒ `user_created`, so `POST /api/v1/recipes` is byte-compatible. |
| `createMany(principal, items, provenance)` | New. Per-recipe transaction and per-recipe outcome — **not** an all-or-nothing batch (HAZ-058). Ingredient resolution stays async and batched (HAZ-059).                               |

**Provenance whitelist (`FR-025`, HAZ-057).** The DTO for `POST /api/v1/recipes` accepts only a
`declaredSource` of `own` or `paid-source + citation`. `imported_public` and `imported_physical` are **not
representable** in that DTO — they are set server-side from the channel actually observed. This is why the
whitelist lives in the type, not in a validation branch someone can forget.

**Object-level authorization** (OWASP API #1) applies to every `{id}`-bearing route: a draft or job belonging to
another user is indistinguishable from one that does not exist (`404`, never `403`), matching the shipped
recipe read rules.

### Error codes — added to `RecipeErrorCode`, mapped in `ApiExceptionFilter`

| Code                          | HTTP  | Meaning                                                                        |
| ----------------------------- | ----- | ------------------------------------------------------------------------------ |
| `IMPORT_SOURCE_BLOCKED`       | `422` | Domain on the paywalled blocklist                                              |
| `IMPORT_SOURCE_UNREACHABLE`   | `422` | DNS/TLS/timeout/4xx/5xx from the source                                        |
| `IMPORT_NO_RECIPE_FOUND`      | `422` | Fetched successfully, no recognisable recipe                                   |
| `IMPORT_NO_CAPTION`           | `422` | Instagram post has no recipe text in caption                                   |
| `IMPORT_UNSUPPORTED_FORMAT`   | `415` | File magic bytes are not JSON/YAML/Markdown                                    |
| `IMPORT_PAYLOAD_TOO_LARGE`    | `413` | Response or upload exceeded its bound                                          |
| `IMPORT_OCR_FAILED`           | `422` | OCR produced no usable text                                                    |
| `IMPORT_PROVIDER_UNAVAILABLE` | `503` | Circuit open / provider down — retryable                                       |
| `IMPORT_DRAFT_INCOMPLETE`     | `422` | Confirm attempted with missing required fields                                 |
| `IMPORT_DRAFT_EXPIRED`        | `410` | Draft passed `expires_at`                                                      |
| `IMPORT_QUOTA_EXCEEDED`       | `429` | Daily import allowance exhausted; carries `resetsAt`                           |
| `IMPORT_REQUIRES_PREMIUM`     | `403` | Channel produces a non-public recipe and the caller has no entitlement (D-014) |

`422` (not `400`) for policy and extraction failures: the request is well-formed but semantically
unprocessable — the meaning `ENGINEERING_EXCELLENCE.md §1` assigns it. The previous revision used `400` in
plan.md and `422` in architecture-design.md; this table is now the single source.

**Duplicate is not an error.** A duplicate URL returns `200` with the existing recipe and `cloneAvailable: true`.

---

## 4. Extraction — library survey _(CLAUDE.md library-first gate)_

Verified against the npm registry on 2026-08-02. The previous revision opened with
`import { parse } from 'schema-org-js'` — **that package does not exist** (registry 404); it was the primary
strategy for the requirement carrying SC-002.

| Need                    | Chosen                         | Ver / last publish | Rejected / why                                                         |
| ----------------------- | ------------------------------ | ------------------ | ---------------------------------------------------------------------- |
| HTML parse + selectors  | `cheerio`                      | 1.2.0 · 2026-07    | `jsdom` — full DOM emulation, far heavier than needed                  |
| JSON-LD extraction      | `JSON.parse` + **Zod** schema  | zod already a dep  | No library needed; the risk is _validation_, which Zod covers          |
| Microdata               | `microdata-node`               | 2.0.0 · 2022-06    | ⚠️ dormant. Accepted: small, focused, stable format. See risk below.   |
| RDFa                    | — **excluded** (C-007)         | —                  | No maintained Node parser; negligible recipe usage vs JSON-LD          |
| Ingredient-line parsing | `parse-ingredient`             | 2.2.0 · 2026-04    | `recipe-ingredient-parser-v2` (dormant since 2022)                     |
| ISO-8601 duration       | `iso8601-duration`             | 2.1.4 · 2026-06    | Hand-rolled regex — the gate explicitly forbids it                     |
| URL canonicalization    | `normalize-url`                | 9.0.1 · 2026-05    | Hand-rolled — HAZ-019 is exactly this bug                              |
| Timeout/retry/breaker   | `cockatiel`                    | 4.0.0 · 2026-05    | `opossum` (breaker only); hand-rolled backoff                          |
| HTML sanitization       | `sanitize-html`                | 2.17.6 · 2026-07   | `isomorphic-dompurify` — needs a DOM; server-side overhead             |
| File type (magic bytes) | `file-type`                    | **already a dep**  | Trusting the client MIME string — the gate forbids it                  |
| YAML                    | `yaml`                         | 2.9.0 · 2026       | `js-yaml` — `yaml` is the maintained successor                         |
| Markdown frontmatter    | `gray-matter`                  | 4.0.3 · 2023-07    | Stable, ubiquitous, format frozen. Low risk.                           |
| Private-IP detection    | `ipaddr.js`                    | 2.4.0 · 2026       | Hand-rolled CIDR math                                                  |
| OCR                     | `@aws-sdk/client-textract`     | 3.1101 · 2026-07   | Tesseract (self-host + model ops); Google Vision (second cloud vendor) |
| HTTP client             | `undici` (Node built-in fetch) | runtime            | axios — no need; undici gives the custom dispatcher SSRF needs         |

**Dependency risk — `microdata-node` and `gray-matter` are dormant.** Both are behind the `RecipeExtractor` /
parser ports, both handle frozen formats, and neither is on a security-sensitive path (their output is
sanitized and Zod-validated before use). Accepted, recorded here rather than discovered later. If either
breaks, the port makes replacement local.

### Extraction chain (Strategy + Chain of Responsibility)

```
JsonLdExtractor      →  script[type="application/ld+json"], walk @graph, Zod-validate @type=Recipe
MicrodataExtractor   →  [itemtype*="schema.org/Recipe"]
HeuristicExtractor   →  structural heuristics (headings + list patterns), returns confidence 0..1
```

First non-null result wins. Strict `@type === 'Recipe'` validation before accepting (HAZ-028 — a
non-Recipe JSON-LD object must not be accepted as a recipe). Every extractor returns `null`, never throws, so
the chain controls flow.

### Normalization — the step the old plan omitted entirely

Extraction output is **not** persistable. Between extraction and the draft:

- `recipeIngredient: string[]` → `parse-ingredient` → `{ quantity, unit, name, raw }`. **`raw` is always
  retained.** Unparseable → `quantity: null`, flagged; never a failure.
- Parsed names → food catalog (003) via `@kitchensink/food-service-client`, using the shipped async
  `food_resolution_status` lifecycle. Resolution **never blocks** draft confirmation.
- `prepTime`/`cookTime`/`totalTime` ISO-8601 → integer minutes. Absent → left empty, listed in
  `missing_required`. **Never defaulted** — a fabricated `0` is a lie the CHECK constraint would happily accept.
- `recipeYield` free text → positive integer where unambiguous (`"4 servings"` → `4`); `"serves a crowd"` →
  empty + flagged.
- All text fields → `sanitize-html` with a zero-tag allowlist (HAZ-008/HAZ-029).

---

## 5. Resilience, security, and egress

### Outbound fetch budget (NFR-006)

| Control               | Value                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Connect timeout       | 3s                                                                                          |
| Total request timeout | 10s                                                                                         |
| Max redirects         | 5, blocklist + SSRF re-checked **on every hop** (HAZ-002/003)                               |
| Max response bytes    | 5 MB, aborted on exceed — streamed, not buffered (HAZ-004)                                  |
| Content types         | `text/html`, `application/xhtml+xml` only                                                   |
| User-Agent            | `Commise/1.0 (+https://commise.app/bot)`                                                    |
| Circuit breaker       | Per registrable domain — `cockatiel`, half-open probe                                       |
| Retry                 | Idempotent GET only, transient failures only, 2 attempts, exponential backoff + full jitter |
| Bulkhead              | Bounded concurrency for outbound fetches, separate from the DB pool                         |

### SSRF defence (NFR-007, HAZ-003 — Catastrophic)

The old plan and task list contained **no SSRF control at all**, while the hazard analysis rated it
Catastrophic. Required, non-negotiable:

1. Reject non-`http(s)` schemes before anything else.
2. Resolve the host and check **every** resolved address with `ipaddr.js`; reject loopback, private (RFC 1918),
   link-local (incl. `169.254.169.254`), CGNAT, unique-local, and unspecified ranges.
3. Pin the connection to the validated address via a custom `undici` dispatcher, closing the DNS-rebinding
   window between check and connect.
4. Re-run 1–3 for **every** redirect hop.
5. No outbound request may carry credentials, cookies, or `Authorization`.

### Robots and politeness (HAZ-021, D-007)

`robots.txt` is fetched once per host and cached with a TTL. Group selection follows the robots.txt
specification — a group naming our agent wins over `*`. Application then differs by group:

| Directive applies to                      | Bare `Disallow: /`     | Path-specific `Disallow` |
| ----------------------------------------- | ---------------------- | ------------------------ |
| A group naming `Commise` (agent-specific) | **Honoured** — blocks  | **Honoured** — blocks    |
| Only the wildcard `*` group               | **Ignored** — proceeds | **Honoured** — blocks    |

The one asymmetric cell is deliberate: a bare wildcard `Disallow: /` is aimed at search indexing, and an import
is a single user-chosen page, not a crawl. A site owner who wants us out writes one line naming our agent and we
comply completely. A `robots.txt` that is unreachable or unparseable is treated as **permissive** (absence of a
directive is not a prohibition), but a _fetch_ of it that times out must not extend the import's own budget.

Every robots-derived block increments a counter (`robots_block_rate`) so D-007 can be revisited on evidence
rather than argument.

### Rate limiting and backpressure

**Burst limiting** reuses the shipped `@nestjs/throttler`: `@Throttle` overrides of `10/min/user` on URL and
Instagram, `5/min/user` on photo. File import and job polling inherit the shipped write/read defaults.

**Daily allowance is NOT a throttler.** `throttle.config.ts` documents that `@nestjs/throttler` v6 applies the
logical AND of every registered throttler to every route — registering a second (daily) throttler would cap
every endpoint in the service. The allowance is therefore **domain policy**: `ImportsService` counts the
principal's `import_jobs` in the trailing 24h and rejects with `IMPORT_QUOTA_EXCEEDED` (`429`) carrying
`resetsAt`. Limits: **200/day/user** across all channels, **50/day** sub-quota for OCR (bounds Textract spend).

The quota function takes the principal's tier as a parameter and today returns the same limits for every tier —
the seam 010-subscriptions needs, without inventing tier rules 010 hasn't specified yet.

Queue depth is bounded; over-capacity sheds with `429`.

---

## 6. Idempotency

`POST /import/{url,instagram,photo}` are non-idempotent creates and MUST require an `Idempotency-Key` header,
with the first response cached per `(key, endpoint, principal)` — `ENGINEERING_EXCELLENCE.md §1`. Without it,
a client retry on a slow import double-imports. The dedup unique index catches the URL case but not OCR or
file, which have no natural key.

---

## 7. Observability and SLOs (NFR-009)

- **SLIs**: import job success rate; end-to-end job latency; extractor-chain hit rate by strategy; per-channel
  draft-confirmation rate; blocklist hit rate; circuit-breaker state.
- **SLOs**: SC-004 latency targets; import job success rate ≥ 97% excluding user-caused failures
  (`SOURCE_BLOCKED`, `NO_RECIPE_FOUND`).
- Structured logs with a correlation ID across the API → queue → worker hops, matching the shipped logger.
- **Never log** the full fetched body or OCR text (third-party content, potential PII).

---

## 8. Open questions

_None blocking._ The four that previously blocked this feature were resolved as owner decisions D-001..D-004
(see `spec.md`). Two items are tracked but do not gate implementation:

1. **Meta app approval for FR-009** — external workstream; the capability flag defaults off (D-002).
2. **Fixture corpus curation for SC-002** — the accuracy bar needs a hand-verified corpus; sizing and
   composition are defined in `v-model/acceptance-plan.md` and must exist before the SC-002 gate can be claimed.

---

## 9. Implementation order

Ordered by dependency. Each step is test-first (§7.1) and ships web **and** mobile together (§14.1).

1. **Contract + schema**: OpenAPI additions, migrations `0019`+, `RecipeErrorCode` additions, typed-client extension.
2. **Pure core**: `CanonicalSourceUrl`, `ProvenancePolicy`, `PaywallPolicy`, normalization (durations, servings,
   ingredient lines). All pure, all unit-testable with no I/O.
3. **Extraction**: `RecipeExtractor` interface + JSON-LD → microdata → heuristic chain, against fixture HTML.
4. **Fetch edge**: `SourceFetcher` with the full §5 budget and SSRF guard. Security tests before features.
5. **Draft lifecycle**: `import_drafts` DAL, create/read/patch/confirm/expire, object-level authz.
6. **URL channel**: job enqueue, worker, end-to-end to a draft.
7. **File channel**: magic-byte sniff, JSON/YAML/MD parsers.
8. **Blocklist + admin endpoints** (D-004).
9. **OCR channel** (D-001): S3 upload, Textract adapter, image lifecycle deletion.
10. **Instagram channel** (D-002): oEmbed adapter behind the capability flag, contract fake in CI.
11. **UI — web and mobile in lockstep**: import entry, draft review/complete, attribution display, error states.
12. **Load and soak** (k6) against the §7 SLOs.

---

## 10. Complexity Tracking

Deviations from the constitution and standards, per `docs/CODING_STANDARDS.md §14.1`, which requires any
single-platform rollout to be waived here explicitly.

| Deviation                                       | Why needed                                                                                                                                  | Simpler alternative rejected because                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Two new tables (`import_drafts`, `import_jobs`) | The shipped `CreateRecipeRequest` cannot represent an incomplete import; async is required because an outbound fetch has unbounded latency. | Writing recipes directly would force fabricated `servings`/times values, violating the honesty of the shipped CHECK constraints. |
| A third table (`paywalled_domains`)             | Owner decision D-004 — blocklist changes must not require a deploy.                                                                         | A code constant makes incident response a release cycle.                                                                         |
| `import_channel` alongside `source_type`        | Different facts that change for different reasons (provenance channel vs policy class).                                                     | Overloading `source_type` would couple metrics to policy and break C-004's CHECK domain.                                         |
| Instagram ships behind a capability flag        | D-002 — the credential is externally gated and cannot be obtained on our schedule.                                                          | Blocking release on Meta's review queue; or deleting a specified requirement.                                                    |
| **No single-platform waiver is claimed.**       | Every user-facing task in `tasks.md` is paired web + mobile per §14.1.                                                                      | —                                                                                                                                |
