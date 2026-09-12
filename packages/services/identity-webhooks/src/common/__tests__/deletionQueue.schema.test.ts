/**
 * The deletion queue's message contract, asserted from BOTH ends.
 *
 * ## Why `erasure` requires `userId` at the schema, not in the handler
 *
 * `deletion-worker`'s `erasure` branch used to guard `userId` itself — `if (userId === undefined) { warn;
 * return; }`. Returning is an ACKNOWLEDGEMENT to Lambda's SQS event source: the message is deleted, never
 * retried, never DLQ'd, and the recipe/food erasure fan-out for that user is silently skipped forever — the
 * opposite of the module's own stated disposition ("an invalid message is our bug; it must reach the DLQ and
 * its alarm"). Every producer of an `erasure` sets `userId` (identity's `SqsService` types it required; the
 * tombstone-sweep copies `tombstone.id`), so its absence IS an invalid message. Making it required on the
 * `erasure` variant rejects it at parse time, where a throw already routes to the DLQ, and the handler's
 * `userId` becomes `string` by narrowing — the runtime check has nothing left to do and is gone.
 *
 * ## The producer side
 *
 * The identity service's `DeletionQueueMessage` is the shape it actually serialises. The type-level
 * assertion below fails `tsc` if that shape ever stops satisfying this schema's INPUT — the contract check
 * that neither package's unit suite could make on its own. (The tombstone-sweep's inline message is covered
 * by `tests/tombstoneSweep.integration.test.ts`, which parses the real bodies it enqueues.)
 *
 * ## Mutation check
 *
 * Widening `userId` back to optional on the erasure variant fails "rejects an erasure with no userId" and
 * the `Extract<…>['userId']` type assertion. Dropping `event` from the enum fails the lifecycle cases.
 * Replacing the union with a single object fails the narrowing assertion.
 */
import type { DeletionQueueMessage } from '@kitchensink/identity-service';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import { DELETION_EVENTS, idpDeletionMessageSchema, type IdpDeletionMessage } from '../deletionQueue.schema.js';

const IDENTITY = 'user_2abcDEF';
const USER = '01J0000000000000000000000A';
const WHEN = '2026-09-04T00:00:00.000Z';

describe('idpDeletionMessageSchema — what each producer sends', () => {
    it('accepts the identity service lifecycle messages (closure / reactivation), with a failureReason', () => {
        for (const event of ['closure', 'reactivation'] as const) {
            const parsed = idpDeletionMessageSchema.parse({
                identityId: IDENTITY,
                userId: USER,
                event,
                enqueuedAt: WHEN,
                failureReason: 'payment_failed',
            });

            expect(parsed).toEqual({ identityId: IDENTITY, userId: USER, event, enqueuedAt: WHEN });
        }
    });

    it('accepts the identity service erasure (user-initiated) and the tombstone-sweep erasure', () => {
        const fromService = idpDeletionMessageSchema.parse({
            identityId: IDENTITY,
            userId: USER,
            event: 'erasure',
            enqueuedAt: WHEN,
        });
        const fromSweep = idpDeletionMessageSchema.parse({
            identityId: IDENTITY,
            userId: USER,
            event: 'erasure',
            enqueuedAt: WHEN,
        });

        expect(fromService).toEqual({ identityId: IDENTITY, userId: USER, event: 'erasure', enqueuedAt: WHEN });
        expect(fromSweep).toEqual(fromService);
    });

    it('accepts the legacy user.deleted webhook message — identityId alone, no event', () => {
        expect(idpDeletionMessageSchema.parse({ identityId: IDENTITY })).toEqual({ identityId: IDENTITY });
    });

    it('names exactly the three lifecycle events, in one place', () => {
        expect(DELETION_EVENTS).toEqual(['closure', 'reactivation', 'erasure']);
    });
});

describe('idpDeletionMessageSchema — what is refused', () => {
    it('rejects an erasure with no userId — the fan-out has no subject, so this must DLQ, not ack', () => {
        expect(() => idpDeletionMessageSchema.parse({ identityId: IDENTITY, event: 'erasure' })).toThrow();
    });

    it('rejects an erasure with an EMPTY userId', () => {
        expect(() => idpDeletionMessageSchema.parse({ identityId: IDENTITY, userId: '', event: 'erasure' })).toThrow();
    });

    it.each([['closre'], ['Closure'], ['account.purge'], [''], [42]])('rejects the unrecognised event %j', (event) => {
        expect(() => idpDeletionMessageSchema.parse({ identityId: IDENTITY, userId: USER, event })).toThrow();
    });

    it('rejects a missing or empty identityId on every variant', () => {
        expect(() => idpDeletionMessageSchema.parse({})).toThrow();
        expect(() => idpDeletionMessageSchema.parse({ identityId: '' })).toThrow();
        expect(() => idpDeletionMessageSchema.parse({ identityId: '', userId: USER, event: 'erasure' })).toThrow();
    });

    it('rejects a non-ISO enqueuedAt rather than letting it become the idempotency key', () => {
        expect(() =>
            idpDeletionMessageSchema.parse({ identityId: IDENTITY, userId: USER, event: 'erasure', enqueuedAt: 'now' }),
        ).toThrow();
    });
});

describe('idpDeletionMessageSchema — the contract as TYPES', () => {
    it('narrows `userId` to a required string on the erasure variant', () => {
        expectTypeOf<Extract<IdpDeletionMessage, { event: 'erasure' }>['userId']>().toEqualTypeOf<string>();
        expectTypeOf<Exclude<IdpDeletionMessage, { event: 'erasure' }>['userId']>().toEqualTypeOf<string | undefined>();
    });

    it('is satisfied by the shape the identity service actually serialises', () => {
        expectTypeOf<DeletionQueueMessage>().toExtend<z.input<typeof idpDeletionMessageSchema>>();
    });
});
