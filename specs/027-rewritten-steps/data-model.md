# Data Model: Flow Steps

Recipe database. One migration (next free number), expand-only (ADR-0035). Owner, migrator and service roles per
ADR-0039. Ids use the house id type (`recipe-core/src/ids.ts`).

## `recipe_rewritten_steps` (the attached version)

| Column           | Type        | Rule                                                                                            |
| ---------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `recipe_id`      | id, PK      | FK `recipes(id)` ON DELETE CASCADE. One row per recipe (R6).                                    |
| `user_id`        | id          | The owner at generation. Erasure deletes by it (FR-024).                                        |
| `content_digest` | char(64)    | SHA-256 hex of the canonical content (R5). CHECK `~ '^[0-9a-f]{64}$'`.                          |
| `language`       | text        | Lower-case BCP 47 primary language subtag of the recipe (2 or 3 letters).                       |
| `steps`          | jsonb       | `[{ text: string, covers: number[] }]`, 1..80 items; validated by the zod parser before insert. |
| `engine_version` | text        | `{modelId}#{promptSha256}`. Audit only (FR-025).                                                |
| `job_id`         | id          | The job that produced it.                                                                       |
| `created_at`     | timestamptz | Default now().                                                                                  |

Current ⇔ `content_digest = digest(saved recipe)`. Computed at read, never stored as a flag.

## `recipe_rewritten_step_jobs`

| Column           | Type             | Rule                                                                                                       |
| ---------------- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`             | id, PK           |                                                                                                            |
| `recipe_id`      | id               | FK ON DELETE CASCADE.                                                                                      |
| `user_id`        | id               | Requester (= owner).                                                                                       |
| `content_digest` | char(64)         | Digest at request.                                                                                         |
| `state`          | text             | CHECK in (`pending`,`ready`,`checkRefused`,`budgetSpent`,`failed`).                                        |
| `refusal`        | text NULL        | For `checkRefused`: `factMissing`,`factAdded`,`tooSimilar`,`unreadable`. CHECK null unless `checkRefused`. |
| `created_at`     | timestamptz      |                                                                                                            |
| `finished_at`    | timestamptz NULL | CHECK set iff state ≠ `pending`.                                                                           |

Indexes:

- `UNIQUE (recipe_id, content_digest) WHERE state = 'pending'`: single flight (FR-023). Insert collision → return
  the existing pending job.
- `(user_id) WHERE state = 'pending'`: the 3-per-cook cap (FR-065), checked under the per-user advisory lock the
  service already uses for slots (ADR-0073 shape).
- Finished jobs are deleted 7 days after `finished_at` by the existing retention sweeper.

## State transitions (job)

```text
pending ──ok + checks pass──────────▶ ready        (write version if newer, settle the held use, same tx)
pending ──checks fail───────────────▶ checkRefused (no version, no use)
pending ──ceiling denial────────────▶ budgetSpent  (refund, no use, not redelivered)
pending ──error × maxReceive / 10 min▶ failed      (no use)
pending ──recipe deleted────────────▶ (row cascades; worker finds no row and acks)
pending ──digest changed before call──▶ failed       (no call, no use)
pending ──digest changed during call──▶ ready        (version reads stale at once; one use, the cook got a result)
```

## Use charge

005's ledger (unbuilt) with a unique key on `(source='rewrittenSteps', job_id)`. A hold is written when the job is
created (under the per-user lock), settled to a charge in the `ready` transaction, and released on any other final
state (research R8).

## Write ordering

The `ready` write upserts `recipe_rewritten_steps` only when no row exists or the existing row's job was created
before this job. A late older job never replaces a newer version. Worker test: two jobs finishing out of order leave
the newer version.

## Erasure and purge

Both tables are user-keyed: add to `erasureSweepCoverage` and to the test-principal purge. Cascade covers recipe
deletion.

## Not stored

The facts sheet, the prompt and the model's raw answer. (Spec 003B differs on purpose: its job keeps a facts snapshot and the source step text (`source_steps`) until a final state, because Publish re-checks the first and a retry resends the second. See 003B data-model.) Logs carry outcome and refusal category only (FR-066).
