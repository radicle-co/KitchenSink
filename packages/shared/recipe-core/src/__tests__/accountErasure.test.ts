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

import { pseudonymizedAuthorHandle, type AccountErasureMessage } from '../accountErasure.js';

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
