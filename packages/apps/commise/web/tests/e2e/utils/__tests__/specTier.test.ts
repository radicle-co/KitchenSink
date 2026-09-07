/**
 * The deployed/mocked partition is TOTAL, DISJOINT and NON-VACUOUS, re-derived from the files on disk.
 *
 * This is the sibling of `authState.test.ts`, and it exists for the same reason: a partition that decides
 * which specs run where is only safe if it cannot silently lose a spec. The failure this guards against is
 * concrete — 39 of 46 specs stub the recipe API in the browser, and every one of them fails against a
 * deployed preview because a real service answers the SSR prefetch the stub cannot reach.
 */

import { describe, expect, it } from 'vitest';

import { allSpecs, deployedSpecs, isMockedSpec, mockedSpecGlobs, mockedSpecs } from '../specTier.js';

describe('the deployed/mocked spec partition', () => {
    it('discovers specs at all — a vacuous pass here would hide every claim below', () => {
        expect(allSpecs().length).toBeGreaterThan(20);
    });

    it('is total: every spec is in exactly one tier', () => {
        const union = [...deployedSpecs(), ...mockedSpecs()].sort();

        expect(union).toEqual([...allSpecs()]);
        expect(new Set(union).size).toBe(union.length);
    });

    it('is non-vacuous in both directions', () => {
        // If either side empties, the split has stopped meaning anything: an empty deployed tier runs no
        // end-to-end test at all, and an empty mocked tier means the marker was renamed out from under this.
        expect(deployedSpecs().length).toBeGreaterThan(0);
        expect(mockedSpecs().length).toBeGreaterThan(0);
    });

    it('puts the real-service auth flows in the deployed tier', () => {
        // Named individually because these are the specs whose whole value is that they face a real Clerk
        // and a real identity service. If a refactor ever stubs one, it leaves the deployed tier silently,
        // and the deployed run would still be green while proving less.
        for (const spec of ['signIn.spec.ts', 'signOut.spec.ts', 'signUp.spec.ts', 'routeProtection.spec.ts']) {
            expect(deployedSpecs(), `${spec} must face real services`).toContain(spec);
        }
    });

    it('classifies by the import, not by the filename', () => {
        for (const spec of mockedSpecs()) {
            expect(isMockedSpec(spec)).toBe(true);
        }

        for (const spec of deployedSpecs()) {
            expect(isMockedSpec(spec)).toBe(false);
        }
    });

    it('produces globs Playwright can match', () => {
        expect(mockedSpecGlobs()).toEqual(mockedSpecs().map((name) => `**/${name}`));
    });
});
