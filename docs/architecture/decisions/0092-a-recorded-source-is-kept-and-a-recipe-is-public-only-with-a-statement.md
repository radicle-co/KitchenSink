# 0092: A recorded source is kept, and a recipe is public only with a statement the cook made

- **Status:** Accepted
- **Date:** 2026-11-15
- **Amends:** [ADR-0089](0089-a-pasted-web-link-sets-the-source-and-a-web-copy-stays-private.md) §6. Removing a source
  still leaves visibility alone. But the removed source stays on record and keeps the recipe out of Public.
- **Amends:** [ADR-0023](0023-curator-declared-provenance.md). A body with no statement no longer means "the cook wrote
  this". Spec 004 `004-FR-024` says "existing behaviour is unchanged". That is no longer true for publishing. The spec
  text is amended separately.
- **Relates to:**
    - [ADR-0072](0072-bulk-recipe-import.md) §9: a recipe without a statement stays out of the library.
    - [ADR-0074](0074-content-source-check.md): the public hold. It is not built yet. It replaces one rule here.
    - [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md) §8: a missing input
      reads as held.
    - [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md): migrations run ahead of the service.
    - [ADR-0014](0014-service-owned-api-contracts.md): the wire contract.
    - Spec 016: `016-FR-014` and `016-FR-069`.

## Context

A cook pasted a web link on a draft. That made the recipe a private web copy. Then the cook removed the link. With no
statement left, the recipe read as `user_created`. Public opened again, with the cook named as the author.

The same reading applied to a recipe with no statement at all. "No statement" and "I wrote this" were one value.

## Decision

### 1. Every recorded third-party source is kept as evidence

Migration `0086` adds the table `recipe_source_evidence`. When the service stores a web, book or paid-site source, it writes a row. The row goes in the same transaction as the
recipe write.

- `capture` is `editorLink`, `editorCitation` or `importFile`. The value `pastedPage` is for the paste import.
- The columns for page credits, an image address and a paste digest are for the paste import. They are empty today.
- **Append-only.** A trigger refuses UPDATE and DELETE for every role. A DELETE passes only for the recipe's
  `ON DELETE CASCADE`. At that point the recipe row is already gone. A `REVOKE` does not hold here, because the migrator grants
  table rights again after each migration.
- **No stated source without evidence.** A deferred constraint trigger on `recipes` refuses a commit that stores a
  `source_kind` with no matching evidence row.
- **Clones inherit it.** A trigger copies the parent's evidence rows to a new clone. Cloning does not drop the
  evidence.
- `source_key` is the parsed link without its `#fragment`. All other normalisation goes into `sourceKeyOf`. There is
  one key.

### 2. `sourceConflict`: evidence keeps a recipe out of Public

`sourceConflictOf` is in `recipe-core`. It is true only if both of these are true:

- The recipe's label is not already private-only.
- Some evidence row names a web domain with no verified site claim, or is a book or a paid site.

Site claims are not built, so the claim list is always empty. The database twin is the function
`recipe_holds_third_party_source`. A LOCAL e2e test checks that the two agree.

`evaluateVisibility`, `evaluatePublishedState` and `defaultCloneVisibility` take `sourceConflict` as a REQUIRED input.
Every route to Public must state it: create, PATCH, set-visibility, publish, clone and the import save. A refusal is
`400 INVALID_VISIBILITY` with `details.reason: 'SOURCE_CONFLICT'`. This rule never refuses Private.

⛔ **This is the one seam the ADR-0074 hold replaces.** After the hold ships, `sourceConflictOf` becomes one of its
inputs, and the refusal is removed. The rule lives only behind this predicate and its input to the policies. Do not
copy it to other places.

### 3. `statement_kind`: "I wrote this" is a statement, and silence is not

Migration `0087` adds two columns to `recipes`:

- `statement_kind`: `authored` or `source`. `NULL` means no statement.
- `content_pasted_at`: set when the cook pasted content.

CHECKs pair `authored` with `user_created` and no source kind. They pair a source kind with `source`.

- The create and PATCH `statement` is a union of `authored`, `public_web`, `book` and `fromPerson`.
- A curator's declared `user_created` counts as no statement.
- `statementRequiredOf` is in `recipe-core`. It is true if three things hold: the recipe is `user_created`, it has no
  statement, and a paste was seen or evidence exists. Its database twin is `recipe_needs_statement`.
- `evaluatePublishedState` takes `statementRequired` as a REQUIRED input. It refuses only a write that LEAVES the
  recipe published and public: `400 INVALID_VISIBILITY`, `details.reason: 'STATEMENT_REQUIRED'`.
- Drafts are public by default, so this rule never refuses a draft.
- The order of refusals is: containment, private-only, `sourceConflict`, `statementRequired`.
- After the ADR-0074 hold ships, `statementRequired` stays. A pasted recipe with "I wrote this" and evidence still meets
  `sourceConflict`. The two rules stay separate.
- After the first publish, PATCH can move a recipe from no statement to `authored`. No other source change opens after
  the first publish.

**"Typed" means we saw no paste.** This is the owner's ruling of 2026-11-15, quoted:
"we only ask if we aren't absolutely sure". The client sends `contentPasted: true` in two cases:

- the cook used a paste sheet.
- on web, the cook pasted into an editor field.

The service stores it as `COALESCE(content_pasted_at, now())`. It is never cleared. A recipe with no paste seen and no
evidence publishes with no question.

Limits of this rule:

- The flag is the client's word. An old client, a changed client or a direct API caller can leave it out. That recipe
  then reads as typed.
- React Native has no paste event. A long-press paste into a plain field on mobile is not seen.

The service writes the evidence rows, the statement and the source kind from what it stores. The editor-link evidence
does not depend on the client. Paste evidence (`pastedPage`) is the client's word.

### 4. Every statement and every Public confirmation is recorded

Migration `0088` adds the table `recipe_statement_attestations`. It is append-only, with the same trigger pattern as
§1. There is one row per act. A row holds:

- the account.
- the mode, `explicit` or `implicit`.
- the choice: `authored`, `publicWeb`, `book`, `fromPerson`, `cleared` or `publicConfirm`.
- the wording version, the locale, the action and the time.

The service writes the row in the write's transaction, after the version check. A refused write leaves no row. A clone
copies no attestations.

- **Wording versions** are closed lists in `recipe-core`: `STATEMENT_WORDINGS` and `PUBLIC_CONFIRM_WORDINGS`. The wire
  checks them with `z.enum`. A new wording is a new version. The version is the client's word that it showed this
  wording.
- **`publicConfirmation`** is REQUIRED on a request whose result becomes published and public:
    - create, published and public.
    - a PATCH that publishes a public draft.
    - set-visibility to public on a published recipe.

    Set-visibility to public on a draft accepts it and records it. A missing one is `400 INVALID_VISIBILITY`,
    `details.reason: 'PUBLIC_CONFIRMATION_REQUIRED'`. API writers (seeds, tests, k6) send
    `PUBLIC_CONFIRMATION_FOR_API_WRITERS`.

- **"From a cookbook or magazine"** is a `book` statement with a required citation. It forces Private. It writes
  evidence with `capture = 'editorCitation'`. A book source that was never published can be corrected
  (`sourceIsCorrectable`).
- **"From another person"** is a `fromPerson` attestation with no source kind. It forces Private. Spec 016 §15 adds
  the `family` and `adapted` kinds later. Then this choice sets one of them.
- Set-visibility takes a `statement`. Make public with an answer is one write.
- The import save does not carry wordings yet. It writes no attestation rows and needs no confirmation. The paste
  import adds one implicit row per item, all with the same wording.

### 5. Account erasure

- Erasure never donates a recipe that the evidence rule holds, or a recipe that needs a statement. Erasure deletes it
  with the owner-only set. Its evidence and attestations go by cascade.
- On a donated recipe, the attestation rows keep the choice, the wording, the locale and the time. Erasure replaces
  their `account_id` with one random token for the erasure: `erased_` and 32 hex characters. The trigger allows only
  this one UPDATE.
- **Owed in the next PR:** on donated recipes, `recipes.owner_id` and `recipe_versions.created_by` still hold the
  erased account's id. They get the same token.

### 6. Retention

An attestation is kept while its recipe is public, plus 6 years. Then it is deleted.

**Owed:** the purge job. Also owed: keeping the rows when a public recipe is hard-deleted. Today the cascade removes
them.

### 7. Deploy order

The schema runs ahead of the service (ADR-0035). In the time between the migration and the service deploy:

- writes from the old service that store a source fail the deferred evidence check at commit.
- the old service does not refuse a recipe with no statement on its way to Public.

Nothing is live, so we accept this window and add no shim.

## Consequences

- The old path is refused at every route to Public. That path was: state a link, remove it, go Public. The refusal is
  `SOURCE_CONFLICT`.
- Clients read three fields that only the owner sees:
    - `statementKind`.
    - `publicNeedsCheck`, from `sourceConflictOf`.
    - `publicNeedsStatement`, from `statementRequiredOf`.
- The statement sheet, the confirmation line and the Public-card note are designed separately. They ship on web and
  mobile together.
- Publishing will need the cook to be 16 or over. This change does not build that gate, and nothing here conflicts
  with it.
