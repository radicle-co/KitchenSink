import { describe, expect, it } from 'vitest';

import {
    isDeniedKey,
    looksLikeBearerToken,
    scrubAttributes,
    scrubText,
    scrubEvent,
    scrubLog,
} from '@/lib/sentryScrubbers';

describe('sentry-scrubbers (web)', () => {
    it('redacts denied keys and bearer-shaped strings', () => {
        expect(isDeniedKey('Authorization')).toBe(true);
        expect(isDeniedKey('id')).toBe(false);
        expect(looksLikeBearerToken('aaaaaaaa.bbbbbbbb.cccccccc')).toBe(true);

        const out = scrubAttributes({ email: 'a@b.com', id: 'u1', nested: { token: 'x' } });
        expect(out.email).toBe('[redacted]');
        expect(out.id).toBe('u1');
        expect(out.nested.token).toBe('[redacted]');
    });

    /**
     * ⛔ THE SAME SINK THE SERVICES' SCRUBBER CARRIED, in the copy that runs in a BROWSER. `out[key] = …`
     * on an object literal walks the prototype chain, so an attribute named `__proto__` hit
     * `Object.prototype`'s inherited setter instead of defining a property: the field was silently DROPPED
     * from the scrubbed output, and what it carried travelled with the merge. This is `beforeSend`, so the
     * keys come from whatever shape an error event happens to have.
     *
     * ⚠️ BOTH HALVES are asserted. Closing the sink is only half the requirement — the attribute is DATA
     * and must still arrive as data, or the fix has quietly become a second way to lose a field.
     */
    it('⛔ a `__proto__` attribute is scrubbed as DATA and pollutes nothing', () => {
        const out = scrubAttributes({ ['__proto__']: { polluted: 'yes' }, keep: 'ok' } as Record<string, unknown>);

        expect(Object.hasOwn(out, '__proto__')).toBe(true);
        expect(out['keep']).toBe('ok');
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('⛔ a nested `constructor` key cannot reach a prototype either', () => {
        const out = scrubAttributes({ nested: { constructor: 'not-a-function' } });

        expect(out.nested.constructor).toBe('not-a-function');
    });

    it('scrubs an event but keeps user.id', () => {
        const out = scrubEvent({
            extra: { email: 'a@b.com' },
            user: { id: 'u1', email: 'a@b.com' },
        } as unknown as Parameters<typeof scrubEvent>[0]);
        expect(out.extra?.['email']).toBe('[redacted]');
        expect(out.user?.id).toBe('u1');
    });

    it('drops debug logs and scrubs attributes', () => {
        expect(scrubLog({ level: 'debug', attributes: {} })).toBeNull();
        const kept = scrubLog({ level: 'info', attributes: { email: 'a@b.com', ok: 1 } });
        expect(kept?.attributes?.['email']).toBe('[redacted]');
        expect(kept?.attributes?.['ok']).toBe(1);
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
