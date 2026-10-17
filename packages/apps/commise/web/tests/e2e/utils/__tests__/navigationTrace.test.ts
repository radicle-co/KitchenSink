/**
 * Guard: the navigation-settle classifier must FAIL on the trace an infinite redirect loop produces, and PASS
 * on the trace a healthy signed-out front door produces.
 *
 * Both fixtures below are captured from real headless-Chromium runs, so this is not a test of an imagined
 * shape. The healthy one is the actual main-frame trace of `https://commise.app/en` on 2026-08-07; the loop
 * one is the sequence the owner observed in a signed-in browser against the same deployment.
 *
 * ## Mutation check (performed, 2026-08-07)
 *
 * Raising `MAX_VISITS_PER_PATHNAME` from 2 to 3 makes "flags the observed production loop" fail. Removing the
 * `expectedFinalPathname` comparison makes "flags a trace that came to rest on the wrong surface" fail.
 * Removing the navigation-budget check leaves the loop case failing (the visit-count rule still catches it),
 * which is why BOTH are asserted — a loop with a fresh query string on every hop defeats the visit-count rule
 * but not the budget.
 */
import { describe, expect, it } from 'vitest';

import { classifyNavigationTrace } from '../navigationTrace.js';

/** Captured from headless Chromium against `https://commise.app/en`, signed out, 2026-08-07. */
const HEALTHY = [
    'https://www.commise.app/en',
    'https://www.commise.app/en',
    'https://www.commise.app/en/sign-in',
    'https://www.commise.app/en/sign-in',
];

/** The loop the owner sees in a signed-in browser: Home 401s, bounces, `<SignIn>` forces them back. */
const LOOP = [
    'https://www.commise.app/en',
    'https://www.commise.app/en/sign-in?redirect_url=%2Fen',
    'https://www.commise.app/en',
    'https://www.commise.app/en/sign-in?redirect_url=%2Fen',
    'https://www.commise.app/en',
];

describe('classifyNavigationTrace', () => {
    it('accepts the real healthy signed-out trace (each pathname visited twice by App Router startup)', () => {
        expect(
            classifyNavigationTrace({
                urls: HEALTHY,
                expectedFinalPathname: '/en/sign-in',
                maxNavigations: 8,
            }),
        ).toEqual({ settled: true, findings: [] });
    });

    it('flags the observed production LOOP — the assertion routeProtection.spec.ts was missing', () => {
        const verdict = classifyNavigationTrace({
            urls: LOOP,
            expectedFinalPathname: '/en/sign-in',
            maxNavigations: 8,
        });

        expect(verdict.settled).toBe(false);
        expect(verdict.findings.join('\n')).toContain('navigation LOOP: /en was visited 3 times');
    });

    it('flags a loop even when every hop carries a fresh query string — that is what the budget is for', () => {
        const urls = Array.from({ length: 12 }, (_, i) =>
            i % 2 === 0 ? `https://www.commise.app/en?n=${i}` : `https://www.commise.app/en/sign-in?n=${i}`,
        );

        const verdict = classifyNavigationTrace({ urls, expectedFinalPathname: '/en/sign-in', maxNavigations: 8 });

        expect(verdict.settled).toBe(false);
        expect(verdict.findings.join('\n')).toContain('exceeds the budget of 8');
    });

    it('flags a trace that came to rest on the wrong surface', () => {
        const verdict = classifyNavigationTrace({
            urls: ['https://www.commise.app/en'],
            expectedFinalPathname: '/en/sign-in',
            maxNavigations: 8,
        });

        expect(verdict.settled).toBe(false);
        expect(verdict.findings.join('\n')).toContain('came to rest on /en, expected /en/sign-in');
    });

    it('tolerates the expected pathname with a trailing slash', () => {
        expect(
            classifyNavigationTrace({
                urls: ['https://www.commise.app/en/sign-in/'],
                expectedFinalPathname: '/en/sign-in',
                maxNavigations: 8,
            }).settled,
        ).toBe(true);
    });

    it('flags an empty trace — a page that never loaded is not a settled page', () => {
        const verdict = classifyNavigationTrace({ urls: [], expectedFinalPathname: '/en/sign-in', maxNavigations: 8 });

        expect(verdict.settled).toBe(false);
        expect(verdict.findings.join('\n')).toContain('never loaded');
    });
});
