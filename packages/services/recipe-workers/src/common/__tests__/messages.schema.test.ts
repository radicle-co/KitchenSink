/**
 * The queue message contracts — written BEFORE the schemas (TDD red → green).
 *
 * WHY THESE EXIST. An SQS handler has no Nest pipe in front of it, so nothing validates a message body unless
 * the handler does it itself. `version-archive-worker` did not: `JSON.parse(record.body) as
 * RecipeVersionArchiveMessage` was the whole of its input handling, and the values that cast produced reach
 * three sinks that all matter —
 *
 *  1. `SELECT … WHERE id = ${versionId}` and `DELETE FROM recipe_versions WHERE id = ${versionId}`;
 *  2. the S3 `PutObject` **Key**, via `recipeVersionArchiveKey({ ownerId, recipeId, versionNumber })`; and
 *  3. the GDPR archive-resurrection guard, `SELECT EXISTS(… WHERE owner_id = ${ownerId})`.
 *
 * Sink 3 is why this is a security control and not tidiness. That guard FAILS OPEN on a malformed owner: an
 * `ownerId` that matches no row makes `EXISTS` false, which the worker reads as "this owner has no erasure on
 * record" and proceeds to write a fresh snapshot — under a prefix derived from that same malformed id, i.e.
 * outside the prefix the erasure sweeper and the orphan sweeper scan. A wrong-shaped owner id therefore
 * produces an archive object that no erasure path will ever find. Validating the id at the boundary is what
 * makes the guard's `false` mean "not erased" rather than "unrecognisable".
 *
 * The mutation each case is built to catch is named in its own comment; collectively, deleting the `.parse`
 * call from either handler reds this file's sibling handler suites, and loosening any single field here reds
 * the case below it.
 */
import { describe, expect, it } from 'vitest';

import { handleSyncMessageSchema, recipeVersionArchiveMessageSchema } from '../messages.schema.js';

/**
 * Valid app-user / recipe / version ULIDs (26 Crockford base32 characters), as `ulidx` mints them.
 *
 * ⚠️ Note what is NOT usable as a readable fixture here: `…OWN0` / `…REC0` / `…VER0` are all INVALID ULIDs,
 * because Crockford base32 excludes `I`, `L`, `O` and `U` (`ULID_REGEX` = `/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i`).
 * The first draft of this suite used them and the POSITIVE cases failed — which is a small but real
 * demonstration that the guard is doing something a `typeof value === 'string'` check never did.
 */
const OWNER = '01J00000000000000000000WN0';

/**
 * Recipe and version ids are **UUIDs**, not ULIDs — `recipes.id` and `recipe_versions.id` are
 * `uuid(...).defaultRandom()` columns, while `owner_id`/`created_by` are `varchar(255)` holding identity's ULID.
 * The first draft of the schema required a ULID for all three and the pre-existing handler suite caught it, which
 * is the case for bounding each field by the column it addresses instead of by one house convention.
 */
const RECIPE = '00000000-0000-4000-8000-000000000001';
const VERSION = '00000000-0000-4000-8000-000000000002';

/** A structurally valid archive message; each test overrides exactly the field it is about. */
const archiveMessage = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    recipeId: RECIPE,
    versionId: VERSION,
    versionNumber: 3,
    ownerId: OWNER,
    requestedAt: '2026-08-12T10:00:00.000Z',
    ...overrides,
});

describe('recipeVersionArchiveMessageSchema', () => {
    it('accepts the message the archive sweeper produces', () => {
        const parsed = recipeVersionArchiveMessageSchema.parse(archiveMessage());

        expect(parsed.ownerId).toBe(OWNER);
        expect(parsed.versionNumber).toBe(3);
    });

    describe('ownerId — the field the GDPR resurrection guard depends on', () => {
        // Each of these reached `WHERE owner_id = $1` and the S3 key prefix unchecked before this schema.
        it.each([
            ['absent', undefined],
            ['blank', ''],
            ['a non-string', 12345],
            ['null', null],
            // The prefix-escape shapes: a path fragment would have gone straight into an S3 object Key.
            ['a path traversal', '../../../etc/passwd'],
            ['a slash-bearing id', `${OWNER}/extra`],
            // Right length, wrong alphabet: `I`, `L`, `O` and `U` are not Crockford base32.
            ['a non-Crockford id', '01J0000000000000000000OWNI'],
            ['too short', '01J0000'],
        ])('rejects %s', (_label, ownerId) => {
            expect(() => recipeVersionArchiveMessageSchema.parse(archiveMessage({ ownerId }))).toThrow();
        });
    });

    describe('versionId and recipeId — the SQL predicate and key components (uuid columns)', () => {
        it.each([
            ['versionId', undefined],
            ['versionId', ''],
            ['versionId', { $ne: null }],
            ['versionId', 'not-a-uuid'],
            // A ULID is a perfectly good id — just not for THIS column. Asserted so a future "make them all
            // ULIDs for consistency" edit reds instead of silently accepting ids the table cannot hold.
            ['versionId', OWNER],
            ['recipeId', undefined],
            ['recipeId', ''],
            ['recipeId', 42],
            ['recipeId', '../../../etc/passwd'],
        ])('rejects a bad %s (%p)', (field, value) => {
            expect(() => recipeVersionArchiveMessageSchema.parse(archiveMessage({ [field]: value }))).toThrow();
        });
    });

    describe('versionNumber — 1-based, and it keys the archive object', () => {
        it.each([
            ['zero', 0],
            ['negative', -1],
            ['fractional', 2.5],
            ['a numeric string', '3'],
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
        ])('rejects %s', (_label, versionNumber) => {
            expect(() => recipeVersionArchiveMessageSchema.parse(archiveMessage({ versionNumber }))).toThrow();
        });

        it('accepts 1, the first version', () => {
            expect(recipeVersionArchiveMessageSchema.parse(archiveMessage({ versionNumber: 1 })).versionNumber).toBe(1);
        });
    });

    it('rejects a non-ISO requestedAt', () => {
        expect(() => recipeVersionArchiveMessageSchema.parse(archiveMessage({ requestedAt: 'yesterday' }))).toThrow();
    });

    it('STRIPS an unknown key rather than rejecting the message', () => {
        // Strip, not strict, and deliberately so: a producer deployed AHEAD of this consumer may add a field,
        // and rejecting it would turn a forward-compatible deploy into a DLQ full of poison messages. The
        // safety property here is that every field the worker ACTS on is validated — not that the producer is
        // forbidden from saying more. Asserting the stripping (rather than just "it parses") is what keeps a
        // future `.strictObject()` from silently changing the rollout story.
        const parsed = recipeVersionArchiveMessageSchema.parse(archiveMessage({ futureField: 'ignored' }));

        expect(parsed).not.toHaveProperty('futureField');
    });
});

describe('handleSyncMessageSchema', () => {
    const handleSync = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        userId: OWNER,
        displayName: 'Ada Lovelace',
        sourceTimestamp: '2026-08-12T10:00:00.000Z',
        ...overrides,
    });

    it('accepts a well-formed rename event', () => {
        expect(handleSyncMessageSchema.parse(handleSync()).displayName).toBe('Ada Lovelace');
    });

    it('requires userId to be a ULID, not merely a non-blank string', () => {
        // The pre-existing guard was `typeof payload.userId !== 'string' || payload.userId.trim() === ''`, so
        // any non-blank string reached three SQL statements. This case reds if the schema is weakened back to
        // that.
        expect(() => handleSyncMessageSchema.parse(handleSync({ userId: 'not-a-ulid' }))).toThrow();
    });

    it('BOUNDS displayName, which is denormalized into three tables', () => {
        // `author_handles.display_name`, `recipes.author_handle` and `recipe_versions.editor_handle` are all
        // written from this one field. Unbounded, a buggy or hostile publisher writes an arbitrarily large
        // value into all three. The bound is the database's, which is the floor the owner asked for.
        expect(() => handleSyncMessageSchema.parse(handleSync({ displayName: 'x'.repeat(1000) }))).toThrow();
    });

    it('rejects a blank or whitespace-only displayName', () => {
        expect(() => handleSyncMessageSchema.parse(handleSync({ displayName: '   ' }))).toThrow();
    });

    it('trims displayName so one name has one stored form', () => {
        expect(handleSyncMessageSchema.parse(handleSync({ displayName: '  Ada  ' })).displayName).toBe('Ada');
    });

    it('rejects a sourceTimestamp that is not a real instant', () => {
        // It is compared against `source_timestamp` in the last-writer-wins predicate, so an unparseable value
        // silently loses (or wins) that comparison instead of being refused.
        expect(() => handleSyncMessageSchema.parse(handleSync({ sourceTimestamp: 'not-a-date' }))).toThrow();
    });
});
