/**
 * Unit tests for the shared GDPR account-erasure contract (CR-002 / C-007).
 *
 * Pins the two pieces of cross-package knowledge this module owns:
 *   - {@link AccountErasureMessage} carries the optional per-recipe donate election (U3b), so a producer
 *     and the worker/sweeper consumer cannot drift on its shape;
 *   - {@link pseudonymizedAuthorHandle} is the ONE authoritative derivation of a kept recipe's post-erasure
 *     author handle — deterministic and injective, so kept recipes render a consistent author and two
 *     erased owners never collapse onto one identity.
 */
import { describe, it, expect } from 'vitest';

import {
    ERASURE_QUEUE_MESSAGE_KINDS,
    erasureQueueMessageKind,
    pseudonymizedAuthorHandle,
    type AccountErasureMessage,
    type ErasureQueueMessage,
    type TestPrincipalResetMessage,
} from '../accountErasure.js';

const OWNER_A = '01JQ8N2X4RBV6WK3ZT5Y7A9C0P';
const OWNER_B = '01JQ8N2X4RBV6WK3ZT5Y7A9C1Q';

describe('AccountErasureMessage', () => {
    it('accepts a message with a donate election', () => {
        const message: AccountErasureMessage = {
            ownerId: OWNER_A,
            requestedAt: '2026-07-10T00:00:00.000Z',
            publishRecipeIds: ['00000000-0000-4000-8000-0000000000r1'],
        };

        expect(message.publishRecipeIds).toEqual(['00000000-0000-4000-8000-0000000000r1']);
    });

    it('treats the election as optional (rollout tolerance — a message without it is still valid)', () => {
        // The durable job row is the source of truth; a pre-election producer (or the eager path before
        // the row is read back) may omit it, and that MUST be a valid message, not a rejected one.
        const message: AccountErasureMessage = { ownerId: OWNER_A, requestedAt: '2026-07-10T00:00:00.000Z' };

        expect(message.publishRecipeIds).toBeUndefined();
    });
});

describe('ErasureQueueMessage — the queue carries two kinds of work (ADR-0040)', () => {
    it('names exactly the two kinds the worker dispatches on', () => {
        expect([...ERASURE_QUEUE_MESSAGE_KINDS]).toEqual(['accountErasure', 'testPrincipalReset']);
    });

    it('reads an explicit `testPrincipalReset` as a reset', () => {
        const message: TestPrincipalResetMessage = {
            kind: 'testPrincipalReset',
            ownerId: OWNER_A,
            requestedAt: '2026-09-13T00:00:00.000Z',
        };

        expect(erasureQueueMessageKind(message)).toBe('testPrincipalReset');
    });

    it('reads an explicit `accountErasure` as an erasure', () => {
        const message: ErasureQueueMessage = {
            kind: 'accountErasure',
            ownerId: OWNER_A,
            requestedAt: '2026-09-13T00:00:00.000Z',
        };

        expect(erasureQueueMessageKind(message)).toBe('accountErasure');
    });

    it('⛔ reads a message with NO kind as an erasure — every message produced before ADR-0040 must be honoured', () => {
        expect(erasureQueueMessageKind({ ownerId: OWNER_A, requestedAt: '2026-07-10T00:00:00.000Z' })).toBe(
            'accountErasure',
        );
    });

    it.each([['accountErasure '], ['TestPrincipalReset'], ['reset'], [42], [null], [true]])(
        '⛔ REFUSES an unrecognised kind (%s) instead of defaulting it to an erasure',
        (kind) => {
            // A future kind an old consumer does not know must fail the delivery, never run the most destructive
            // work in the system under a name it was not given.
            expect(erasureQueueMessageKind({ kind, ownerId: OWNER_A })).toBeUndefined();
        },
    );

    it('refuses a body that is not an object', () => {
        expect(erasureQueueMessageKind('testPrincipalReset')).toBeUndefined();
        expect(erasureQueueMessageKind(null)).toBeUndefined();
        expect(erasureQueueMessageKind(['testPrincipalReset'])).toBeUndefined();
    });
});

describe('pseudonymizedAuthorHandle', () => {
    it('derives a stable handle from the ULID so every kept recipe renders a CONSISTENT author', () => {
        expect(pseudonymizedAuthorHandle(OWNER_A)).toBe(pseudonymizedAuthorHandle(OWNER_A));
        expect(pseudonymizedAuthorHandle(OWNER_A)).toBe(`user_${OWNER_A}`);
    });

    it('is injective — distinct owners never collapse to the same author (no misattribution)', () => {
        // Two erased owners mapping to one handle would attribute one user's public recipes to another.
        // Embedding the whole ULID (not a truncation) makes distinctness guaranteed, not probabilistic.
        expect(pseudonymizedAuthorHandle(OWNER_A)).not.toBe(pseudonymizedAuthorHandle(OWNER_B));
    });

    it('contains no cleartext name — it is derived only from the pseudonymous ULID', () => {
        // The ULID is the identifier GDPR-legitimately retains on recipes.owner_id; the handle carries
        // nothing else (no display name / email / Clerk handle).
        expect(pseudonymizedAuthorHandle(OWNER_A)).toContain(OWNER_A);
    });
});
