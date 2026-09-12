import { describe, expect, it } from 'vitest';

import { PLACEHOLDER_SITE_URL, resolveSiteUrl } from '../siteUrl.js';

/**
 * Docusaurus stamps `url` into every page's canonical link, its Open Graph tags and its sitemap. It
 * is not load-bearing for navigation — routes are `baseUrl`-relative — so a wrong value fails
 * SILENTLY, which is exactly the class of defect that justifies a resolver with tests instead of an
 * inline `??` in the config.
 *
 * ⚠️ This value is NOT a security control and must never be read as one. What keeps the corpus
 * private is the Vercel project's `ssoProtection`, asserted by `docsSiteDeployGuards.test.ts` and by
 * the unauthenticated probe in `.github/workflows/docs.yml`. A site published at a URL this resolver
 * has never heard of is still protected.
 */
describe('resolveSiteUrl', () => {
    it('uses the configured absolute URL', () => {
        expect(resolveSiteUrl('https://commise-docs.vercel.app')).toBe('https://commise-docs.vercel.app');
    });

    it('drops a trailing slash, because Docusaurus rejects a `url` that carries one', () => {
        expect(resolveSiteUrl('https://commise-docs.vercel.app/')).toBe('https://commise-docs.vercel.app');
    });

    it('ignores surrounding whitespace, which is what a copy-pasted repository variable carries', () => {
        expect(resolveSiteUrl('  https://commise-docs.vercel.app  ')).toBe('https://commise-docs.vercel.app');
    });

    it('falls back to the placeholder when nothing is configured', () => {
        // A local `docusaurus start`/`build` must not require the deployment's identity to exist.
        expect(resolveSiteUrl(undefined)).toBe(PLACEHOLDER_SITE_URL);
        expect(resolveSiteUrl('')).toBe(PLACEHOLDER_SITE_URL);
        expect(resolveSiteUrl('   ')).toBe(PLACEHOLDER_SITE_URL);
    });

    it('refuses a value that is not an absolute http(s) origin, rather than passing it to Docusaurus', () => {
        // Docusaurus's own failure for these is a Joi error thousands of lines into a build; refusing
        // here names the variable that is wrong. Each of these is a real mis-set: a bare host, a path,
        // a non-web scheme.
        for (const bad of ['commise-docs.vercel.app', '/docs', 'ftp://example.com', 'not a url']) {
            expect(() => resolveSiteUrl(bad)).toThrow(/DOCS_SITE_URL/);
        }
    });
});
