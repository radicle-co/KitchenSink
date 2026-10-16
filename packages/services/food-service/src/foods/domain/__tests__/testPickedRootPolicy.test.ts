/**
 * Unit tests for `testPickedRootPolicy` (ADR-0040, food half; owner ruling 2026-10-16 "Clean up test-picked foods") —
 * written RED-first.
 *
 * Three questions, each answered from its inputs alone:
 *
 *  - WHO a created root is attributed to (`attributionOf`): only a signed test principal with a synced ULID. A real
 *    cook's root is never recorded, so nothing the test purge reads can ever name it.
 *  - WHO places a hold on a root (`marksRealHold`): a real cook answering it, never a test principal.
 *  - WHICH roots a test principal's purge may delete (`isPurgeablePickedRoot`): its own creation, and nothing that
 *    anyone else relies on. Every "kept" row is a root a normal cook's flow could depend on.
 *
 * The purgeable table flips each fact singly away from the one deletable shape, so a predicate that dropped any one
 * conjunct shows here as a `true` that should be `false` (the mutation lens).
 */
import { describe, expect, it } from 'vitest';

import { attributionOf, isPurgeablePickedRoot, marksRealHold, type PickedRootFacts } from '../testPickedRootPolicy.js';

const POOL_ULID = '01J9ZK8N7QF3B2X4M6T0V5C3AA';
const OTHER_POOL_ULID = '01J9ZK8N7QF3B2X4M6T0V5C3AC';
const REAL_ULID = '01J9ZK8N7QF3B2X4M6T0V5C3AB';

/** The one deletable shape: a pool slot's own, catalog-shaped, not seed-owned, unshared, variant-less root. */
const DELETABLE: PickedRootFacts = {
    createdBy: POOL_ULID,
    heldByRealUser: false,
    authorId: null,
    seedOwned: false,
    hasVariants: false,
    status: 'RESOLVED',
};

describe('attributionOf', () => {
    it.each([
        [
            'a signed test principal with a synced ULID',
            { testPrincipal: true, sub: 'user_p', userId: POOL_ULID },
            POOL_ULID,
        ],
        [
            'a signed test principal whose ULID has not synced',
            { testPrincipal: true, sub: 'user_p', userId: undefined },
            undefined,
        ],
        ['a service principal carrying the claim', { testPrincipal: true, sub: 'svc_x', userId: POOL_ULID }, undefined],
        ['a real cook', { testPrincipal: false, sub: 'user_r', userId: REAL_ULID }, undefined],
        [
            'a real cook whose ULID has not synced',
            { testPrincipal: false, sub: 'user_r', userId: undefined },
            undefined,
        ],
    ] as const)('%s', (_name, principal, expected) => {
        expect(attributionOf(principal)).toBe(expected);
    });
});

describe('marksRealHold', () => {
    it('a real cook answering a root holds it', () => {
        expect(marksRealHold({ testPrincipal: false })).toBe(true);
    });

    it('a test principal answering a root does not hold it against its own purge', () => {
        expect(marksRealHold({ testPrincipal: true })).toBe(false);
    });

    it('⛔ an answer no principal shaped holds the root: a shared edge answer may reach any real cook', () => {
        expect(marksRealHold(undefined)).toBe(true);
    });
});

describe('isPurgeablePickedRoot', () => {
    it("deletes the caller's own picked root", () => {
        expect(isPurgeablePickedRoot(DELETABLE, POOL_ULID)).toBe(true);
    });

    it.each([
        ['another test principal created it', { createdBy: OTHER_POOL_ULID }],
        ['a real cook also picked or bound it', { heldByRealUser: true }],
        ['it is an authored food, not a catalog root', { authorId: POOL_ULID }],
        ['the seed owns its item', { seedOwned: true }],
        ['a variant hangs off it', { hasVariants: true }],
        ['it is mid-erasure', { status: 'DELETING' }],
    ] as const)('keeps it when %s', (_name, change) => {
        expect(isPurgeablePickedRoot({ ...DELETABLE, ...change }, POOL_ULID)).toBe(false);
    });

    it.each(['PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED', 'AWAITING_RETRY', 'WITHDRAWN'])(
        'deletes a %s root: the status of a picked root is not what makes it safe',
        (status) => {
            expect(isPurgeablePickedRoot({ ...DELETABLE, status }, POOL_ULID)).toBe(true);
        },
    );
});
