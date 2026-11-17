# 0095: A recorded source is kept, and a recipe is public only with a statement the cook made

- **Status:** Accepted
- **Date:** 2026-11-15
- **Amends:** [ADR-0089](0089-a-pasted-web-link-sets-the-source-and-a-web-copy-stays-private.md) §6. Removing a source
  still leaves visibility alone. But the removed source stays on record and keeps the recipe out of Public.
- **Amends:** [ADR-0023](0023-curator-declared-provenance.md). A body with no statement no longer means "the cook wrote
  this". Spec 004 `004-FR-024` says "existing behaviour is unchanged". That is no longer true for publishing. The spec
  text is amended separately.
- **Relates to:**
    - [ADR-0093](0093-imported-recipes-go-public-only-as-a-commise-written-version.md): a copied recipe stays private
      until its Commise-written version ships, and source evidence is locked and append-only (§8). The evidence here is
      that record.
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
- **Append-only.** A trigger refuses UPDATE and DELETE for every role, and a statement trigger refuses TRUNCATE. A DELETE passes only for the recipe's
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

- `statement_kind`: `authored`, `source` or `fromPerson`. `NULL` means no statement.
- `content_pasted_at`: set when the cook pasted content.

CHECKs pair `authored` with `user_created` and no source kind. They pair a source kind with `source`.

- The create and PATCH `statement` is a union of `authored`, `public_web`, `book` and `fromPerson`.
- A curator's declared `user_created` counts as no statement.
- `statementRequiredOf` is in `recipe-core`. It is true if three things hold: the recipe is `user_created`, it has no
  statement, and a paste was seen or evidence exists. Its database twin is `recipe_needs_statement`.
- `evaluatePublishedState` takes `statementRequired` as a REQUIRED input. It refuses only a write that LEAVES the
  recipe published and public: `400 INVALID_VISIBILITY`, `details.reason: 'STATEMENT_REQUIRED'`.
- Drafts are public by default, so this rule never refuses a draft.
- The order of refusals is: containment, private-only, `sourceConflict`, `fromPerson`, `statementRequired`.
- After the ADR-0074 hold ships, `statementRequired` stays. A pasted recipe with "I wrote this" and evidence still meets
  `sourceConflict`. The two rules stay separate.
- The cook's statement stays editable after the first publish (ADR-0093 §8). The cook can state, change or clear it,
  through PATCH or set-visibility. A third-party statement still forces Private in the same write, writes its evidence
  and takes a private slot under the lock. Evidence is never cleared, so a recipe that holds evidence is still refused
  Public after the cook changes the statement to "I wrote this" (`SOURCE_CONFLICT`). Three locks stay: a source the
  curator declared, a source a clone inherited, and a source kind the service does not know.

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
§1. There is one row per act that showed the cook a wording. A row holds:

- the account.
- the mode, `explicit` or `implicit`.
- the choice: `authored`, `publicWeb`, `book`, `fromPerson`, `cleared` or `publicConfirm`.
- the wording version, the locale, the action and the time.

The service writes the row in the write's transaction, after the version check. A refused write leaves no row. A clone
copies no attestations, with one exception: the "from another person" fact (see that statement below).

- **Wording versions** are closed lists in `recipe-core`: `STATEMENT_WORDINGS` and `PUBLIC_CONFIRM_WORDINGS`. The wire
  checks them with `z.enum`. A new wording is a new version. The version is the client's word that it showed this
  wording.
- **`publicConfirmation`** is REQUIRED on a request whose result becomes published and public:
    - create, published and public.
    - a PATCH that publishes a public draft.
    - set-visibility to public on a published recipe.

    Set-visibility to public on a draft accepts it and records it. A missing one is `400 INVALID_VISIBILITY`,
    `details.reason: 'PUBLIC_CONFIRMATION_REQUIRED'`.

- **API writers send a marker, not a wording.** Seeds, tests and k6 send
  `PUBLIC_CONFIRMATION_FOR_API_WRITERS`, which is `{ apiWriter: true }`. The marker meets the confirmation duty and writes no
  attestation row, because no person saw a wording. Only a test principal can send it. A real cook who sends it gets
  `400 INVALID_VISIBILITY` with `details.reason: 'API_WRITER_CONFIRMATION_FORBIDDEN'`. The service checks this before any
  other rule.

- **"From a cookbook or magazine"** is a `book` statement with a required citation. It forces Private. It writes
  evidence with `capture = 'editorCitation'`. A book source can be corrected
  (`sourceIsCorrectable`).
- **"From another person"** is stored as `statement_kind = 'fromPerson'`, with no source kind. A stored `fromPerson`
  refuses Public at every route (`FROM_PERSON_PRIVATE_ONLY`), and erasure never donates it (`recipe_is_from_person`).
  A statement of `null` cannot clear it: the write is refused with `403 SOURCE_LOCKED`. A recipe whose statement is empty but
  that has a past `fromPerson` attestation row counts as `fromPerson` too. The rule is `fromPersonOf` in `recipe-core`, and its SQL
  twin is `recipe_is_from_person`.
  Spec 016 §15 adds the `family` and `adapted` kinds later. Then this choice sets one of them.
    - **It is sticky.** Once the cook says "from another person", the recipe and its clones stay out of Public until
      the cook makes an explicit statement that replaces it: "I wrote this" or a source. Saying "I wrote this", then
      clearing the statement, holds the recipe as another person's again. This is the cautious choice, and it is on purpose.
    - **A clone carries the fact.** When a recipe is held as "from another person" and its clone starts with no statement,
      migration `0090` copies the source's latest `fromPerson` row to the clone. The account, mode, choice, wording, locale,
      action and time are kept, and the row names the clone. So the clone is held at every route to Public, and erasure does not donate
      it. We chose the copy over reading the `cloned_from_id` chain because the clone then stands alone: deleting the source
      later changes nothing, and the one SQL rule stays one rule. No other attestation is copied.
- Set-visibility takes a `statement`. Make public with an answer is one write.
- **An explicit "I wrote this" in the same write meets the Public-confirmation duty.** Its own attestation row records
  the stronger act, so that write needs no `publicConfirmation`.
- On the recipe page, Make public always opens a dialog: the statement sheet, or a confirm dialog that shows the
  confirmation line. A confirmation is sent only from a screen that showed it.
- **The Source row's web link states a source with no wording.** The editor's Source row shows the cook no wording, so
  its `public_web` statement may omit one. The service then writes the source and its `editorLink` evidence, and no
  attestation row, because nothing was shown to attest. The sheet's "From a web page" sends the wording and is recorded
  as above. The other three statements still require a wording.
- The import save saves Private only. It carries no wording and writes no attestation row, so it cannot make a recipe
  public. An import that asks for Public is held for the cook, and the item shows the `visibilityRefused` issue. When the
  paste import carries wordings and writes one implicit row per item, it can offer Public.

### 5. Account erasure

- Erasure never donates a recipe that the evidence rule holds, or a recipe that needs a statement. Erasure deletes it
  with the owner-only set. Its evidence rows go by cascade.
- Erasure keeps every attestation row of the erased owner. Before it deletes any recipe, it replaces `account_id` on all
  of those rows with one random token for the erasure: `erased_` and 32 hex characters.
- The trigger allows this one UPDATE only while an `account_erasure_jobs` row for that account has the status `queued` or
  `running`. A reset of a test account uses the same swap (section 6).
- **Owed in the next PR:** on donated recipes, `recipes.owner_id` and `recipe_versions.created_by` still hold the
  erased account's id. They get the same token.

### 6. Retention

An attestation is kept while its recipe is public, plus 6 years. Then it is deleted.

- Migration `0090` adds `recipe_ref`. It always equals the id of the recipe that the row was written for. The foreign key
  on `recipe_id` is now `ON DELETE SET NULL`, so a deleted recipe leaves the row in place with `recipe_id` empty.
- The trigger allows one more UPDATE: `recipe_id` to empty, when the recipe is gone. It refuses every DELETE, for every role.
- A reset of a test account keeps the rows and swaps their `account_id` to an `erased_` token. The trigger allows that swap
  only for a registered test principal, and only while its reset is running.
- A hard delete by the cook keeps the rows. A soft delete keeps everything.
- Evidence rows keep their cascade. They go with the recipe.

**Owed:** the purge job.

**Known limit.** The two exceptions to append-only trust tables the service itself writes. The service role writes
`test_principals` and `test_reset_jobs`, and it starts erasure jobs. So the service role could mark an account as a test
account and start its reset, or start an erasure job, and then move that account's records to a token. The worst result is
that the record of who acted is lost. The record itself is never lost, because no role can delete a row. The triggers stop
mistakes in the code. They do not stop a service that is taken over.

**Follow-up.** The lasting fix is a separate database role for the workers. The trigger would check that role, so the service
role could not pass either exception.

### 7. Deploy order

The schema runs ahead of the service (ADR-0035). In the time between the migration and the service deploy:

- writes from the old service that store a source fail the deferred evidence check at commit.
- the old service does not refuse a recipe with no statement on its way to Public.

Nothing is live, so we accept this window and add no shim.

Migration `0090` pins `search_path` to `pg_catalog, public, pg_temp` on every trigger and rule function of the recipes
schema: the ones from `0086`, `0087` and `0088`, and the eight older ones. A LOCAL e2e check reads the catalog and fails for any
function that leaves the pin out. A role that can create temporary tables can no longer shadow `recipes` with its own table.

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
