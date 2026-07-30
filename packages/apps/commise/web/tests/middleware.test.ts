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
});
