/**
 * WHERE THIS IMPORTER MAY WRITE.
 *
 * `importCookbook.ts` documents a safety property in bold — "It has no production affordance and must never
 * be given one" — which nothing enforced: `--recipe-url` was read straight into the mutating client, so a
 * mistyped or pasted production origin would have created real, PUBLIC `imported_public` recipes with no
 * second confirmation. A property stated only in a docstring is a property the next operator can break.
 *
 * The rule under test is an ALLOW-list, and that is the whole point: an origin this module does not
 * recognise is REFUSED, not classified. It therefore differs deliberately from the two stage classifiers in
 * the tree (`prodWebSurface.classifyHostStage`, `web/src/config/clerkStageCoherence.classifyEndpointStage`),
 * which must place every host and answer `unknown` — that shape is right for a coherence report and wrong
 * for a write gate, where an unrecognised host must fail closed.
 */
import { describe, expect, it } from 'vitest';

import { assertWritableImportOrigin, isForbiddenImportOriginError, isWritableImportOrigin } from '../writableOrigin.js';

describe('isWritableImportOrigin', () => {
    it.each([
        'http://localhost:3000',
        'http://localhost',
        'http://127.0.0.1:3000',
        'http://[::1]:3000',
        'http://recipe.localhost:3000',
        'https://recipe-pr-73.commise.app',
        'https://recipe-pr-7.commise.app/',
        'https://food-pr-112.commise.app',
        'https://sandbox.commise.app',
        'https://recipe.sandbox.commise.app',
    ])('admits the non-production origin %s', (origin) => {
        expect(isWritableImportOrigin(origin)).toBe(true);
    });

    // The first two are the pasted-production case this exists for. The rest are the fail-closed half: an
    // origin nobody recognises is refused, because "not obviously production" is not "safe to write to".
    it.each([
        'https://recipe.commise.app',
        'https://commise.app',
        'https://www.commise.app',
        'https://identity.commise.app',
        'https://recipe.example.com',
        'https://recipe-pr-.commise.app',
        'https://recipe-prod.commise.app',
        'https://evil.com/?x=sandbox.commise.app',
        'https://sandbox.commise.app.evil.com',
        'not-a-url',
        '',
        'ftp://localhost',
        'file:///etc/passwd',
    ])('refuses %s', (origin) => {
        expect(isWritableImportOrigin(origin)).toBe(false);
    });
});

describe('assertWritableImportOrigin', () => {
    it('returns the origin unchanged when it is writable, so it can wrap the argument in place', () => {
        expect(assertWritableImportOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('throws a typed, guardable error naming the origin and the rule', () => {
        const failure = ((): unknown => {
            try {
                assertWritableImportOrigin('https://recipe.commise.app');

                return undefined;
            } catch (error) {
                return error;
            }
        })();

        expect(isForbiddenImportOriginError(failure)).toBe(true);
        expect((failure as Error).message).toContain('recipe.commise.app');
        expect((failure as Error).message).toMatch(/localhost|sandbox|pr-/);
    });

    it('is an Error subclass whose prototype survives, so `instanceof` works across the boundary', () => {
        expect(() => assertWritableImportOrigin('https://commise.app')).toThrow(Error);
    });
});
