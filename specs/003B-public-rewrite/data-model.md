# Data Model: Public Versions of Imported Recipes

Recipe database. One migration plus its `_validate` twin (next free numbers at build time). Expand-only (ADR-0035).
Owner, migrator and service roles per ADR-0039. Every one-way door below goes in the feature ADR before code.

## `recipe_source_records` (append-only, never shown)

One row per third-party import item (the page is `page_key`), written in the same transaction as the item's save or the job's creation. It is
the source of truth for this feature (FR-080). It extends ADR-0089 §6's evidence by reference and does not cascade from
a recipe, so it outlives the private copy and the public version (C-14). It holds no cook id: the job and the public version carry the
owner, and neither the fingerprint nor the monitoring count needs the cook. So erasure has nothing to sweep here, and the table goes
in `erasureSweepCoverage`'s `RETAINED_BY_RULING` map with this reason.

| Column                    | Type                 | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid PK              |                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `evidence_id`             | uuid NULL            | The ADR-0089 §6 evidence row, where one exists. Not a foreign key: the evidence row cascades away with its recipe, and this record outlives it. Indexed: `hasSourceRecord` and the later route read it.                                                                                                                                                                                                                                           |
| `source_key`              | text NOT NULL        | Registrable domain (Public Suffix List, by library), (the same key `016` uses for a source). It is not the evidence record's `source_key`, which is the normalised page address (`page_key` here).                                                                                                                                                                                                                                                |
| `source_class`            | text NOT NULL        | CHECK in (`site`, `aggregator`, `paid_site`). Kept for monitoring. It changes no rule.                                                                                                                                                                                                                                                                                                                                                            |
| `classification`          | text NOT NULL        | CHECK in (`open`, `thirdParty`, `paid`). `paid` only for a clearly read paid signal (`isAccessibleForFree` false, or a metered paywall). A page on the paid list with no clear signal, and every `unknown` signal, is `thirdParty` (FR-012b).                                                                                                                                                                                                     |
| `classification_inputs`   | jsonb NOT NULL       | The signals read: statement kind, claim state, licence signal, paid signal (`isAccessibleForFree` false or metered paywall; the paid-list domain is a separate input, not a signal), publication date, signature status, list versions. Each signal is `stated`, `absent` or `unread`. For the open test, `unread` reads as third-party. For the paid, opt-out and signature signals, `unread` is `unknown` and takes the rewrite path (FR-012b). |
| `fingerprint_format`      | smallint NOT NULL    | Format version of the hashing (R3).                                                                                                                                                                                                                                                                                                                                                                                                               |
| `fingerprint_key_version` | smallint NOT NULL    | Version of the hash key. One keyring secret holds every version, rotation adds a version and never deletes one (the feature ADR, owed (T004)).                                                                                                                                                                                                                                                                                                    |
| `step_shingles`           | bigint[] NOT NULL    | Keyed hashes (first 8 bytes of an HMAC-SHA-256, as a signed bigint) of word 5-shingles of the source steps. Never the text.                                                                                                                                                                                                                                                                                                                       |
| `title_shingles`          | bigint[] NOT NULL    | Keyed hashes of word 2-shingles of the source title.                                                                                                                                                                                                                                                                                                                                                                                              |
| `title_hash`              | bigint NOT NULL      | Keyed hash of the normalised source title.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `page_key`                | text NOT NULL        | The normalised source address, `sourceLinkKey(url)` (`004`), as text. For a page with no date, the paid hold reads the earliest `recorded_at` per page (FR-017). Indexed.                                                                                                                                                                                                                                                                         |
| `published_on`            | date NULL            | The page's own publication date, where its data states one.                                                                                                                                                                                                                                                                                                                                                                                       |
| `language`                | text NULL            | BCP 47 primary subtag of the source's language (2 or 3 lower-case letters), set at the import save (FR-012c). NULL when the language could not be decided with confidence (`languageUncertain`). A decided language the platform cannot handle is still stored as decided (FR-012c step 6), and the offer reads it as `languageUnsupported` when no language profile exists for it. A CHECK allows only `^[a-z]{2,3}$`.                           |
| `recorded_at`             | timestamptz NOT NULL |                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Append-only for every role, by trigger, as the evidence record of ADR-0089 §6 does. No UPDATE, no DELETE except the retention purge. Indexes: `page_key` and `evidence_id`.

## `public_version_jobs`

| Column                                                        | Type              | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                          | uuid PK           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `source_record_id`                                            | uuid NOT NULL     | FK `recipe_source_records`.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `page_key`                                                    | text NOT NULL     | Copied from the source record. One live job per page, across cooks (FR-034).                                                                                                                                                                                                                                                                                                                                                                                                         |
| `user_id`                                                     | id NOT NULL       | The requester. 404 for anyone else.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `import_item_id`                                              | uuid NULL         | Set on the import path. NULL on the later route.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `private_recipe_id`                                           | uuid NULL         | The Both path and the later route. FK `recipes` ON DELETE SET NULL.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `private_digest`                                              | char(64) NULL     | Digest of the private copy at writing time (FR-045). Set on the Both path and on the later route.                                                                                                                                                                                                                                                                                                                                                                                    |
| `state`                                                       | text NOT NULL     | CHECK in (`pending`, `writing`, `ready`, `checkRefused`, `budgetSpent`, `failed`, `cancelled`, `published`).                                                                                                                                                                                                                                                                                                                                                                         |
| `attempts`                                                    | smallint NOT NULL | 0 to 3 (C-7). Each claim from `pending` to `writing` adds one.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `engine_version`                                              | text NULL         | `{modelId}#{promptSha256}` of the call that wrote the output. Copied to the public version at Publish.                                                                                                                                                                                                                                                                                                                                                                               |
| `facts_snapshot`                                              | jsonb NULL        | The facts sheet from import (or, on the later route, from the private copy). Cleared only on entering a terminal state (see below).                                                                                                                                                                                                                                                                                                                                                  |
| `source_steps`                                                | jsonb NULL        | `{ text }[]`: the source step text the writer reads (FR-030, `027-FR-035`). A Snapshot beside `facts_snapshot`, filled at Start from the same read: on the public path from the import item's parsed steps, on the Both path and the later route from the private copy's steps. Rebuilt with `facts_snapshot` on `privateCopyChanged`. Cleared in the same UPDATE as `facts_snapshot` and `output` at every terminal state and on cancel. Never returned by a read and never logged. |
| `output`                                                      | jsonb NULL        | `{ title, steps[] }` from the writer and the title builder. Cleared only on entering a terminal state.                                                                                                                                                                                                                                                                                                                                                                               |
| `created_at`, `claimed_at`, `state_changed_at`, `finished_at` | timestamptz       | `state_changed_at` is set on every transition and starts every expiry window below. `finished_at` set iff terminal.                                                                                                                                                                                                                                                                                                                                                                  |

Indexes:

- `UNIQUE (page_key) WHERE state IN ('pending','writing','ready')`: one live job per source page. A second cook who collides is told there is a version on its way (`publicExists.writing`) and keeps Private. A job re-entering `pending` meets the same index, and a collision there answers `409 publicExists`.
- `(user_id, created_at)`: the cook's own job list.

Every expiry counts from `state_changed_at`, so a retry starts a fresh window. A job expires lazily, in the data layer, in the same transaction before an insert and again on every read: a job in
`pending` or `writing` for more than 10 minutes becomes `failed`, and a job in `ready` for more than 24 hours becomes
`cancelled`, and so is a `checkRefused` or `failed` job after 24 hours, resting (fewer than 3 attempts) or final (3 attempts). A sweep on the band drain's existing 15-minute tick (`bandDrain.ts` in recipe-workers, beside `purgeFinishedImports` and the parse-job sweep) runs the same expiry function the reads use, and also clears the import item's draft step text of a finished public-path job 24 hours after its `state_changed_at`. It follows ADR-0072's purge rules: its own transaction, `FOR UPDATE SKIP LOCKED`, and it runs even if an earlier sweep failed. Every tick publishes the age of the oldest expired job with `Stage` (ADR-0062), and a behind alarm, `PublicVersionJobSweepBehindAlarm`, is styled like `BulkImportPurgeBehindAlarm`. It adds no Lambda, no schedule rule and no NAT consumer. So a job nobody reads cannot hold its page key or its text: the pasted text lives about 3 days after the cook's last action, inside the 30 days of ADR-0072.

Finished jobs are deleted 7 days after `finished_at` by the existing retention sweeper. The table is user-keyed: add it
to `erasureSweepCoverage` and to the test-principal purge.

## State transitions (job)

```text
pending ──claimed by worker──────────────▶ writing         (attempts + 1)
writing ──re-claim after a transport failure──▶ writing    (no attempt spent, state_changed_at unchanged, claimed_at updated)
writing ──engine ok──────────────────────▶ ready           (output stored, reservation settled)
writing ──check refused, attempts < 2────▶ pending         (automatic retry)
writing ──check refused, attempts >= 2───▶ checkRefused    (rests while attempts < 3, terminal at 3)
writing ──ceiling denial─────────────────▶ budgetSpent     (refund, ack, never redelivered)
pending|writing ──Stop (Both path, or no slot)──▶ cancelled       (a late result is dropped: writes need state IN pending, writing; with a slot on the public-only path Stop is keepPrivate)
pending|writing ──10 min / maxReceive────▶ failed          (rests while attempts < 3, terminal at 3)
ready ──Publish (server re-checks pass)──▶ published       (same transaction as the recipe insert)
ready ──Not now / 24 h───────────────────▶ cancelled
ready ──"Write it again" (422 flags, 422 tooSimilar, 409 privateCopyChanged)──▶ pending   (attempts < 3)
checkRefused ──"Try again"───────────────▶ pending         (attempts < 3)
checkRefused ──24 h (attempts < 3)───────▶ cancelled
failed ──"Try again"────────────────────▶ pending         (attempts < 3)
failed ──24 h (attempts < 3)─────────────▶ cancelled
checkRefused|failed ──24 h (attempts = 3)────▶ cancelled        (the job's own text is already cleared)
pending|writing|ready|checkRefused|failed ──cancel (failed.done on the Both path, review.discard and the reused cancel on the public-only path, Stop and Back with no slot)──▶ cancelled
budgetSpent ──cancel──▶ budgetSpent   (already terminal: only the item draft clears)
pending|writing|ready ──keepPrivate (For everyone path only, charges the unit)──▶ cancelled   (failed, checkRefused and budgetSpent keep their state; published answers 409 notKeepable)
```

Rules:

- The retry route (`POST /api/v1/public-version-jobs/{jobId}/retry`) makes `ready`, `checkRefused` and `failed` to
  `pending`. It answers `409 attemptsUsed` at 3 attempts. Re-entering `pending` meets the partial
  unique index, and a collision answers `409 publicExists`. A job in `pending`, `writing`, `published`, `cancelled` or
  `budgetSpent`, or whose import item already records a recipe id (keepPrivate ran), answers `409 notRetryable`; that condition holds for every "Try again" edge above. Attempts carry over a retry, and a retry spends no allowance unit.
- `failed` rests like `checkRefused`: it keeps `facts_snapshot`, `source_steps` and `output` while attempts < 3, can be
  retried or cancelled, expires to `cancelled` after 24 hours, and is final at 3 attempts. The cancel route accepts
  every state in the transition list above, and clears the snapshots in the same UPDATE.
- The claim is one conditional UPDATE: state `pending`, or state `writing` with `claimed_at` older than the visibility
  timeout. Only a claim from `pending` adds an attempt. A transport failure is not acked, so the message returns and the
  re-claim `writing` to `writing` spends no attempt and leaves `state_changed_at` alone, so the 10-minute window is not
  extended.
- After `privateCopyChanged` the re-entry rebuilds `facts_snapshot`, `source_steps` and `private_digest` from the changed private copy.
- A Publish that answers `503 checkUnavailable` leaves the job `ready` and spends no attempt.
- `facts_snapshot`, `source_steps` and `output` are cleared only on entering a terminal state: `published`,
  `cancelled`, `budgetSpent`, `failed` at 3 attempts, or `checkRefused` at 3 attempts. They are kept while "Write it
  again" or "Try again" can still happen. The import item's draft step text follows FR-033: it clears only on Publish, keepPrivate, cancel or the sweep, while the job's text columns clear at a final state.
- keepPrivate (`POST /api/v1/public-version-jobs/{jobId}/keepPrivate`) applies to the public-only path (`import_item_id` set, `private_recipe_id` NULL). One transaction: the DD33 lock, save the item's draft as a private recipe, record the recipe id on the item, cancel the job (a `failed`, `checkRefused` or `budgetSpent` job keeps its state), and set `source_steps`, `facts_snapshot`, `output` and the draft step text to NULL. It charges the paste's one unit in the same transaction, guarded by `recipe_import_items.allowance_spent_at` (the conditional UPDATE and `admit` of FR-016a). A refusal by `admit` rolls everything back (`429 IMPORT_QUOTA_EXCEEDED`), and so does no free slot (`403 PRIVATE_SLOTS_FULL`, nothing charged). The route is checked in this order: an item that already records a recipe id answers `200` with it; a `cancelled` or `published` job answers `409 notKeepable`.
- Every pair of states that this list does not name is refused.

## Columns on existing tables

- `recipes.public_credit text NULL`: the credit a public version carries, set in the Publish transaction from the
  credit the cook was shown and the server compared (FR-035). CHECK in (`free`, `paid`), and CHECK `public_credit IS
NOT NULL` if and only if `source_type = 'commise_written'`. Both are `NOT VALID` then `VALIDATE` (expand-only). The
  display reads this column: `free` shows `credit.basedOn` with the site read through `source_record_id` to the
  record's `source_key`, and `paid` reads no site (FR-060, FR-018). One-way door, named in the feature ADR, owed (T004).
- `recipes.source_record_id uuid NULL` and `recipes.source_page_key text NULL`: mark a public version. FK
  `recipe_source_records`, no cascade. A partial `UNIQUE (source_page_key) WHERE source_page_key IS NOT NULL` gives one
  public version per source page (FR-034) and is Publish's idempotency key. The key is released (set to NULL) in the same
  transaction as its cause: delete (the row goes), a 020 rejection, or a publisher opt-out
  (FR-034a).
- Provenance: a public version has `source_type = 'commise_written'`, no `source_kind` and no `statement_kind`. The
  existing `source_type` CHECKs gain the value. `public_web` + `imported_public` is wrong, because it reads as a web
  copy. One-way door, named in the feature ADR, owed (T004).
- The rights label "Steps written by Commise" (016-FR-015c) and the licence `cc-by-sa-4.0` are derived from
  `source_type` in `recipe-core` (`rightsLabelOf`, `licenceOf`). There is no column for either.
- Import item `choice text NULL CHECK in ('private','public','both')`. Not a new `visibility` value, which
  `importSchemaParity` pins.
- Allowance: a paste spends its one unit only at save, in the transaction of whichever save ends it in a recipe (keepPrivate, Publish, the import pipeline's private save, or the Both path's private save in Start), guarded by
  `recipe_import_items.allowance_spent_at` (FR-016a). Making a public version spends no unit of its own, on the import
  path or on the later route (`POST /api/v1/recipes/{recipeId}/public-version`). Cancel, expiry and the sweep spend
  nothing. `import_allowance_events` and its channel CHECK are unchanged.
- Item channel: `recipe_import_items.channel text NOT NULL DEFAULT 'bulk' CHECK (channel IN ('bulk', 'paste'))`. The paste flow sets `paste` when it creates an item, and every existing and bulk item reads `bulk`. A constant default makes the add cheap and expand-only (ADR-0035).
- Check relaxed: `recipe_import_items_job_needs_payment` (`parse_job_id IS NULL OR allowance_spent_at IS NOT NULL`, migration 0059) becomes `parse_job_id IS NULL OR allowance_spent_at IS NOT NULL OR channel = 'paste'`. It is relaxed for paste items only, because a paste's extraction no longer pays and its parse job exists before the unit is spent. A bulk item still pays when its lines are sent, so the CHECK keeps holding for it. `NOT VALID` then `VALIDATE` (ADR-0035).
- Recipe read, owner only: `hasSourceRecord` (boolean, no column). True when a `recipe_source_records` row exists
  whose `evidence_id` equals this recipe's evidence row (several rows: the latest `recorded_at`, which the later route
  uses). Only an import writes a source record. An edit in the editor never does. Omitted for any other viewer.
- Monitoring counts public versions per `source_key` from `recipes.source_page_key` and the source records, for the
  rate alarm only. There is no per-source ledger and there are no caps (owner ruling 2026-11-15).
- Publish confirmation: one row in `recipe_statement_attestations` (ADR-0095, PR #301, not merged): mode implicit, choice `publicConfirm`, action `create`, wording `publicVersionConfirm.v1`. Licence acceptance (FR-062) is that confirmation.

## Identity

Identity's database gains the `age_assurances` table now, as defined in `specs/016-legal-compliance-framework/data-model.md` §3 (FR-016, FR-016b). This feature writes `basis = self_attested`, `floor_met = 16`, `wording_version = ageConfirm.v1` and the cook's `locale`. Account erasure
deletes the row, and the erasure coverage test covers it. The Clerk claim `public_metadata.ageFloorMet` (the integer `16`) is set after the
row is written. Recipe-service holds no age data. `clerk-verify` parses the claim into the `Principal` field `publishAgeMet`.

## Source evidence retained

ADR-0089 §6's evidence record holds no source steps. This feature keeps source step text only in `public_version_jobs.source_steps`, while the job lives (about 3 days after the cook's last action), so a retry sends the writer the same text. The source record keeps hashes only. Keys are never
deleted, so a missing key version is an operator fault. A later save then answers `503 checkUnavailable` and raises an
alarm, and Publish answers the same `503`, leaving the job `ready` (FR-050a).

## Not stored

The source steps and title text, once the job has ended (`source_steps` is NULL at every terminal state and on cancel). The prompt. The model's raw answer. Logs carry outcome and refusal category only.
