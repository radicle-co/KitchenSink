/**
 * The seed function's event (curated catalog plan U2, KTD-4 and KTD-5): `apply` carries the digest of the bundle the
 * pipeline built, and `describe` carries nothing, because the deploy gate asking what a function holds has no
 * bundle to digest. Parsed at the JSON boundary, with no default action.
 */
import { describe, expect, it } from 'vitest';

import { MalformedSeedEventError, isMalformedSeedEventError, parseSeedEvent } from '../seedEvent.js';

const SHA = 'a'.repeat(64);

describe('parseSeedEvent', () => {
    it('accepts an apply carrying a well-formed digest', () => {
        expect(parseSeedEvent({ action: 'apply', expectSeedSha: SHA })).toStrictEqual({
            action: 'apply',
            expectSeedSha: SHA,
        });
    });

    it('accepts a describe carrying nothing', () => {
        expect(parseSeedEvent({ action: 'describe' })).toStrictEqual({ action: 'describe' });
    });

    it.each([
        ['an absent event', undefined],
        ['a null event', null],
        ['an empty event', {}],
        ['a digest with no action — there is no default action', { expectSeedSha: SHA }],
        ['an apply with no digest', { action: 'apply' }],
        ['an apply with an uppercase digest', { action: 'apply', expectSeedSha: 'A'.repeat(64) }],
        ['an apply with a 63-character digest', { action: 'apply', expectSeedSha: 'a'.repeat(63) }],
        ['a describe carrying a digest', { action: 'describe', expectSeedSha: SHA }],
        ['an extra key', { action: 'apply', expectSeedSha: SHA, force: true }],
        ['an unknown action', { action: 'reseed' }],
    ])('⛔ refuses %s', (_case, event) => {
        let caught: unknown;

        try {
            parseSeedEvent(event);
        } catch (error) {
            caught = error;
        }

        expect(isMalformedSeedEventError(caught)).toBe(true);
        expect((caught as MalformedSeedEventError).issues.length).toBeGreaterThan(0);
    });

    it('lists each problem as `path: reason`, or `(root)`', () => {
        let caught: unknown;

        try {
            parseSeedEvent({ action: 'apply', expectSeedSha: 'x' });
        } catch (error) {
            caught = error;
        }

        expect((caught as MalformedSeedEventError).issues).toStrictEqual([
            'expectSeedSha: must be a 64-character lowercase hex sha256',
        ]);
        expect((caught as MalformedSeedEventError).message).toMatch(/^seed function received a malformed event — /u);
    });
});
