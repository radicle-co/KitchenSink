import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInit } = vi.hoisted(() => ({ mockInit: vi.fn() }));

vi.mock('@sentry/react-native', () => ({
    init: mockInit,
    wrap: <T>(component: T): T => component,
}));

import { DENYLIST_KEYS as SHARED_DENYLIST } from '@kitchensink/observability-scrubbers';

import {
    DENYLIST_KEYS,
    initSentry,
    mobileRelease,
    mobileTracesSampleRate,
    scrubAttributes,
    scrubText,
    scrubEvent,
    scrubLog,
} from '../src/observability/sentry';

/**
 * ⛔ MOBILE KEEPS ITS OWN SCRUBBER, AND THIS IS WHAT STOPS IT DRIFTING (plan U16/U22).
 *
 * The denylist is ONE rule about what may leave a host, and it had three implementations — identity's,
 * identity-webhooks' and this one. The other two now import `@kitchensink/observability-scrubbers`; mobile
 * cannot, because that module's `pseudonymizeId` uses `node:crypto` and React Native has no such module.
 *
 * So the LIST is held equal by assertion instead. Without this, the next key someone adds protects the
 * backend and not the app — silently, and in the direction that leaks.
 *
 * ⚠️ THE SPLIT THIS NOTE ASKED FOR NOW EXISTS: `@kitchensink/observability-scrubbers/denylist` is a pure
 * entry that imports nothing, guarded on its module graph rather than on its behaviour. Mobile could import
 * the list itself and this equality assertion could become "mobile imports the shared list" — a test that
 * cannot pass while a copy exists, which is strictly stronger than one that notices copies diverging after
 * they have.
 *
 * ⛔ IT IS TAKEN NOW, and both reasons for not taking it are discharged rather than waived. The first was
 * real: the package ENTRY imports `node:crypto`, which React Native does not have — `./core` is the same
 * engine with no Node built-ins, guarded transitively by `observability-scrubbers/src/__tests__/
 * browserSafety.test.ts`. The second was that a Metro subpath resolution is a bundler change nobody here
 * can execute; that was an assumption, and it is falsifiable by inspection — this app already resolves
 * twenty-odd workspace subpath exports (`@commise/ui/button`, `@commise/query/boundary`,
 * `@commise/features-account/danger`, …), so the mechanism is not unexercised.
 *
 * ⚠️ THE OLD PARITY TEST IS GONE BECAUSE IT WOULD NOW BE TAUTOLOGICAL. It asserted that mobile's own copy
 * of the list equalled the shared one — a real check while a copy existed, and `x === x` once the module
 * re-exports the shared list. Its coverage did not move to another test; it moved into the TYPE SYSTEM,
 * which is a stronger place: there is no second list to drift. What is asserted instead is that the
 * re-export is the shared value, so deleting the re-export and reinstating a copy fails here.
 */
describe('the mobile denylist IS the shared one', () => {
    it('⛔ re-exports the shared list rather than carrying a copy that can drift', () => {
        expect(DENYLIST_KEYS).toBe(SHARED_DENYLIST);
    });
});

describe('mobile sentry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env['EXPO_PUBLIC_SENTRY_DSN'];
    });

    it('initializes with PII off and logs enabled when a DSN is present', () => {
        process.env['EXPO_PUBLIC_SENTRY_DSN'] = 'https://key@o1.ingest.sentry.io/1';

        initSentry();

        expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ enableLogs: true, sendDefaultPii: false }));
    });

    it('is inert without a DSN (local dev)', () => {
        initSentry();

        expect(mockInit).not.toHaveBeenCalled();
    });

    /**
     * ⛔ U19 — mobile events carried NO release, which makes two things impossible that Sentry is otherwise
     * good at: attributing a crash to the build it came from, and telling a regression from a long-standing
     * bug. Both matter more on mobile than on web, because installed builds linger — several versions are
     * live at once and there is no deploy that retires the old ones.
     */
    it('⛔ includes a non-empty release when the build knows its commit', () => {
        process.env['EXPO_PUBLIC_SENTRY_DSN'] = 'https://key@o1.ingest.sentry.io/1';
        process.env['EXPO_PUBLIC_COMMIT_SHA'] = 'abc123def';

        try {
            initSentry();

            expect(mockInit).toHaveBeenCalledWith(expect.objectContaining({ release: 'abc123def' }));
        } finally {
            delete process.env['EXPO_PUBLIC_COMMIT_SHA'];
        }
    });

    /**
     * ⚠️ OMITTED, not `release: undefined`. A build with no SHA should look to Sentry exactly like the
     * un-released builds that came before this change, rather than like a release named "undefined".
     */
    it('omits the release entirely when the build does not know its commit', () => {
        process.env['EXPO_PUBLIC_SENTRY_DSN'] = 'https://key@o1.ingest.sentry.io/1';

        initSentry();

        const options: unknown = mockInit.mock.calls[0]?.[0];

        expect(options).not.toHaveProperty('release');
    });

    /**
     * ⛔ Every installed build sampled EVERY transaction. That is fine on a simulator and is a bill plus a
     * quota ceiling on real devices — and a quota that fills drops ERRORS, not just traces, so over-sampling
     * traces is a way to lose the events the SDK exists to deliver.
     */
    it('⛔ samples traces BELOW 1 outside development', () => {
        expect(mobileTracesSampleRate('production')).toBeLessThan(1);
        expect(mobileTracesSampleRate('sandbox')).toBeLessThan(1);
        expect(mobileTracesSampleRate('development')).toBe(1);
    });

    it('takes the release from either build variable, preferring the explicit one', () => {
        expect(mobileRelease({ EXPO_PUBLIC_COMMIT_SHA: 'sha' })).toBe('sha');
        expect(mobileRelease({ EXPO_PUBLIC_SENTRY_RELEASE: 'r', EXPO_PUBLIC_COMMIT_SHA: 'sha' })).toBe('r');
        // ⚠️ EAS sets this on every cloud build with nobody wiring anything, so a forgotten variable still
        // leaves a real build carrying its commit rather than nothing.
        expect(mobileRelease({ EAS_BUILD_GIT_COMMIT_HASH: 'eas-sha' })).toBe('eas-sha');
        expect(mobileRelease({})).toBeUndefined();
    });

    it('scrubs denied keys and drops debug logs', () => {
        expect(scrubAttributes({ email: 'a@b.com', id: 'u1' }).email).toBe('[redacted]');
        expect(scrubAttributes({ email: 'a@b.com', id: 'u1' }).id).toBe('u1');
        expect(scrubLog({ level: 'debug' })).toBeNull();
        expect(scrubLog({ level: 'info', attributes: { token: 'x' } })?.attributes?.['token']).toBe('[redacted]');
    });

    it('scrubEvent redacts extra/request.data but preserves the opaque user id', () => {
        const out = scrubEvent({
            extra: { email: 'a@b.com', ok: 1 },
            request: { data: { token: 'aaaaaaaa.bbbbbbbb.cccccccc' } },
            user: { id: 'u1', email: 'a@b.com' },
        } as unknown as Parameters<typeof scrubEvent>[0]);

        expect((out.extra as Record<string, unknown>)['email']).toBe('[redacted]');
        // ⚠️ Narrowed rather than `out.request?.data as …`, which `no-unsafe-optional-chaining` rejects:
        // a short-circuit to `undefined` would throw on the index rather than fail the assertion, so a
        // regression that DROPPED `request` entirely would surface as a TypeError instead of a diff.
        expect(out.request).toBeDefined();
        expect((out.request?.data as Record<string, unknown> | undefined)?.['token']).toBe('[redacted]');
        expect(out.user?.id).toBe('u1');
        expect((out.user as Record<string, unknown>)['email']).toBe('[redacted]');
    });

    /**
     * ⛔ THE SAME SINK THE SERVICE AND WEB SCRUBBERS CARRIED — one defect in three copies of one function,
     * which is what the duplication costs. `out[key] = …` on an object literal walks the prototype chain,
     * so an attribute named `__proto__` was silently DROPPED from the scrubbed event instead of being
     * redacted or kept. This runs in `beforeSend`, over whatever shape an error event has.
     */
    it('⛔ a `__proto__` attribute is scrubbed as DATA and pollutes nothing', () => {
        const out = scrubAttributes({ ['__proto__']: { polluted: 'yes' }, keep: 'ok' } as Record<string, unknown>);

        expect(Object.hasOwn(out, '__proto__')).toBe(true);
        expect(out['keep']).toBe('ok');
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    /**
     * ⛔ AN UNBOUNDED SCRUB IS A DENIAL OF SERVICE THE APP INFLICTS ON ITSELF. `scrubText` runs
     * synchronously inside `beforeSend`, on the UI thread, over an error message that can be
     * user-influenced — and this copy carried the UNANCHORED email and bearer patterns long after the
     * services' copy was fixed, because the shared module could not be imported here. Measured on the
     * original patterns: 38,638 ms on a 200 KB run of local-part characters.
     *
     * ⚠️ The threshold is deliberately loose. This is not a benchmark: it fails only on a return of the
     * quadratic behaviour, which is four orders of magnitude away, so it cannot flake on a slow machine.
     */
    it('⛔ does not backtrack quadratically on a long local-part run', () => {
        const hostile = `${'a'.repeat(200_000)}@`;
        const started = performance.now();

        scrubText(hostile);

        expect(performance.now() - started).toBeLessThan(1_000);
    });

    /**
     * ⛔ THE ANCHORING MUST NOT COST AN ADDRESS. A leading boundary is what stops the backtracking, and the
     * way it goes wrong is ACROSS matches: a scan that resumes immediately after a TLD sits on a character
     * that is itself in the local-part class, so a naive anchor rejects the very next address. That leaked
     * one address of every adjacent pair in the services' copy before `redactAll` was added beside it.
     */
    it('⛔ redacts BOTH addresses when two are adjacent, and one at index 0', () => {
        expect(scrubText('user@example.com-other@example.org')).not.toContain('other@example.org');
        expect(scrubText('user@example.com trailing')).not.toContain('user@example.com');
        expect(scrubText('contact prefix-user@example.com now')).not.toContain('prefix-user@example.com');
    });
});
