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

import { SessionSubjectChangedError } from '@commise/features-account';
import { BadRequestError, InvalidRequestError, VersionConflictError } from '@kitchensink/recipe-service-client';
import type { VersionConflictSide } from '@kitchensink/recipe-core';
import { makeRecipeVersion } from '@kitchensink/recipe-core/testing';
import { classifyFailure, type OutboxRecord } from '@kitchensink/sync';

import { recipeSender } from '../recipeSender.js';

/** A record of the given kind, with only the fields the sender reads. */
function record(intentKind: string, payload: unknown = {}, entity = 'recipe'): OutboxRecord {
    return { entity, intentKind, localId: 'r1', dependsOn: [], payload, seq: 1, state: 'pending' } as OutboxRecord;
}

/** One side of a version conflict, at `versionNumber`. */
function sideAt(versionNumber: number): VersionConflictSide {
    const { snapshot } = makeRecipeVersion({ versionNumber });

    return { versionNumber, updatedAt: '2026-10-09T00:00:00.000Z', snapshot };
}

describe('recipeSender', () => {
    /**
     * REWRITTEN for slice 7: a write's answer now travels with it. The editor that queued the update reads the version
     * it produced from `answer` (ADR-0057: "the editor owns the CAS token"), so the recipe the server returned is part of
     * the result, not only its id.
     */
    it('sends an update through the client and reports the server id and the recipe it returned', async () => {
        const updateRecipe = vi.fn().mockResolvedValue({ id: 'srv-1', currentVersion: 5 });
        const send = recipeSender(() => ({ updateRecipe }) as never);

        const result = await send(record('update', { id: 'r1', input: { title: 'edited' } }));

        expect(updateRecipe).toHaveBeenCalledWith('r1', { title: 'edited' });
        expect(result).toStrictEqual({
            outcome: 'ok',
            serverId: 'srv-1',
            answer: { kind: 'recipeWritten', detail: { id: 'srv-1', currentVersion: 5 } },
        });
    });

    it('sends a create and reports the id the server assigned, with the recipe it returned', async () => {
        const createRecipe = vi.fn().mockResolvedValue({ id: 'srv-new', currentVersion: 1 });
        const send = recipeSender(() => ({ createRecipe }) as never);

        const result = await send(record('create', { input: { title: 'New' } }));

        expect(createRecipe).toHaveBeenCalledWith({ title: 'New' });
        expect(result).toStrictEqual({
            outcome: 'ok',
            serverId: 'srv-new',
            answer: { kind: 'recipeWritten', detail: { id: 'srv-new', currentVersion: 1 } },
        });
    });

    /**
     * ⛔ A 409 CARRIES ITS TWO SIDES AS DATA. The conflict view is built from the server's winning side and the base the
     * edit started from, and the queued write is the only thing that saw the response — dropping them here would leave
     * the editor a bare 409 with nothing to show.
     */
    it('⛔ reports a version conflict as a 409 carrying the server`s side and the base', async () => {
        const server = sideAt(7);
        const base = sideAt(6);
        const updateRecipe = vi.fn().mockRejectedValue(new VersionConflictError(7, 6, 'conflict', { server, base }));
        const send = recipeSender(() => ({ updateRecipe }) as never);

        expect(await send(record('update', { id: 'r1', input: {} }))).toStrictEqual({
            outcome: 'failed',
            status: 409,
            answer: { kind: 'recipeConflict', server, base },
        });
    });

    it('a draft`s 409 has no base, and none is invented (ADR-0058)', async () => {
        const server = sideAt(3);
        const updateRecipe = vi.fn().mockRejectedValue(new VersionConflictError(3, 2, 'conflict', { server }));
        const send = recipeSender(() => ({ updateRecipe }) as never);

        expect(await send(record('update', { id: 'r1', input: {} }))).toStrictEqual({
            outcome: 'failed',
            status: 409,
            answer: { kind: 'recipeConflict', server },
        });
    });

    it('a 409 with no server side is a plain refusal, with no answer to build a view from', async () => {
        const updateRecipe = vi.fn().mockRejectedValue(new VersionConflictError(3, 2));
        const send = recipeSender(() => ({ updateRecipe }) as never);

        expect(await send(record('update', { id: 'r1', input: {} }))).toStrictEqual({ outcome: 'failed', status: 409 });
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
    /**
     * ⛔ A RECORD SENT AFTER ITS COOK'S SESSION ENDED IS REFUSED BEFORE ANY REQUEST (ADR-0054), by the token proxy the
     * client was built with. Nothing left the device, so the outcome is not `unknown` ("may have been processed"), and
     * it must not be `transient` either: re-sending at once only meets the same refusal. It parks, and drains again the
     * next time its own cook signs in.
     */
    it('⛔ parks a record whose cook is no longer signed in, without saying it may have been processed', async () => {
        const updateRecipe = vi.fn().mockRejectedValue(new SessionSubjectChangedError());
        const send = recipeSender(() => ({ updateRecipe }) as never);

        const result = await send(record('update', { id: 'r1', input: {} }));

        expect(result).toStrictEqual({ outcome: 'failed', status: 401 });
        expect(classifyFailure({ entity: 'recipe', intentKind: 'update', localId: 'r1', status: 401 })).toBe(
            'terminal',
        );
    });

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
