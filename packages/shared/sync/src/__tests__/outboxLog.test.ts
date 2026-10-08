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

import {
    EMPTY_OUTBOX,
    appendIntent,
    claimForSending,
    drainOrder,
    markSending,
    recoverInterrupted,
    settle,
    supersede,
    type OutboxLog,
} from '../outboxLog.js';
import { type Intent, type OutboxRecord } from '../record.js';

/** An empty log — the starting state of a device that has never queued a write. */
const EMPTY: OutboxLog = EMPTY_OUTBOX;

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
            ...EMPTY,
            records: [
                {
                    ...intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }),
                    seq: 1,
                    state: 'parked',
                } as OutboxRecord,
            ],
            nextSeq: 2,
        };

        expect(() => supersede(parked, intent({ entity: 'recipe', intentKind: 'delete', localId: 'r1' }))).toThrow(
            /parked/iu,
        );
    });
});

/**
 * ⛔ A RECORD HAS AN IDENTITY OF ITS OWN, and every settlement is addressed by it. The drain sends a SNAPSHOT while
 * `submit` keeps appending; when the drain reports back, "remove what synced" must remove exactly the record that was
 * sent. Keyed by entity and kind it would delete the NEWER edit that coalesced into that slot during the send.
 */
describe('record identity', () => {
    it('gives every appended record a new sequence number, and a coalesced replacement a new one too', () => {
        const once = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));
        const twice = appendIntent(
            once,
            intent({ entity: 'recipe', intentKind: 'update', localId: 'r1', payload: { title: 'newer' } }),
        );

        expect(once.records.map((record) => record.seq)).toStrictEqual([1]);
        expect(twice.records.map((record) => record.seq)).toStrictEqual([2]);
        expect(twice.nextSeq).toBe(3);
    });

    /**
     * ⛔ THE COUNTER NEVER GOES BACK. A seq computed from the records still present would be reused once an in-flight
     * record was superseded, and the drain's settlement for the old record would then land on the new one.
     */
    it('⛔ never reuses a sequence number, even after the records holding it are gone', () => {
        const queued = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: 'r1' }));
        const annihilated = supersede(queued, intent({ entity: 'recipe', intentKind: 'delete', localId: 'r1' }));
        const next = appendIntent(annihilated, intent({ entity: 'recipe', intentKind: 'update', localId: 'r2' }));

        // Seq 1 was the annihilated create's; a counter derived from the surviving records would hand it out again.
        expect(next.records[0]?.seq).toBeGreaterThan(1);
    });

    /**
     * ⛔ AN IN-FLIGHT RECORD IS NEVER REPLACED. Coalescing into it would make the drain's answer for the OLD body be
     * filed against the NEW one, and a coalesced create would be sent twice.
     */
    it('⛔ appends beside a record that is being sent, rather than replacing it', () => {
        const queued = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));
        const sending = markSending(queued, 1);
        const edited = appendIntent(
            sending,
            intent({ entity: 'recipe', intentKind: 'update', localId: 'r1', payload: { title: 'newer' } }),
        );

        expect(edited.records.map((record) => [record.seq, record.state])).toStrictEqual([
            [1, 'sending'],
            [2, 'pending'],
        ]);
    });
});

describe('settle — the drain reports back by sequence number', () => {
    it('removes the synced record and records the id it produced', () => {
        const queued = appendIntent(
            EMPTY,
            intent({ entity: 'recipe', intentKind: 'create', localId: 'r1', produces: 'local:recipe:r1' }),
        );

        const after = settle(markSending(queued, 1), {
            seq: 1,
            outcome: 'synced',
            produces: 'local:recipe:r1',
            serverId: 'srv-1',
        });

        expect(after.records).toStrictEqual([]);
        expect(after.resolutions).toStrictEqual({ 'local:recipe:r1': 'srv-1' });
    });

    /** ⛔ THE CLOBBER, AT THE LEVEL OF THE LOG: a record appended while the drain was sending survives its report. */
    it('⛔ leaves a record appended during the send untouched', () => {
        const queued = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            1,
        );
        const appendedMeanwhile = appendIntent(
            queued,
            intent({ entity: 'recipe', intentKind: 'update', localId: 'r1', payload: { title: 'newer' } }),
        );

        const after = settle(appendedMeanwhile, { seq: 1, outcome: 'synced', serverId: 'srv-1' });

        expect(after.records.map((record) => [record.seq, record.payload])).toStrictEqual([[2, { title: 'newer' }]]);
    });

    it('parks a refused record with the status it was refused with', () => {
        const queued = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            1,
        );

        const after = settle(queued, { seq: 1, outcome: 'parked', status: 422 });

        expect(after.records.map((record) => [record.state, record.lastStatus])).toStrictEqual([['parked', 422]]);
    });

    it('returns a deferred record to pending, and leaves a settlement for an absent record as a no-op', () => {
        const queued = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            1,
        );

        const deferred = settle(queued, { seq: 1, outcome: 'deferred', until: 5_000 });

        expect(deferred.records[0]?.state).toBe('pending');
        expect(deferred.pausedUntil).toBe(5_000);
        expect(settle(queued, { seq: 99, outcome: 'parked', status: 422 })).toStrictEqual(queued);
    });
});

/**
 * ⛔ A RECORD LEFT `sending` ON DISK HAS AN UNKNOWN OUTCOME. The app died between sending it and hearing back, so the
 * server may hold it. Re-sending on relaunch is the blind retry the drainer's rule forbids; it parks for the cook.
 */
describe('recoverInterrupted', () => {
    it('⛔ parks a record that was being sent, with no status, and leaves every other record alone', () => {
        const queued = appendIntent(
            markSending(appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: 'r1' })), 1),
            intent({ entity: 'recipe', intentKind: 'update', localId: 'r2' }),
        );

        const after = recoverInterrupted(queued);

        expect(after.records.map((record) => [record.seq, record.state, record.lastStatus])).toStrictEqual([
            [1, 'parked', undefined],
            [2, 'pending', undefined],
        ]);
    });
});

describe('supersede — a record being sent', () => {
    /**
     * ⛔ A CREATE IN FLIGHT CANNOT BE ANNIHILATED. It may already exist on the server; dropping both it and the delete
     * would leave a recipe the cook removed. The delete is kept, ordered after the create and addressed to the id the
     * create produces.
     */
    it('⛔ keeps an in-flight create and queues the delete behind it', () => {
        const queued = markSending(
            appendIntent(
                EMPTY,
                intent({ entity: 'recipe', intentKind: 'create', localId: 'r1', produces: 'local:recipe:r1' }),
            ),
            1,
        );

        const after = supersede(
            queued,
            intent({ entity: 'recipe', intentKind: 'delete', localId: 'r1', payload: { id: 'local:recipe:r1' } }),
        );

        expect(after.records.map((record) => [record.intentKind, record.state, record.dependsOn])).toStrictEqual([
            ['create', 'sending', []],
            ['delete', 'pending', ['local:recipe:r1']],
        ]);
    });
});

describe('claimForSending', () => {
    it('marks a queued record sending', () => {
        const queued = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        expect(claimForSending(queued, 1)?.records[0]?.state).toBe('sending');
    });

    /** ⛔ The claim is what stops a drain sending a body the cook has since replaced or deleted. */
    it.each([
        ['replaced by a newer edit', 2],
        ['deleted with its entity', 1],
    ])('⛔ refuses a record that was %s', (_label, sequence) => {
        const queued = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));
        const changed =
            sequence === 2
                ? appendIntent(
                      queued,
                      intent({ entity: 'recipe', intentKind: 'update', localId: 'r1', payload: { v: 2 } }),
                  )
                : supersede(queued, intent({ entity: 'recipe', intentKind: 'delete', localId: 'r1' }));

        expect(claimForSending(changed, 1)).toBeUndefined();
    });

    it('refuses a record already on the wire', () => {
        const sending = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            1,
        );

        expect(claimForSending(sending, 1)).toBeUndefined();
    });
});
