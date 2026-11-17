# Technical Plan: Feature 004 — Recipe Importing

**Feature**: `004-recipe-importing`
**Last revised**: 2026-08-02
**Status**: Ready for implementation
**Source of truth**: the shipped codebase. Where this plan and `main` disagree, `main` wins and this plan is wrong.

> ⚠️ **Owner rulings, 2026-11-15 ([spec](./spec.md) `FR-064` to `FR-067`,
> [ADR-0093](../../docs/architecture/decisions/0093-imported-recipes-go-public-only-as-a-commise-written-version.md)).**
> They change this plan in five places, and the spec wins where they differ:
>
> 1. **A link is fetched on the device first, then by the server.** The cook's device fetches a link's page. If that
>    fails, the server URL fetch edge (`SourceFetcher`, the outbound fetch budget, robots and data-mining checks before
>    a fetch, `import_jobs` for the fetch channel) runs, under spec `FR-008`, `FR-023`, `FR-053` and `FR-053a`. On web
>    it usually runs. A paste is never fetched. Extraction runs on the cook's device in tiers: schema.org, microdata,
>    a rule-based reader, then an on-device AI tier when the cook's account setting allows it (on by default on mobile,
>    off on web), each a strict yes or no, with no cook review of the extraction. A "no" from every tier goes to the
>    server AI fallback (§12a).
> 2. **The paywall blocklist becomes the paid list.** It classifies a source as a paid site (`FR-014`), it does not
>    block one.
> 3. **No facts cards, no linked card, no per-market switch.** `MarketCopyPolicy`, the facts-card cap counter and the
>    linked-card read are withdrawn. The public path is a Commise-written version (`FR-065`, spec 003B, planned).
> 4. **One import allowance** for every user-facing channel, 200 a day on Free and 1,000 on a paid plan, with no
>    limit for test principals (`FR-067`). There are no per-source caps.
> 5. **The private copy keeps the source wording** and the source author's name (`FR-066`).

---

## 0. Pattern register _(CLAUDE.md — design-pattern-first)_

The patterns in force for this feature, the ones deliberately preserved from 001, and the shapes where a
pattern's intent is **already satisfied** so nobody adds redundant machinery.

| Pattern                     | Where                                                                                                 | Why it fits                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Strategy**                | `RecipeExtractor` implementations (JSON-LD, microdata, heuristic)                                     | One interface, interchangeable extraction algorithms selected at runtime by what the page actually contains.                                                                                                                  |
| **Chain of Responsibility** | `ExtractorChain` running the Strategy set in order, first non-null wins                               | Each extractor either handles the page or passes it on; adding one is additive.                                                                                                                                               |
| **Ports & Adapters**        | `OEmbedProvider` (→ Meta), `SourceFetcher` (→ undici)                                                 | Every third-party dependency is a domain-declared port with an edge adapter, so the core is testable without the vendor and D-002 stays reversible. _(`OcrProvider` moved to 011 with the photo channel — D-001 as amended.)_ |
| **Policy / Specification**  | `PaywallPolicy`, `ProvenancePolicy` (pure classification)                                             | Import policy is a pure decision over inputs, separable from I/O and exhaustively testable.                                                                                                                                   |
| **State machine**           | `ImportJob` (`queued → running → succeeded \| failed`), `ImportDraft` (`open → confirmed \| expired`) | Makes illegal lifecycle transitions unrepresentable rather than validated after the fact.                                                                                                                                     |
| **Facade**                  | `ImportService` over fetch → extract → normalize → classify → dedup                                   | One entry point per channel; the orchestration sequence lives in exactly one place (HAZ-026).                                                                                                                                 |
| **Value object**            | `CanonicalSourceUrl`                                                                                  | Canonicalization is a property of the type, not a step a caller can forget (HAZ-019).                                                                                                                                         |

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

| Column                    | Type                    | Notes                                                                                                                 |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`                      | `uuid` PK               |                                                                                                                       |
| `owner_id`                | `varchar(255)` NOT NULL | App-user ULID, matching `recipes.owner_id` (D2 — no FK)                                                               |
| `status`                  | `text` NOT NULL         | `open`/`confirmed`/`expired`, CHECK-constrained                                                                       |
| `import_channel`          | `text` NOT NULL         | CHECK-constrained to the channel set                                                                                  |
| `source_type`             | `text` NOT NULL         | Provenance classification decided at draft time                                                                       |
| `source_url`              | `text` NULL             |                                                                                                                       |
| `source_url_canonical`    | `text` NULL             |                                                                                                                       |
| `source_citation`         | `text` NULL             | FR-014a free-text citation when no URL exists                                                                         |
| `extracted`               | `jsonb` NOT NULL        | Normalized draft payload (title, lines, steps, times, photos)                                                         |
| `field_confidence`        | `jsonb` NOT NULL        | Per-field extraction confidence                                                                                       |
| `missing_required`        | `text[]` NOT NULL       | Required fields still absent                                                                                          |
| ~~`ocr_object_key`~~      | —                       | ⛔ Removed with the channel — **011** owns the image and it never enters this service (D-001 as amended, ADR-0019 §3) |
| `expires_at`              | `timestamptz` NOT NULL  | FR-018 — `created_at + 7 days` (D-005); stage-configurable, capped at 7d in prod                                      |
| `created_at`/`updated_at` | `timestamptz` NOT NULL  |                                                                                                                       |

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

**Contract-first, and the contract is zod in the recipe service** — authored **before** any handler is
written. Normative sources: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md).

> ⚠️ **Amended 2026-08-11 (GR-015).** This section previously said the typed client
> `@kitchensink/recipe-service-client` "is extended from the contract", and named
> `specs/001-commise-recipe-app/contracts/api.openapi.yaml` as the recipe service's one OpenAPI document that
> 004 extends. **Both statements are superseded.** The authority is now the zod authored in the recipe service
> at `src/**/*.schema.ts` and copied into `@kitchensink/schema-recipe`; the hand-written 001 document is
> verified by nothing, is superseded in principle, and **must not be extended with 004's endpoints**. "One
> service, one contract" still holds — the contract just moved to where it can be enforced. 004 adds no second
> contract artifact and no schema package of its own.

### 3.0 Contract ownership and drift (GR-015)

| Role                                   | Binding for 004                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)   | `@kitchensink/recipe-service` — the import endpoints' `*.schema.ts` live beside the import controller                           |
| Schema package (generated, committed)  | `@kitchensink/schema-recipe` — `packages/schemas/recipe` (**shared with 001; 004 adds to it, never forks it**)                  |
| Consuming client                       | `@kitchensink/recipe-service-client`                                                                                            |
| Consuming apps / feature packages      | `@commise/web`, `@commise/mobile`, `packages/apps/commise/features/*`                                                           |
| 004 as a **client** of another (§15-b) | ingredient resolution via `@kitchensink/food-service-client` → imports `@kitchensink/schema-food`, declares no food wire shapes |

**The service MUST**: author every import/job/draft request and response shape — and the admin
paywalled-domain surface — as zod in the recipe service beside its controller; validate its own requests with
that same zod via `nestjs-zod`'s `createZodDto`; regenerate `@kitchensink/schema-recipe` so the new shapes are
exported; and keep those `*.schema.ts` files importing **only `zod` and other `*.schema.ts` files** (no
extractor type, no Drizzle schema, no Nest symbol).

**Every client MUST** — separately mandatory, and this is the half that got skipped portfolio-wide: import
import-job, draft and error wire types **and zod** from `@kitchensink/schema-recipe`, and **declare none of
its own**. The **draft-review UI is the load-bearing case**: a review screen's editable model is a
**DERIVATION** of the draft wire type via `Pick` / `Omit` / `Partial`, never a hand-written parallel
interface — and it must be derived once and shared, not re-typed on web and again on mobile. Reference:
`packages/apps/commise/features/recipes/src/filters/model.ts`. **An import endpoint is not complete until its
types are reachable from `@kitchensink/schema-recipe`**; "the review screen will add the type" is a contract
fork, not a task.

**Drift gates** — inherited from GR-015 §15-c, all three required: turbo `inputs` rebuild, the
regenerate-and-diff CI gate, and the `CONTRACT_HASH` boot assertion.

### ⚠️ Everything 004 IMPORTS FROM is a third-party surface (GR-015 §15-d)

This feature's entire input side is untrusted external data, and none of it is a contract we own:

- **Scraped web pages, schema.org / JSON-LD recipe blobs, Instagram oEmbed payloads, uploaded files, OCR
  output.** A publisher's JSON-LD is not an API we serve; it is arbitrary, attacker-influenceable input.
- Every extraction adapter therefore **validates the raw upstream shape at the boundary with zod** before any
  field reaches a draft, and **MAY declare its own types**. The normalized draft shape deliberately differs
  from whatever the page emitted — that difference is the normalization, not drift. This is what §0's
  **Ports & Adapters** register entry already implies; §15-d makes it a requirement.
- **No OpenAPI document is written for any upstream source**, and none of these shapes goes into
  `@kitchensink/schema-recipe` as though we owned it. Only 004's **own** endpoints do.
- `packages/clients/usda` is the reference implementation. **Do not "converge" a boundary schema away**: on
  this feature it is the parse standing between a hostile page and the recipe write path.

| Method   | Path                                              | Auth        | Success | Notes                                                                                                                                                                                           |
| -------- | ------------------------------------------------- | ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST     | `/api/v1/import/url`                              | user        | `202`   | Async job; `Idempotency-Key` required                                                                                                                                                           |
| POST     | `/api/v1/import/instagram`                        | user        | `202`   | Gated by capability flag (D-002)                                                                                                                                                                |
| POST     | `/api/v1/import/file`                             | user        | `201`   | Sync — local parse, no outbound call                                                                                                                                                            |
| POST     | `/api/v1/import/text`                             | user        | `202`   | Raw-text paste (`FR-052`). Device-read pages need no AI. Text with no structured data goes to the async AI fallback (`FR-056`); the paste is a one-recipe import on `/api/v1/import` (`FR-061`) |
| GET      | `/api/v1/import/text/{id}`                        | user, owner | `200`   | Poll the AI fallback result: `pending`, `extracted`, `noRecipe`, `severalRecipes`, `budgetSpent`, `failed` (`FR-056`, `FR-059`)                                                                 |
| ~~POST~~ | ~~`/api/v1/import/photo`~~                        | —           | —       | ⛔ **011 owns the photo channel** (D-001 as amended, ADR-0019 §3). 004 keeps only the `imported_physical` `sourceType` in the bulk contract                                                     |
| GET      | `/api/v1/import/jobs/{id}`                        | user, owner | `200`   | Job status → `draftId` or error code                                                                                                                                                            |
| GET      | `/api/v1/import/drafts/{id}`                      | user, owner | `200`   | Draft for review                                                                                                                                                                                |
| PATCH    | `/api/v1/import/drafts/{id}`                      | user, owner | `200`   | User corrections                                                                                                                                                                                |
| POST     | `/api/v1/import/drafts/{id}/confirm`              | user, owner | `201`   | Creates the Recipe; the only write path                                                                                                                                                         |
| DELETE   | `/api/v1/import/drafts/{id}`                      | user, owner | `204`   | Discard                                                                                                                                                                                         |
| GET      | `/api/v1/import/sources`                          | user        | `200`   | Enabled channels + blocklist summary                                                                                                                                                            |
| GET      | `/api/v1/admin/import/paywalled-domains`          | admin scope | `200`   | D-004                                                                                                                                                                                           |
| POST     | `/api/v1/admin/import/paywalled-domains`          | admin scope | `201`   | D-004                                                                                                                                                                                           |
| DELETE   | `/api/v1/admin/import/paywalled-domains/{domain}` | admin scope | `204`   | D-004                                                                                                                                                                                           |

**Clone is NOT here** — `POST /api/v1/recipes/{id}/clone` already ships in 001.

> ⚠️ **Routes live under `/api/v1/import/*`.** Owner ruling, 2026-10-26. The single-recipe channels above sit beside
> the bulk import resource of [ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md) §1
> (`POST /api/v1/import`, `GET /api/v1/import/{importId}`). An import id is a ULID, so it never collides with a
> literal word such as `url`, `file`, `jobs` or `drafts`. A many-recipe export file goes through ADR-0072's
> resource, not through `file` and `confirm-bulk`. How `file` and `confirm-bulk` fold into that resource is owed.

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
`declaredSource` of `own` or `paid-source + citation`. _(Amended 2026-11-03, ADR-0082: the statement kind is the
D3 set `authored`, `adapted`, `source`, `family`, `publicDomain`. `publicDomain` is curator-grant only and needs the D1
record. A book or paid-site `source` keeps its verbatim copy private. Amended 2026-11-15: its public form is a
Commise-written version, `FR-065`, and the facts card, `FR-014b`, is withdrawn.)_
`imported_public` and `imported_physical` are **not representable** in that DTO — they are set server-side from the channel actually observed. This is why the
whitelist lives in the type, not in a validation branch someone can forget.

**Object-level authorization** (OWASP API #1) applies to every `{id}`-bearing route: a draft or job belonging to
another user is indistinguishable from one that does not exist (`404`, never `403`), matching the shipped
recipe read rules.

### 3.1 Input validation (GR-016) — 004's input is HOSTILE by definition

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). §3.0 decides **who
authors** the zod; GR-016 decides **where it runs**. Bindings for this feature only.

**Every other feature validates input a user typed. 004 validates input a stranger's web page emitted** — so
the boundary parse is not hygiene here, it is the feature's primary control surface.

- **One mechanism, one `400`.** Every import/job/draft/admin-domain input — body, path params, query params,
  and the required `Idempotency-Key` header — is parsed by the recipe service's own `*.schema.ts` zod via
  `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`. 004 adds **no** `class-validator` DTO. ⚠️ **CORRECTED
  2026-08-12: recipe-service carries ZERO such files.** This bullet said it "still carries 19 such files (measured
  2026-08-11)"; that 19 was a **mention** count, the single real importer
  (`src/search/dto/searchRecipes.query.dto.ts`) is converged onto `nestjs-zod`, and `class-validator` /
  `class-transformer` are **removed from the service's `package.json` and `prod.package.json`**. 004 therefore
  inherits **one** mechanism — adding a second would not join a residue, it would **re-create** one, and it would
  fail repo-wide gate **G5** in `packages/tools/repoGuards/__tests__/serviceSecurityInvariants.test.ts`.
- **⛔ THE FLOOR, and this is where a hostile page reaches it.** 001's five int-backed fields — **`servings`,
  `prepTimeMinutes`, `cookTimeMinutes`, `totalTimeMinutes`, `timerSeconds`** — write `integer` (`int4`) columns
  capped at **2,147,483,647**, and **004 is the channel that populates them from data we did not author**. A
  publisher's JSON-LD claiming `"recipeYield": 9999999999` must be rejected **when the draft is created**, not
  discovered at the `INSERT` behind `confirm` (which is the `500`-that-owed-a-`400` shape GR-016 exists to
  end). Every extracted numeric is bounded at the extraction boundary **and** at the draft/confirm wire
  boundary — the two are different inputs from different parties.
    - ⚠️ **Asserted, never derived**: no zod generated from Drizzle, no storage type imported into a
      `*.schema.ts`. §3.0's import constraint is unchanged.
    - ⚠️ **Text is unbounded in storage** (`text()` columns), so limits on an extracted title, step, note or
      ingredient string are **product decisions** — and on this feature they are also a **DoS control**, since
      the upstream author chooses the length. "The column allows it" is not a reason to persist a 2 MB step.
- **✅ The extraction adapters' boundary parse is REQUIRED by GR-016, not merely permitted by §15-d.** §3.0
  already says every adapter validates the raw upstream shape (scraped HTML, schema.org/JSON-LD, oEmbed,
  uploaded files, OCR output). GR-016 makes that parse **mandatory before any field reaches a draft**, and
  forbids "converging" it away.
- **The provenance whitelist is the pattern GR-016 wants everywhere.** `FR-025`/HAZ-057 makes
  `imported_public` / `imported_physical` **not representable** in the `POST /api/v1/recipes` DTO — the rule
  lives **in the type, not in a validation branch someone can forget**. That is "make illegal states
  unrepresentable" applied to a wire schema; prefer it over a refinement wherever the shape allows.
- **Non-HTTP ingress is in scope.** The async import path (`url`, `instagram`, `photo` → `202`) enqueues jobs;
  the worker **parses its job payload against an authored zod before acting on it**. The job envelope is shared
  between the service and the worker, authored once (§3.0) and validated on receipt.
- **004 is a client of food** (ingredient resolution): outbound bodies validated against
  `@kitchensink/schema-food` before the call — including the ≤100-name batch bound — and responses validated on
  receipt.
- **Unknown keys are a stated choice per surface.** On `PATCH .../drafts/{id}` (user corrections) a silently
  stripped unknown key returns `200` for a correction that was never applied — the worst possible place for
  `z.object`'s default. (Portfolio default is **OPEN**, GR-016 OPEN-GR-016-B.)
- **Validation is not SSRF defence, and neither substitutes for the other.** A URL that parses is not a URL
  that is safe to fetch; §5's SSRF controls (HAZ-003) still apply after the schema accepts the input.
- **⛔ Response validation is DEFERRED (GR-016 §16-g).** Do not add server-side response parsing to the import
  endpoints; the deferral is an owner decision, not an unfinished task.

### Error codes — added to `RecipeErrorCode`, mapped in `ApiExceptionFilter`

| Code                          | HTTP  | Meaning                                                                                                                                                 |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IMPORT_SOURCE_BLOCKED`       | `422` | Domain on the paywalled blocklist                                                                                                                       |
| `IMPORT_SOURCE_UNREACHABLE`   | `422` | DNS/TLS/timeout/4xx/5xx from the source                                                                                                                 |
| `IMPORT_NO_RECIPE_FOUND`      | `422` | Fetched successfully, no recognisable recipe                                                                                                            |
| `IMPORT_NO_CAPTION`           | `422` | Instagram post has no recipe text in caption                                                                                                            |
| `IMPORT_UNSUPPORTED_FORMAT`   | `415` | File magic bytes are not JSON/YAML/Markdown                                                                                                             |
| `IMPORT_PAYLOAD_TOO_LARGE`    | `413` | Response or upload exceeded its bound                                                                                                                   |
| `IMPORT_TEXT_UNPARSEABLE`     | `422` | A pasted body contained no recognisable recipe content (`FR-052`). _(`IMPORT_OCR_FAILED` transfers to 011 with the channel.)_                           |
| `IMPORT_PROVIDER_UNAVAILABLE` | `503` | Circuit open / provider down — retryable                                                                                                                |
| `IMPORT_DRAFT_INCOMPLETE`     | `422` | Confirm attempted with missing required fields                                                                                                          |
| `IMPORT_DRAFT_EXPIRED`        | `410` | Draft passed `expires_at`                                                                                                                               |
| `IMPORT_QUOTA_EXCEEDED`       | `429` | Daily import allowance exhausted; carries `resetsAt`                                                                                                    |
| `PRIVATE_SLOTS_FULL`          | `403` | A free cook has no free private slot for a recipe that must be private (004-FR-028 as amended 2026-10-26, ADR-0073). Replaces `IMPORT_REQUIRES_PREMIUM` |

`422` (not `400`) for policy and extraction failures: the request is well-formed but semantically
unprocessable — the meaning `ENGINEERING_EXCELLENCE.md §1` assigns it. The previous revision used `400` in
plan.md and `422` in architecture-design.md; this table is now the single source.

**Duplicate is not an error.** A duplicate URL returns `200` with the existing recipe and `cloneAvailable: true`.

---

## 4. Extraction — library survey _(CLAUDE.md library-first gate)_

Verified against the npm registry on 2026-08-02. The previous revision opened with
`import { parse } from 'schema-org-js'` — **that package does not exist** (registry 404); it was the primary
strategy for the requirement carrying SC-002.

| Need                    | Chosen                         | Ver / last publish | Rejected / why                                                                                                                                                                |
| ----------------------- | ------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML parse + selectors  | `cheerio`                      | 1.2.0 · 2026-07    | `jsdom` — full DOM emulation, far heavier than needed                                                                                                                         |
| JSON-LD extraction      | `JSON.parse` + **Zod** schema  | zod already a dep  | No library needed; the risk is _validation_, which Zod covers                                                                                                                 |
| Microdata               | `microdata-node`               | 2.0.0 · 2022-06    | ⚠️ dormant. Accepted: small, focused, stable format. See risk below.                                                                                                          |
| RDFa                    | — **excluded** (C-007)         | —                  | No maintained Node parser; negligible recipe usage vs JSON-LD                                                                                                                 |
| Ingredient-line parsing | `parse-ingredient`             | 2.2.0 · 2026-04    | `recipe-ingredient-parser-v2` (dormant since 2022)                                                                                                                            |
| ISO-8601 duration       | `iso8601-duration`             | 2.1.4 · 2026-06    | Hand-rolled regex — the gate explicitly forbids it                                                                                                                            |
| URL canonicalization    | `normalize-url`                | 9.0.1 · 2026-05    | Hand-rolled — HAZ-019 is exactly this bug                                                                                                                                     |
| Timeout/retry/breaker   | `cockatiel`                    | 4.0.0 · 2026-05    | `opossum` (breaker only); hand-rolled backoff                                                                                                                                 |
| HTML sanitization       | `sanitize-html`                | 2.17.6 · 2026-07   | `isomorphic-dompurify` — needs a DOM; server-side overhead                                                                                                                    |
| File type (magic bytes) | `file-type`                    | **already a dep**  | Trusting the client MIME string — the gate forbids it                                                                                                                         |
| YAML                    | `yaml`                         | 2.9.0 · 2026       | `js-yaml` — `yaml` is the maintained successor                                                                                                                                |
| Markdown frontmatter    | `gray-matter`                  | 4.0.3 · 2023-07    | Stable, ubiquitous, format frozen. Low risk.                                                                                                                                  |
| Private-IP detection    | `ipaddr.js`                    | 2.4.0 · 2026       | Hand-rolled CIDR math                                                                                                                                                         |
| ~~OCR~~                 | ~~`@aws-sdk/client-textract`~~ | —                  | ⛔ **011's dependency, not 004's.** Kept as a row so the alternatives it weighed (Tesseract self-host, Google Vision) transfer with the decision rather than being re-derived |
| HTTP client             | `undici` (Node built-in fetch) | runtime            | axios — no need; undici gives the custom dispatcher SSRF needs                                                                                                                |

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

_(Amended 2026-11-15, owner ruling, `FR-056`, C-007.)_ `HeuristicExtractor` is replaced by the AI text-extraction fallback. JSON-LD and
microdata run first, on the cook's device, with no AI. A page with neither, and any plain-text paste, goes to a separate async
job in recipe-workers (`RecipeTextExtractFunction`): own queue, DLQ and reserved concurrency, the single Bedrock role, spend
call site `'text-extraction'` (ADR-0024 §4c), VPC-attached so it is an ADR-0004 NAT consumer. The model returns line numbers
only (`FR-057`), the input is capped at 48,000 UTF-8 bytes and refused over it (`FR-058`), and the ceiling ends the paste as
`budgetSpent` (`FR-059`). A guessed source is a question, never the statement (`FR-060`, ADR-0089 §7). It uses the one import
pipeline and the one import allowance (`FR-061`). A page opt-out skips it (`FR-063`). The mobile paste row is gated on it (`FR-062`). Design detail:
ADR-0092 (planned), plus a new result table in its own migration.

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

`robots.txt` is fetched once per host and cached with a TTL. Group selection follows RFC 9309: the group that names
our agent binds the fetch, and if no group names us the `*` group binds it. _(Amended 2026-11-03, owner ruling,
ADR-0082: the earlier asymmetric table, which let a bare wildcard `Disallow: /` through for a user-chosen page, is
withdrawn.)_ _(Amended 2026-11-15: applies to the server fetch of a link, spec `FR-023`.)_

| Directive applies to                      | Bare `Disallow: /`   | Path-specific `Disallow` |
| ----------------------------------------- | -------------------- | ------------------------ |
| A group naming `Commise` (agent-specific) | **Honoured**, blocks | **Honoured**, blocks     |
| Only the wildcard `*` group               | **Honoured**, blocks | **Honoured**, blocks     |

A `robots.txt` that is unreachable or unparseable is treated as **permissive** (absence of a directive is not a
prohibition), but a _fetch_ of it that times out must not extend the import's own budget.

**Data-mining opt-outs (`FR-023`).** The same pre-fetch step reads TDMRep (`/.well-known/tdmrep.json` and the
`tdm-reservation` header), `noai` and `noimageai` tags, AI-crawler blocks (GPTBot, ClaudeBot, Google-Extended, CCBot)
and Content Signals `ai-input=no`. Our parse uses an LLM, so we honour them everywhere from v1.
A new pure `FetchSignalPolicy` returns allow or deny from the signals. The fetch writes one **signal log row per
fetch** with what each signal said, including "none found". Known pirate hosts sit on the paywall blocklist. The fetch
never passes a paywall, login or meter, never uses a cook's cookies, and never rotates addresses.

**Per-market private copy (D6).** _(Withdrawn 2026-11-15, owner ruling: the private copy keeps the source wording in
every market, spec `FR-066`.)_

Every robots-derived block increments a counter (`robots_block_rate`) so the policy can be reviewed on evidence
rather than argument.

### Rate limiting and backpressure

**Burst limiting** reuses the shipped `@nestjs/throttler`: `@Throttle` overrides of `10/min/user` on URL and
Instagram, `10/min/user` on raw text (`FR-052`). _(The `5/min` photo limit transfers to 011.)_ File import and job polling inherit the shipped write/read defaults.

**Daily allowance is NOT a throttler.** `throttle.config.ts` documents that `@nestjs/throttler` v6 applies the
logical AND of every registered throttler to every route — registering a second (daily) throttler would cap
every endpoint in the service. The allowance is therefore **domain policy**: `ImportsService` counts the
principal's `import_jobs` in the trailing 24h and rejects with `IMPORT_QUOTA_EXCEEDED` (`429`) carrying
`resetsAt`. Limits: **200/day/user** across all channels. _(The **50/day** OCR sub-quota bounding Textract spend transfers to 011 with the channel — 011 MUST inherit it rather than re-derive it.)_

The quota function takes the principal's tier as a parameter and today returns the same limits for every tier —
the seam 010-subscriptions needs, without inventing tier rules 010 hasn't specified yet.

> ⚠️ **Where the count lives, and the bulk allowance.** Owner ruling, 2026-10-26. The allowance is not counted over
> `import_jobs`. It is counted in the `import_allowance_events` ledger (recipe-service migration 0058), under a
> per-user advisory lock. It first counted each channel on its own rows (paste 200 a rolling day; bulk 1,000 on a paid plan and 200 on Free, owner 2026-10-27); that is superseded by the one allowance below. [ADR-0072](../../docs/architecture/decisions/0072-bulk-recipe-import.md) §8 holds the rule, and
> spec `FR-022` carries the same note.
>
> ⚠️ **One allowance.** Owner ruling, 2026-11-15: the per-channel counts are replaced by one import allowance for every
> user-facing import, the editor's paste included, with no limit for test principals (spec `FR-067`, built).

Queue depth is bounded; over-capacity sheds with `429`.

---

## 6. Idempotency

`POST /import/{url,instagram,text}` are non-idempotent creates and MUST require an `Idempotency-Key` header,
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
   composition are fixed at PLANNING and must exist before the SC-002 gate can be claimed.

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
10. **Instagram channel** (D-002): oEmbed adapter behind the capability flag, contract fake in CI. _(Amended
    2026-11-03, ADR-0082: official APIs only, no video download, paste or screenshot fallback, no frames or audio kept.)_
    10a. **Open-library policies** _(added 2026-11-03, ADR-0082)_: `FetchSignalPolicy` and its signal log, `MarketCopyPolicy`
    (D6), the per-source cap counter for facts cards (`FR-014b`, `FR-026`), and the image-deletion step after
    extraction. See tasks T-033 to T-037. _(Amended 2026-11-15: `MarketCopyPolicy` and the facts-card counter are
    withdrawn. `FetchSignalPolicy` applies to the server fetch. The image-deletion step stays.)_
11. **UI — web and mobile in lockstep**: import entry, draft review/complete, attribution display, error states.
12. **Load and soak** (k6) against the §7 SLOs.
    12a. **AI text-extraction fallback** _(added 2026-11-15, `FR-056` to `FR-063`)_: built in this feature, after the page reader and the paste channel. See tasks T-048.

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
