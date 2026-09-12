/**
 * The outbox log — ordering, coalescing and supersession.
 *
 * ⛔ WRITTEN FROM THE SPECIFICATION, BEFORE THE IMPLEMENTATION EXISTS. Every expectation below is derived
 * from `docs/design/offlineNotice.md` and the architecture blueprint's rulings, not from reading code — the
 * code does not exist yet. That is the point: a test written afterwards asserts what the implementation
 * happens to do, and would have missed every case the spec names but the author forgot.
 *
 * ## What the log is FOR, in one line
 *
 * Offline is a PAUSE, not a mode (owner ruling): a write resolves optimistically, its INTENT is durable, and
 * the queue drains when connectivity returns. The log owns which intents exist, in what order they may be
 * sent, and which ones supersede which.
 *
 * ⛔ IT IS A LOG, NOT A KEYED MAP, and the difference is the whole design. A map keyed by entity id forfeits
 * ordering, and ordering is load-bearing here: a recipe referencing a freeform ingredient cannot be sent
 * before the ingredient exists server-side, and a delete of a recipe must also remove a pending membership
 * add whose own key is scoped to a COLLECTION, not to that recipe.
 */
import { describe, expect, it } from 'vitest';

import { appendIntent, drainOrder, supersede, type OutboxLog } from '../outboxLog.js';
import { type Intent } from '../record.js';

/** An empty log — the starting state of a device that has never queued a write. */
const EMPTY: OutboxLog = { records: [] };

/** Build an intent with the fields a test cares about; everything else takes a neutral default. */
function intent(overrides: Partial<Intent> & Pick<Intent, 'entity' | 'intentKind' | 'localId'>): Intent {
    return {
        dependsOn: [],
        payload: {},
        ...overrides,
    } as Intent;
}

describe('appendIntent — ordering', () => {
    it('keeps independent intents in the order they were made', () => {
        const log = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'a' })),
            intent({ entity: 'recipe', intentKind: 'update', localId: 'b' }),
        );

        expect(drainOrder(log).map((record) => record.localId)).toStrictEqual(['a', 'b']);
    });

    /**
     * ⛔ THE DEPENDENCY EDGE IS THE REASON THIS IS A LOG. A recipe embedding a not-yet-created freeform
     * ingredient cannot be sent first — `resolveIngredientLines` rejects the WHOLE body for one unknown id.
     * Appending the recipe first must NOT put it first in the drain.
     */
    it('⛔ drains a dependency before the intent that embeds it, regardless of append order', () => {
        const log = appendIntent(
            appendIntent(
                EMPTY,
                intent({ entity: 'recipe', intentKind: 'create', localId: 'r1', dependsOn: ['local:ingredient:x'] }),
            ),
            intent({
                entity: 'ingredient',
                intentKind: 'createFreeform',
                localId: 'x',
                produces: 'local:ingredient:x',
            }),
        );

        expect(drainOrder(log).map((record) => record.localId)).toStrictEqual(['x', 'r1']);
    });

    it('⛔ refuses a cycle rather than draining an arbitrary half of it', () => {
        const log = appendIntent(
            appendIntent(
                EMPTY,
                intent({
                    entity: 'recipe',
                    intentKind: 'create',
                    localId: 'a',
                    dependsOn: ['local:recipe:b'],
                    produces: 'local:recipe:a',
                }),
            ),
            intent({
                entity: 'recipe',
                intentKind: 'create',
                localId: 'b',
                dependsOn: ['local:recipe:a'],
                produces: 'local:recipe:b',
            }),
        );

        expect(() => drainOrder(log)).toThrow(/cycle/iu);
    });
});

describe('appendIntent — reference hygiene', () => {
    /**
     * ⛔ A MALFORMED REF USED TO FAIL SILENTLY, AND THAT IS WHY THIS EXISTS. `substituteRefs` only rewrites
     * values carrying the `local:` prefix, so a `dependsOn`/`produces` entry written as a bare `'ing:x'`
     * would order the drain correctly and then send the recipe with the PLACEHOLDER still in it — a server
     * rejection hours later, blamed on the cook's data rather than on our bug.
     *
     * Found while writing these tests: two of my own spec files disagreed about the shape of a ref, and the
     * drainer quietly did the wrong thing rather than complaining. So the log refuses the malformed shape at
     * the point of entry, where the stack trace still names the caller that built it.
     */
    it('⛔ rejects a dependency that is not a local reference', () => {
        expect(() =>
            appendIntent(
                EMPTY,
                intent({ entity: 'recipe', intentKind: 'create', localId: 'r1', dependsOn: ['ing:x'] }),
            ),
        ).toThrow(/local reference/iu);
    });

    it('⛔ rejects a produced reference that is not a local reference', () => {
        expect(() =>
            appendIntent(
                EMPTY,
                intent({ entity: 'ingredient', intentKind: 'createFreeform', localId: 'x', produces: 'ing:x' }),
            ),
        ).toThrow(/local reference/iu);
    });
});

describe('appendIntent — coalescing', () => {
    /**
     * ⚠️ Lossless ONLY because the editor submits a whole draft rather than a delta. If a caller ever queues
     * a partial update, replacing would silently drop the earlier edit — which is why coalescing is a rule
     * per intent KIND and not a blanket overwrite.
     */
    it('replaces a pending update to the same entity with the newer whole draft', () => {
        const log = appendIntent(
            appendIntent(
                EMPTY,
                intent({ entity: 'recipe', intentKind: 'update', localId: 'r1', payload: { title: 'first' } }),
            ),
            intent({ entity: 'recipe', intentKind: 'update', localId: 'r1', payload: { title: 'second' } }),
        );

        expect(log.records).toHaveLength(1);
        expect(log.records[0]?.payload).toStrictEqual({ title: 'second' });
    });

    /**
     * ⛔ VISIBILITY IS A SEPARATE ENDPOINT WITH ITS OWN POLICY, so it must NOT collapse into a create. Kept
     * apart, a C-004 refusal parks the VISIBILITY change and leaves the recipe saved; collapsed, one refusal
     * would take both down and the cook would be told their recipe failed when only its privacy did.
     */
    it('⛔ keeps a visibility change separate from a pending create', () => {
        const log = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: 'r1' })),
            intent({ entity: 'recipe', intentKind: 'setVisibility', localId: 'r1' }),
        );

        expect(log.records.map((record) => record.intentKind)).toStrictEqual(['create', 'setVisibility']);
    });

    it('⛔ never coalesces photos — each is its own upload with its own outcome', () => {
        const log = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'photo', intentKind: 'upload', localId: 'p1' })),
            intent({ entity: 'photo', intentKind: 'upload', localId: 'p2' }),
        );

        expect(log.records).toHaveLength(2);
    });

    it('dedupes a freeform ingredient queued twice under the same name', () => {
        const log = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'ingredient', intentKind: 'createFreeform', localId: 'gochujang' })),
            intent({ entity: 'ingredient', intentKind: 'createFreeform', localId: 'gochujang' }),
        );

        expect(log.records).toHaveLength(1);
    });
});

describe('supersede', () => {
    /**
     * ⛔ THE CASE A PER-ENTITY MAP CANNOT SEE. A pending membership-add of recipe R into collection C is
     * keyed by the COLLECTION, so deleting R must reach across scopes to remove it. Miss this and the drain
     * sends a membership add for a recipe that no longer exists.
     */
    it('⛔ a delete removes pending intents for that entity ACROSS scopes', () => {
        const queued = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            // ⚠️ `concerns`, NOT `dependsOn` — see the note on `Intent` for why these are two fields. This
            // membership-add is ABOUT recipe r1 while being keyed by the collection, which is precisely the
            // cross-scope case a per-entity map cannot express.
            intent({ entity: 'collection', intentKind: 'addMember', localId: 'c9', concerns: ['recipe:r1'] }),
        );

        const after = supersede(queued, intent({ entity: 'recipe', intentKind: 'delete', localId: 'r1' }));

        expect(after.records.map((record) => record.intentKind)).toStrictEqual(['delete']);
    });

    /**
     * ⛔ A DELETE OF A NEVER-DRAINED CREATE ANNIHILATES BOTH. The row never reached the server, so sending
     * `DELETE` would 404 — and reporting that 404 to the cook as a failure would be a lie about a recipe they
     * correctly removed before it ever synced.
     */
    it('⛔ deleting a recipe that never drained leaves NOTHING queued', () => {
        const queued = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: 'r1' }));

        const after = supersede(queued, intent({ entity: 'recipe', intentKind: 'delete', localId: 'r1' }));

        expect(after.records).toStrictEqual([]);
    });

    /**
     * ⛔ A PARKED RECORD IS WORK THE SYSTEM PROMISED TO KEEP. Removing one silently discards an edit the cook
     * was told was safe, so supersession must report it rather than swallow it.
     */
    it('⛔ refuses to silently supersede a PARKED record', () => {
        const parked: OutboxLog = {
            records: [
                {
                    ...intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }),
                    state: 'parked',
                } as OutboxLog['records'][number],
            ],
        };

        expect(() => supersede(parked, intent({ entity: 'recipe', intentKind: 'delete', localId: 'r1' }))).toThrow(
            /parked/iu,
        );
    });
});
