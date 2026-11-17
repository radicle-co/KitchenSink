# Data Model: Public Versions of Imported Recipes

Recipe database. One migration plus its `_validate` twin (next free numbers at build time). Expand-only (ADR-0035).
Owner, migrator and service roles per ADR-0039. Every one-way door below goes in the feature ADR before code.
`db-arch-1` and `staff-architect` BLUEPRINT own the final column names.

## `recipe_source_records` (append-only, never shown)

One row per third-party import item (the page is `page_key`), written in the same transaction as the item's save or the job's creation. It is
the source of truth for this feature (FR-080). It extends ADR-0089 §6's evidence by reference and does not cascade from
a recipe, so it outlives the private copy and the public version (C-14). It holds no cook id: the job and the public version carry the
owner, and neither the fingerprint nor the monitoring count needs the cook. So erasure has nothing to sweep here, and the table goes
in `erasureSweepCoverage`'s `RETAINED_BY_RULING` map with this reason.

| Column                    | Type                 | Rule                                                                                                                                                                                                                          |
| ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid PK              |                                                                                                                                                                                                                               |
| `evidence_id`             | uuid NULL            | The ADR-0089 §6 evidence row, where one exists. Not a foreign key: the evidence row cascades away with its recipe, and this record outlives it.                                                                               |
| `source_key`              | text NOT NULL        | Registrable domain (Public Suffix List, by library), (the same key `016` uses for a source).                                                                                                                                  |
| `source_class`            | text NOT NULL        | CHECK in (`site`, `aggregator`, `paid_site`). Kept for monitoring. It changes no rule.                                                                                                                                        |
| `classification`          | text NOT NULL        | CHECK in (`open`, `thirdParty`, `paid`).                                                                                                                                                                                      |
| `classification_inputs`   | jsonb NOT NULL       | The signals read: statement kind, claim state, licence signal, paid signal (which of the three), publication date, signature status, list versions. Each signal is `stated`, `absent` or `unread`, and `unread` reads closed. |
| `fingerprint_format`      | smallint NOT NULL    | Format version of the hashing (R3).                                                                                                                                                                                           |
| `fingerprint_key_version` | smallint NOT NULL    | Version of the hash key. One keyring secret holds every version, rotation adds a version and never deletes one (ADR-0097 §4).                                                                                                 |
| `step_shingles`           | bigint[] NOT NULL    | Keyed hashes (first 8 bytes of an HMAC-SHA-256, as a signed bigint) of word 5-shingles of the source steps. Never the text.                                                                                                   |
| `title_shingles`          | bigint[] NOT NULL    | Keyed hashes of word 2-shingles of the source title.                                                                                                                                                                          |
| `title_hash`              | bigint NOT NULL      | Keyed hash of the normalised source title.                                                                                                                                                                                    |
| `page_key`                | text NOT NULL        | The normalised source address, `sourceLinkKey(url)` (`004`), as text. For a page with no date, the paid hold reads the earliest `recorded_at` per page (FR-017). Indexed.                                                     |
| `published_on`            | date NULL            | The page's own publication date, where its data states one.                                                                                                                                                                   |
| `recorded_at`             | timestamptz NOT NULL |                                                                                                                                                                                                                               |

Append-only for every role, by trigger, as the evidence record of ADR-0089 §6 does. No UPDATE, no DELETE except the retention purge.

## `public_version_jobs`

| Column                                    | Type              | Rule                                                                                                         |
| ----------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`                                      | uuid PK           |                                                                                                              |
| `source_record_id`                        | uuid NOT NULL     | FK `recipe_source_records`.                                                                                  |
| `page_key`                                | text NOT NULL     | Copied from the source record. One live job per page, across cooks (FR-034).                                 |
| `user_id`                                 | id NOT NULL       | The requester. 404 for anyone else.                                                                          |
| `import_item_id`                          | uuid NULL         | Set on the import path. NULL on the later route.                                                             |
| `private_recipe_id`                       | uuid NULL         | The Both path and the later route. FK `recipes` ON DELETE SET NULL.                                          |
| `private_digest`                          | char(64) NULL     | Digest of the private copy at writing time (FR-045).                                                         |
| `state`                                   | text NOT NULL     | CHECK in (`pending`, `writing`, `ready`, `checkRefused`, `budgetSpent`, `failed`, `cancelled`, `published`). |
| `attempts`                                | smallint NOT NULL | 0 to 3 (C-7).                                                                                                |
| `engine_version`                          | text NULL         | `{modelId}#{promptSha256}` of the call that wrote the output. Copied to the public version at Publish.       |
| `facts_snapshot`                          | jsonb NULL        | The facts sheet from import. Set to NULL at any terminal state.                                              |
| `output`                                  | jsonb NULL        | `{ title, steps[] }` from the writer and the title builder. Set to NULL at any terminal state.               |
| `created_at`, `claimed_at`, `finished_at` | timestamptz       | `finished_at` set iff terminal.                                                                              |

Indexes:

- `UNIQUE (page_key) WHERE state IN ('pending','writing','ready')`: one live job per source page. A second cook who collides is told there is a version on its way (`publicExists.writing`) and keeps Private.
- `(user_id, created_at)`: the cook's own job list.

A job expires lazily, in the data layer, in the same transaction before an insert and again on every read: a job in
`pending` or `writing` for more than 10 minutes becomes `failed`, and a job in `ready` for more than 24 hours becomes
`cancelled`. No timer process is needed, and a job nobody reads cannot hold its page key past the next insert for that page.

Finished jobs are deleted 7 days after `finished_at` by the existing retention sweeper. The table is user-keyed: add it
to `erasureSweepCoverage` and to the test-principal purge.

## State transitions (job)

```text
pending ──claimed by worker──────────────▶ writing
writing ──engine ok──────────────────────▶ ready           (output stored, reservation settled)
writing ──check refused, attempts < 2────▶ pending         (one automatic retry)
writing ──check refused again────────────▶ checkRefused    (terminal, "Try again" by hand makes a new attempt ≤ 3)
writing ──ceiling denial─────────────────▶ budgetSpent     (refund, ack, never redelivered)
pending|writing ──Stop───────────────────▶ cancelled       (a late result is dropped: writes need state IN pending, writing)
pending|writing ──10 min / maxReceive────▶ failed
ready ──Publish (server re-checks pass)──▶ published       (same transaction as the recipe insert)
ready ──Not now / flow ends──────────────▶ cancelled
```

## Columns on existing tables

- `recipes.source_record_id uuid NULL` and `recipes.source_page_key text NULL`: mark a public version. FK
  `recipe_source_records`, no cascade. A partial `UNIQUE (source_page_key) WHERE source_page_key IS NOT NULL` gives one
  public version per source page (FR-034) and is Publish's idempotency key. The key is released (set to NULL) in the same
  transaction as its cause: delete (the row goes), a 020 rejection, or a publisher opt-out
  (FR-034a).
- Provenance: a public version has `source_type = 'commise_written'`, no `source_kind` and no `statement_kind`. The
  existing `source_type` CHECKs gain the value. `public_web` + `imported_public` is wrong, because it reads as a web
  copy. One-way door, named in ADR-0097.
- The rights label "Steps written by Commise" (016-FR-015c) and the licence `cc-by-sa-4.0` are derived from
  `source_type` in `recipe-core` (`rightsLabelOf`, `licenceOf`). There is no column for either.
- Import item `choice text NULL CHECK in ('private','public','both')`. Not a new `visibility` value, which
  `importSchemaParity` pins.
- Allowance: the item's own unit covers the public version that its import path writes. The later route
  (`POST /api/v1/recipes/{recipeId}/public-version`) spends one unit on the new channel `publicVersion`, so the
  `import_allowance_events` channel CHECK gains that value (alongside `paste` and `bulk`).
- Monitoring counts public versions per `source_key` from `recipes.source_page_key` and the source records, for the
  rate alarm only. There is no per-source ledger and there are no caps (owner ruling 2026-11-15).
- Publish confirmation: one row in `recipe_statement_attestations` (ADR-0095): mode implicit, choice `publicConfirm`, action `create`, wording `publicVersionConfirm.v1`. Licence acceptance (FR-062) is that confirmation.
- Age confirmation at first publish: one row in the same table (ADR-0095), wording `ageConfirm.v1`. Identity sets the cook's age claim, `ageFloorMet`, from it (FR-016).

## Source evidence retained

ADR-0089 §6's evidence record holds no source steps, so a save under a key version the service cannot read cannot be
re-checked against retained text. It answers `422 rewriteNeeded` (FR-050a). This feature keeps no source text of its own.

## Not stored

The source steps and title text. The prompt. The model's raw answer. Logs carry outcome and refusal category only.
