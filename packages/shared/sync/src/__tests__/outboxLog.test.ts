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
    appendExclusive,
    appendIntent,
    claimForSending,
    discardEntity,
    drainOrder,
    markSending,
    recoverInterrupted,
    settle,
    supersede,
    withdraw,
    withdrawMoot,
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

    it('leaves a pending create pending when the log is not a copy', () => {
        const queued = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: 'r1' }));

        expect(recoverInterrupted(queued, { copied: false }).records[0]?.state).toBe('pending');
    });

    /**
     * ⛔ A DUPLICATED BROWSER TAB COPIES THE JOURNAL. Both tabs then hold the same pending create, and each would send
     * it: a second recipe. A create has no version token, so the copy parks every record whose second copy would make a
     * second row, and the cook decides. An update names its version, so a second copy meets a 409; it stays pending.
     */
    it.each([
        ['create', 'pending', 'parked'],
        ['create', 'blocked', 'parked'],
        ['createFreeform', 'pending', 'parked'],
        ['upload', 'pending', 'parked'],
        ['update', 'pending', 'pending'],
        ['delete', 'pending', 'pending'],
        ['setVisibility', 'pending', 'pending'],
        ['addMember', 'pending', 'pending'],
        ['update', 'parked', 'parked'],
    ] as const)('⛔ in a copied log, a %s left %s becomes %s', (intentKind, state, expected) => {
        const queued = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind, localId: 'r1' }));
        const log: OutboxLog = {
            ...queued,
            records: queued.records.map((record) => ({ ...record, state, lastStatus: 409 })),
        };

        const [after] = recoverInterrupted(log, { copied: true }).records;

        expect(after?.state).toBe(expected);
        // A record the copy parks is an unknown outcome: it carries no status. One it leaves alone keeps its own.
        expect(after?.lastStatus).toBe(expected === state ? 409 : undefined);
    });

    it('⛔ in a copied log, still parks a record a dead process left sending', () => {
        const queued = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            1,
        );

        expect(recoverInterrupted(queued, { copied: true }).records[0]?.state).toBe('parked');
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

/**
 * The editor's Discard of a recipe the server may not hold yet (finding 2 of the 2026-10-10 review). Its delete names the
 * create's local ref, and only the outbox knows, inside its serialized mutation, whether that create is still queued
 * (remove both), on the wire (wait for its answer: nothing is queued), parked (the cook's consent withdraws it), or
 * already synced (delete the id it made).
 */
describe('appendExclusive — a delete of a recipe its create may still be making', () => {
    const REF = 'local:recipe:d';
    const create = intent({ entity: 'recipe', intentKind: 'create', localId: REF, produces: REF });
    const remove = intent({
        entity: 'recipe',
        intentKind: 'delete',
        localId: REF,
        dependsOn: [REF],
        payload: { id: REF },
    });

    it('⛔ a create on the wire: reports it and queues NOTHING — no delete waits on a create that may park', () => {
        const sending = markSending(appendIntent(EMPTY, create), 1);

        expect(appendExclusive(sending, remove)).toStrictEqual({ kind: 'inFlight', seq: 1 });
    });

    it('a create still queued: both go, and nothing is left to send', () => {
        const result = appendExclusive(appendIntent(EMPTY, create), remove);

        expect(result.kind).toBe('queued');
        expect(result.kind === 'queued' ? result.log.records : undefined).toStrictEqual([]);
    });

    it('a parked create: reports it, for the caller to withdraw with the cook`s consent', () => {
        const parked = settle(appendIntent(EMPTY, create), { seq: 1, outcome: 'parked', status: 400 });

        expect(appendExclusive(parked, remove)).toStrictEqual({ kind: 'parked', seq: 1, status: 400 });
    });

    it('a create that already synced: the delete is queued, to be sent with the id the create made', () => {
        const synced = settle(appendIntent(EMPTY, create), {
            seq: 1,
            outcome: 'synced',
            serverId: 'rec_d',
            produces: REF,
        });
        const result = appendExclusive(synced, remove);

        expect(result.kind === 'queued' ? result.log.records.map((record) => record.intentKind) : []).toStrictEqual([
            'delete',
        ]);
    });

    it('⛔ no create anywhere and no id made: nothing is queued — that delete could never be sent', () => {
        const result = appendExclusive(EMPTY, remove);

        expect(result.kind === 'queued' ? result.log.records : undefined).toStrictEqual([]);
    });
});

describe('supersede — a delete nothing can ever address', () => {
    /**
     * ⛔ A DELETE WAITING ON A REF NO RECORD PRODUCES AND NO DRAIN RESOLVED IS NEVER SENDABLE. Queued, it sat pending for
     * the life of the session and kept "not synced" up. It names an entity the server never held, so it is moot.
     */
    it('⛔ drops a delete whose local ref nothing produces and nothing resolved', () => {
        const after = supersede(
            EMPTY,
            intent({
                entity: 'recipe',
                intentKind: 'delete',
                localId: 'local:recipe:z',
                dependsOn: ['local:recipe:z'],
            }),
        );

        expect(after.records).toStrictEqual([]);
    });

    it('keeps a delete whose ref resolved (one behind an in-flight create: `supersede — a record being sent`)', () => {
        const resolved = supersede(
            { ...EMPTY, resolutions: { 'local:recipe:z': 'rec_z' } },
            intent({
                entity: 'recipe',
                intentKind: 'delete',
                localId: 'local:recipe:z',
                dependsOn: ['local:recipe:z'],
            }),
        );

        expect(resolved.records.map((record) => record.intentKind)).toStrictEqual(['delete']);
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

/**
 * ⛔ A PARKED RECORD IS NEVER COALESCED (slice 7 blueprint, amending ADR-0057 §3). It is work the cook was told about and
 * has not decided on: a create parked with an unknown outcome may exist on the server, and replacing it with a newer
 * body sends a second create — a duplicate recipe. It leaves the log only by an explicit {@link withdraw}.
 */
describe('appendIntent — a parked record is never replaced', () => {
    it.each(['create', 'update'] as const)('appends a %s beside a parked one of the same entity', (kind) => {
        const parked = settle(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: kind, localId: 'r1', payload: { v: 1 } })),
            { seq: 1, outcome: 'parked' },
        );
        const next = appendIntent(
            parked,
            intent({ entity: 'recipe', intentKind: kind, localId: 'r1', payload: { v: 2 } }),
        );

        expect(next.records.map((record) => [record.seq, record.state, record.payload])).toStrictEqual([
            [1, 'parked', { v: 1 }],
            [2, 'pending', { v: 2 }],
        ]);
    });
});

/**
 * The editor's submit (slice 7): one server write per recipe at a time, decided INSIDE the serialized mutation, so the
 * check cannot race the drain's claim. A pending record is replaced losslessly (the editor sends whole drafts); a
 * record on the wire or parked is reported, never joined.
 */
describe('appendExclusive', () => {
    const edit = (v: number): Intent =>
        intent({ entity: 'recipe', intentKind: 'update', localId: 'r1', payload: { v } });

    it('queues into an empty slot, answering the new sequence number', () => {
        const result = appendExclusive(EMPTY, edit(1));

        expect(result).toStrictEqual({ kind: 'queued', seq: 1, log: appendIntent(EMPTY, edit(1)) });
    });

    it('replaces a pending record of the same entity and kind, keeping one record', () => {
        const pendingCreate = appendIntent(
            EMPTY,
            intent({ entity: 'recipe', intentKind: 'create', localId: 'local:recipe:a', payload: { v: 1 } }),
        );
        const result = appendExclusive(
            pendingCreate,
            intent({ entity: 'recipe', intentKind: 'create', localId: 'local:recipe:a', payload: { v: 2 } }),
        );

        expect(result.kind).toBe('queued');
        expect(result.kind === 'queued' ? result.log.records.map((record) => record.payload) : []).toStrictEqual([
            { v: 2 },
        ]);
    });

    it('reports a record on the wire and changes nothing', () => {
        const sending = markSending(appendIntent(EMPTY, edit(1)), 1);

        expect(appendExclusive(sending, edit(2))).toStrictEqual({ kind: 'inFlight', seq: 1 });
    });

    it('reports a parked record, with its status, and changes nothing', () => {
        const parked = settle(appendIntent(EMPTY, edit(1)), { seq: 1, outcome: 'parked', status: 409 });

        expect(appendExclusive(parked, edit(2))).toStrictEqual({ kind: 'parked', seq: 1, status: 409 });
        expect(
            appendExclusive(settle(appendIntent(EMPTY, edit(1)), { seq: 1, outcome: 'parked' }), edit(2)),
        ).toStrictEqual({ kind: 'parked', seq: 1 });
    });

    /**
     * Finding 1 of the 2026-10-10 review: Back queues the create, Forward reopens an editor that never saw its answer,
     * and the create syncs and leaves the log. The reopened editor's next checkpoint built `create local:X` again, and
     * nothing stood in its way: two recipes. The resolution IS the record that the create happened.
     */
    it('⛔ refuses a create whose ref is already resolved, answering the server id, and queues nothing', () => {
        const create = intent({
            entity: 'recipe',
            intentKind: 'create',
            localId: 'local:recipe:x',
            produces: 'local:recipe:x',
        });
        const synced = settle(appendIntent(EMPTY, create), {
            seq: 1,
            outcome: 'synced',
            serverId: 'rec_x',
            produces: 'local:recipe:x',
        });

        expect(appendExclusive(synced, create)).toStrictEqual({ kind: 'resolved', serverId: 'rec_x' });
        expect(appendExclusive(synced, { ...create, localId: 'local:recipe:y', produces: 'local:recipe:y' }).kind).toBe(
            'queued',
        );
    });

    it('⛔ answers the resolution before any record of the same entity that stands in the way', () => {
        const create = intent({
            entity: 'recipe',
            intentKind: 'create',
            localId: 'local:recipe:x',
            produces: 'local:recipe:x',
        });
        const resolvedAndParked = settle(
            { ...appendIntent(EMPTY, create), resolutions: { 'local:recipe:x': 'rec_x' } },
            { seq: 1, outcome: 'parked' },
        );

        expect(appendExclusive(resolvedAndParked, create)).toStrictEqual({ kind: 'resolved', serverId: 'rec_x' });
    });

    it('ignores other entities and other recipes', () => {
        const other = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r2' })),
            1,
        );

        expect(appendExclusive(other, edit(1)).kind).toBe('queued');
    });
});

/**
 * A1's handoff (2026-10-09): Discard while the create is on the wire queues the delete BEHIND it, depending on the ref
 * the create produces (`supersede`). If that create then parks and the cook withdraws it, no server id will ever exist
 * for the ref, so the delete could never be sent: it sat pending forever, counted as "syncing". A transient park is
 * re-sent by the drain and the delete must keep waiting, so the cascade belongs to the withdrawal, not the park.
 */
describe('withdraw — what waits on the withdrawn record', () => {
    const REF = 'local:recipe:r1';

    /**
     * Discard while the create is on the wire, then the create is parked with an unknown outcome. Parked by hand:
     * `settle` now settles this pair itself (`withdrawMoot`), so a log holding it is one an older build persisted, and
     * `withdraw` must still clear it.
     */
    function discardedWhileSending(): OutboxLog {
        const sending = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: REF, produces: REF })),
            1,
        );
        const discarded = supersede(sending, intent({ entity: 'recipe', intentKind: 'delete', localId: REF }));

        return {
            ...discarded,
            records: discarded.records.map((record) =>
                record.seq === 1 ? { ...record, state: 'parked' as const } : record,
            ),
        };
    }

    it('⛔ withdrawing the parked create also removes the delete that waited on its id', () => {
        const log = discardedWhileSending();
        expect(log.records.map((record) => [record.intentKind, record.state])).toStrictEqual([
            ['create', 'parked'],
            ['delete', 'pending'],
        ]);

        expect(withdraw(log, 1).records).toStrictEqual([]);
    });

    /**
     * ⛔ ONLY THE DELETE OF THE SAME ENTITY. Anything else that waits on the ref is the cook's work, and the ref is not
     * dead: the editor's Retry withdraws a parked create and resubmits it under the SAME local ref. Silently dropping a
     * pending record breaks the outbox's never-silently-discard rule.
     */
    it('⛔ keeps every other record that waits on the ref: a Retry resubmits the create under the same ref', () => {
        const queued = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: REF, produces: REF })),
            intent({ entity: 'photo', intentKind: 'upload', localId: 'p1', dependsOn: [REF] }),
        );
        const parked = settle(queued, { seq: 1, outcome: 'parked' });

        expect(withdraw(parked, 1).records.map((record) => record.localId)).toStrictEqual(['p1']);
    });

    it('keeps a record whose dependency already resolved: it can still be sent', () => {
        const log = discardedWhileSending();
        const resolved: OutboxLog = { ...log, resolutions: { [REF]: 'rec_1' } };

        expect(withdraw(resolved, 1).records.map((record) => record.intentKind)).toStrictEqual(['delete']);
    });
});

describe('withdraw', () => {
    it('removes a parked record by its sequence number', () => {
        const parked = settle(appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })), {
            seq: 1,
            outcome: 'parked',
            status: 409,
        });

        expect(withdraw(parked, 1).records).toStrictEqual([]);
    });

    it('⛔ refuses a record that is not parked: a pending one is the drain`s, a sending one is on the wire', () => {
        const pending = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        expect(() => withdraw(pending, 1)).toThrow(/not parked/);
        expect(() => withdraw(markSending(pending, 1), 1)).toThrow(/not parked/);
    });

    it('is a no-op for a record that is already gone', () => {
        expect(withdraw(EMPTY, 7)).toBe(EMPTY);
    });
});

/**
 * ⛔ A RECORD THE LOG ITSELF CAN PROVE POINTLESS LEAVES BY ITSELF. A Discard queues a delete behind a create on the wire
 * (the cook's consent, a Tombstone). When that create parks, no id will ever exist, so the pair is settled in the same
 * mutation that parked it — nobody is left to withdraw it once the editor is gone (stuck "Syncing 1").
 */
describe('withdrawMoot — a parked create with the cook`s delete waiting on it', () => {
    const REF = 'local:recipe:r1';

    /** A create on the wire, with a Discard's delete queued behind it in `deleteState`. */
    function createWithDelete(deleteState: 'pending' | 'blocked'): OutboxLog {
        const sending = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: REF, produces: REF })),
            1,
        );
        const withDelete = supersede(sending, intent({ entity: 'recipe', intentKind: 'delete', localId: REF }));

        return deleteState === 'pending' ? withDelete : settleBlocked(withDelete, 2);
    }

    /** Mark a record blocked without going through `settle`, which would apply the very rule under test. */
    function settleBlocked(log: OutboxLog, seq: number): OutboxLog {
        return {
            ...log,
            records: log.records.map((record) => (record.seq === seq ? { ...record, state: 'blocked' } : record)),
        };
    }

    it.each([
        ['an unknown outcome', undefined],
        ['a signed-out cook', 401],
        ['a terminal refusal', 400],
        ['a transient refusal that outlasted its attempts', 503],
    ])('⛔ %s: parking the create settles the pair, for a pending and for a blocked delete', (_label, status) => {
        for (const state of ['pending', 'blocked'] as const) {
            const parked = settle(createWithDelete(state), {
                seq: 1,
                outcome: 'parked',
                ...(status === undefined ? {} : { status }),
            });

            expect(parked.records, state).toStrictEqual([]);
        }
    });

    it('⛔ leaves a parked create alone when no delete waits on it', () => {
        const parked = settle(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: REF, produces: REF })),
            { seq: 1, outcome: 'parked' },
        );

        expect(parked.records.map((record) => [record.intentKind, record.state])).toStrictEqual([['create', 'parked']]);
    });

    it('does nothing when the ref already resolved: the delete can still be sent', () => {
        const parkedOnly = {
            ...createWithDelete('pending'),
            records: createWithDelete('pending').records.map((record) =>
                record.seq === 1 ? { ...record, state: 'parked' as const } : record,
            ),
            resolutions: { [REF]: 'rec_1' },
        };

        expect(withdrawMoot(parkedOnly).records.map((record) => record.intentKind)).toStrictEqual(['create', 'delete']);
    });

    it('⛔ leaves another entity`s delete, and a create that is not parked, untouched', () => {
        const unrelated = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: REF, produces: REF })),
            intent({ entity: 'recipe', intentKind: 'delete', localId: 'rec_9' }),
        );
        const parked = settle(unrelated, { seq: 1, outcome: 'parked' });

        expect(withdrawMoot(unrelated)).toBe(unrelated);
        expect(parked.records.map((record) => record.intentKind)).toStrictEqual(['create', 'delete']);
        expect(withdrawMoot(EMPTY)).toBe(EMPTY);
    });

    it('is applied by recoverInterrupted: a create a dead process left on the wire, with its delete behind it', () => {
        expect(recoverInterrupted(createWithDelete('pending')).records).toStrictEqual([]);
    });
});

describe('settle — a synced delete settles every parked write of its entity', () => {
    /** Everything parked about recipe `rec_1`, plus one about `rec_2`, then the delete of `rec_1` queued. */
    function parkedAround(): OutboxLog {
        let log = EMPTY;
        log = appendIntent(log, intent({ entity: 'recipe', intentKind: 'update', localId: 'rec_1' }));
        log = appendIntent(log, intent({ entity: 'recipe', intentKind: 'setVisibility', localId: 'rec_1' }));
        log = appendIntent(
            log,
            intent({ entity: 'collection', intentKind: 'addMember', localId: 'c1', concerns: ['recipe:rec_1'] }),
        );
        log = appendIntent(log, intent({ entity: 'recipe', intentKind: 'update', localId: 'rec_2' }));

        for (const seq of [1, 2, 3, 4]) {
            log = settle(log, { seq, outcome: 'parked', status: 409 });
        }

        return appendIntent(log, intent({ entity: 'recipe', intentKind: 'delete', localId: 'rec_1' }));
    }

    it('⛔ withdraws the update, the visibility and the membership of the deleted recipe, and only those', () => {
        const after = settle(parkedAround(), { seq: 5, outcome: 'synced', serverId: 'rec_1' });

        expect(after.records.map((record) => record.localId)).toStrictEqual(['rec_2']);
    });

    it('matches the entity by the id the server answered when the delete was queued under a local ref', () => {
        const log = settle(appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'rec_1' })), {
            seq: 1,
            outcome: 'parked',
            status: 500,
        });
        const withDelete = appendIntent(
            log,
            intent({
                entity: 'recipe',
                intentKind: 'delete',
                localId: 'local:recipe:r1',
                dependsOn: ['local:recipe:r1'],
            }),
        );

        expect(settle(withDelete, { seq: 2, outcome: 'synced', serverId: 'rec_1' }).records).toStrictEqual([]);
    });

    it('⛔ a synced update (or any non-delete) withdraws nothing', () => {
        const log = settle(
            appendIntent(
                appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'rec_1' })),
                intent({ entity: 'recipe', intentKind: 'setVisibility', localId: 'rec_1' }),
            ),
            { seq: 2, outcome: 'parked', status: 409 },
        );

        expect(
            settle(log, { seq: 1, outcome: 'synced', serverId: 'rec_1' }).records.map((record) => record.seq),
        ).toStrictEqual([2]);
    });

    it('does not touch a pending write of the entity: only what the cook was already told about', () => {
        const log = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'delete', localId: 'rec_1' })),
            intent({ entity: 'recipe', intentKind: 'setVisibility', localId: 'rec_1' }),
        );

        expect(
            settle(log, { seq: 1, outcome: 'synced', serverId: 'rec_1' }).records.map((record) => record.seq),
        ).toStrictEqual([2]);
    });
});

describe('withdraw — a blocked delete leaves with its producer', () => {
    it('⛔ removes a delete that the drain marked blocked behind the withdrawn create', () => {
        const REF = 'local:recipe:r1';
        const log: OutboxLog = {
            ...EMPTY,
            nextSeq: 3,
            records: [
                {
                    ...intent({ entity: 'recipe', intentKind: 'create', localId: REF, produces: REF }),
                    seq: 1,
                    state: 'parked',
                },
                {
                    ...intent({ entity: 'recipe', intentKind: 'delete', localId: REF, dependsOn: [REF] }),
                    seq: 2,
                    state: 'blocked',
                },
            ],
        };

        expect(withdraw(log, 1).records).toStrictEqual([]);
    });
});

describe('discardEntity — one consented change', () => {
    const del = (localId: string, dependsOn: readonly string[] = []): Intent =>
        intent({ entity: 'recipe', intentKind: 'delete', localId, dependsOn });

    it('⛔ a parked create (never published, outcome unknown): nothing is left queued, and it does not throw', () => {
        const REF = 'local:recipe:r1';
        const parked = settle(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: REF, produces: REF })),
            { seq: 1, outcome: 'parked' },
        );

        expect(discardEntity(parked, del(REF, [REF])).records).toStrictEqual([]);
    });

    it('⛔ a parked update of a recipe the server holds: it is withdrawn and the delete is queued', () => {
        const parked = settle(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'rec_1' })),
            { seq: 1, outcome: 'parked', status: 409 },
        );

        const after = discardEntity(parked, del('rec_1'));

        expect(after.records.map((record) => [record.intentKind, record.state])).toStrictEqual([['delete', 'pending']]);
    });

    it('a record on the wire gets the delete behind it', () => {
        const sending = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'rec_1' })),
            1,
        );

        expect(
            discardEntity(sending, del('rec_1')).records.map((record) => [record.intentKind, record.state]),
        ).toStrictEqual([
            ['update', 'sending'],
            ['delete', 'pending'],
        ]);
    });

    it('a pending record is superseded, and another entity`s parked record stays', () => {
        let log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'rec_2' }));
        log = settle(log, { seq: 1, outcome: 'parked', status: 409 });
        log = appendIntent(log, intent({ entity: 'recipe', intentKind: 'update', localId: 'rec_1' }));

        const after = discardEntity(log, del('rec_1'));

        expect(after.records.map((record) => [record.localId, record.intentKind, record.state])).toStrictEqual([
            ['rec_2', 'update', 'parked'],
            ['rec_1', 'delete', 'pending'],
        ]);
    });

    it('⛔ a create on the wire with a delete queued behind it, then the create parks: both go', () => {
        const REF = 'local:recipe:r1';
        const sending = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: REF, produces: REF })),
            1,
        );
        const discarded = discardEntity(sending, del(REF, [REF]));

        expect(discarded.records.map((record) => record.intentKind)).toStrictEqual(['create', 'delete']);
        expect(settle(discarded, { seq: 1, outcome: 'parked' }).records).toStrictEqual([]);
    });
});
