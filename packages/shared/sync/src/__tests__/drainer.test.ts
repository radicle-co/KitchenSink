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

import { drain, type SendResult, type Sender } from '../drainer.js';
import { appendIntent, type OutboxLog } from '../outboxLog.js';
import type { Intent } from '../record.js';

const EMPTY: OutboxLog = { records: [] };

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

        const after = await drain(log, sender);

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
