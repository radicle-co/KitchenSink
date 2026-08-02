# Acceptance Test Plan: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Regenerated**: 2026-08-02
**Status**: Approved
**Source**: `specs/004-recipe-importing/v-model/requirements.md`
**Level**: Validation (user view) — "did we build the right thing?"
**Standards**: IEEE 1012:2016 (V&V) · ISO/IEC 25010:2023 (quality in use) · ISO/IEC/IEEE 29119-4:2021

> **Regeneration note (2026-08-02).** The previous revision organised acceptance procedures by _user
> capability_ (`ATP-001` = "import from URL") with scenarios numbered `ATS-NNN-x`. That is readable but is
> **not parseable by `build-matrix.sh`**, which keys `ATP-NNN-X` to `REQ-NNN` by numeric base and expects
> `SCN-NNN-X#` scenarios. Running the deterministic builder against the old format reported `❌ MISSING` for
> **all 62 requirements** — the coverage claim was an assertion no tool could confirm. This revision uses the
> tool-native three-tier schema so the matrix is generated, not hand-maintained.
>
> The ID lineage is self-describing: `SCN-001-A1` → `ATP-001-A` → `REQ-001`.

## Entry criteria

`requirements.md` is baselined (62 requirements, owner decisions D-001..D-014 recorded). Implementation has
not begun, so every scenario below is `⬜ Pending Execution`.

## Exit criteria

100% of active requirements carry ATP coverage, every ATP carries ≥1 SCN, and no unresolved `[SUSPECT]` items
remain. **No waiver is permitted for the Catastrophic-hazard requirements** (REQ-027, REQ-NF-009, REQ-IF-004).

---

## Requirement Validation: REQ-001 (Import from a public URL)

#### Test Case: ATP-001-A (Structured-markup URL import yields a complete draft)

**Linked Requirement:** REQ-001
**Description:** An authenticated user imports a public recipe URL carrying schema.org markup.
**Validation Condition:** A draft is created containing title, ingredient lines, steps, and photo URLs.
**Expected Result:** Job reaches `succeeded` with a `draftId`; the draft contains the fixture's expected title, ≥1 ingredient line, and ≥1 step; **no recipe row exists yet**.

- **User Scenario: SCN-001-A1**
    - **Given** an authenticated user and a fixture page serving valid schema.org `Recipe` JSON-LD
    - **When** the user submits that page's URL for import
    - **Then** the import job completes with status `succeeded` and returns a draft whose title, ingredient lines, and steps match the fixture's expected values, and no recipe has been created

#### Test Case: ATP-001-B (Unreachable source creates nothing)

**Linked Requirement:** REQ-001
**Description:** The submitted URL cannot be retrieved.
**Validation Condition:** A typed failure is returned and no draft or recipe is persisted.
**Expected Result:** Job status `failed` with code `IMPORT_SOURCE_UNREACHABLE`; draft count and recipe count for that user are unchanged.

- **User Scenario: SCN-001-B1**
    - **Given** an authenticated user and a fixture host that responds `404` to every request
    - **When** the user submits a URL on that host for import
    - **Then** the job fails with code `IMPORT_SOURCE_UNREACHABLE` and neither a draft nor a recipe is created

---

## Requirement Validation: REQ-002 (Structured markup preferred; non-Recipe rejected)

#### Test Case: ATP-002-A (JSON-LD is preferred over heuristics)

**Linked Requirement:** REQ-002
**Description:** A page carrying both valid JSON-LD and heuristic-parseable HTML is extracted via JSON-LD.
**Validation Condition:** The recorded extraction strategy is `json-ld`.
**Expected Result:** The draft reports `strategy: "json-ld"` and field confidence of 1.0 for title.

- **User Scenario: SCN-002-A1**
    - **Given** a fixture page containing valid schema.org `Recipe` JSON-LD and a heading/list structure that the heuristic extractor could also parse
    - **When** the page is imported
    - **Then** the draft records the JSON-LD strategy as the one that produced the result

#### Test Case: ATP-002-B (Non-Recipe JSON-LD is not accepted as a recipe)

**Linked Requirement:** REQ-002
**Description:** A page whose only JSON-LD block is `@type: Article`.
**Validation Condition:** The JSON-LD strategy returns no result and the chain continues.
**Expected Result:** The draft is not produced from JSON-LD; either a lower strategy produces it or the job fails `IMPORT_NO_RECIPE_FOUND`.

- **User Scenario: SCN-002-B1**
    - **Given** a fixture page whose only structured block declares `@type: "Article"` and which has no recipe-shaped HTML
    - **When** the page is imported
    - **Then** the job fails with code `IMPORT_NO_RECIPE_FOUND` rather than producing a draft built from the article

---

## Requirement Validation: REQ-003 (Deduplication by canonicalized URL)

#### Test Case: ATP-003-A (Second import of the same URL surfaces the existing recipe)

**Linked Requirement:** REQ-003
**Description:** A URL already imported by any user is imported again.
**Validation Condition:** The existing recipe is returned and no second recipe is created.
**Expected Result:** Job succeeds reporting `duplicate: true` with the existing recipe id and `cloneAvailable: true`; the count of recipes for that canonical URL remains 1.

- **User Scenario: SCN-003-A1**
    - **Given** a recipe already imported from a specific source URL and a second authenticated user
    - **When** the second user submits the same URL for import
    - **Then** the job returns the existing recipe with a clone option and exactly one recipe exists for that canonical URL

#### Test Case: ATP-003-B (Equivalent URL variants resolve to one recipe)

**Linked Requirement:** REQ-003
**Description:** URLs differing only by case, trailing slash, tracking parameters, or fragment.
**Validation Condition:** All variants map to the same canonical key.
**Expected Result:** Exactly one recipe exists after importing all variants.

- **User Scenario: SCN-003-B1**
    - **Given** a recipe already imported from `https://example.test/recipes/pie`
    - **When** a user imports `HTTPS://Example.test/recipes/pie/?utm_source=x#top`
    - **Then** the existing recipe is surfaced and exactly one recipe exists for that canonical URL

---

## Requirement Validation: REQ-004 (Uniqueness enforced by database constraint)

#### Test Case: ATP-004-A (Concurrent imports of a new URL produce exactly one recipe)

**Linked Requirement:** REQ-004
**Description:** Two imports of the same previously-unseen URL commit simultaneously.
**Validation Condition:** The unique index admits exactly one insert; the loser resolves to the winner.
**Expected Result:** Exactly one recipe row exists for the canonical URL; both callers receive that recipe id; neither receives a `5xx`.

- **User Scenario: SCN-004-A1**
    - **Given** two authenticated users and a source URL that has never been imported
    - **When** both users confirm an import of that URL at the same moment
    - **Then** exactly one recipe exists for the canonical URL and both users are returned that same recipe id

---

## Requirement Validation: REQ-005 (Instagram caption import — gated)

#### Test Case: ATP-005-A (Caption containing a recipe yields a draft)

**Linked Requirement:** REQ-005
**Description:** With the capability flag enabled, a post whose caption contains a recipe is imported.
**Validation Condition:** A draft is produced and classified `imported_public`.
**Expected Result:** Job succeeds with a draft whose `sourceType` is `imported_public` and whose `sourceUrl` is the post URL.

- **User Scenario: SCN-005-A1**
    - **Given** the Instagram capability flag is enabled and a contract fake returns a caption containing a full recipe
    - **When** an authenticated user imports that post URL
    - **Then** a draft is produced with source type `imported_public` and the post URL recorded as the source

#### Test Case: ATP-005-B (Caption without recipe text is rejected explicitly)

**Linked Requirement:** REQ-005
**Description:** A video-only or caption-less post.
**Validation Condition:** A distinct no-caption failure is returned.
**Expected Result:** Job fails with code `IMPORT_NO_CAPTION`; no draft is created.

- **User Scenario: SCN-005-B1**
    - **Given** the Instagram capability flag is enabled and a contract fake returns a post with no recipe text in its caption
    - **When** an authenticated user imports that post URL
    - **Then** the job fails with code `IMPORT_NO_CAPTION` and no draft is created

---

## Requirement Validation: REQ-006 (File import typed by content inspection)

#### Test Case: ATP-006-A (Each supported format produces a draft)

**Linked Requirement:** REQ-006
**Description:** JSON, YAML, and Markdown-with-frontmatter recipe files.
**Validation Condition:** Each yields a draft regardless of filename.
**Expected Result:** `201` with a `draftId` for each of the three formats.

- **User Scenario: SCN-006-A1**
    - **Given** an authenticated user holding a valid recipe file in JSON, YAML, or Markdown-with-frontmatter form
    - **When** the user uploads that file
    - **Then** the system returns a draft identifier for each format

#### Test Case: ATP-006-B (Filename is not trusted for type detection)

**Linked Requirement:** REQ-006
**Description:** A file named `.json` whose bytes are a ZIP archive.
**Validation Condition:** Type is determined by magic bytes, not the name.
**Expected Result:** `415` with code `IMPORT_UNSUPPORTED_FORMAT`; no draft created.

- **User Scenario: SCN-006-B1**
    - **Given** an authenticated user holding a ZIP archive renamed to end in `.json`
    - **When** the user uploads that file
    - **Then** the upload is rejected with code `IMPORT_UNSUPPORTED_FORMAT` and no draft is created

---

## Requirement Validation: REQ-007 (Photo/OCR import produces a draft)

#### Test Case: ATP-007-A (Legible photo yields a reviewable draft)

**Linked Requirement:** REQ-007
**Description:** A premium user photographs a clearly printed recipe.
**Validation Condition:** OCR text flows through the shared normalize path into a draft.
**Expected Result:** Job succeeds with a draft classified `imported_physical`.

- **User Scenario: SCN-007-A1**
    - **Given** a premium authenticated user and a photograph of a clearly printed recipe
    - **When** the user submits the photograph for import
    - **Then** a draft is produced with source type `imported_physical` for the user to review

#### Test Case: ATP-007-B (Unreadable image fails without creating a draft)

**Linked Requirement:** REQ-007
**Description:** An image from which no usable text can be extracted.
**Validation Condition:** A distinct OCR failure is returned and the stored image is removed.
**Expected Result:** Job fails with `IMPORT_OCR_FAILED`; no draft; the uploaded object no longer exists in storage.

- **User Scenario: SCN-007-B1**
    - **Given** a premium authenticated user and an image containing no legible text
    - **When** the user submits it for import
    - **Then** the job fails with code `IMPORT_OCR_FAILED`, no draft is created, and the uploaded image is deleted from storage

---

## Requirement Validation: REQ-008 (Ingredient lines parsed, raw retained)

#### Test Case: ATP-008-A (Structured quantity extracted with raw preserved)

**Linked Requirement:** REQ-008
**Description:** A conventional ingredient line.
**Validation Condition:** Quantity, unit, and name are populated and `raw` is byte-identical to the source line.
**Expected Result:** `{ quantity: 2, unit: "cup", name: "flour", raw: "2 cups flour" }`.

- **User Scenario: SCN-008-A1**
    - **Given** a source recipe whose ingredient list contains the line `2 cups flour`
    - **When** the recipe is imported
    - **Then** the draft holds that ingredient with quantity 2, unit "cup", name "flour", and the original line preserved verbatim

---

## Requirement Validation: REQ-009 (Unparseable line preserved, never fatal)

#### Test Case: ATP-009-A (Unparseable line is flagged, not discarded)

**Linked Requirement:** REQ-009
**Description:** An ingredient line with no determinable quantity.
**Validation Condition:** The line survives with a null quantity and a review flag; the import still succeeds.
**Expected Result:** Draft contains the line with `quantity: null` and `needsReview: true`; job status `succeeded`.

- **User Scenario: SCN-009-A1**
    - **Given** a source recipe whose ingredient list contains the line `salt to taste`
    - **When** the recipe is imported
    - **Then** the draft retains that line verbatim with no quantity, marks it for review, and the import still succeeds

---

## Requirement Validation: REQ-010 (Async ingredient resolution never blocks)

#### Test Case: ATP-010-A (Confirmation succeeds while the food service is down)

**Linked Requirement:** REQ-010
**Description:** The food catalog is unavailable at confirmation time.
**Validation Condition:** The recipe is still created; ingredients remain unresolved.
**Expected Result:** `201` with the recipe created; ingredient resolution status is `PENDING` or `UNRESOLVED`.

- **User Scenario: SCN-010-A1**
    - **Given** a complete draft and a food catalog service that is unreachable
    - **When** the user confirms the draft
    - **Then** the recipe is created successfully and its ingredients are recorded as awaiting resolution

---

## Requirement Validation: REQ-011 (Durations and servings normalized, never defaulted)

#### Test Case: ATP-011-A (ISO-8601 durations become integer minutes)

**Linked Requirement:** REQ-011
**Description:** A source stating `PT1H30M`.
**Validation Condition:** The value is converted to 90.
**Expected Result:** Draft `prepTimeMinutes` equals 90.

- **User Scenario: SCN-011-A1**
    - **Given** a source recipe declaring a preparation time of `PT1H30M`
    - **When** the recipe is imported
    - **Then** the draft records a preparation time of 90 minutes

#### Test Case: ATP-011-B (Absent values are flagged, never fabricated)

**Linked Requirement:** REQ-011
**Description:** A source stating no servings and no times.
**Validation Condition:** Fields are empty and listed in `missingRequired`; no zero or one is substituted.
**Expected Result:** `servings` is empty, `missingRequired` contains `servings`, and no numeric default appears anywhere in the draft.

- **User Scenario: SCN-011-B1**
    - **Given** a source recipe that states neither a serving count nor any timing
    - **When** the recipe is imported
    - **Then** those fields are left empty and listed as missing, and no substituted default value is present

---

## Requirement Validation: REQ-012 (Every import produces a draft, not a recipe)

#### Test Case: ATP-012-A (Draft carries confidence and missing-field list)

**Linked Requirement:** REQ-012
**Description:** Any successful import.
**Validation Condition:** The draft exposes per-field confidence and an explicit missing-required list, and no recipe exists.
**Expected Result:** Draft has non-empty `fieldConfidence`; recipe count unchanged until confirmation.

- **User Scenario: SCN-012-A1**
    - **Given** an authenticated user importing any supported source
    - **When** the import completes successfully
    - **Then** a draft is returned carrying per-field extraction confidence and the list of still-missing required fields, and no recipe has been created

---

## Requirement Validation: REQ-013 (Confirmation validates against the shipped contract)

#### Test Case: ATP-013-A (Complete draft confirms into a recipe)

**Linked Requirement:** REQ-013
**Description:** A draft with every required field present.
**Validation Condition:** A recipe is created through the shipped write path.
**Expected Result:** `201` with a recipe whose content matches the draft.

- **User Scenario: SCN-013-A1**
    - **Given** a draft with every required field populated
    - **When** the user confirms it
    - **Then** a recipe is created whose title, ingredients, and steps match the draft, and the draft is marked confirmed

#### Test Case: ATP-013-B (Incomplete draft is refused with field-level errors)

**Linked Requirement:** REQ-013
**Description:** A draft missing a required field.
**Validation Condition:** Confirmation is rejected and no recipe is created.
**Expected Result:** `422` code `IMPORT_DRAFT_INCOMPLETE` naming the missing field; recipe count unchanged.

- **User Scenario: SCN-013-B1**
    - **Given** a draft whose source stated no serving count
    - **When** the user attempts to confirm it without supplying one
    - **Then** confirmation is refused with an error naming the serving count and no recipe is created

---

## Requirement Validation: REQ-014 (Provenance classification per channel)

#### Test Case: ATP-014-A (Each channel sets the documented source type)

**Linked Requirement:** REQ-014
**Description:** Imports through URL, Instagram, OCR, and file channels.
**Validation Condition:** `sourceType` matches the channel mapping.
**Expected Result:** url/instagram → `imported_public`; ocr → `imported_physical`; file → `user_created`.

- **User Scenario: SCN-014-A1**
    - **Given** an authenticated user with entitlement for every channel
    - **When** the user imports one recipe through each of the URL, Instagram, photo, and file channels
    - **Then** each resulting recipe carries the source type documented for that channel

---

## Requirement Validation: REQ-015 (Visibility delegated to the shipped policy)

#### Test Case: ATP-015-A (No second visibility rule exists in the feature)

**Linked Requirement:** REQ-015
**Description:** Structural inspection plus behavioural confirmation.
**Validation Condition:** Visibility outcomes match the shipped `evaluateVisibility` for every provenance.
**Expected Result:** Import-created recipes exhibit the same visibility decisions as the shipped policy; no independent visibility implementation exists under the import module.

- **User Scenario: SCN-015-A1**
    - **Given** recipes created through import for each provenance classification
    - **When** each recipe's visibility is compared against the shipped visibility policy's decision for that provenance
    - **Then** every outcome matches, and no separate visibility rule is implemented within the import feature

---

## Requirement Validation: REQ-016 (Attribution displayed on both platforms)

#### Test Case: ATP-016-A (Imported public recipe shows source, author, platform)

**Linked Requirement:** REQ-016
**Description:** Recipe detail view on web and on mobile.
**Validation Condition:** All three attribution elements are visible on both platforms.
**Expected Result:** Source link, author, and platform are present and the link targets the original source.

- **User Scenario: SCN-016-A1**
    - **Given** a recipe imported from a public web source
    - **When** a user views that recipe's detail screen on web and on mobile
    - **Then** the source link, original author, and platform are visible on both platforms

#### Test Case: ATP-016-B (Non-imported recipe shows no attribution block)

**Linked Requirement:** REQ-016
**Description:** A user-created recipe.
**Validation Condition:** The attribution block does not render.
**Expected Result:** No attribution element is present in the rendered detail view.

- **User Scenario: SCN-016-B1**
    - **Given** a recipe the user created themselves with no external source
    - **When** the user views its detail screen
    - **Then** no attribution block is displayed

---

## Requirement Validation: REQ-017 (Blocked source rejected before any request)

#### Test Case: ATP-017-A (Blocklisted domain is never contacted)

**Linked Requirement:** REQ-017
**Description:** An import targeting a domain present on the blocklist.
**Validation Condition:** Rejection occurs pre-fetch; the fixture server records zero requests.
**Expected Result:** Code `IMPORT_SOURCE_BLOCKED`; the fixture host's request log is empty.

- **User Scenario: SCN-017-A1**
    - **Given** a domain recorded on the paywalled-source blocklist
    - **When** an authenticated user attempts to import a URL on that domain
    - **Then** the import is refused with a blocked-source explanation and the source host receives no request at all

---

## Requirement Validation: REQ-018 (Guards re-evaluated on every redirect hop)

#### Test Case: ATP-018-A (Redirect into a blocked domain is refused mid-chain)

**Linked Requirement:** REQ-018
**Description:** A permitted URL that redirects to a blocklisted host.
**Validation Condition:** The blocklist is re-checked at the hop.
**Expected Result:** Code `IMPORT_SOURCE_BLOCKED`; the blocked host receives no request.

- **User Scenario: SCN-018-A1**
    - **Given** a permitted URL that responds with a redirect to a blocklisted domain
    - **When** an authenticated user imports the permitted URL
    - **Then** the import is refused at the redirect and the blocklisted host receives no request

#### Test Case: ATP-018-B (Redirect into a private address is refused mid-chain)

**Linked Requirement:** REQ-018
**Description:** A public URL that redirects to a link-local address.
**Validation Condition:** The address guard is re-applied at the hop.
**Expected Result:** Refused; no connection is opened to the private address.

- **User Scenario: SCN-018-B1**
    - **Given** a public URL that responds with a redirect to `http://169.254.169.254/`
    - **When** an authenticated user imports the public URL
    - **Then** the import is refused and no connection is made to the link-local address

---

## Requirement Validation: REQ-019 (Blocklist is admin-managed data with an audit trail)

#### Test Case: ATP-019-A (Admin addition takes effect without a deploy)

**Linked Requirement:** REQ-019
**Description:** An administrator adds a domain at runtime.
**Validation Condition:** Subsequent imports from that domain are blocked, and the entry records who added it.
**Expected Result:** Import blocked within the cache TTL; the stored row carries the admin identifier and timestamp.

- **User Scenario: SCN-019-A1**
    - **Given** an administrator with the required scope and a domain not yet blocklisted
    - **When** the administrator adds that domain to the blocklist
    - **Then** subsequent imports from it are refused and the stored entry records the administrator's identity and the time it was added

#### Test Case: ATP-019-B (Non-admin cannot modify the blocklist)

**Linked Requirement:** REQ-019
**Description:** A caller without the admin scope.
**Validation Condition:** The mutation is refused.
**Expected Result:** `403`; the blocklist is unchanged.

- **User Scenario: SCN-019-B1**
    - **Given** an authenticated user without the administrative scope
    - **When** the user attempts to add a domain to the blocklist
    - **Then** the request is refused and the blocklist is unchanged

---

## Requirement Validation: REQ-020 (Blocklist matching is exact host or registrable suffix)

#### Test Case: ATP-020-A (A look-alike domain is not blocked)

**Linked Requirement:** REQ-020
**Description:** A domain whose name contains a blocked domain as a substring.
**Validation Condition:** Matching never uses substring containment.
**Expected Result:** Import from `notexample.test` succeeds while `example.test` is blocked.

- **User Scenario: SCN-020-A1**
    - **Given** `example.test` is on the blocklist
    - **When** an authenticated user imports a recipe from `notexample.test`
    - **Then** the import proceeds normally and is not treated as a blocked source

#### Test Case: ATP-020-B (A subdomain of a blocked domain is blocked)

**Linked Requirement:** REQ-020
**Description:** A host beneath a blocklisted registrable domain.
**Validation Condition:** Suffix matching applies.
**Expected Result:** Import from `recipes.example.test` is refused.

- **User Scenario: SCN-020-B1**
    - **Given** `example.test` is on the blocklist
    - **When** an authenticated user imports a recipe from `recipes.example.test`
    - **Then** the import is refused as a blocked source

---

## Requirement Validation: REQ-021 (Attestation and citation required for external manual entry)

#### Test Case: ATP-021-A (Citation is mandatory before saving)

**Linked Requirement:** REQ-021
**Description:** A user attests that pasted content came from an external source.
**Validation Condition:** Saving is refused until a citation is supplied.
**Expected Result:** Save blocked with a field-level error naming the citation; no recipe created.

- **User Scenario: SCN-021-A1**
    - **Given** an authenticated premium user who has pasted recipe text and declared it came from an external source
    - **When** the user attempts to save without providing a citation
    - **Then** the save is refused with an error naming the missing citation and no recipe is created

---

## Requirement Validation: REQ-022 (Non-public cited source is classified paid and stays private)

#### Test Case: ATP-022-A (Cookbook citation yields a private, unpublishable recipe)

**Linked Requirement:** REQ-022
**Description:** A citation that is not a publicly reachable web page.
**Validation Condition:** Classification is `imported_paid` and publication is refused.
**Expected Result:** Recipe created private with `sourceType: imported_paid`; a later attempt to make it public is refused.

- **User Scenario: SCN-022-A1**
    - **Given** an authenticated premium user who has attested a pasted recipe came from a printed cookbook and cited it
    - **When** the user saves the recipe and then attempts to make it public
    - **Then** the recipe is stored as a paid-source recipe, remains private, and the attempt to publish it is refused

---

## Requirement Validation: REQ-023 (Detection heuristics flag only)

#### Test Case: ATP-023-A (A heuristic does not override the user's declaration)

**Linked Requirement:** REQ-023
**Description:** Heuristics suspect paid-source content the user declared as their own.
**Validation Condition:** Classification follows the declaration; only a review flag is added.
**Expected Result:** `sourceType` unchanged by the heuristic; a review flag is recorded; the save is not blocked.

- **User Scenario: SCN-023-A1**
    - **Given** an authenticated user saving a pasted recipe they declared as their own, whose text triggers a paid-source heuristic
    - **When** the user saves the recipe
    - **Then** the recipe is saved with the declared classification, is flagged for review, and the save is not blocked

---

## Requirement Validation: REQ-024 (Distinct failure codes; nothing persisted on failure)

#### Test Case: ATP-024-A (Each failure kind returns its own code)

**Linked Requirement:** REQ-024
**Description:** Blocked, unreachable, and recipe-free sources.
**Validation Condition:** Three distinct machine-readable codes; no shared fallback.
**Expected Result:** `IMPORT_SOURCE_BLOCKED`, `IMPORT_SOURCE_UNREACHABLE`, `IMPORT_NO_RECIPE_FOUND` respectively.

- **User Scenario: SCN-024-A1**
    - **Given** three sources — one blocklisted, one unreachable, and one reachable but containing no recipe
    - **When** an authenticated user attempts to import each in turn
    - **Then** each attempt fails with a distinct machine-readable code identifying its specific cause

#### Test Case: ATP-024-B (A failed import persists nothing)

**Linked Requirement:** REQ-024
**Description:** Any failing import.
**Validation Condition:** Neither a draft nor a recipe is written.
**Expected Result:** Draft and recipe counts for the user are unchanged after the failure.

- **User Scenario: SCN-024-B1**
    - **Given** an authenticated user with a known number of drafts and recipes
    - **When** an import fails for any reason
    - **Then** the user's draft and recipe counts are unchanged

---

## Requirement Validation: REQ-025 (Imported recipe survives source deletion)

#### Test Case: ATP-025-A (Removed source leaves the recipe intact and marked unverifiable)

**Linked Requirement:** REQ-025
**Description:** The original source becomes unreachable after import.
**Validation Condition:** The recipe and its stored attribution persist; the source is marked unverifiable.
**Expected Result:** Recipe still readable with attribution present and a visible unverifiable indication.

- **User Scenario: SCN-025-A1**
    - **Given** a recipe imported from a source that has since been deleted by its publisher
    - **When** a user views that recipe
    - **Then** the recipe and its stored attribution are still present, and the source is shown as no longer verifiable

---

## Requirement Validation: REQ-026 (Draft expiry and image lifetime)

#### Test Case: ATP-026-A (Drafts expire after seven days)

**Linked Requirement:** REQ-026
**Description:** An unconfirmed draft passes its retention window.
**Validation Condition:** The draft is removed and can no longer be confirmed.
**Expected Result:** Confirmation returns `410` `IMPORT_DRAFT_EXPIRED`; the draft row is gone after the sweep.

- **User Scenario: SCN-026-A1**
    - **Given** an unconfirmed import draft created more than seven days ago
    - **When** the expiry sweep runs and the user then attempts to confirm it
    - **Then** the draft is gone and the confirmation attempt reports that it has expired

#### Test Case: ATP-026-B (OCR image never outlives its draft)

**Linked Requirement:** REQ-026
**Description:** Confirm, discard, and expiry paths for a photo import.
**Validation Condition:** The stored image is deleted on whichever terminal path occurs first.
**Expected Result:** The object is absent from storage after each of the three paths.

- **User Scenario: SCN-026-B1**
    - **Given** three photo-import drafts, one to be confirmed, one discarded, and one left to expire
    - **When** each reaches its terminal state
    - **Then** the stored source image no longer exists for any of the three

---

## Requirement Validation: REQ-027 (Object-level authorization on drafts and jobs)

#### Test Case: ATP-027-A (Another user's draft is indistinguishable from absent)

**Linked Requirement:** REQ-027
**Description:** A caller requests a draft belonging to someone else.
**Validation Condition:** The response is identical to that for a non-existent id.
**Expected Result:** `404` with no ownership disclosure; never `403`.

- **User Scenario: SCN-027-A1**
    - **Given** a draft owned by one user and a second authenticated user who knows its identifier
    - **When** the second user requests that draft
    - **Then** the response is identical to the response for an identifier that does not exist, disclosing nothing about ownership

---

## Requirement Validation: REQ-028 (Idempotency key required and honoured)

#### Test Case: ATP-028-A (Repeated key produces exactly one import)

**Linked Requirement:** REQ-028
**Description:** The same request is submitted twice with one key.
**Validation Condition:** The original outcome is returned; no second import occurs.
**Expected Result:** Both calls return the same `jobId`; exactly one draft exists.

- **User Scenario: SCN-028-A1**
    - **Given** an authenticated user submitting an import with a specific idempotency key
    - **When** the identical request is submitted a second time with the same key
    - **Then** the original job is returned and exactly one draft exists

#### Test Case: ATP-028-B (Missing key is refused)

**Linked Requirement:** REQ-028
**Description:** A non-idempotent import POST without the header.
**Validation Condition:** The request is rejected before work begins.
**Expected Result:** `400` naming the required header; no job created.

- **User Scenario: SCN-028-B1**
    - **Given** an authenticated user submitting an import request without an idempotency key
    - **When** the request is received
    - **Then** it is rejected with an error naming the required header and no import job is created

---

## Requirement Validation: REQ-029 (Daily allowance as domain policy)

#### Test Case: ATP-029-A (Exhausted allowance is refused with a reset time)

**Linked Requirement:** REQ-029
**Description:** A user at their daily allowance starts another import.
**Validation Condition:** A distinct quota code is returned carrying the reset instant.
**Expected Result:** `429` code `IMPORT_QUOTA_EXCEEDED` with a `resetsAt` value in the future.

- **User Scenario: SCN-029-A1**
    - **Given** an authenticated user who has consumed their daily import allowance
    - **When** the user starts another import
    - **Then** the request is refused with a quota-specific code that states when the allowance resets

#### Test Case: ATP-029-B (A bulk file counts as one import against the allowance)

**Linked Requirement:** REQ-029
**Description:** A large multi-recipe file imported by a user near the cap.
**Validation Condition:** The file consumes one unit of allowance, not one per recipe.
**Expected Result:** Import succeeds; allowance consumed increases by exactly one.

- **User Scenario: SCN-029-B1**
    - **Given** an authenticated user close to their daily allowance and an export file containing 900 recipes
    - **When** the user imports that file
    - **Then** the import succeeds and the user's consumed allowance increases by exactly one

---

## Requirement Validation: REQ-030 (robots.txt interpretation)

#### Test Case: ATP-030-A (Bare wildcard disallow does not block a user-initiated import)

**Linked Requirement:** REQ-030
**Description:** A site whose `robots.txt` contains only `User-agent: *` / `Disallow: /`.
**Validation Condition:** The import proceeds.
**Expected Result:** Job succeeds; a draft is produced.

- **User Scenario: SCN-030-A1**
    - **Given** a source site whose robots file disallows all paths for all agents and names no specific agent
    - **When** an authenticated user imports a single recipe page from that site
    - **Then** the import proceeds and produces a draft

#### Test Case: ATP-030-B (A directive naming our agent is honoured in full)

**Linked Requirement:** REQ-030
**Description:** A `robots.txt` group naming the import user-agent with `Disallow: /`.
**Validation Condition:** The import is refused and the block is counted.
**Expected Result:** Code `IMPORT_SOURCE_BLOCKED`; the robots-block counter increments.

- **User Scenario: SCN-030-B1**
    - **Given** a source site whose robots file names the import user-agent and disallows all paths for it
    - **When** an authenticated user attempts to import a page from that site
    - **Then** the import is refused as blocked and the refusal is counted

---

## Requirement Validation: REQ-031 (Creation accepts explicit provenance)

#### Test Case: ATP-031-A (Provenance drives the visibility decision)

**Linked Requirement:** REQ-031
**Description:** Recipes created with each provenance classification.
**Validation Condition:** The visibility policy is evaluated against the actual provenance, not a hardcoded default.
**Expected Result:** Each recipe's visibility matches the shipped policy's decision for its provenance.

- **User Scenario: SCN-031-A1**
    - **Given** an authenticated user creating recipes with each supported provenance classification
    - **When** each recipe is created
    - **Then** each one's visibility matches the shipped policy's decision for that provenance

#### Test Case: ATP-031-B (Existing creation behaviour is unchanged)

**Linked Requirement:** REQ-031
**Description:** A recipe-creation request supplying no provenance.
**Validation Condition:** Behaviour is identical to before the change.
**Expected Result:** Recipe created as `user_created` with the pre-existing visibility outcome.

- **User Scenario: SCN-031-B1**
    - **Given** an authenticated user creating a recipe without supplying any provenance
    - **When** the recipe is created
    - **Then** it is stored as a user-created recipe with exactly the visibility it would have had before provenance was introduced

---

## Requirement Validation: REQ-032 (Client provenance is whitelisted)

#### Test Case: ATP-032-A (A caller cannot obtain a private recipe by declaring a physical source)

**Linked Requirement:** REQ-032
**Description:** A free-tier caller declares a typed-in recipe as physical-copy provenance.
**Validation Condition:** The declaration is not accepted from the client.
**Expected Result:** The request is refused, or the recipe is stored as `user_created`; the caller does not obtain a private recipe.

- **User Scenario: SCN-032-A1**
    - **Given** an authenticated free-tier user creating a recipe by typing it in
    - **When** the user attempts to declare it as originating from a physical copy
    - **Then** the declaration is not honoured and the user does not obtain a private recipe

#### Test Case: ATP-032-B (A caller cannot attach false public attribution)

**Linked Requirement:** REQ-032
**Description:** A caller declares `imported_public` provenance directly.
**Validation Condition:** That classification is not client-settable.
**Expected Result:** The request is refused; no recipe carries attribution the server did not observe.

- **User Scenario: SCN-032-B1**
    - **Given** an authenticated user creating a recipe directly
    - **When** the user attempts to declare it as an attributed public import
    - **Then** the request is refused and no recipe is created carrying attribution the system did not itself observe

---

## Requirement Validation: REQ-033 (Multi-recipe file import with split review)

#### Test Case: ATP-033-A (One file yields one draft per recipe with a completeness split)

**Linked Requirement:** REQ-033
**Description:** An export file containing many recipes of mixed completeness.
**Validation Condition:** Each recipe becomes a draft; complete and incomplete drafts are distinguished.
**Expected Result:** Draft count equals recipe count in the file; the job reports how many are complete.

- **User Scenario: SCN-033-A1**
    - **Given** an authenticated user holding an export file containing many recipes, some complete and some missing required fields
    - **When** the user uploads that file
    - **Then** one draft is created per recipe and the result distinguishes the complete drafts from those needing attention

#### Test Case: ATP-033-B (A file above the recipe limit is refused)

**Linked Requirement:** REQ-033
**Description:** An export file containing more than one thousand recipes.
**Validation Condition:** The upload is refused with an explicit limit message before parsing completes.
**Expected Result:** `413` naming the limit; no drafts created.

- **User Scenario: SCN-033-B1**
    - **Given** an authenticated user holding an export file containing 1,001 recipes
    - **When** the user uploads that file
    - **Then** the upload is refused with a message stating the limit and no drafts are created

---

## Requirement Validation: REQ-034 (Per-recipe bulk outcome)

#### Test Case: ATP-034-A (One failure does not discard the successes)

**Linked Requirement:** REQ-034
**Description:** Bulk confirmation where one recipe fails to persist.
**Validation Condition:** The remaining recipes are still created and the failure is reported individually.
**Expected Result:** All but the failing recipe exist; the response names the failure with a reason.

- **User Scenario: SCN-034-A1**
    - **Given** a set of complete drafts in which one recipe will fail to persist
    - **When** the user confirms them in bulk
    - **Then** every other recipe is created and the response identifies the single failure and its reason

#### Test Case: ATP-034-B (An already-present recipe reports as existing, not failed)

**Linked Requirement:** REQ-034
**Description:** A bulk set containing a recipe already imported.
**Validation Condition:** Deduplication applies per recipe.
**Expected Result:** That entry reports `already_existed`; no duplicate is created; it is not counted as a failure.

- **User Scenario: SCN-034-B1**
    - **Given** a bulk set of drafts in which one recipe has already been imported previously
    - **When** the user confirms the set
    - **Then** that entry is reported as already existing rather than failed, and no duplicate recipe is created

---

## Requirement Validation: REQ-035 (Premium entitlement on non-public channels)

#### Test Case: ATP-035-A (Unentitled caller is refused before any provider work)

**Linked Requirement:** REQ-035
**Description:** A free-tier caller invokes the photo-import endpoint directly.
**Validation Condition:** The entitlement is checked before the OCR provider is called.
**Expected Result:** `403` code `IMPORT_REQUIRES_PREMIUM`; the OCR provider records zero invocations.

- **User Scenario: SCN-035-A1**
    - **Given** an authenticated free-tier user
    - **When** the user calls the photo-import endpoint directly
    - **Then** the request is refused with a premium-required code and the OCR provider is never invoked

#### Test Case: ATP-035-B (Gated channels are not advertised to unentitled callers)

**Linked Requirement:** REQ-035
**Description:** The supported-sources listing for a free-tier caller.
**Validation Condition:** Non-public channels are absent from the advertised list.
**Expected Result:** The response omits the photo and paid-source channels; both UIs render no such affordance.

- **User Scenario: SCN-035-B1**
    - **Given** an authenticated free-tier user
    - **When** the user opens the import surface on web or mobile
    - **Then** the photo and cookbook-paste channels are not offered at all

---

# Non-Functional Requirements

## Requirement Validation: REQ-NF-001 (Strict TypeScript, no `any`)

#### Test Case: ATP-NF-001-A (Type checking passes with no escape hatches)

**Linked Requirement:** REQ-NF-001
**Description:** Static inspection of the feature's source.
**Validation Condition:** Type checking succeeds and no `any` or suppression comment appears outside marked test doubles.
**Expected Result:** Type check exits zero; a search for `any` and suppression directives returns only explicitly marked test doubles.

- **User Scenario: SCN-NF-001-A1**
    - **Given** the feature's complete source tree
    - **When** the project type checker and a search for type-escape hatches are run over it
    - **Then** type checking succeeds and no unmarked escape hatches are present

---

## Requirement Validation: REQ-NF-002 (JSDoc on every export)

#### Test Case: ATP-NF-002-A (All exported symbols are documented)

**Linked Requirement:** REQ-NF-002
**Description:** Inspection of exported functions, interfaces, and types.
**Validation Condition:** Every export carries a documentation comment.
**Expected Result:** The documentation lint reports zero undocumented exports in the feature's modules.

- **User Scenario: SCN-NF-002-A1**
    - **Given** the feature's exported functions, interfaces, and types
    - **When** the documentation lint is run over them
    - **Then** it reports no undocumented exports

---

## Requirement Validation: REQ-NF-003 (85% extraction accuracy)

#### Test Case: ATP-NF-003-A (Corpus accuracy meets the threshold)

**Linked Requirement:** REQ-NF-003
**Description:** Field-level accuracy measured over the hand-verified fixture corpus.
**Validation Condition:** Overall accuracy is at least 85% across title, ingredient lines, and steps.
**Expected Result:** The accuracy report is ≥85%; the gate fails the build below that.

- **User Scenario: SCN-NF-003-A1**
    - **Given** the hand-verified fixture corpus of at least fifty stratified recipe pages
    - **When** the extraction accuracy measurement is run offline against it
    - **Then** field-level accuracy for title, ingredient lines, and steps is at least 85%

---

## Requirement Validation: REQ-NF-004 (Accessible names on every control)

#### Test Case: ATP-NF-004-A (Every import control is reachable by role or label)

**Linked Requirement:** REQ-NF-004
**Description:** All interactive elements of the import surface, on both platforms.
**Validation Condition:** Each control is addressable by accessible role or label.
**Expected Result:** Every control in the import flow is located by role or label with no reliance on test identifiers.

- **User Scenario: SCN-NF-004-A1**
    - **Given** the import surface rendered on web and on mobile
    - **When** each interactive control is queried by its accessible role or label
    - **Then** every control is found without relying on test-only identifiers

---

## Requirement Validation: REQ-NF-005 (State never conveyed by colour alone)

#### Test Case: ATP-NF-005-A (Every state carries an icon or text label)

**Linked Requirement:** REQ-NF-005
**Description:** Import progress, error, confidence, and missing-field states.
**Validation Condition:** Each state exposes a non-colour indicator.
**Expected Result:** Every state renders an icon or text label alongside any colour treatment.

- **User Scenario: SCN-NF-005-A1**
    - **Given** the import surface displaying each of its progress, error, low-confidence, and missing-field states
    - **When** each state is inspected with colour information disregarded
    - **Then** the state remains identifiable from an icon or text label

---

## Requirement Validation: REQ-NF-006 (Localized copy, machine-readable codes)

#### Test Case: ATP-NF-006-A (No user-facing literal is hard-coded)

**Linked Requirement:** REQ-NF-006
**Description:** All import copy across web and mobile.
**Validation Condition:** Strings resolve through the shared message catalogue; the service returns codes.
**Expected Result:** No hard-coded user-facing literal in the components; error responses carry a machine-readable code.

- **User Scenario: SCN-NF-006-A1**
    - **Given** the import components and the service's error responses
    - **When** the components are inspected for literals and a failing import is triggered
    - **Then** all user-facing copy resolves through the shared catalogue and the service response carries a machine-readable code rather than prose

---

## Requirement Validation: REQ-NF-007 (Bounded outbound requests)

#### Test Case: ATP-NF-007-A (Every outbound call is bounded and breaker-wrapped)

**Linked Requirement:** REQ-NF-007
**Description:** Timeout, redirect cap, response-size cap, and circuit breaker.
**Validation Condition:** Each bound is enforced independently.
**Expected Result:** A stalling source aborts at the deadline, a 6-hop chain is refused, an oversize body aborts mid-stream, and repeated failures open the breaker.

- **User Scenario: SCN-NF-007-A1**
    - **Given** fixture hosts that variously stall, redirect endlessly, and stream an oversize body
    - **When** an authenticated user attempts to import from each
    - **Then** each attempt terminates within its documented bound rather than running unbounded

---

## Requirement Validation: REQ-NF-008 (Retries bounded, jittered, idempotent-only)

#### Test Case: ATP-NF-008-A (Transient failures retry; client errors do not)

**Linked Requirement:** REQ-NF-008
**Description:** A source returning a transient error versus a permanent one.
**Validation Condition:** Retries occur only for transient classes and are capped.
**Expected Result:** A transient failure is retried at most twice with increasing, jittered delay; a `404` is not retried.

- **User Scenario: SCN-NF-008-A1**
    - **Given** one fixture host returning a transient server error and another returning a not-found error
    - **When** an authenticated user imports from each
    - **Then** the transient case is retried a bounded number of times with increasing delay and the not-found case is not retried at all

---

## Requirement Validation: REQ-NF-009 (No request to a non-public address)

#### Test Case: ATP-NF-009-A (Private and link-local addresses are refused)

**Linked Requirement:** REQ-NF-009
**Description:** Hosts resolving to loopback, private, link-local, or unspecified addresses.
**Validation Condition:** No connection is opened to any non-public address.
**Expected Result:** Every such import is refused; no socket is opened to the address.

- **User Scenario: SCN-NF-009-A1**
    - **Given** URLs whose hosts resolve to loopback, private, link-local, and unspecified addresses
    - **When** an authenticated user attempts to import each
    - **Then** every attempt is refused and no connection is made to any of those addresses

#### Test Case: ATP-NF-009-B (Address is re-validated after DNS changes)

**Linked Requirement:** REQ-NF-009
**Description:** A host whose DNS answer changes between validation and connection.
**Validation Condition:** The connection is pinned to the validated address.
**Expected Result:** The rebinding attempt fails to reach the private address.

- **User Scenario: SCN-NF-009-B1**
    - **Given** a host that resolves to a public address when checked and a private address moments later
    - **When** an authenticated user imports a URL on that host
    - **Then** the connection reaches only the validated public address and never the private one

---

## Requirement Validation: REQ-NF-010 (Extracted content sanitized before persistence)

#### Test Case: ATP-NF-010-A (Markup in a source cannot become active content)

**Linked Requirement:** REQ-NF-010
**Description:** A source page whose recipe fields contain script and event-handler markup.
**Validation Condition:** Stored values are inert plain text.
**Expected Result:** The persisted fields contain no markup, and rendering them executes nothing.

- **User Scenario: SCN-NF-010-A1**
    - **Given** a source page whose recipe fields contain script tags and event-handler attributes
    - **When** the recipe is imported, confirmed, and then rendered
    - **Then** the stored fields hold inert text and nothing from the source executes

---

## Requirement Validation: REQ-NF-011 (SLOs published and load-tested)

#### Test Case: ATP-NF-011-A (Latency targets hold under load and shed cleanly beyond it)

**Linked Requirement:** REQ-NF-011
**Description:** Load and soak testing of the import endpoints.
**Validation Condition:** Documented latency targets are met at expected load; over-capacity sheds rather than failing catastrophically.
**Expected Result:** Import job and confirm latencies meet their targets; beyond capacity the service returns a shed response rather than exhausting memory.

- **User Scenario: SCN-NF-011-A1**
    - **Given** the import endpoints under sustained expected load and then beyond capacity
    - **When** the load and soak profiles are executed
    - **Then** the documented latency targets hold at expected load and excess demand is shed rather than causing unbounded queue growth

---

## Requirement Validation: REQ-NF-012 (Fetched bodies and OCR text never logged)

#### Test Case: ATP-NF-012-A (No third-party content reaches the logs)

**Linked Requirement:** REQ-NF-012
**Description:** A URL import and an OCR import with distinctive marker content.
**Validation Condition:** The marker never appears in any log output.
**Expected Result:** Log capture across the request and worker contains no occurrence of the marker text.

- **User Scenario: SCN-NF-012-A1**
    - **Given** a source page and a photograph each containing a distinctive marker string
    - **When** both are imported with log output captured
    - **Then** the marker string appears nowhere in the captured logs

---

## Requirement Validation: REQ-NF-013 (Mutation thresholds on the pure core)

#### Test Case: ATP-NF-013-A (Mutation score meets the per-area threshold)

**Linked Requirement:** REQ-NF-013
**Description:** Mutation testing over the policy, normalization, guard, and extractor modules.
**Validation Condition:** Each gated area meets its documented threshold.
**Expected Result:** The mutation run reports scores at or above threshold for every gated area; the build fails below it.

- **User Scenario: SCN-NF-013-A1**
    - **Given** the feature's pure policy, normalization, SSRF-guard, and extractor modules with their unit suites
    - **When** the mutation run executes over them
    - **Then** every gated area meets or exceeds its documented mutation threshold

---

# Interface Requirements

## Requirement Validation: REQ-IF-001 (Instagram oEmbed behind a capability flag)

#### Test Case: ATP-IF-001-A (Disabled flag hides the channel entirely)

**Linked Requirement:** REQ-IF-001
**Description:** The capability flag is off.
**Validation Condition:** The endpoint is unavailable and the channel is unadvertised.
**Expected Result:** The endpoint responds as not found and the channel is absent from the supported-sources listing.

- **User Scenario: SCN-IF-001-A1**
    - **Given** the Instagram capability flag is disabled
    - **When** an authenticated user opens the import surface and separately calls the Instagram endpoint
    - **Then** the channel is not offered and the endpoint reports as not found

---

## Requirement Validation: REQ-IF-002 (OCR behind a provider port)

#### Test Case: ATP-IF-002-A (Pipeline runs against a substituted provider)

**Linked Requirement:** REQ-IF-002
**Description:** The OCR pipeline exercised with a contract fake in place of the vendor.
**Validation Condition:** The pipeline completes without contacting the real provider.
**Expected Result:** A draft is produced using the fake, proving the port boundary holds.

- **User Scenario: SCN-IF-002-A1**
    - **Given** the OCR provider port bound to a contract fake rather than the vendor
    - **When** a premium user submits a photograph for import
    - **Then** a draft is produced and no request is made to the external vendor

---

## Requirement Validation: REQ-IF-003 (Creation only through the shipped write path)

#### Test Case: ATP-IF-003-A (Imported recipes satisfy the shipped creation contract)

**Linked Requirement:** REQ-IF-003
**Description:** A confirmed import inspected against the shipped recipe contract.
**Validation Condition:** The created recipe conforms to the shipped schema and carries a version record.
**Expected Result:** The recipe satisfies every shipped constraint and its first version snapshot exists.

- **User Scenario: SCN-IF-003-A1**
    - **Given** a complete import draft
    - **When** the user confirms it
    - **Then** the resulting recipe satisfies the shipped recipe contract including its version history, exactly as a directly created recipe would

---

## Requirement Validation: REQ-IF-004 (Authentication on every import endpoint)

#### Test Case: ATP-IF-004-A (Unauthenticated request is refused before any work)

**Linked Requirement:** REQ-IF-004
**Description:** Every import endpoint called without a valid token.
**Validation Condition:** Rejection precedes any import processing.
**Expected Result:** Each endpoint refuses with an unauthenticated response; no job, draft, or outbound request occurs.

- **User Scenario: SCN-IF-004-A1**
    - **Given** no valid session token
    - **When** each import endpoint is called in turn
    - **Then** every call is refused as unauthenticated and no import work of any kind is performed

---

## Requirement Validation: REQ-IF-005 (Ingredient resolution via the shipped food client)

#### Test Case: ATP-IF-005-A (Parsed names are submitted to the catalog)

**Linked Requirement:** REQ-IF-005
**Description:** Confirmation of a draft with parsed ingredient names.
**Validation Condition:** Names are submitted through the shipped client and tracked by its lifecycle.
**Expected Result:** Each ingredient carries a resolution status from the shipped lifecycle.

- **User Scenario: SCN-IF-005-A1**
    - **Given** a complete draft whose ingredient lines parsed into recognisable names
    - **When** the user confirms the draft
    - **Then** those names are submitted to the food catalog and each ingredient carries a resolution status from the shipped lifecycle

---

## Requirement Validation: REQ-IF-006 (Contract-first publication and typed client)

#### Test Case: ATP-IF-006-A (Documented contract matches actual responses)

**Linked Requirement:** REQ-IF-006
**Description:** Round-trip comparison of the published contract against live responses.
**Validation Condition:** Documented request and response shapes match what the service returns.
**Expected Result:** Every import endpoint's actual response validates against its published schema.

- **User Scenario: SCN-IF-006-A1**
    - **Given** the published contract for every import endpoint
    - **When** each endpoint is exercised and its response validated against the published schema
    - **Then** every response conforms to its documented shape

---

# Constraint Requirements

## Requirement Validation: REQ-CN-001 (One recipe per canonical source URL)

#### Test Case: ATP-CN-001-A (No canonical URL ever holds two live recipes)

**Linked Requirement:** REQ-CN-001
**Description:** Repeated and concurrent imports of one URL.
**Validation Condition:** The invariant holds under both sequential and simultaneous import.
**Expected Result:** Exactly one non-deleted recipe exists for the canonical URL in every case.

- **User Scenario: SCN-CN-001-A1**
    - **Given** a source URL imported repeatedly, both sequentially and simultaneously, by different users
    - **When** all imports have settled
    - **Then** exactly one non-deleted recipe exists for that canonical URL

---

## Requirement Validation: REQ-CN-002 (Deleted imports can be re-imported)

#### Test Case: ATP-CN-002-A (Soft-deleted recipe does not block a fresh import)

**Linked Requirement:** REQ-CN-002
**Description:** Re-import of a URL whose recipe was deleted.
**Validation Condition:** The uniqueness constraint excludes deleted rows.
**Expected Result:** The re-import succeeds and creates a new recipe.

- **User Scenario: SCN-CN-002-A1**
    - **Given** a recipe imported from a URL and subsequently deleted by its owner
    - **When** any user imports that same URL again
    - **Then** the import succeeds and produces a new recipe

---

## Requirement Validation: REQ-CN-003 (Paid-source recipes never public)

#### Test Case: ATP-CN-003-A (Publication is refused regardless of entry channel)

**Linked Requirement:** REQ-CN-003
**Description:** A paid-source recipe entered by any available route.
**Validation Condition:** No route permits it to become public.
**Expected Result:** Every attempt to publish is refused and the recipe remains private.

- **User Scenario: SCN-CN-003-A1**
    - **Given** recipes classified as originating from a paid source, entered through each available route
    - **When** the owner attempts to make each one public
    - **Then** every attempt is refused and each recipe remains private

---

## Requirement Validation: REQ-CN-004 (Instagram limited to caption recipes)

#### Test Case: ATP-CN-004-A (Non-caption posts are out of scope and say so)

**Linked Requirement:** REQ-CN-004
**Description:** Video-only and image-only posts.
**Validation Condition:** These are refused with an explicit unsupported explanation.
**Expected Result:** A no-caption code is returned; no draft or recipe is created.

- **User Scenario: SCN-CN-004-A1**
    - **Given** the Instagram channel enabled and a post carrying no recipe text in its caption
    - **When** an authenticated user attempts to import it
    - **Then** the import is refused with an explanation that only caption-based posts are supported

---

## Requirement Validation: REQ-CN-005 (RDFa out of scope)

#### Test Case: ATP-CN-005-A (Only the three documented strategies are present)

**Linked Requirement:** REQ-CN-005
**Description:** Inspection of the registered extractor chain.
**Validation Condition:** The chain contains exactly the JSON-LD, microdata, and heuristic strategies.
**Expected Result:** No RDFa strategy is registered.

- **User Scenario: SCN-CN-005-A1**
    - **Given** the configured extractor chain
    - **When** its registered strategies are enumerated
    - **Then** exactly the JSON-LD, microdata, and heuristic strategies are present and no RDFa strategy exists

---

## Requirement Validation: REQ-CN-006 (JS-rendered pages reported explicitly)

#### Test Case: ATP-CN-006-A (A client-rendered page is a stated failure, not an empty success)

**Linked Requirement:** REQ-CN-006
**Description:** A page whose recipe content never appears in the served HTML.
**Validation Condition:** The outcome is an explicit no-recipe-found failure.
**Expected Result:** The job fails with the no-recipe-found code; no empty draft is produced.

- **User Scenario: SCN-CN-006-A1**
    - **Given** a page whose recipe content is only assembled by client-side script
    - **When** an authenticated user imports it
    - **Then** the import fails with an explicit no-recipe-found result rather than producing an empty draft

---

## Requirement Validation: REQ-CN-007 (No duplicate implementation of shipped capabilities)

#### Test Case: ATP-CN-007-A (Import creates recipes only through the shipped path)

**Linked Requirement:** REQ-CN-007
**Description:** Inspection of the import feature for rival implementations.
**Validation Condition:** No second implementation of attribution storage, clone, visibility policy, error mapping, or rate limiting exists.
**Expected Result:** The import feature contains one confirmation bridge and no independent recipe-write, visibility, or error-mapping implementation.

- **User Scenario: SCN-CN-007-A1**
    - **Given** the import feature's complete source
    - **When** it is inspected for recipe-creation, visibility-decision, error-mapping, and rate-limiting implementations
    - **Then** it contains none of its own, delegating each to the already-shipped implementation

---

## Requirement Validation: REQ-CN-008 (Web and mobile ship together)

#### Test Case: ATP-CN-008-A (No capability exists on only one platform)

**Linked Requirement:** REQ-CN-008
**Description:** Comparison of the import surface across web and mobile.
**Validation Condition:** Every user-facing capability is present on both.
**Expected Result:** The set of import capabilities is identical on both platforms.

- **User Scenario: SCN-CN-008-A1**
    - **Given** the import feature released to web and to mobile
    - **When** the user-facing capabilities of each platform are enumerated and compared
    - **Then** both platforms offer the same set of capabilities with no platform-only feature

---

## Coverage Summary

Generated by `validate-requirement-coverage.sh` — see the run output recorded with this revision.

---

## Requirement Validation: REQ-CN-009 (API paths carry the /api/{version}/ prefix)

#### Test Case: ATP-CN-009-A (Every introduced endpoint is /api/v1-prefixed)

**Linked Requirement:** REQ-CN-009
**Description:** Inspection of every endpoint this feature introduces.
**Validation Condition:** All new paths begin `/api/v1/`; cited shipped paths match the deployed routes.
**Expected Result:** No new endpoint omits the prefix, and no cited shipped path differs from its actual route.

- **User Scenario: SCN-CN-009-A1**
    - **Given** the published contract for this feature and the currently deployed services
    - **When** every path introduced here and every shipped path cited here is compared against the deployed routes
    - **Then** each introduced path begins `/api/v1/` and each cited shipped path matches the route actually served
