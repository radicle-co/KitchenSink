/**
 * The site's own public identity — the one thing about this package that only the deployment knows.
 *
 * Docusaurus needs an absolute `url` at build time and uses it for canonical links, Open Graph tags
 * and the sitemap. Nothing about navigation depends on it, so a wrong value is invisible in the
 * rendered site: that is why it is resolved by a tested function rather than an inline expression in
 * `docusaurus.config.ts`, which the config's own header reserves for wiring.
 *
 * ⛔ NOT a security control. Access to the published corpus is governed by the Vercel project's
 * deployment protection (`ssoProtection.deploymentType === 'all'`), which `.github/workflows/docs.yml`
 * asserts against the Vercel API before it deploys and re-asserts with an unauthenticated request
 * afterwards. This value never gates anything.
 */

/**
 * The `url` used when no deployment identity is configured — a local build, or a pull request that
 * only proves the site compiles.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve, which makes a placeholder
 * that escaped into a published page an obviously broken link rather than a plausible wrong one.
 */
export const PLACEHOLDER_SITE_URL = 'https://example.invalid';

/** Thrown by {@link resolveSiteUrl}; kept local because its only caller is the site config. */
class InvalidSiteUrlError extends Error {
    constructor(readonly value: string) {
        super(
            `DOCS_SITE_URL must be an absolute http(s) origin (e.g. https://commise-docs.vercel.app), but was ${JSON.stringify(value)}.`,
        );
        this.name = 'InvalidSiteUrlError';
        Object.setPrototypeOf(this, InvalidSiteUrlError.prototype);
    }
}

/** Type guard for {@link InvalidSiteUrlError}, per the repository's custom-error convention. */
export function isInvalidSiteUrlError(error: unknown): error is InvalidSiteUrlError {
    return error instanceof InvalidSiteUrlError;
}

/**
 * Resolves the site's absolute `url` from a configured value.
 *
 * Absent is FINE (the placeholder stands in); present-but-malformed is a FAILURE, because the only
 * way a malformed value gets here is a mis-set `DOCS_SITE_URL`, and Docusaurus's own complaint about
 * it names Joi rather than the variable.
 *
 * @param configured - Raw `DOCS_SITE_URL`, as read from the environment.
 * @returns An absolute origin with no trailing slash.
 * @throws {InvalidSiteUrlError} When a value is present but is not an absolute http(s) URL.
 */
export function resolveSiteUrl(configured: string | undefined): string {
    const trimmed = (configured ?? '').trim();

    if (trimmed === '') {
        return PLACEHOLDER_SITE_URL;
    }

    let parsed: URL;

    try {
        parsed = new URL(trimmed);
    } catch {
        throw new InvalidSiteUrlError(trimmed);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new InvalidSiteUrlError(trimmed);
    }

    // Docusaurus wants the ORIGIN in `url` and everything after it in `baseUrl`; `new URL` normalises
    // a bare origin's pathname to `/`, so anything longer is a path the caller meant to put here.
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
        throw new InvalidSiteUrlError(trimmed);
    }

    return parsed.origin;
}
