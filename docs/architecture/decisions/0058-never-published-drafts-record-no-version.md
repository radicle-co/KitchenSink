# 0058 — A never-published draft is saved in place, and its versions start at the first publish

- **Status**: Accepted
- **Date**: 2026-10-08
- **Amends**: [ADR-0034](0034-recipe-save-and-version-row-are-atomic.md), its premise that every recipe write records a
  version. Its decision is untouched and still governs: a write and the version it records commit together.
  [ADR-0045](0045-ingredient-lookup-and-unresolved-foods.md), its clause that a rebind "makes a version". A rebind of a
  line on a never-published draft makes none.
- **Drivers**: Owner ruling D9 (`docs/design/uiOverhaul/ownerDecisions.md`). The ruling says: "Saves of a
  never-published draft overwrite it in place and create no version. Versions start at the first publish." The
  one-page editor of the UI overhaul (D1) saves a draft to the server at checkpoints.
- **Relates to**: [ADR-0057](0057-editor-device-draft-and-outbox-format.md), the editor's saving model. This decision
  makes its checkpoint cadence affordable.

## Context

ADR-0034 starts from a fact: every recipe write records an immutable `recipe_versions` row. The writes are create,
update, clone and restore. ADR-0034 deleted the one caller opt-out, the restore's `recordSnapshot: false`, as "an
opt-out of an invariant".

The overhaul's editor changes what a write is. It saves a new recipe to the server at checkpoints (blueprint A3). The
checkpoints are a section change, the app going to the background, the editor's exit, and ten seconds of idle typing.
Under ADR-0034 each checkpoint makes a version. Postgres keeps the newest ten (`VERSION_RETENTION_LIMIT`) and sends the
rest to the S3 archive outbox. So one sitting on a first draft pushes ten versions of half-typed text through the
window, and the archive stores every one. That history records typing, and a cook has no use for it.

Nobody else has seen an unpublished draft. Undo inside the editor is the editor's job. So a draft that was never
published has no history worth keeping.

## Decision

**After its first publish, every write of a recipe records a version. Before it, no write does.** The table gives
each write path:

| Write                                                     | Version row                                     |
| --------------------------------------------------------- | ----------------------------------------------- |
| Create as a draft                                         | None                                            |
| Save of a draft that was never published                  | None. The row is overwritten in place.          |
| Rebind of a line on a draft that was never published      | None                                            |
| Publish (create as published, or a draft's first publish) | One, numbered at the version the write produced |
| Any save of a published recipe                            | One, as before                                  |
| Any save of a published recipe that was set back to draft | One, as before                                  |
| Clone (always created published)                          | One, as before                                  |
| Restore (needs a version, so only a published recipe)     | One, as before                                  |
| Rebind on a published recipe                              | One, as before                                  |

Four rules keep this safe:

1. **The fact is `first_published_at`, never `status`.** The API lets a cook set a published recipe back to draft
   with `PATCH { status: 'draft' }`. A rule keyed on status lets the saves of that recipe overwrite its published
   history in place. So migration 0053 adds `recipes.first_published_at`. It is `NULL` until the first publish, it is
   set then, and it never changes after.
2. **The database owns the fact.** A trigger, `recipes_first_published_at_ratchet`, sets the column on the first
   publish for every writer. The writers are the service's DAL and every tool that inserts recipes directly. The
   trigger raises `check_violation` on any later change. It is a trigger and not a CHECK, because "never changes"
   compares OLD with NEW, and a CHECK sees only NEW. A CHECK, `recipes_published_has_first_published_at`, states the
   rule a published row must meet. No application code writes the column.
3. **One pure predicate decides, from the row the write returned, inside the write's transaction.** The predicate is
   `recordsVersion` (`recipes/domain/versionPolicy.ts`). `RecipesService.recordSnapshotIn` calls it, at the one point
   where create, update, clone, restore and rebind meet. No caller can ask for a skip. The opt-out ADR-0034 deleted was
   a caller's choice. This is a property of the stored row, so it does not bring that opt-out back.
4. **`current_version` still moves on every write.** It is the compare-and-swap token between devices. So the
   service still refuses a stale save of a draft with `409 VERSION_CONFLICT`. Only the history row is skipped. The
   retention pass is skipped with it, because it has nothing new to judge.

ADR-0034's atomicity holds wherever a version is recorded. The write and its version row commit together or not at
all, and nothing swallows a failure.

## Consequences

- **Version numbers have gaps.** A recipe's first version takes the number its first publish produced. After six
  draft saves, that number is 7. Clients address versions by number and read the list newest first. Nothing expects
  the numbers to start at 1 or to run without gaps.
- **A conflict on a never-published draft carries no `base`.** The enriched 409 reads the base snapshot from
  `recipe_versions`, and a draft has none there. `base` was already optional, because retention can evict it, so no
  client breaks. The client's conflict view reads a missing base as a base evicted from history (`conflictView.ts`).
  That text is wrong for a draft. The slice 7 editor owes a draft's conflict its own text.
- **A draft's unpublished edits have no server history.** This is the decision, not a residual.
- **The account export carries `firstPublishedAt`.** It is a stored fact about the cook's recipe, and the export is
  a full copy of the row.
- **A clone of a draft is created PUBLISHED.** `clone` sets no status, so the column default applies. That was true
  before this decision, and the copy now also records version 1. This decision does not answer whether a copy of a
  cook's own draft must publish. That is a product question.

## Alternatives rejected

- **Key the skip on `status = 'draft'`.** It is wrong for a published recipe set back to draft. The saves of that
  recipe overwrite its published history in place.
- **Derive "published at some time" from the presence of a version row.** That makes the version table the
  publication ledger. It also ties the rule to retention never emptying a recipe's history, and it gives a client
  nothing to read.
- **A flag from the caller ("checkpoint, do not version").** That is the opt-out ADR-0034 deleted. With it, any
  caller can write a published recipe with no version.
- **Keep versions for drafts, and make the checkpoints slower.** That makes fewer versions per sitting, but they are
  still versions of typing. A slower cadence also loses more of a draft on a crash.

## Verification

- `recipes/domain/__tests__/versionPolicy.test.ts` tests the predicate, with the re-drafted case.
- `recipes/__tests__/recipes.service.test.ts`, block "a never-published draft records no version (ADR-0058)",
  proves that the decision reads the returned row and not the pre-read.
- `__tests__/integration/recipes/draftVersioning.integration.test.ts` runs the real HTTP pipeline with the DALs
  mocked. It proves that a draft skips both the version row and the retention pass, and a published recipe makes both.
- `tests/e2e/draftVersions.e2e.test.ts` is LOCAL e2e on a real Postgres. It proves these facts:
    - The migration applied.
    - The trigger sets and keeps the column for a writer that never names it.
    - The saves and rebinds of a draft write no row, and `current_version` moves.
    - A stale draft save is a 409.
    - The first publish writes one row, at the version it produced.
    - A re-drafted recipe keeps its versions.
