import { isDeniedKey, isIdKey, looksLikeBearerToken } from '../denylist.js';
import { describe, expect, it } from 'vitest';

import { pseudonymizeId, scrubEvent, scrubLog, scrubText, scrubAttributes } from '../scrubbers.js';

describe('sentry-scrubbers', () => {
    describe('isDeniedKey', () => {
        it('matches the denylist case-insensitively', () => {
            expect(isDeniedKey('Email')).toBe(true);
            expect(isDeniedKey('AUTHORIZATION')).toBe(true);
            expect(isDeniedKey('avatarUrl')).toBe(true);
            expect(isDeniedKey('id')).toBe(false);
            expect(isDeniedKey('identityId')).toBe(false);
        });
    });

    describe('looksLikeBearerToken', () => {
        it('detects JWT-shaped strings and ignores ordinary text', () => {
            expect(looksLikeBearerToken('aaaaaaaa.bbbbbbbb.cccccccc')).toBe(true);
            expect(looksLikeBearerToken('hello world')).toBe(false);
            expect(looksLikeBearerToken('a.b.c')).toBe(false);
        });
    });

    describe('scrubAttributes', () => {
        it('redacts denied keys and bearer-shaped strings, recursing nested structures', () => {
            const input = {
                email: 'a@b.com',
                id: 'u1',
                nested: { token: 'secret', note: 'ok' },
                list: ['plain', 'aaaaaaaa.bbbbbbbb.cccccccc'],
            };

            const out = scrubAttributes(input);

            expect(out.email).toBe('[redacted]');
            expect(out.id).toBe('u1');
            expect(out.nested.token).toBe('[redacted]');
            expect(out.nested.note).toBe('ok');
            expect(out.list[0]).toBe('plain');
            expect(out.list[1]).toBe('[redacted]');
        });
    });

    describe('isIdKey', () => {
        it('matches person-linked id keys case-insensitively, not bare id', () => {
            expect(isIdKey('sub')).toBe(true);
            expect(isIdKey('identityId')).toBe(true);
            expect(isIdKey('userId')).toBe(true);
            expect(isIdKey('ownerId')).toBe(true);
            expect(isIdKey('requesterId')).toBe(true);
            expect(isIdKey('clerkUserId')).toBe(true);
            expect(isIdKey('id')).toBe(false);
            expect(isIdKey('jobId')).toBe(false);
            expect(isIdKey('recipeId')).toBe(false);
        });
    });

    describe('pseudonymizeId', () => {
        it('is deterministic, prefixed, and non-reversible in shape', () => {
            const a = pseudonymizeId('user_2abcDEF');
            expect(a).toMatch(/^anon_[0-9a-f]{16}$/);
            expect(pseudonymizeId('user_2abcDEF')).toBe(a); // stable → correlation preserved
            expect(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P')).not.toBe(a); // distinct inputs → distinct
            expect(a).not.toContain('user_2abcDEF'); // raw id does not survive
        });

        /**
         * ⛔ IDEMPOTENT, AND THAT IS A CORRELATION REQUIREMENT, NOT TIDINESS. A Clerk `sub` can be
         * pseudonymized by TWO different rules on its way out: `scrubText` replaces it inline wherever it
         * appears in free text (`CLERK_SUB_GLOBAL`), and `scrubAttributes` replaces it by KEY. Once
         * `@kitchensink/service-logging`'s sink began scrubbing every string, an id-keyed sub met both — and
         * a second hash of `anon_<h1>` yields `anon_<h2>`.
         *
         * Measured on the real path: `identity/src/queue/deletionEnqueue.error.ts` emits an ISSUE and a LOG
         * for the SAME ids in one function. Without this, its `identityId` arrived as one token on the issue
         * and a different one in the log, so an operator pivoting between them for the same human silently
         * found nothing — which is precisely what ADR-0043 says pseudonymization exists to prevent, and what
         * that function's own docstring promises.
         *
         * ⚠️ A guard on the OUTPUT SHAPE cannot swallow a real id: the pseudonym form is `anon_` + lowercase
         * hex, a Clerk `sub` is `user_`-prefixed, and a ULID is uppercase Crockford base32. The last case
         * below pins that an `anon_`-looking string which is NOT the output shape is still hashed.
         */
        it('⛔ is IDEMPOTENT — a value pseudonymized twice keeps one token, so correlation survives', () => {
            const sub = 'user_2NNEqL2nrIRdJ194ndJqAHwEfxC';
            const once = pseudonymizeId(sub);

            expect(pseudonymizeId(once)).toBe(once);
            expect(pseudonymizeId(pseudonymizeId(scrubText(sub)))).toBe(once);
        });

        it('⚠️ still hashes a value that merely starts with `anon_` but is not a pseudonym', () => {
            expect(pseudonymizeId('anon_DEADBEEFDEADBEEF')).not.toBe('anon_DEADBEEFDEADBEEF');
            expect(pseudonymizeId('anon_short')).not.toBe('anon_short');
        });

        it('⛔ gives the CONSOLE path and the ISSUE path the same token for one Clerk sub', () => {
            const sub = 'user_2NNEqL2nrIRdJ194ndJqAHwEfxC';

            // The issue path: `scrubEvent` → `scrubAttributes`, by key, once.
            const onIssue = scrubAttributes({ identityId: sub })['identityId'];
            // The console path since the sink scrubs every string: `scrubText` first, then `scrubAttributes`.
            const onConsole = scrubAttributes({ identityId: scrubText(sub) })['identityId'];

            expect(onConsole).toBe(onIssue);
        });
    });

    describe('prototype pollution', () => {
        /**
         * ⛔ A LOG ATTRIBUTE IS DATA, AND `__proto__` IS A LEGAL KEY IN IT. Built on an ordinary object
         * literal, `out['__proto__'] = value` never creates a property — it reaches the inherited setter,
         * so the field is silently DROPPED and, when the result is later merged, what it changed travels
         * with it. CodeQL reports the same defect from the other side as "remote property injection",
         * high severity, and it fails the branch's check.
         *
         * ⚠️ Both halves are asserted, because the fix has to keep the DATA as well as close the sink: a
         * version that stripped dangerous keys would silence the scanner and lose a field.
         */
        it('⛔ keeps a `__proto__` attribute as data and does not pollute anything with it', () => {
            const scrubbed = scrubAttributes({ ['__proto__']: { polluted: true }, jobId: 'j-1' }) as Record<
                string,
                unknown
            >;

            expect(scrubbed['jobId']).toBe('j-1');
            expect(Object.hasOwn(scrubbed, '__proto__')).toBe(true);
            expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
            expect(JSON.stringify(scrubbed)).toContain('polluted');
        });

        it('⚠️ still scrubs normally through a nested bag that carries one', () => {
            const scrubbed = scrubAttributes({
                ctx: { ['__proto__']: { x: 1 }, email: 'someone@example.com' },
            }) as Record<string, Record<string, unknown>>;

            expect(scrubbed['ctx']?.['email']).not.toBe('someone@example.com');
        });
    });

    describe('scrubText cost', () => {
        /**
         * ⛔ AN UNBOUNDED SCRUB IS A DENIAL OF SERVICE THE LOGGER INFLICTS ON ITS OWN CALLER. `scrubText`
         * runs synchronously inside `beforeSend`/`beforeSendLog`, on the request or worker thread, over text
         * that can be user-influenced. The email pattern used to backtrack quadratically — 606 ms at 50 KB
         * and 9.9 SECONDS at 200 KB on `'a'.repeat(n) + '@'` — because every position inside a long
         * local-part run was retried as a fresh start.
         *
         * ⚠️ The threshold is deliberately loose. This is not a benchmark: it fails only on a return of the
         * quadratic behaviour, which is three orders of magnitude away, so it cannot flake on a slow runner.
         */
        it('⛔ does not backtrack quadratically on a long local-part run', () => {
            const hostile = `${'a'.repeat(200_000)}@`;
            const started = performance.now();

            scrubText(hostile);

            expect(performance.now() - started).toBeLessThan(1_000);
        });

        /**
         * ⛔ A DIFFERENTIAL PROPERTY TEST, BECAUSE EXAMPLES CANNOT DISCHARGE AN EQUIVALENCE CLAIM — and that
         * is not a stylistic preference here, it is what went wrong. The lookbehind shipped with eighteen
         * hand-picked parity cases and the word "provably equivalent". Every one of those cases held a
         * SINGLE address, so the case set was structurally incapable of reaching the defect: across matches
         * `replace` resumes immediately after a TLD, whose last character is in the local-part class, so the
         * lookbehind rejected the NEXT address. `user@example.com-other@example.org` redacted the first and
         * left the second in plaintext — a PII leak, from a module every Node service loads on `beforeSend`.
         * Measured at the time: 181,274 divergences in 400,000 address-shaped inputs.
         *
         * ⛔ THE POSITIVE-RATE ASSERTION IS NOT DECORATION. A parity test over inputs that never match agrees
         * vacuously and looks exactly like a passing one, which is the same vacuity `expect(register.size)`
         * guards against in `errorReportingRegister.test.ts`. It is asserted before parity is.
         */
        it('⛔ redacts byte-identically to the unanchored original, on input that actually contains addresses', () => {
            const original = (text: string): string =>
                text
                    .replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]')
                    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted]');

            // The joins matter more than the addresses: `-`, `_`, `.`, `+`, `%` and a digit are all in the
            // local-part class, so they are exactly the characters that put two matches adjacent.
            const joins = ['-', '_', '.', '+', '%', '1', ' ', ',', ';', ''];
            const locals = ['user', 'a.b', 'x+y', 'n_m', 'q%z'];
            const domains = ['example.com', 'sub.domain.co.uk', 'a.io'];
            const inputs: string[] = [];

            for (const join of joins) {
                for (const local of locals) {
                    for (const domain of domains) {
                        inputs.push(`${local}@${domain}${join}${local}@${domain}`);
                        inputs.push(`prefix ${local}@${domain}${join}other@x.org tail`);
                    }
                }
            }

            const redacting = inputs.filter((input) => original(input) !== input);

            expect(redacting.length).toBeGreaterThan(inputs.length / 2);

            for (const input of redacting) {
                expect(scrubText(input), input).toBe(original(input));
            }
        });

        it('⚠️ still redacts an address whose local part touches the preceding token', () => {
            // The lookbehind refuses a RESTART inside a local-part run; it must not refuse a real boundary.
            expect(scrubText('contact prefix-user@example.com now')).not.toContain('prefix-user@example.com');
            expect(scrubText('a.b+c%d_e@sub.domain.co.uk')).not.toContain('sub.domain.co.uk');
        });

        it('⛔ redacts BOTH addresses when two are adjacent — the case the leak left in plaintext', () => {
            expect(scrubText('user@example.com-other@example.org')).toBe('[redacted][redacted]');
            expect(scrubText('a@b.io_c@d.org')).toBe('[redacted][redacted]');
        });
    });

    describe('scrubEvent', () => {
        it('scrubs extra and user fields and PSEUDONYMIZES the user id', () => {
            const event = {
                extra: { email: 'a@b.com', ok: 1, ownerId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P' },
                user: { id: 'user_2abcDEFghiJKL', email: 'a@b.com', name: 'Bob' },
            } as unknown as Parameters<typeof scrubEvent>[0];

            const out = scrubEvent(event);

            expect(out.extra?.['email']).toBe('[redacted]');
            expect(out.extra?.['ok']).toBe(1);
            expect(out.extra?.['ownerId']).toBe(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P'));
            expect(out.user?.id).toBe(pseudonymizeId('user_2abcDEFghiJKL'));
            expect(out.user?.id).not.toBe('user_2abcDEFghiJKL');
            expect(out.user?.['email']).toBe('[redacted]');
            expect(out.user?.['name']).toBe('[redacted]');
        });
    });

    describe('scrubAttributes id pseudonymization', () => {
        it('pseudonymizes person-linked id VALUES (stable), leaves bare id, redacts denied keys', () => {
            const input = {
                sub: 'user_2abcDEFghiJKL',
                userId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P',
                ownerId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P',
                id: 'u1',
                jobId: 'job-123',
                email: 'a@b.com',
                nested: { identityId: 'user_zzz', note: 'ok' },
            };

            const out = scrubAttributes(input);

            expect(out.sub).toBe(pseudonymizeId('user_2abcDEFghiJKL'));
            expect(out.userId).toBe(pseudonymizeId('01JQ8N2X4RBV6WK3ZT5Y7A9C0P'));
            expect(out.ownerId).toBe(out.userId); // same id → same token (correlatable)
            expect(out.id).toBe('u1'); // bare id untouched
            expect(out.jobId).toBe('job-123'); // non-person id untouched
            expect(out.email).toBe('[redacted]');
            expect(out.nested.identityId).toBe(pseudonymizeId('user_zzz'));
            expect(out.nested.note).toBe('ok');
        });
    });

    describe('scrubText', () => {
        it('redacts email and bearer-shaped substrings inside free text', () => {
            expect(scrubText('contact me at a@b.com please')).toBe('contact me at [redacted] please');
            expect(scrubText('token aaaaaaaa.bbbbbbbb.cccccccc rejected')).toBe('token [redacted] rejected');
            expect(scrubText('nothing sensitive here')).toBe('nothing sensitive here');
        });

        it('pseudonymizes an embedded Clerk sub in free text', () => {
            const sub = 'user_2abcDEFghiJKLmnopqrstuvwx'; // realistic Clerk sub length (24 chars after prefix)
            expect(scrubText(`provisioning failed for ${sub}`)).toBe(`provisioning failed for ${pseudonymizeId(sub)}`);
        });
    });

    describe('scrubEvent message + exception', () => {
        it('redacts PII in the event message and exception values', () => {
            const event = {
                message: 'failed for a@b.com',
                exception: { values: [{ value: 'token aaaaaaaa.bbbbbbbb.cccccccc invalid' }] },
            } as unknown as Parameters<typeof scrubEvent>[0];

            const out = scrubEvent(event);

            expect(out.message).toBe('failed for [redacted]');
            expect(out.exception?.values?.[0]?.value).toBe('token [redacted] invalid');
        });
    });

    describe('scrubLog', () => {
        it('drops debug logs and redacts the message body + attributes', () => {
            expect(scrubLog({ level: 'debug', message: 'x' })).toBeNull();

            const out = scrubLog({ level: 'info', message: 'user a@b.com synced', attributes: { token: 'x' } });
            expect(out?.message).toBe('user [redacted] synced');
            expect(out?.attributes?.['token']).toBe('[redacted]');
        });
    });
});

/**
 * ⛔ AN `Error` PASSES THROUGH WHOLE, and this is not a nicety — it is the difference between a logged error
 * and `{}`.
 *
 * `message` and `stack` are NON-ENUMERABLE on `Error`. Structural scrubbing walks `Object.entries`, which
 * returns neither, so an `Error` fed through the generic path comes out as an empty object: the log line
 * survives, the error in it does not, and nothing says so.
 *
 * ⚠️ This branch is being ADOPTED from `recipe-workers/src/common/logScrub.ts`, the fourth copy of this
 * denylist, which is about to be deleted. It is the one behaviour that copy had and this module did not, so
 * it moves FIRST — a deletion that dropped it would have silently emptied every error that package logs.
 *
 * ⚠️ Free text inside `message` is handled at the sink (`beforeSend`), not here. Redacting a message would
 * destroy the one field an operator reads.
 */
describe('an Error survives scrubbing', () => {
    it('⛔ passes an Error through rather than flattening it to {}', () => {
        const error = new Error('database unreachable');
        const out = scrubAttributes({ error });

        expect(out['error']).toBe(error);
        expect((out['error'] as Error).message).toBe('database unreachable');
    });

    it('⛔ and inside an array or a nested object, where a walk would also flatten it', () => {
        const error = new Error('boom');
        const out = scrubAttributes({ errors: [error], wrapper: { cause: error } });

        expect((out['errors'] as unknown[])[0]).toBe(error);
        expect((out['wrapper'] as Record<string, unknown>)['cause']).toBe(error);
    });

    /** ⚠️ A subclass is still an Error. The house custom-error convention makes every service error one. */
    it('passes a subclass through too', () => {
        class QueueError extends Error {}

        const error = new QueueError('subclassed');

        expect(scrubAttributes({ error })['error']).toBe(error);
    });

    /**
     * ⛔ The pass-through is NOT a hole for a denied key. An `Error` is opaque to the walk by design, but an
     * object that merely LOOKS like one must still be scrubbed — otherwise `{ message, stack }` becomes a
     * way to smuggle a payload past the denylist.
     */
    it('⛔ still scrubs a plain object that is not an Error', () => {
        const out = scrubAttributes({ fake: { message: 'looks like one', email: 'a@b.com' } });

        expect((out['fake'] as Record<string, unknown>)['email']).toBe('[redacted]');
    });
});
