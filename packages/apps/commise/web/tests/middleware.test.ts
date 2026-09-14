import { describe, expect, it, vi } from 'vitest';

// clerkMiddleware(cb) → cb, so `mod.default` is the callback we can invoke directly. NextResponse is
// stubbed to identifiable objects so we can assert redirect vs pass-through without a real runtime.
vi.mock('@clerk/nextjs/server', () => ({
    clerkMiddleware: (handler: unknown) => handler,
}));

vi.mock('next/server', () => ({
    NextResponse: {
        redirect: (url: URL) => ({ type: 'redirect', location: url.toString() }),
        next: () => ({ type: 'next' }),
    },
}));

/** A minimal NextRequest double: a cloneable `nextUrl` + `Accept-Language` header. */
function makeReq(pathname: string, acceptLanguage = 'en-US,en;q=0.9') {
    const url = new URL(`https://app.test${pathname}`);

    return {
        nextUrl: Object.assign(url, { clone: () => new URL(url.href) }),
        headers: new Headers({ 'accept-language': acceptLanguage }),
    };
}

type Handler = (auth: unknown, req: unknown) => Promise<{ type: string; location?: string }>;

describe('middleware (locale gate)', () => {
    it('exports a middleware function and matcher config', async () => {
        const mod = await import('@/middleware');

        expect(typeof mod.default).toBe('function');
        expect(Array.isArray(mod.config.matcher)).toBe(true);
    });

    it('redirects a locale-less page path to the negotiated locale', async () => {
        const mod = await import('@/middleware');

        const res = await (mod.default as unknown as Handler)(undefined, makeReq('/profile'));

        expect(res.type).toBe('redirect');
        expect(res.location).toBe('https://app.test/en/profile');
    });

    it('redirects the bare root to /{locale} (no trailing slash)', async () => {
        const mod = await import('@/middleware');

        const res = await (mod.default as unknown as Handler)(undefined, makeReq('/'));

        expect(res.location).toBe('https://app.test/en');
    });

    it('passes a locale-prefixed path through unchanged', async () => {
        const mod = await import('@/middleware');

        expect((await (mod.default as unknown as Handler)(undefined, makeReq('/en/profile'))).type).toBe('next');
        expect((await (mod.default as unknown as Handler)(undefined, makeReq('/en'))).type).toBe('next');
    });

    it('never locale-redirects API/tRPC routes', async () => {
        const mod = await import('@/middleware');

        expect((await (mod.default as unknown as Handler)(undefined, makeReq('/api/users'))).type).toBe('next');
        expect((await (mod.default as unknown as Handler)(undefined, makeReq('/trpc/x'))).type).toBe('next');
    });

    it('protection is RESOURCE-level: the middleware never calls auth.protect (GHSA-vqx2-fgx2-5wq9)', async () => {
        // Guard against reintroducing createRouteMatcher + middleware auth.protect — deprecated by Clerk
        // after a middleware route-matching bypass advisory. Protected pages self-redirect instead.
        const mod = await import('@/middleware');
        const protect = vi.fn();
        const fakeAuth = Object.assign(() => Promise.resolve({ protect }), { protect });

        await (mod.default as unknown as Handler)(fakeAuth, makeReq('/en/profile'));

        expect(protect).not.toHaveBeenCalled();
    });
});

describe('middleware matcher config', () => {
    it('is root-anchored (no pr-N tolerance; Next auto-prepends basePath) and valid Next syntax', async () => {
        const { config } = await import('@/middleware');

        for (const m of config.matcher) {
            expect(m.startsWith('/(?:')).toBe(false); // invalid-syntax guard (build-breaker)
            expect(m).not.toContain('pr-'); // rely on Next's basePath prepend
        }
    });

    it('excludes Next internals + the Sentry tunnel, includes the bare root', async () => {
        const { config } = await import('@/middleware');

        expect(config.matcher).toContain('/');
        const assetMatcher = config.matcher.find((m) => m.includes('_next/static'))!;
        const re = new RegExp(`^${assetMatcher}$`);
        expect(re.test('/en/profile')).toBe(true);
        expect(re.test('/_next/static/chunk.js')).toBe(false);
        expect(re.test('/sentry-tunnel')).toBe(false);
    });

    /**
     * `/_vercel/*` is the PLATFORM's own path namespace, not an app route, and it is where Vercel Web
     * Analytics both loads its script and posts its beacons. If the matcher admits it, this middleware
     * locale-redirects it: `/_vercel/insights/script.js` is not `/api`, carries no locale prefix, and so
     * falls through to `NextResponse.redirect(/en/_vercel/insights/script.js)` — a path that does not
     * exist. The script 404s, `inject()` never arms, and NOT ONE page view is ever recorded.
     *
     * The failure is invisible from inside the app: no error, no console warning in production, no failed
     * assertion — just a dashboard that stays permanently empty, which reads identically to "nobody
     * visited". Vercel's own recommended matcher for locale middleware excludes `_vercel` for exactly this
     * reason, and this is the assertion that keeps it excluded.
     */
    it('excludes the /_vercel platform namespace so analytics is never locale-redirected', async () => {
        const { config } = await import('@/middleware');

        const assetMatcher = config.matcher.find((m) => m.includes('_next/static'))!;
        const re = new RegExp(`^${assetMatcher}$`);

        // The script the browser loads, and the two beacon endpoints it posts to.
        expect(re.test('/_vercel/insights/script.js')).toBe(false);
        expect(re.test('/_vercel/insights/view')).toBe(false);
        expect(re.test('/_vercel/insights/event')).toBe(false);
        // Speed Insights uses the same namespace; excluding the whole prefix covers it before it is added.
        expect(re.test('/_vercel/speed-insights/script.js')).toBe(false);
    });

    it('still matches an app path that merely CONTAINS the excluded names', async () => {
        // The exclusions are anchored prefixes, not substrings: a real recipe whose slug happens to read
        // `_vercel` or `sentry-tunnel` must still be locale-redirected like any other page.
        const { config } = await import('@/middleware');

        const assetMatcher = config.matcher.find((m) => m.includes('_next/static'))!;
        const re = new RegExp(`^${assetMatcher}$`);

        expect(re.test('/recipes/_vercel-cake')).toBe(true);
        expect(re.test('/en/recipes/sentry-tunnel-soup')).toBe(true);
    });
});

describe('middleware handler — platform paths must not be locale-redirected', () => {
    // Defence in depth. The matcher is the primary gate, but it is a build-time manifest string: a typo
    // there fails open (the path reaches the handler). Asserting the handler ALSO passes `/_vercel`
    // through means one mistake cannot silently disable analytics on its own.
    it('passes /_vercel/* through instead of redirecting it to a locale', async () => {
        const mod = await import('@/middleware');

        for (const path of ['/_vercel/insights/script.js', '/_vercel/insights/view', '/_vercel/insights/event']) {
            expect((await (mod.default as unknown as Handler)(undefined, makeReq(path))).type).toBe('next');
        }
    });

    it('still locale-redirects an app path that merely STARTS with the platform prefix', async () => {
        // The platform namespace is `/_vercel/` — the slash is part of it. `/_vercel-cake`, `/_vercelx/…`
        // and a bare `/_vercel` are app paths, and the matcher above (anchored on `_vercel/`) sends them
        // here to be locale-redirected like any other page. A handler check on the bare prefix would pass
        // them through un-localized instead, contradicting the matcher it exists to back up.
        const mod = await import('@/middleware');

        for (const path of ['/_vercel-cake', '/_vercelx/insights/view', '/_vercel']) {
            const res = await (mod.default as unknown as Handler)(undefined, makeReq(path));

            expect(res.type).toBe('redirect');
            expect(res.location).toBe(`https://app.test/en${path}`);
        }
    });
});
