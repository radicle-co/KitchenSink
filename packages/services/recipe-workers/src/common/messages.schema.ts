/**
 * THE QUEUE MESSAGE CONTRACTS these workers consume — authored as zod, parsed at every handler boundary.
 *
 * WHY THIS FILE EXISTS. An HTTP controller in this repo is guarded by a bound `ZodValidationPipe`; an SQS
 * handler has NOTHING in front of it. Every worker here was therefore doing its own input handling, and the
 * three did it three different ways: `version-archive-worker` cast the body outright
 * (`JSON.parse(record.body) as RecipeVersionArchiveMessage`), `handle-sync-worker` hand-rolled a `typeof`
 * ladder, and `account-erasure-worker` hand-rolled a stricter ULID guard. So the queue — which writes to the
 * database and to S3 with no user in the loop — was the least-guarded surface in the service, and the amount
 * of checking a field received depended on which handler happened to receive it.
 *
 * These schemas are that checking, in one place, expressed once. Two properties are deliberate:
 *
 *  - **ULIDs are validated with `ulidx`'s own `isValidUlid`, not a regex.** These ids are minted by `ulidx`
 *    elsewhere in the system; reusing the generator's validator is what keeps "what a valid id is" from
 *    drifting into two answers (library-first, and the guard `account-erasure-worker` already chose).
 *  - **`z.object`, so unknown keys are STRIPPED, not rejected.** A producer deployed ahead of a consumer must
 *    be able to add a field without filling a DLQ with poison messages. The safety property is that every
 *    field a worker ACTS on is validated — not that the producer is forbidden from saying more. (Contrast the
 *    HTTP request bodies, which are `strictObject`: there the client is untrusted and an unknown key is more
 *    likely a typo'd field name than a forward-compatible deploy.)
 *
 * IDEAL HOME, NOT YET AVAILABLE. `RecipeVersionArchiveMessage` is produced by `archive-sweeper` and consumed
 * by `version-archive-worker` — both in this package — so authoring the contract here keeps producer and
 * consumer on ONE definition today. `HandleSyncMessage`, however, is produced by `identity-webhooks` via
 * `@kitchensink/identity-core`, which declares it as a plain `interface` and carries no zod at all. The
 * cross-service half of that contract is therefore still two representations; the shared packages are outside
 * this change's ownership, so the schema lives here and the gap is recorded rather than papered over.
 */
import { z } from 'zod';
// Aliased on import exactly as `account-erasure-worker` already does, so the two boundaries name one validator.
import { isValid as isValidUlid } from 'ulidx';

/**
 * An app-user / recipe / version ULID, validated by the same library that mints them.
 *
 * The strictness matters most for owner ids, which become BOTH a SQL predicate and an S3 key prefix. A
 * malformed owner id is not a crash — it is a value that matches no row and no object, which is why the
 * erasure guard that depends on it fails open. See {@link recipeVersionArchiveMessageSchema}.
 */
const ulid = (): z.ZodType<string> => z.string().refine(isValidUlid, { error: 'must be a valid ULID' });

/**
 * The largest value a Postgres `integer` (int4) column accepts.
 *
 * `recipe_versions.version_number` is `integer`, so a larger value cannot exist in the table this worker reads.
 * Bounding it here keeps an out-of-range number from becoming `WHERE … = $1` with a parameter Postgres rejects
 * as `22003 value out of range for type integer` — which surfaces as an opaque driver error on a message that
 * could simply have been refused at the boundary.
 */
const INT4_CEILING = 2_147_483_647;

/**
 * An ISO-8601 instant. `z.iso.datetime()` rather than a `Date.parse` refinement, because `Date.parse` accepts
 * a large amount of implementation-defined slop (`'2026'`, `'Aug 12 2026'`) and these values are compared
 * against `timestamptz` columns, where a non-normalized string is a comparison that quietly does the wrong
 * thing rather than an error.
 */
const isoInstant = (): z.ZodISODateTime => z.iso.datetime();

/**
 * The maximum display-name length this consumer will accept.
 *
 * Sourced from the PRODUCER'S OWN published contract, not invented here: identity caps `displayName` at 100
 * characters in `patchUserMeRequestSchema` (`@kitchensink/schema-identity`), so a longer value could not have
 * been set through identity's API and does not need to be honoured by a downstream consumer of identity's
 * rename event.
 *
 * ⚠️ It is NOT sourced from the database, and that is worth stating because the owner's rule of thumb is that
 * the schema is the validation floor. Here the floor is absent: `author_handles.display_name`,
 * `recipes.author_handle`, `recipe_versions.editor_handle` and identity's own `profiles.display_name` are ALL
 * unbounded `text`. So the column imposes no ceiling, and an unvalidated rename event writes an
 * arbitrarily-large value into three tables — which is the reason this bound is applied here rather than
 * left to the database to reject.
 */
export const MAX_DISPLAY_NAME_LENGTH = 100;

/**
 * `RecipeVersionArchiveMessage` — the version-archive queue's contract (FR-007b-i).
 *
 * Every field is validated because every field reaches a sink: `versionId` is the SQL predicate for both the
 * load and the `DELETE`, `ownerId`/`recipeId`/`versionNumber` compose the S3 object Key, and `ownerId` is
 * additionally the subject of the GDPR archive-resurrection guard.
 *
 * That guard is the reason `ownerId` is ULID-strict rather than merely non-blank. It asks
 * `SELECT EXISTS(SELECT 1 FROM account_erasure_jobs WHERE owner_id = $1)` and treats `false` as "this owner
 * has no erasure on record". A malformed owner id matches no row, so it produces `false` — the guard FAILS
 * OPEN — and the worker then writes a snapshot under a prefix derived from that same malformed id, i.e.
 * outside the prefix both the erasure sweeper and the orphan sweeper scan. The object would be unreachable by
 * every erasure path in the system. Validating the id is what makes the guard's `false` mean "not erased"
 * instead of "unrecognisable".
 */
export const recipeVersionArchiveMessageSchema = z.object({
    /**
     * The recipe the version belongs to; a component of the archive object key.
     *
     * A **UUID**, not a ULID: `recipes.id` is `uuid('id').primaryKey().defaultRandom()`. The two id families are
     * genuinely mixed in this schema — surrogate keys are UUIDs, while owner references are ULIDs minted by
     * identity — so each field is bounded by the column it addresses rather than by one house convention.
     */
    recipeId: z.uuid(),
    /** The internal `recipe_versions.id` (a `uuid` column) — the SQL predicate for the load and the prune. */
    versionId: z.uuid(),
    /** The 1-based client-facing version number; keys the archive object (ARCH-BE-3). */
    versionNumber: z.number().int().positive().max(INT4_CEILING),
    /**
     * App-user ULID of the recipe owner — the erasure-guard subject and the key's owner prefix.
     *
     * `owner_id`/`created_by` are `varchar(255)` holding the ULID identity mints, so the column's own bound is
     * far looser than the value's real shape. ULID-strict here because THIS is the field that becomes an S3
     * prefix and the erasure predicate; `varchar(255)` would admit a path fragment.
     */
    ownerId: ulid(),
    /** ISO 8601 timestamp of when the archive was requested (observational). */
    requestedAt: isoInstant(),
});

/** The version-archive queue's message contract. */
export type RecipeVersionArchiveMessage = z.infer<typeof recipeVersionArchiveMessageSchema>;

/**
 * `HandleSyncMessage` — the author-handle rename event (W8-a.2), published by identity over SNS and delivered
 * to this service through SQS.
 *
 * `displayName` is the field that needed a schema most: the pre-existing guard tested only
 * `typeof payload.displayName === 'string'`, and the value is then written to `author_handles.display_name`
 * and denormalized into `recipes.author_handle` and `recipe_versions.editor_handle` — three unbounded `text`
 * columns. Trimmed here so one name has one stored form across all three.
 */
export const handleSyncMessageSchema = z.object({
    /** The app-user ULID whose handle changed. */
    userId: ulid(),
    /** The new display name — trimmed, non-empty, and bounded by {@link MAX_DISPLAY_NAME_LENGTH}. */
    displayName: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH),
    /**
     * `profiles.updatedAt` from the transaction that changed the name (ISO-8601). It is the last-writer-wins
     * discriminator, compared against the stored `source_timestamp`, so an unparseable value would silently
     * lose or win that comparison rather than be refused.
     */
    sourceTimestamp: isoInstant(),
});

/** The author-handle rename event's contract. */
export type HandleSyncMessage = z.infer<typeof handleSyncMessageSchema>;
