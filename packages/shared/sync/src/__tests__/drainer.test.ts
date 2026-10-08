/**
 * The drainer — sending queued intents when connectivity returns.
 *
 * ⛔ WRITTEN FROM THE SPECIFICATION, BEFORE THE IMPLEMENTATION EXISTS.
 *
 * ## The rule that removes the need for server-side idempotency
 *
 * > The drainer auto-retries ONLY a request that demonstrably did not reach the server. A request whose
 * > outcome is UNKNOWN — a timeout, a socket dropped mid-send — becomes `failed` + retryable, and the USER
 * > presses Retry.
 *
 * Because at-least-once delivery therefore never happens behind the cook's back, nothing needs to be
 * idempotent that is not already: no client-minted recipe id, no upsert, no unique index on a photo key.
 * That is a large amount of server work this one rule deletes, which is why it is asserted here rather than
 * left as prose.
 */
import { describe, expect, it, vi } from 'vitest';

import { MAX_INLINE_WAIT_MS, drain, type DrainJournal, type SendResult, type Sender } from '../drainer.js';
import { EMPTY_OUTBOX, appendIntent, markSending, settle, type OutboxLog } from '../outboxLog.js';
import type { Intent, OutboxRecord } from '../record.js';

const EMPTY: OutboxLog = EMPTY_OUTBOX;

/** A sleep that returns at once, recording what it was asked to wait. */
function recordingSleep(): { readonly sleep: (ms: number) => Promise<void>; readonly waits: number[] } {
    const waits: number[] = [];

    return {
        sleep: async (ms: number) => {
            waits.push(ms);
        },
        waits,
    };
}

const noSleep = { sleep: async (): Promise<void> => undefined };

/** A one-record log whose record has been parked with `status`. */
function parkedWith(status: number | undefined, over: Partial<Intent> = {}): OutboxLog {
    const queued = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1', ...over }));

    return settle(queued, { seq: 1, outcome: 'parked', ...(status === undefined ? {} : { status }) });
}

function intent(over: Partial<Intent> & Pick<Intent, 'entity' | 'intentKind' | 'localId'>): Intent {
    return { dependsOn: [], payload: {}, ...over } as Intent;
}

/** A sender that answers each call from a queue of scripted results. */
function scripted(...results: readonly SendResult[]): Sender {
    const queue = [...results];

    return vi.fn(async (): Promise<SendResult> => queue.shift() ?? { outcome: 'ok', serverId: 'srv' });
}

describe('drain — the happy path', () => {
    it('sends every pending intent and empties the log', async () => {
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        const after = await drain(log, scripted({ outcome: 'ok', serverId: 'srv-1' }));

        expect(after.log.records).toStrictEqual([]);
        expect(after.synced).toStrictEqual([{ entity: 'recipe', localId: 'r1', serverId: 'srv-1' }]);
    });

    /**
     * ⛔ SERIAL, NOT PARALLEL, and that is a decision rather than laziness. A recipe with three new freeform
     * ingredients issues four writes; a fleet of devices reconnecting after an outage would otherwise arrive
     * as a thundering herd at a single Fargate task. It is also what makes ordering observable at all.
     */
    it('⛔ sends one at a time, in dependency order', async () => {
        const order: string[] = [];
        const sender: Sender = vi.fn(async (record): Promise<SendResult> => {
            order.push(record.localId);

            return { outcome: 'ok', serverId: `srv-${record.localId}` };
        });
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

        await drain(log, sender);

        expect(order).toStrictEqual(['x', 'r1']);
    });

    /** The substitution the dependency edge exists for: the recipe is sent with the server's real id. */
    it('⛔ substitutes the produced id into the dependent intent before sending it', async () => {
        const sent: unknown[] = [];
        const sender: Sender = vi.fn(async (record): Promise<SendResult> => {
            sent.push(record.payload);

            return { outcome: 'ok', serverId: 'srv-real' };
        });
        const log = appendIntent(
            appendIntent(
                EMPTY,
                intent({
                    entity: 'recipe',
                    intentKind: 'create',
                    localId: 'r1',
                    dependsOn: ['local:ingredient:x'],
                    payload: { ingredients: [{ ingredientId: 'local:ingredient:x' }] },
                }),
            ),
            intent({
                entity: 'ingredient',
                intentKind: 'createFreeform',
                localId: 'x',
                produces: 'local:ingredient:x',
            }),
        );

        await drain(log, sender);

        expect(sent[1]).toStrictEqual({ ingredients: [{ ingredientId: 'srv-real' }] });
    });
});

describe('drain — failure handling', () => {
    it('retries a transient refusal, which the server did not process', async () => {
        const sender = scripted({ outcome: 'failed', status: 503 }, { outcome: 'ok', serverId: 'srv-1' });
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        const after = await drain(log, sender, noSleep);

        expect(sender).toHaveBeenCalledTimes(2);
        expect(after.log.records).toStrictEqual([]);
    });

    /**
     * ⛔ THE RULE THAT DELETES THE SERVER WORK. An unknown outcome may ALREADY have been applied, so a replay
     * could write twice. It must park for the cook rather than retry — and the record must survive, because
     * the cook was told the write was saved.
     */
    it('⛔ NEVER auto-retries an unknown outcome — it parks for the user', async () => {
        const sender = scripted({ outcome: 'failed' });
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        const after = await drain(log, sender);

        expect(sender).toHaveBeenCalledTimes(1);
        expect(after.log.records[0]?.state).toBe('parked');
    });

    it('⛔ parks a terminal refusal without retrying it — the answer will not change', async () => {
        const sender = scripted({ outcome: 'failed', status: 422 });
        const log = appendIntent(EMPTY, intent({ entity: 'ingredient', intentKind: 'createFreeform', localId: 'x' }));

        const after = await drain(log, sender);

        expect(sender).toHaveBeenCalledTimes(1);
        expect(after.log.records[0]?.state).toBe('parked');
    });

    it('⛔ parks a conflict carrying what the resolver needs, rather than discarding the draft', async () => {
        const sender = scripted({ outcome: 'failed', status: 409 });
        const log = appendIntent(
            EMPTY,
            intent({ entity: 'recipe', intentKind: 'update', localId: 'r1', payload: { title: 'mine' } }),
        );

        const after = await drain(log, sender);

        expect(after.log.records[0]?.state).toBe('parked');
        expect(after.log.records[0]?.payload).toStrictEqual({ title: 'mine' });
    });

    /**
     * ⛔ A BLOCKED DEPENDENT IS NOT A FAILURE OF ITS OWN. If the ingredient parks, the recipe that embeds it
     * must NOT be sent (its id would be unresolved) and must NOT be reported as failed — the cook has one
     * problem to fix, not two. Reporting both is how an error state becomes noise.
     */
    it('⛔ blocks a dependent when its dependency parks, and does not send or fail it', async () => {
        const sender = scripted({ outcome: 'failed', status: 422 });
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

        const after = await drain(log, sender);

        expect(sender).toHaveBeenCalledTimes(1);
        expect(after.log.records.find((record) => record.localId === 'r1')?.state).toBe('blocked');
        expect(after.failed.map((failure) => failure.localId)).toStrictEqual(['x']);
    });

    /** Independent entities keep draining — one bad ingredient must not strand an unrelated recipe. */
    it('keeps draining intents that do not depend on the failed one', async () => {
        const sender = scripted({ outcome: 'failed', status: 422 }, { outcome: 'ok', serverId: 'srv-2' });
        const log = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'ingredient', intentKind: 'createFreeform', localId: 'x' })),
            intent({ entity: 'recipe', intentKind: 'update', localId: 'unrelated' }),
        );

        const after = await drain(log, sender);

        expect(after.synced.map((item) => item.localId)).toStrictEqual(['unrelated']);
    });
});

/**
 * ⛔ A TRANSIENT REFUSAL IS RE-SENT AFTER A WAIT, NEVER IMMEDIATELY. The three attempts used to run back to back, which
 * is the thundering herd the serial drain exists to avoid, and a `429` is the one status where waiting is not
 * optional. The wait is "full jitter" (a uniform draw under an exponential ceiling) so a fleet reconnecting together
 * spreads out, and a `Retry-After` the server stated is a floor under it.
 */
describe('drain — backoff', () => {
    it('waits a full-jitter delay under a doubling ceiling between transient attempts', async () => {
        const { sleep, waits } = recordingSleep();
        const sender = scripted(
            { outcome: 'failed', status: 503 },
            { outcome: 'failed', status: 503 },
            { outcome: 'ok', serverId: 'srv-1' },
        );
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        const after = await drain(log, sender, { sleep, random: () => 0.5 });

        expect(waits).toStrictEqual([250, 500]);
        expect(after.log.records).toStrictEqual([]);
    });

    it('waits at least as long as the server’s Retry-After', async () => {
        const { sleep, waits } = recordingSleep();
        const sender = scripted(
            { outcome: 'failed', status: 429, retryAfterSeconds: 2 },
            { outcome: 'ok', serverId: 's' },
        );
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        await drain(log, sender, { sleep, random: () => 0.5 });

        expect(waits).toStrictEqual([2000]);
    });

    /**
     * ⛔ A LONG WAIT ENDS THE DRAIN; IT DOES NOT SLEEP INSIDE IT. The drain is serial and holds the queue's one drain
     * slot, so sleeping for a minute would stall every other record. The record goes back to pending, nothing after
     * it is sent (the server asked this client to back off), and the report says when to come back.
     */
    it('⛔ ends the drain on a wait beyond the inline budget, leaves the record pending, and says when to return', async () => {
        const { sleep, waits } = recordingSleep();
        const sender = scripted({ outcome: 'failed', status: 429, retryAfterSeconds: 60 });
        const log = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            intent({ entity: 'recipe', intentKind: 'update', localId: 'r2' }),
        );

        const after = await drain(log, sender, { sleep, random: () => 0.5 });

        expect(waits).toStrictEqual([]);
        expect(sender).toHaveBeenCalledTimes(1);
        expect(after.retryAfterMs).toBe(60_000);
        expect(after.retryAfterMs).toBeGreaterThan(MAX_INLINE_WAIT_MS);
        expect(after.log.records.map((record) => record.state)).toStrictEqual(['pending', 'pending']);
        expect(after.failed).toStrictEqual([]);
    });

    it('parks a transient refusal that outlasts its attempts, keeping the status', async () => {
        const sender = scripted(
            { outcome: 'failed', status: 503 },
            { outcome: 'failed', status: 503 },
            { outcome: 'failed', status: 503 },
        );
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        const after = await drain(log, sender, noSleep);

        expect(sender).toHaveBeenCalledTimes(3);
        expect(after.log.records.map((record) => [record.state, record.lastStatus])).toStrictEqual([['parked', 503]]);
    });

    it('does not wait after a success, or before the first attempt', async () => {
        const { sleep, waits } = recordingSleep();
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        await drain(log, scripted({ outcome: 'ok', serverId: 's' }), { sleep, random: () => 0.5 });

        expect(waits).toStrictEqual([]);
    });
});

/**
 * ⛔ A PARKED RECORD IS RE-SENT ONLY WHEN RE-SENDING CANNOT WRITE TWICE. Every drain used to iterate every record,
 * parked or not, so an UNKNOWN outcome — parked precisely because it may already have been applied — was re-sent
 * on the next reconnect: the blind retry the rule above forbids, one trigger later.
 */
describe('drain — what a parked record waits for', () => {
    it.each([
        ['an unknown outcome', undefined],
        ['a conflict', 409],
        ['a terminal refusal', 422],
    ])('⛔ does not re-send %s; it waits for the cook', async (_label, status) => {
        const sender = scripted();

        const after = await drain(parkedWith(status), sender, noSleep);

        expect(sender).not.toHaveBeenCalled();
        expect(after.log.records.map((record) => record.state)).toStrictEqual(['parked']);
        expect(after.failed).toStrictEqual([]);
    });

    it.each([
        ['a transient refusal that outlasted its attempts', 503],
        ['a record whose cook was signed out (nothing was sent)', 401],
    ])('re-sends %s', async (_label, status) => {
        const sender = scripted({ outcome: 'ok', serverId: 'srv-1' });

        const after = await drain(parkedWith(status), sender, noSleep);

        expect(sender).toHaveBeenCalledTimes(1);
        expect(after.log.records).toStrictEqual([]);
    });

    /**
     * ⛔ A RECORD ALREADY `sending` IS NOT THIS DRAIN'S TO SEND. Drains are serialized, so one found `sending` is a
     * request whose answer was never written down (its settle failed): its outcome is unknown. Re-sending it is a
     * blind retry; it waits, and the next process start parks it.
     */
    it('⛔ never sends a record that is already marked sending', async () => {
        const sending = markSending(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            1,
        );
        const sender = scripted();

        const after = await drain(sending, sender, noSleep);

        expect(sender).not.toHaveBeenCalled();
        expect(after.log.records.map((record) => record.state)).toStrictEqual(['sending']);
    });

    it('keeps a dependent of a parked record it skipped blocked', async () => {
        const parked = parkedWith(422, {
            entity: 'ingredient',
            intentKind: 'createFreeform',
            localId: 'x',
            produces: 'local:ingredient:x',
        });
        const log = appendIntent(
            parked,
            intent({ entity: 'recipe', intentKind: 'create', localId: 'r1', dependsOn: ['local:ingredient:x'] }),
        );
        const sender = scripted();

        const after = await drain(log, sender, noSleep);

        expect(sender).not.toHaveBeenCalled();
        expect(after.log.records.map((record) => record.state)).toStrictEqual(['parked', 'blocked']);
    });
});

/**
 * ⛔ AN ID RESOLVED BY AN EARLIER DRAIN STAYS RESOLVED. A checkpoint `update` queued after its `create` already synced
 * has no producer left in the log; without the persisted map it would be sent with the `local:` placeholder in it.
 */
describe('drain — resolutions outlive the drain that made them', () => {
    it('substitutes an id an earlier drain resolved, and carries new resolutions out', async () => {
        const sent: unknown[] = [];
        const sender: Sender = vi.fn(async (record): Promise<SendResult> => {
            sent.push(record.payload);

            return { outcome: 'ok', serverId: 'srv-ingredient' };
        });
        const resolved: OutboxLog = { ...EMPTY, resolutions: { 'local:recipe:r1': 'srv-recipe' } };
        const log = appendIntent(
            resolved,
            intent({
                entity: 'ingredient',
                intentKind: 'createFreeform',
                localId: 'x',
                produces: 'local:ingredient:x',
                dependsOn: ['local:recipe:r1'],
                payload: { id: 'local:recipe:r1' },
            }),
        );

        const after = await drain(log, sender, noSleep);

        expect(sent).toStrictEqual([{ id: 'srv-recipe' }]);
        expect(after.log.resolutions).toStrictEqual({
            'local:recipe:r1': 'srv-recipe',
            'local:ingredient:x': 'srv-ingredient',
        });
    });
});

/**
 * ⛔ EVERY STEP IS JOURNALLED AS IT HAPPENS. The record is marked `sending` BEFORE the request and settled right AFTER
 * it, so a crash at any point leaves storage telling the truth: a record that died mid-send is known to be of
 * unknown outcome, and a record that synced is gone.
 */
describe('drain — the journal', () => {
    it('marks each record sending before it is sent and settles it as soon as it answers', async () => {
        const events: string[] = [];
        const journal: DrainJournal = {
            claim: async (seq) => {
                events.push(`sending:${String(seq)}`);

                return true;
            },
            settle: async (settlement) => {
                events.push(`${settlement.outcome}:${String(settlement.seq)}`);
            },
        };
        const sender: Sender = vi.fn(async (record: OutboxRecord): Promise<SendResult> => {
            events.push(`send:${String(record.seq)}`);

            return record.localId === 'r1' ? { outcome: 'ok', serverId: 's' } : { outcome: 'failed', status: 422 };
        });
        const log = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' })),
            intent({ entity: 'recipe', intentKind: 'update', localId: 'r2' }),
        );

        await drain(log, sender, { ...noSleep, journal });

        expect(events).toStrictEqual(['sending:1', 'send:1', 'synced:1', 'sending:2', 'send:2', 'parked:2']);
    });
});

/**
 * ⛔ THE DRAIN SENDS ONLY WHAT IT CAN CLAIM. It walks a snapshot over network time, and the cook keeps editing: a record
 * in the snapshot may have been replaced by a newer edit, or deleted with its entity, by the time its turn comes. The
 * claim is checked against the log as stored now, and a record it cannot claim is neither sent nor settled.
 */
describe('drain — the claim', () => {
    it('⛔ neither sends nor settles a record the journal will not claim', async () => {
        const settled: number[] = [];
        const journal: DrainJournal = {
            claim: async (seq) => seq !== 1,
            settle: async (settlement) => {
                settled.push(settlement.seq);
            },
        };
        const sent: string[] = [];
        const sender: Sender = vi.fn(async (record): Promise<SendResult> => {
            sent.push(record.localId);

            return { outcome: 'ok', serverId: 's' };
        });
        const log = appendIntent(
            appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'create', localId: 'r1' })),
            intent({ entity: 'recipe', intentKind: 'update', localId: 'r2' }),
        );

        await drain(log, sender, { ...noSleep, journal });

        expect(sent).toStrictEqual(['r2']);
        expect(settled).toStrictEqual([2]);
    });

    /**
     * ⛔ A PAYLOAD IS NEVER SENT WITH A PLACEHOLDER IN IT. A dependent whose producer could not be claimed — or was
     * queued after this drain read its snapshot — has no id to substitute yet. It waits, pending, for a later drain.
     */
    it('⛔ leaves a dependent pending, unsent, while the id it needs is unresolved', async () => {
        const journal: DrainJournal = {
            claim: async (seq) => seq !== 1,
            settle: async () => undefined,
        };
        const sender = scripted();
        const log = appendIntent(
            appendIntent(
                EMPTY,
                intent({ entity: 'recipe', intentKind: 'create', localId: 'r1', produces: 'local:recipe:r1' }),
            ),
            intent({
                entity: 'recipe',
                intentKind: 'update',
                localId: 'r1-update',
                dependsOn: ['local:recipe:r1'],
                payload: { id: 'local:recipe:r1' },
            }),
        );

        const after = await drain(log, sender, { ...noSleep, journal });

        expect(sender).not.toHaveBeenCalled();
        expect(after.log.records.map((record) => record.state)).toStrictEqual(['pending', 'pending']);
    });
});

/**
 * ⛔ A WAIT THE SERVER STATED HOLDS FOR THE WHOLE OUTBOX, ACROSS DRAINS. A deferral returns the record to pending, so
 * without a stored "not before" the next `submit` — a checkpoint every few seconds — would re-send it at once and the
 * `Retry-After` would mean nothing.
 */
describe('drain — a pause the server asked for', () => {
    it('⛔ sends nothing before the stated time, and reports how long is left', async () => {
        let now = 1_000_000;
        const sender = scripted({ outcome: 'failed', status: 429, retryAfterSeconds: 60 });
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        const deferred = await drain(log, sender, { ...noSleep, now: () => now });
        now += 5_000;
        const tooSoon = await drain(
            appendIntent(deferred.log, intent({ entity: 'recipe', intentKind: 'update', localId: 'r2' })),
            sender,
            {
                ...noSleep,
                now: () => now,
            },
        );

        expect(deferred.log.pausedUntil).toBe(1_060_000);
        expect(sender).toHaveBeenCalledTimes(1);
        expect(tooSoon.retryAfterMs).toBe(55_000);
        expect(tooSoon.log.records.map((record) => record.state)).toStrictEqual(['pending', 'pending']);
    });

    it('sends again once the stated time has passed', async () => {
        let now = 1_000_000;
        const sender = scripted(
            { outcome: 'failed', status: 429, retryAfterSeconds: 60 },
            { outcome: 'ok', serverId: 's' },
        );
        const log = appendIntent(EMPTY, intent({ entity: 'recipe', intentKind: 'update', localId: 'r1' }));

        const deferred = await drain(log, sender, { ...noSleep, now: () => now });
        now += 60_000;
        const later = await drain(deferred.log, sender, { ...noSleep, now: () => now });

        expect(sender).toHaveBeenCalledTimes(2);
        expect(later.log.records).toStrictEqual([]);
    });
});
