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

| Column                    | Type                 | Rule                                                                                                                                                                   |
| ------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid PK              |                                                                                                                                                                        |
| `evidence_id`             | uuid NULL            | The ADR-0089 §6 evidence row, where one exists. No cascade.                                                                                                            |
| `source_key`              | text NOT NULL        | Registrable domain (Public Suffix List, by library), (the same key `016` uses for a source).                                                                           |
| `source_class`            | text NOT NULL        | CHECK in (`site`, `aggregator`, `paid_site`). Kept for monitoring. It changes no rule.                                                                                 |
| `classification`          | text NOT NULL        | CHECK in (`open`, `thirdParty`, `paid`).                                                                                                                               |
| `classification_inputs`   | jsonb NOT NULL       | The signals read: statement kind, claim state, licence signal, paid signal (which of the three), publication date, signature status, list versions.                    |
| `fingerprint_format`      | smallint NOT NULL    | Format version of the hashing (R3).                                                                                                                                    |
| `fingerprint_key_version` | smallint NOT NULL    | Version of the hash key.                                                                                                                                               |
| `step_shingles`           | bigint[] NOT NULL    | Keyed hashes of word 5-shingles of the source steps. Never the text.                                                                                                   |
| `title_shingles`          | bigint[] NOT NULL    | Keyed hashes of word 2-shingles of the source title.                                                                                                                   |
| `title_hash`              | bigint NOT NULL      | Keyed hash of the normalised source title.                                                                                                                             |
| `page_key`                | bytea NOT NULL       | SHA-256 of the normalised source address (`sourceLinkKey`, `004`). For a page with no date, the paid hold reads the earliest `recorded_at` per page (FR-017). Indexed. |
| `published_on`            | date NULL            | The page's own publication date, where its data states one.                                                                                                            |
| `recorded_at`             | timestamptz NOT NULL |                                                                                                                                                                        |

Append-only for every role, by trigger, as the evidence record of ADR-0089 §6 does. No UPDATE, no DELETE except the retention purge.

## `public_version_jobs`

| Column                                    | Type              | Rule                                                                                                         |
| ----------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`                                      | uuid PK           |                                                                                                              |
| `source_record_id`                        | uuid NOT NULL     | FK `recipe_source_records`.                                                                                  |
| `page_key`                                | bytea NOT NULL    | Copied from the source record. One live job per page, across cooks (FR-034).                                 |
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

- `UNIQUE (page_key) WHERE state IN ('pending','writing','ready')`: one live job per source page. A second cook who collides is told there is a version on its way (`exists.pending`) and keeps Private.
- `(user_id, created_at)`: the cook's own job list.

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

- `recipes.source_record_id uuid NULL` and `recipes.source_page_key bytea NULL`: mark a public version. FK
  `recipe_source_records`, no cascade. A partial `UNIQUE (source_page_key) WHERE source_page_key IS NOT NULL` gives one
  public version per source page (FR-034) and is Publish's idempotency key.
- `recipes` rights label input: a new derived label "Steps written by Commise" (016-FR-015c). One-way door.
- `recipes.licence`: the union gains `cc-by-sa-4.0` (016 data-model §11). One-way door.
- Provenance pair: a public version needs its own `source_type` and `source_kind` pairing in the
  `recipes_source_kind_pairs_source_type` CHECK. `public_web` + `imported_public` is wrong, because it reads as a web
  copy. One-way door, named in the ADR.
- Import item `choice text NULL CHECK in ('private','public','both')`. Not a new `visibility` value, which
  `importSchemaParity` pins.
- Monitoring counts public versions per `source_key` from `recipes.source_page_key` and the source records, for the
  rate alarm only. There is no per-source ledger and there are no caps (owner ruling 2026-11-15).
- Licence acceptance at Publish: one row in 016's acceptance record with the terms version (FR-062).

## Not stored

The source steps and title text. The prompt. The model's raw answer. Logs carry outcome and refusal category only.
