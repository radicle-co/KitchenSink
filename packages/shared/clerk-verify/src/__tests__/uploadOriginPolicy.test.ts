/**
 * The origins a browser may PUT a presigned object from, derived from the same Clerk `azp` resolver the token check
 * and the CORS policy use (ADR-0047), so the three cannot disagree about which pages are ours.
 *
 * | Requirement                                                                        | Test                                      |
 * | ---------------------------------------------------------------------------------- | ----------------------------------------- |
 * | an exact party list is admitted as is                                              | 'exact-list'                              |
 * | a preview base becomes ONE S3 glob under the base, strict mode adds no apex        | 'preview-pattern (strict)'                |
 * | transition mode additionally admits the base apex                                  | 'preview-pattern (transition)'            |
 * | every origin the azp regex admits is matched by a glob                             | 'parity with the azp pattern'             |
 * | every glob host stays inside the base domain; look-alike origins never match       | 'refuses look-alike origins'              |
 * | nothing configured is an error, never an empty or `*` list                         | 'throws when no selector is configured'   |
 * | a wildcard smuggled into the party list is refused                                 | 'refuses a wildcard in the party list'    |
 */
import { describe, expect, it } from 'vitest';

import { buildPreviewAzpPattern, buildTransitionAzpPattern } from '../clerkVerify.js';
import { isUploadOriginPolicyError, resolveUploadOrigins, UploadOriginPolicyError } from '../uploadOriginPolicy.js';

/**
 * S3 CORS `AllowedOrigin` matching: at most one `*`, matching ANY run of characters (dots and slashes included),
 * anchored at both ends. Reimplemented here so the parity claim is checked against the documented semantics.
 */
function s3GlobMatches(glob: string, origin: string): boolean {
    const star = glob.indexOf('*');

    if (star === -1) {
        return glob === origin;
    }

    const head = glob.slice(0, star);
    const tail = glob.slice(star + 1);

    return origin.length >= head.length + tail.length && origin.startsWith(head) && origin.endsWith(tail);
}

const matchesAny = (globs: readonly string[], origin: string): boolean =>
    globs.some((glob) => s3GlobMatches(glob, origin));

const BASE = 'sandbox.commise.app';

describe('resolveUploadOrigins', () => {
    it('exact-list: admits the configured parties as is', () => {
        const result = resolveUploadOrigins({
            authorizedPartiesRaw: ' https://commise.app, https://www.commise.app ',
            previewBaseDomain: undefined,
            previewMode: undefined,
        });

        expect(result).toEqual({ mode: 'exact-list', origins: ['https://commise.app', 'https://www.commise.app'] });
    });

    it('preview-pattern (strict): one glob under the base and no apex', () => {
        const result = resolveUploadOrigins({
            authorizedPartiesRaw: undefined,
            previewBaseDomain: BASE,
            previewMode: undefined,
        });

        expect(result).toEqual({ mode: 'preview-pattern', origins: [`https://pr-*.${BASE}`] });
    });

    it('preview-pattern (strict): any value but "transition" stays strict', () => {
        const result = resolveUploadOrigins({
            authorizedPartiesRaw: undefined,
            previewBaseDomain: BASE,
            previewMode: 'trasition',
        });

        expect(result.origins).toEqual([`https://pr-*.${BASE}`]);
    });

    it('preview-pattern (transition): also admits the base apex', () => {
        const result = resolveUploadOrigins({
            authorizedPartiesRaw: undefined,
            previewBaseDomain: BASE,
            previewMode: 'transition',
        });

        expect(result).toEqual({ mode: 'preview-pattern', origins: [`https://pr-*.${BASE}`, `https://${BASE}`] });
    });

    it('a party list wins over a preview base, as it does for CORS and azp', () => {
        const result = resolveUploadOrigins({
            authorizedPartiesRaw: 'https://commise.app',
            previewBaseDomain: BASE,
            previewMode: undefined,
        });

        expect(result.mode).toBe('exact-list');
    });

    it.each([
        ['nothing set', undefined, undefined],
        ['blank strings', '  ', '  '],
        ['only commas', ' , ,', undefined],
    ])('throws when no selector is configured (%s)', (_name, parties, base) => {
        const attempt = (): unknown =>
            resolveUploadOrigins({ authorizedPartiesRaw: parties, previewBaseDomain: base, previewMode: undefined });

        expect(attempt).toThrow(UploadOriginPolicyError);

        try {
            attempt();
        } catch (error) {
            expect(isUploadOriginPolicyError(error)).toBe(true);
        }
    });

    it.each(['*', 'https://*', 'https://*.commise.app', 'https://commise.app/', 'http://commise.app', 'commise.app'])(
        'refuses a wildcard or a non-origin in the party list (%s)',
        (entry) => {
            expect(() =>
                resolveUploadOrigins({
                    authorizedPartiesRaw: entry,
                    previewBaseDomain: undefined,
                    previewMode: undefined,
                }),
            ).toThrow(UploadOriginPolicyError);
        },
    );
});

describe('parity with the azp pattern', () => {
    it('every origin the strict azp regex admits is matched by a glob', () => {
        const { origins } = resolveUploadOrigins({
            authorizedPartiesRaw: undefined,
            previewBaseDomain: BASE,
            previewMode: undefined,
        });
        const azp = buildPreviewAzpPattern(BASE);

        for (const origin of ['https://pr-1.sandbox.commise.app', 'https://pr-91.sandbox.commise.app']) {
            expect(azp.test(origin)).toBe(true);
            expect(matchesAny(origins, origin)).toBe(true);
        }
    });

    it('every origin the transition azp regex admits is matched, apex included', () => {
        const { origins } = resolveUploadOrigins({
            authorizedPartiesRaw: undefined,
            previewBaseDomain: BASE,
            previewMode: 'transition',
        });
        const azp = buildTransitionAzpPattern(BASE);

        for (const origin of [
            'https://pr-1.sandbox.commise.app',
            'https://pr-91.sandbox.commise.app',
            'https://sandbox.commise.app',
        ]) {
            expect(azp.test(origin)).toBe(true);
            expect(matchesAny(origins, origin)).toBe(true);
        }
    });

    it('strict mode does NOT admit the apex that transition mode admits', () => {
        const { origins } = resolveUploadOrigins({
            authorizedPartiesRaw: undefined,
            previewBaseDomain: BASE,
            previewMode: undefined,
        });

        expect(matchesAny(origins, 'https://sandbox.commise.app')).toBe(false);
    });
});

describe('refuses look-alike origins', () => {
    const refused = [
        'https://evil.com',
        'https://sandbox.commise.app.evil.com',
        'https://pr-1.sandbox.commise.app.evil.com',
        'http://pr-1.sandbox.commise.app',
        'https://pr-1.sandbox.commise.app:8443',
        'https://xpr-1.sandbox.commise.app',
    ];

    it.each([undefined, 'transition'])('with previewMode %s, no refused origin matches', (previewMode) => {
        const { origins } = resolveUploadOrigins({
            authorizedPartiesRaw: undefined,
            previewBaseDomain: BASE,
            previewMode,
        });

        for (const origin of refused) {
            expect(matchesAny(origins, origin), origin).toBe(false);
        }
    });

    it('every glob host ends with the base domain and carries at most one star', () => {
        const { origins } = resolveUploadOrigins({
            authorizedPartiesRaw: undefined,
            previewBaseDomain: BASE,
            previewMode: 'transition',
        });

        for (const glob of origins) {
            expect(glob.startsWith('https://')).toBe(true);
            expect(glob.endsWith(BASE)).toBe(true);
            expect(glob.split('*').length - 1).toBeLessThanOrEqual(1);
        }
    });
});
