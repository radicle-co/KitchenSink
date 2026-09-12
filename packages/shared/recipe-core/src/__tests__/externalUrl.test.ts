/**
 * Unit tests for the external-source URL gate ({@link safeHttpUrl}).
 *
 * A recipe's `sourceUrl` is UNTRUSTED: it arrives from an import pipeline, and the wire schema
 * (`z.string().url()`) is NOT a protective boundary — zod's URL check accepts `javascript:alert(1)`,
 * `data:text/html,…` and `vbscript:…` because they are all parseable URLs. Everything below is written to
 * fail if the gate ever degrades to "does it parse", to a substring/`startsWith` test, or to a check that
 * only holds on one of the two JavaScript engines this code runs on (V8 and Hermes/React Native).
 */
import { describe, expect, it } from 'vitest';

import { safeHttpUrl } from '../externalUrl.js';

describe('safeHttpUrl — schemes that must NEVER produce a link', () => {
    it.each([
        ['javascript:alert(1)'],
        ['JaVaScRiPt:alert(1)'],
        ['data:text/html,<script>alert(1)</script>'],
        ['vbscript:msgbox(1)'],
        ['file:///etc/passwd'],
        ['mailto:cook@example.com'],
        ['tel:+15551234567'],
        ['sms:+15551234567'],
        ['intent://scan/#Intent;scheme=zxing;end'],
        ['commise://recipes/rec_1'],
        ['ftp://files.example.com/recipe.txt'],
        ['blob:https://example.com/1234'],
    ])('rejects %s', (raw) => {
        expect(safeHttpUrl(raw)).toBeNull();
    });

    it('rejects a dangerous scheme dressed up with an http-looking tail', () => {
        // A `startsWith`/`includes` implementation, or one that only inspects the END of the string, passes
        // this. The scheme is decided by what comes BEFORE the first colon, and nothing else.
        expect(safeHttpUrl('javascript:https://example.com')).toBeNull();
        expect(safeHttpUrl('javascript:void(location="https://example.com")')).toBeNull();
    });

    it('rejects a scheme hidden behind leading control characters', () => {
        // The classic sanitizer bypass: browsers strip leading C0 controls before parsing, so a naive
        // `raw.startsWith('http')` guard says "not http, reject" while the platform would happily run it —
        // and a naive `new URL(raw).protocol` check on an engine that trims says "javascript:", which we
        // must reject. Both readings must land on `null`.
        expect(safeHttpUrl('\u0001javascript:alert(1)')).toBeNull();
        expect(safeHttpUrl('\njavascript:alert(1)')).toBeNull();
        expect(safeHttpUrl('\tjava\nscript:alert(1)')).toBeNull();
    });
});

describe('safeHttpUrl — shapes that are not an absolute http(s) URL', () => {
    it.each<[string, string]>([
        ['', 'empty'],
        ['   ', 'blank'],
        ['not a url', 'free text'],
        ['example.com/recipe', 'schemeless host'],
        ['//evil.example.com/recipe', 'protocol-relative'],
        ['/recipes/rec_1', 'absolute path'],
        ['../recipes/rec_1', 'relative path'],
        ['https://', 'scheme with no host'],
        ['http://', 'scheme with no host'],
    ])('rejects %s (%s)', (raw) => {
        expect(safeHttpUrl(raw)).toBeNull();
    });

    it('rejects a URL carrying embedded credentials', () => {
        // `https://seriouseats.com@evil.example` reads to a human as Serious Eats and resolves to
        // `evil.example`. Rendering its host would ACTIVELY MISLEAD, so the whole URL is refused rather
        // than displayed with a host the viewer cannot trust.
        expect(safeHttpUrl('https://seriouseats.com@evil.example/recipe')).toBeNull();
        expect(safeHttpUrl('https://user:secret@example.com/recipe')).toBeNull();
    });
});

describe('safeHttpUrl — genuine http(s) sources', () => {
    it('accepts an https URL and reports its href and host', () => {
        expect(safeHttpUrl('https://www.seriouseats.com/recipes/lamb')).toEqual({
            href: 'https://www.seriouseats.com/recipes/lamb',
            host: 'www.seriouseats.com',
        });
    });

    it('accepts a plain http URL (a source is not required to be secure to be attributable)', () => {
        expect(safeHttpUrl('http://old.example.com/recipe')).toEqual({
            href: 'http://old.example.com/recipe',
            host: 'old.example.com',
        });
    });

    it('normalizes a mixed-case scheme and host without losing the path, query, or fragment', () => {
        const safe = safeHttpUrl('HtTpS://Example.COM/Recipes/Lamb?ref=1#steps');

        expect(safe?.host).toBe('example.com');
        // Path/query/fragment are case-SENSITIVE and must survive verbatim; only scheme + host lower-case.
        expect(safe?.href).toBe('https://example.com/Recipes/Lamb?ref=1#steps');
    });

    it('keeps a non-default port in the host, so the displayed origin is the real one', () => {
        expect(safeHttpUrl('https://example.com:8443/recipe')?.host).toBe('example.com:8443');
    });

    it('accepts a URL padded with surrounding whitespace', () => {
        expect(safeHttpUrl('  https://example.com/recipe  ')?.href).toBe('https://example.com/recipe');
    });

    it('percent-encodes characters that would otherwise break out of an href attribute', () => {
        const safe = safeHttpUrl('https://example.com/recipe?q="onmouseover=alert(1)');

        // The link is safe to render because the parser re-serializes it — the returned href can no longer
        // carry a bare `"` that would terminate the attribute in a hand-built markup string.
        expect(safe?.href).not.toContain('"');
        expect(safe?.host).toBe('example.com');
    });
});
