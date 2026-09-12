/**
 * `recipeSender` — the thing that makes the queue actually send.
 *
 * ⛔ WITHOUT THIS THE QUEUE IS PLUMBING WITH THE WATER OFF. `SyncProvider` was mounted in both apps with a
 * sender that threw, so the provider ran, the notice rendered, and `pendingCount` was permanently 0 — the
 * layer existed and did nothing. This maps an intent onto the real client call.
 *
 * ⛔ AN INTENT IT CANNOT SEND IS PARKED, NOT THROWN AND NOT SILENTLY "SUCCEEDED". Both wrong answers lose
 * data, in opposite directions. Reporting `ok` drains the record and tells the cook it synced while nothing
 * reached the server. THROWING is what the first version did, and review disproved it: `drain` does not wrap
 * `send`, and `flush` saves only after `drain` RETURNS, so a throw at record N discards the successful sends
 * of records 1..N-1 and the next drain RE-SENDS them — at-least-once delivery, which `drainer.ts`'s header
 * states never happens and on which the no-server-change argument rests. A terminal `SendResult` refuses the
 * one record and leaves the rest of the drain intact.
 */
import { describe, expect, it, vi } from 'vitest';

import { BadRequestError, InvalidRequestError } from '@kitchensink/recipe-service-client';

import { recipeSender } from '../recipeSender.js';
import type { OutboxRecord } from '@kitchensink/sync';

/** A record of the given kind, with only the fields the sender reads. */
function record(intentKind: string, payload: unknown = {}, entity = 'recipe'): OutboxRecord {
    return { entity, intentKind, localId: 'r1', dependsOn: [], payload, state: 'pending' } as OutboxRecord;
}

describe('recipeSender', () => {
    it('sends an update through the client and reports the server id', async () => {
        const updateRecipe = vi.fn().mockResolvedValue({ id: 'srv-1' });
        const send = recipeSender(() => ({ updateRecipe }) as never);

        const result = await send(record('update', { id: 'r1', input: { title: 'edited' } }));

        expect(updateRecipe).toHaveBeenCalledWith('r1', { title: 'edited' });
        expect(result).toStrictEqual({ outcome: 'ok', serverId: 'srv-1' });
    });

    it('sends a create and reports the id the server assigned', async () => {
        const createRecipe = vi.fn().mockResolvedValue({ id: 'srv-new' });
        const send = recipeSender(() => ({ createRecipe }) as never);

        const result = await send(record('create', { input: { title: 'New' } }));

        expect(createRecipe).toHaveBeenCalledWith({ title: 'New' });
        expect(result).toStrictEqual({ outcome: 'ok', serverId: 'srv-new' });
    });

    it('sends a delete', async () => {
        const deleteRecipe = vi.fn().mockResolvedValue(undefined);
        const send = recipeSender(() => ({ deleteRecipe }) as never);

        expect(await send(record('delete', { id: 'r1' }))).toStrictEqual({ outcome: 'ok', serverId: 'r1' });
        expect(deleteRecipe).toHaveBeenCalledWith('r1');
    });

    /**
     * ⛔ A FAILURE IS REPORTED WITH ITS STATUS, so the drainer can classify it — transient retries, terminal
     * parks, unknown asks the cook. Swallowing the status would collapse all three into one.
     */
    it('⛔ reports a refusal with the status the drainer classifies on', async () => {
        // ⛔ A REAL `RecipeServiceClientError`, not `Object.assign(new Error(), {status})`. The duck-typed
        // fixture is what let the implementation read `.status` structurally; a fake that satisfies a shape
        // the real client never produces tests the fake, not the contract.
        const updateRecipe = vi.fn().mockRejectedValue(new BadRequestError('nope'));
        const send = recipeSender(() => ({ updateRecipe }) as never);

        expect(await send(record('update', { id: 'r1', input: {} }))).toStrictEqual({ outcome: 'failed', status: 400 });
    });

    /**
     * ⛔ A BODY THE CLIENT REFUSED LOCALLY IS TERMINAL, NOT `unknown`. `InvalidRequestError` is thrown from
     * `request()` BEFORE any HTTP call and carries no status, so a structural `.status` read classified it
     * `unknown` — which `itemStatus.ts` defines as "may have been processed server-side, so replaying it
     * could write twice". This write provably never left the process, and `unknown` is the classification
     * the entire no-blind-retry rule keys on, so polluting it is dangerous in the direction that matters.
     */
    it('⛔ classifies a locally-rejected body as terminal, not as an unknown outcome', async () => {
        const updateRecipe = vi.fn().mockRejectedValue(new InvalidRequestError('updateRecipe', new Error('zod')));
        const send = recipeSender(() => ({ updateRecipe }) as never);

        expect(await send(record('update', { id: 'r1', input: {} }))).toStrictEqual({ outcome: 'failed', status: 400 });
    });

    /** A non-object rejection used to throw a `TypeError` inside the catch and escape as a drain abort. */
    it('⛔ survives a rejection that is not an object at all', async () => {
        const updateRecipe = vi.fn().mockRejectedValue(null);
        const send = recipeSender(() => ({ updateRecipe }) as never);

        expect(await send(record('update', { id: 'r1', input: {} }))).toStrictEqual({ outcome: 'failed' });
    });

    /** An outcome with no status is `unknown` to the drainer, which asks the cook rather than replaying. */
    it('⛔ reports a statusless failure without inventing one', async () => {
        const updateRecipe = vi.fn().mockRejectedValue(new Error('socket died'));
        const send = recipeSender(() => ({ updateRecipe }) as never);

        expect(await send(record('update', { id: 'r1', input: {} }))).toStrictEqual({ outcome: 'failed' });
    });

    /**
     * ⛔ AN UNSUPPORTED KIND PARKS THE ONE RECORD — it neither reports success nor aborts the drain. `501` is
     * not `409` and is not in the transient set, so `classifyFailure` calls it terminal and it surfaces in
     * `failures` for the cook instead of being retried forever or vanishing.
     */
    it('⛔ parks an intent kind it cannot send, without aborting the drain', async () => {
        const send = recipeSender(() => ({}) as never);

        expect(await send(record('setVisibility'))).toStrictEqual({ outcome: 'failed', status: 501 });
    });

    /**
     * ⛔ THE ONE PATH THAT COULD REPORT A FALSE SUCCESS, and the suite could not see it. Dispatch switched on
     * `intentKind` alone while `SyncEntity` is `recipe|ingredient|photo|collection` over ONE queue with ONE
     * injected sender — so a collection create called `client.createRecipe` with a collection's payload and
     * reported `ok`. A wrong-entity write, recorded as synced. Every prior case here used `entity: 'recipe'`.
     */
    it('⛔ refuses a record for another entity instead of writing it into recipes', async () => {
        const createRecipe = vi.fn().mockResolvedValue({ id: 'srv-wrong' });
        const send = recipeSender(() => ({ createRecipe }) as never);

        expect(await send(record('create', { input: { name: 'Weeknight' } }, 'collection'))).toStrictEqual({
            outcome: 'failed',
            status: 501,
        });
        expect(createRecipe).not.toHaveBeenCalled();
    });

    it('⛔ throws when no client is available, rather than dropping the write', async () => {
        const send = recipeSender(() => undefined);

        await expect(send(record('update', { id: 'r1', input: {} }))).rejects.toThrow(/no client/iu);
    });
});
