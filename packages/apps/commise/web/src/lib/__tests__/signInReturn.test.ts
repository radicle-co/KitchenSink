/**
 * The sign-in return path (W-01; `buildSpec.md` §8: "a signed-out deep link returns to its destination after
 * sign-in"). `redirect_url` is attacker-controlled input that ends up as Clerk's `forceRedirectUrl`, so the question
 * these tables ask is "what can a crafted link make the signed-in browser navigate to?" — the answer must be "only a
 * page of this app, in this locale".
 */
import { describe, expect, it } from 'vitest';

import { safeReturnPath, signInPathFor, signUpPathFor } from '../signInReturn';

describe('safeReturnPath', () => {
    it.each([
        ['a locale page', '/en/collections', '/en/collections'],
        ['the locale root', '/en', '/en'],
        [
            'a nested page',
            '/en/recipes/0b3c6f0e-6f0e-4f0e-8f0e-0b3c6f0e6f0e/edit',
            '/en/recipes/0b3c6f0e-6f0e-4f0e-8f0e-0b3c6f0e6f0e/edit',
        ],
        ['a query', '/en/discover?q=pasta&tag=quick', '/en/discover?q=pasta&tag=quick'],
        ['a fragment', '/en/recipes#top', '/en/recipes#top'],
        ['a query on the locale root', '/en?x=1', '/en?x=1'],
    ])('keeps %s', (_what, raw, expected) => {
        expect(safeReturnPath(raw, 'en', '')).toBe(expected);
    });

    it.each([
        ['nothing', undefined],
        ['an empty string', ''],
        ['a repeated parameter', ['/en/a', '/en/b']],
        ['a protocol-relative URL', '//evil.com'],
        ['a protocol-relative URL behind the locale', '//en/collections'],
        ['an absolute URL', 'https://evil.com/en/collections'],
        ['an absolute URL to this locale path', 'https://evil.com/en'],
        ['a javascript URL', 'javascript:alert(1)'],
        ['a data URL', 'data:text/html,<script>alert(1)</script>'],
        ['a backslash host', '/\\evil.com'],
        ['a backslash after the locale', '/en\\evil.com'],
        ['an empty segment, which a normaliser can collapse into a host', '/en//evil.com'],
        ['a backslash deeper in', '/en/collections\\..\\evil'],
        ['a path with no leading slash', 'en/collections'],
        ['another locale', '/de/collections'],
        ['a longer segment that begins with the locale', '/english/collections'],
        ['an encoded slash after the locale', '/en%2F..%2Fevil'],
        ['an encoded host', '/%2F%2Fevil.com'],
        ['a double-encoded host', '/%252F%252Fevil.com'],
        ['a dot-dot segment', '/en/../evil'],
        ['a dot-dot segment that normalises to a protocol-relative URL', '/en/..//evil.com'],
        ['an encoded dot-dot segment', '/en/%2e%2e/%2E%2E/evil'],
        ['a dot segment', '/en/./collections'],
        ['a leading space', ' /en/collections'],
        ['an embedded newline', '/en/collections\n//evil.com'],
        ['an embedded tab', '/en/\t/evil.com'],
        ['an embedded NUL', '/en/\u0000'],
        ['an upper-case locale', '/EN/collections'],
        ['the sign-in page itself', '/en/sign-in'],
        ['the sign-in page with a query', '/en/sign-in?redirect_url=%2Fen'],
        ['the sign-up page', '/en/sign-up'],
        ['an over-long value', `/en/${'a'.repeat(3000)}`],
    ])('refuses %s', (_what, raw) => {
        expect(safeReturnPath(raw, 'en', '')).toBeUndefined();
    });

    describe('under a path-routed preview basePath', () => {
        it('strips the basePath, because forceRedirectUrl must stay bare (Next prepends it again)', () => {
            expect(safeReturnPath('/pr-9/en/collections', 'en', '/pr-9')).toBe('/en/collections');
            expect(safeReturnPath('/pr-9/en', 'en', '/pr-9')).toBe('/en');
            expect(safeReturnPath('/pr-9/en/discover?q=a', 'en', '/pr-9')).toBe('/en/discover?q=a');
        });

        it('still takes a bare path, which is what the server pages send', () => {
            expect(safeReturnPath('/en/collections', 'en', '/pr-9')).toBe('/en/collections');
        });

        it.each([
            ['the basePath alone', '/pr-9'],
            ['a basePath with no locale after it', '/pr-9/collections'],
            ['another preview’s basePath', '/pr-91/en/collections'],
            ['a basePath written as a prefix of a longer segment', '/pr-9en/collections'],
            ['a basePath, then a protocol-relative URL', '/pr-9//evil.com'],
            ['a basePath, then another locale', '/pr-9/de/collections'],
            ['a basePath twice', '/pr-9/pr-9/en/collections'],
        ])('refuses %s', (_what, raw) => {
            expect(safeReturnPath(raw, 'en', '/pr-9')).toBeUndefined();
        });
    });

    it('does not honour a preview basePath where there is none (production)', () => {
        expect(safeReturnPath('/pr-9/en/collections', 'en', '')).toBeUndefined();
    });

    it.each([
        ['an empty locale, which would make every path "in" it', '', '/anything'],
        ['a locale that is itself a host', '/evil.com', '//evil.com/x'],
        ['a locale with a slash', 'en/x', '/en/x/y'],
    ])('refuses %s', (_what, locale, raw) => {
        expect(safeReturnPath(raw, locale, '')).toBeUndefined();
    });

    it('judges the locale it is told, not a fixed one', () => {
        expect(safeReturnPath('/de/collections', 'de', '')).toBe('/de/collections');
        expect(safeReturnPath('/en/collections', 'de', '')).toBeUndefined();
    });
});

describe('signInPathFor', () => {
    it('sends the sign-in page the destination, percent-encoded as one value', () => {
        expect(signInPathFor('en', '/en/collections', '')).toBe('/en/sign-in?redirect_url=%2Fen%2Fcollections');
    });

    it('encodes a query so its own & and = do not become parameters of the sign-in URL', () => {
        const url = new URL(signInPathFor('en', '/en/discover?q=a&tag=b', ''), 'https://app.test');

        expect([...url.searchParams.keys()]).toEqual(['redirect_url']);
        expect(url.searchParams.get('redirect_url')).toBe('/en/discover?q=a&tag=b');
    });

    it('sends a bare sign-in when the destination is not one it would honour', () => {
        for (const bad of ['//evil.com', 'https://evil.com', '/de/x', '/en/sign-in', '/en/../x', '']) {
            expect(signInPathFor('en', bad, ''), bad).toBe('/en/sign-in');
        }
    });

    it('strips the basePath from a destination that carries it (the 401 handler sends window.location.pathname)', () => {
        expect(signInPathFor('en', '/pr-9/en/collections', '/pr-9')).toBe(
            '/en/sign-in?redirect_url=%2Fen%2Fcollections',
        );
    });

    it.each(['/en', '/en/collections', '/en/discover?q=a%20b&tag=c#top', '/en/recipes/new'])(
        'round-trips %s through the URL the sign-in page reads it from',
        (destination) => {
            const url = new URL(signInPathFor('en', destination, ''), 'https://app.test');

            expect(safeReturnPath(url.searchParams.get('redirect_url') ?? undefined, 'en', '')).toBe(destination);
        },
    );
});

describe('signUpPathFor', () => {
    it('carries the destination to the sign-up page the same way', () => {
        expect(signUpPathFor('en', '/en/collections', '')).toBe('/en/sign-up?redirect_url=%2Fen%2Fcollections');
        expect(signUpPathFor('en', '/pr-9/en/collections', '/pr-9')).toBe(
            '/en/sign-up?redirect_url=%2Fen%2Fcollections',
        );
    });

    it('sends a bare sign-up when the destination is not one it would honour', () => {
        expect(signUpPathFor('en', '//evil.com', '')).toBe('/en/sign-up');
    });
});
