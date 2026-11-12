# 0090: An ingredient line's source text is shown only to the cook who transcribed it

- **Status**: Accepted
- **Date**: 2026-11-11
- **Drivers**: The editor shows a cook "You wrote: …" beside a line that the verification gate did not confirm. That
  text is `ingredients.source_line`. It is the line exactly as the cook pasted or imported it. It is verbatim copied
  text, and a clone copies it.
- **Relates to**:
    - [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md) §2. No line of
      another page goes word for word onto a public form.
    - [ADR-0023](0023-curator-declared-provenance.md). It makes `sourceLine` a create-only request field.
    - [ADR-0026](0026-two-engine-ingredient-parse-pipeline.md). The gate judges the text, so a clone keeps it.
    - [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md). Migrations are expand-first.
    - [ADR-0058](0058-never-published-drafts-record-no-version.md). A clone is born a draft, so it writes no version.
    - [ADR-0072](0072-bulk-recipe-import.md). Bulk import is a future writer of lines.
    - `specs/003A-signed-out-reading/contracts/publicRecipeRead.md`. The strict public view never carries the field.

## Context

The recipe detail read carries `RecipeIngredientView.sourceLine`. One pure Specification decides who receives it:
`recipe-service/src/recipes/domain/transcriptionDisclosure.ts`. The detail assembler calls it once per read. The
response mapper is typed so that it does not see the column. The first version of the rule had one condition: the
viewer owns the recipe.

That condition is not enough. `toClonedLineInput` copies `source_line`, `source_phrase` and the stated measure onto a
clone. It must copy them. The gate judges the text, and `verificationKey` hashes it. A clone without the text is never
verified, and its verdicts stop matching the source's verdicts. But the cloner owns the clone. So "the owner sees the
text" shows the cloner another cook's verbatim words, on a recipe that the cloner can publish.

Two simpler fixes fail:

- **Lineage.** A rule such as "the owner sees it, unless the recipe is a clone" reads `cloned_from_id`. Account erasure
  sets that pointer to NULL on each surviving clone of an erased cook's removed recipes (`eraseRecipeRows`, step 5).
  The test-principal purge does the same (`purgeTestPrincipalRows`, step 2). Then the rule changes its answer for a
  recipe that nobody touched, and it changes toward disclosure. `publishPolicy.ts` records the same trap.
- **A look at the source at read time.** The source can be gone, private or erased. There is no reliable thing to read.

Only one fact decides disclosure: who supplied the text. Only the write of the line knows that fact.

## Decision

### 1. The boundary and its rule

Migration 0072 adds `ingredients.source_line_transcribed_by_owner boolean NOT NULL DEFAULT false`. It records whether
the recipe's owner supplied the line's `source_line`. A database constraint refuses TRUE on a line with no text.

The rule lives in `transcriptionDisclosure.ts` and nowhere else:

> If the viewer owns the recipe AND the owner transcribed that line, the response shows the line's source text.

`transcriptionAudienceOf` decides ownership once per read. `disclosedSourceLine` reads the flag. It is the only function
that reads a line. An unknown viewer is a reader. An unknown writer is FALSE. So both halves fail closed.

The response mapper's row type omits `sourceLine`, `sourcePhrase` and the flag. The flag adds no wire field. (This
change does add `sourceLine` to the response, for the owner only.)

### 2. Who writes the flag

All lines reach the table through one writer: `IngredientLinesDal.replaceForRecipe`. The flag is a REQUIRED field of
`IngredientLineInput`, so each path that writes a line must state it. The flag is not derived from the text, because
a clone copies the text.

| Path                                                                                       | Value                                                                                                             |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Create (`POST /api/v1/recipes`): the editor, paste, the cookbook importer and the e2e seed | TRUE on a line with `sourceLine`. The caller becomes the owner.                                                   |
| Update (`PATCH /api/v1/recipes/{id}`), and the rebind and version restore that use it      | Carried with the text by `transcriptionCarryForward.ts`, from the same stored line. If nothing is carried, FALSE. |
| Clone of another cook's recipe                                                             | FALSE. The text is still copied.                                                                                  |
| Clone of the cook's own recipe                                                             | The source line's value. It is never raised.                                                                      |

`POST /api/v1/import` (ADR-0072) is not on this branch. When it lands, it uses the same writer, and the required field
makes it state the value. For the cook's own import the value is TRUE, as for a create.

A version restore does not bring a flag back from history. A snapshot carries neither the text nor the flag. A restore
is an update, so each restored line takes the flag of the current line it matches, or FALSE.

### 3. The closed paths

The text reaches no other surface. That includes a list item, a search result, a collection, a rating answer to
another cook, a version snapshot and 003A's strict `PublicRecipeView`. The integration test
`__tests__/integration/recipes/sourceLineDisclosure.integration.test.ts` tests each one on the raw response text.

### 4. Donation at erasure

The erasure donation (`eraseRecipeRows`, step 1) changes the `visibility` and the `status` of an elected recipe, and
nothing else. `owner_id` stays the ULID of the erased cook, who can never sign in again. No other code writes
`recipes.owner_id` after the insert. So ownership moves to no living cook and to no system owner. A cook who reads a
donated recipe is a reader. A cook who clones it gets FALSE.

### 5. The backfill

Prod already holds recipes whose owners pasted their lines. With DEFAULT FALSE alone, those owners do not see their
own lines. So migration 0072 sets TRUE where it can PROVE that the owner wrote the line. It leaves FALSE everywhere else.

On this branch, no clone marker survives a detach. A clone is a draft, so it writes no version row (ADR-0058).
`source_type`, `has_substantive_edit` and `bound_by` do not identify a clone. So the proof uses time:

- A detach changes only a clone that already exists at the time of the detach.
- Each such run leaves a job row. `account_erasure_jobs` is the legal record of an erasure, and nothing deletes it.
  Erasure deletes `test_reset_jobs` rows (step 15), but each of those is older than the erasure job that deleted it.
- Each job write after a detach sets `updated_at`. A job that is still queued or running counts as unbounded, because
  its detach can be committed already.

> TRUE where `source_line IS NOT NULL`, `cloned_from_id IS NULL`, and the recipe was created after the latest erasure
> or purge job was touched. With no job rows, there is no time limit.

A completed erasure replay runs the detach again and does not touch the job row. This is safe: the erased account
cannot write, so its owner-only set is already empty, and the replay detaches nothing.

### 6. The premise this reverses

`recipe-core` (`statedMeasure.ts`, `nutrition.ts` and `recipe.types.ts`) called `source_line` "write-side provenance"
that the gate reads and that no cook sees. The clone path called it "a fact about the SOURCE, not about the author",
so it travelled with the line like `display_text`.

The first claim no longer holds. The owner who wrote a line now sees it. The second claim holds for the TEXT but not
for its AUTHORSHIP. The text is a fact about the source, and it travels with a clone. Who supplied it is a fact about
the writer of the line, and it does not travel. This record adds that second fact.

## Consequences

- A cook sees "You wrote: …" only on lines that they pasted or imported. A cook who clones another cook's recipe sees
  the line's verdict, but not the other cook's words.
- Lineage stays out of the rule. An erasure elsewhere does not change what a living cook sees.
- The backfill fails closed in two known places. The first is an owner's recipe created before the latest erasure or
  purge job. The second is each self-clone made before migration 0072. Those owners do not see their pasted lines. A
  durable `recipes.is_clone` fact lets a later migration prove more of them.
- The migration is expand-only. The release before this one writes FALSE. It also inserts every line of a recipe
  again on every save. So a save that it serves after the migration, even a title edit, sets that recipe's flags back
  to FALSE. This window fails closed. It never shows a cook text that they did not write, but it hides an owner's own
  lines. The backfill UPDATE is idempotent, so the deploy can run it again after the new release serves.
- The flag records who supplied the text for the owner AT WRITE TIME. Any future ownership transfer of a recipe must
  reset the flag to FALSE on every line, or the new owner reads the old owner's words.
- A new writer of `ingredients` lines must state the flag, because the field is required. A new read surface reads
  `source_line` only through `disclosedSourceLine`.
