/**
 * Per-item sync status and failure classification — where an error is SHOWN and what it offers.
 *
 * ⛔ WRITTEN FROM THE SPECIFICATION, BEFORE THE IMPLEMENTATION EXISTS.
 *
 * ## The owner's requirement, which these assertions encode
 *
 * > "The errors should be as close to the failed data item as possible (i.e. if a food failed to save, then
 * > they should see an error state and helpful human-readable message telling them what happened and how to
 * > fix it. likewise if the entire recipe failed, then the error should be more global to the recipe page."
 *
 * > "success can just be indicated through a toast or some other UI (like a green sync icon with a tooltip
 * > indicating that the recipe has been saved as a status wherever it makes sense)"
 *
 * So a failure carries a SCOPE — the thing it should be rendered next to — and a REMEDY, because "it failed"
 * with no way forward is not an error state, it is an apology. Success carries no scope at all: it is quiet.
 *
 * ⛔ AND THE REMEDY IS NOT ALWAYS "RETRY". The shipped `useRecipePhotoUploadQueue` already establishes this
 * and it is the model being generalised: "only a settled TRANSPORT failure is retryable; a validation
 * rejection offers Remove and nothing else". Offering Retry on a 422 invites the cook to press a button that
 * cannot ever succeed.
 */
import { describe, expect, it } from 'vitest';

import { classifyFailure, remedyFor, scopeOf, type SyncFailure } from '../itemStatus.js';

/** A failure as the drainer would report it, with only the fields a classification depends on. */
function failure(overrides: Partial<SyncFailure>): SyncFailure {
    return { entity: 'recipe', intentKind: 'update', localId: 'r1', status: 500, ...overrides } as SyncFailure;
}

describe('classifyFailure — what kind of failure is it', () => {
    it.each([
        { status: 503, expected: 'transient' },
        { status: 429, expected: 'transient' },
        { status: 409, expected: 'conflict' },
        { status: 400, expected: 'terminal' },
        { status: 403, expected: 'terminal' },
        { status: 404, expected: 'terminal' },
        { status: 413, expected: 'terminal' },
        { status: 415, expected: 'terminal' },
        { status: 422, expected: 'terminal' },
    ])('classifies $status as $expected', ({ status, expected }) => {
        expect(classifyFailure(failure({ status }))).toBe(expected);
    });

    /**
     * ⛔ AN UNKNOWN OUTCOME IS NOT A SUCCESS AND NOT A BLIND RETRY. A timeout or a dropped socket may have
     * been processed server-side, so replaying it could duplicate a write. It becomes the cook's decision —
     * which is what removes the need for every endpoint to be idempotent.
     */
    it('⛔ treats an unknown outcome as needing the USER to decide, never an automatic replay', () => {
        expect(classifyFailure(failure({ status: undefined }))).toBe('unknown');
    });
});

describe('scopeOf — WHERE the error is rendered', () => {
    /**
     * ⛔ THE OWNER'S CENTRAL REQUIREMENT. A failing ingredient is an ITEM-scoped error: it renders on that
     * row, not as a page banner, because a banner cannot tell the cook WHICH of twelve lines to fix.
     */
    it('⛔ puts an ingredient failure on the ingredient', () => {
        expect(
            scopeOf(failure({ entity: 'ingredient', intentKind: 'createFreeform', localId: 'gochujang' })),
        ).toStrictEqual({
            kind: 'item',
            entity: 'ingredient',
            localId: 'gochujang',
        });
    });

    it('⛔ puts a photo failure on the photo', () => {
        expect(scopeOf(failure({ entity: 'photo', intentKind: 'upload', localId: 'p1', status: 413 }))).toStrictEqual({
            kind: 'item',
            entity: 'photo',
            localId: 'p1',
        });
    });

    /** A whole-recipe failure has no single row to blame, so it belongs to the recipe surface. */
    it('⛔ puts a whole-recipe failure on the recipe, not on any one field', () => {
        expect(scopeOf(failure({ entity: 'recipe', intentKind: 'create', localId: 'r1' }))).toStrictEqual({
            kind: 'entity',
            entity: 'recipe',
            localId: 'r1',
        });
    });
});

describe('remedyFor — what the cook can actually DO', () => {
    it('offers a retry for a transient failure, which is the one a retry can fix', () => {
        expect(remedyFor(failure({ status: 503 }))).toBe('retry');
    });

    /**
     * ⛔ NO RETRY ON A TERMINAL REFUSAL. The server has stated the request is wrong; pressing Retry would
     * re-send the same bytes for the same answer. The cook must change something or drop it.
     */
    it('⛔ offers EDIT, never retry, for a terminal refusal', () => {
        expect(remedyFor(failure({ status: 422 }))).toBe('edit');
    });

    it('⛔ sends a conflict to the existing resolver rather than offering a blind retry', () => {
        expect(remedyFor(failure({ status: 409 }))).toBe('resolve');
    });

    it('⛔ asks the cook to decide when the outcome is unknown, since a replay might duplicate', () => {
        expect(remedyFor(failure({ status: undefined }))).toBe('confirm');
    });
});

describe('the message a human reads', () => {
    /**
     * ⛔ A MESSAGE KEY, NOT A MESSAGE. The layer names WHICH message; the app supplies the localized words —
     * the same split the design system uses, and the reason a raw server string is never shown.
     *
     * ⚠️ Every failure must resolve to a key. A default-less lookup that returns `undefined` renders an empty
     * error state, which is worse than a generic one: the cook sees that something went wrong and is told
     * nothing at all.
     */
    it.each([
        { status: 422, entity: 'ingredient' as const },
        { status: 413, entity: 'photo' as const },
        { status: 409, entity: 'recipe' as const },
        { status: 503, entity: 'recipe' as const },
        { status: undefined, entity: 'recipe' as const },
    ])('⛔ resolves a message key for $entity / $status', ({ status, entity }) => {
        const resolved = remedyFor(failure({ status, entity }));

        expect(resolved).toBeTypeOf('string');
        expect(resolved.length).toBeGreaterThan(0);
    });
});
