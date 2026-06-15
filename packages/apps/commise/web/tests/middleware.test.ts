import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => {
    return {
        clerkMiddleware: (handler: unknown) => handler,
        createRouteMatcher: (patterns: string[]) => {
            return (req: { nextUrl: { pathname: string } }) =>
                patterns.some((p) => {
                    const prefix = p.replace('(.*)', '');

                    return req.nextUrl.pathname.startsWith(prefix);
                });
        },
    };
});

describe('middleware (IdP)', () => {
    it('exports a middleware function and matcher config', async () => {
        const mod = await import('@/middleware');

        expect(typeof mod.default).toBe('function');
        expect(mod.config).toBeDefined();
        expect(Array.isArray(mod.config.matcher)).toBe(true);
    });

    it('protects /profile, /account, /settings routes', async () => {
        const mod = await import('@/middleware');
        const protect = vi.fn();
        const fakeAuth = Object.assign(() => Promise.resolve({ protect }), { protect });

        await (mod.default as unknown as (a: unknown, r: unknown) => Promise<unknown>)(fakeAuth, {
            nextUrl: { pathname: '/profile' },
        });
        expect(protect).toHaveBeenCalled();

        protect.mockClear();
        await (mod.default as unknown as (a: unknown, r: unknown) => Promise<unknown>)(fakeAuth, {
            nextUrl: { pathname: '/account' },
        });
        expect(protect).toHaveBeenCalled();

        protect.mockClear();
        await (mod.default as unknown as (a: unknown, r: unknown) => Promise<unknown>)(fakeAuth, {
            nextUrl: { pathname: '/settings' },
        });
        expect(protect).toHaveBeenCalled();
    });

    it('does not protect public routes', async () => {
        const mod = await import('@/middleware');
        const protect = vi.fn();
        const fakeAuth = Object.assign(() => Promise.resolve({ protect }), { protect });

        await (mod.default as unknown as (a: unknown, r: unknown) => Promise<unknown>)(fakeAuth, {
            nextUrl: { pathname: '/' },
        });

        expect(protect).not.toHaveBeenCalled();
    });
});

describe('middleware under a base path (/pr-{N})', () => {
    it('protects the stripped path: Next removes /pr-{N} before middleware, so root-anchored matching fires', async () => {
        // Real Next 15 behavior (verified in get-next-pathname-info): a request to /pr-123/profile
        // reaches middleware as nextUrl.pathname '/profile'. Root-anchored patterns therefore protect
        // it; a /pr-123-prefixed matcher would NOT match the stripped path → silent auth bypass.
        const mod = await import('@/middleware');
        const protect = vi.fn();
        const fakeAuth = Object.assign(() => Promise.resolve({ protect }), { protect });

        await (mod.default as unknown as (a: unknown, r: unknown) => Promise<unknown>)(fakeAuth, {
            nextUrl: { pathname: '/profile' },
        });

        expect(protect).toHaveBeenCalled();
    });

    it('config.matcher is root-anchored — Next auto-prepends basePath at build, no manual pr-N tolerance', async () => {
        // Verified against the compiled middleware-manifest: with basePath=/pr-999, Next compiles
        // `/((?!_next/static|…).*)` to `^\/pr-999\/((?!_next/static|…).*)` — it prepends the prefix and
        // applies the asset/tunnel exclusions AFTER it. So the SOURCE stays root-anchored; a leading
        // `(?:pr-[^/]+/)?` is both redundant AND invalid Next matcher syntax (it broke `next build` with
        // "Pattern cannot start with ?"). These assertions guard both regressions.
        const { config } = await import('@/middleware');

        for (const m of config.matcher) {
            expect(m.startsWith('/(?:')).toBe(false); // invalid-syntax guard (build-breaker)
            expect(m).not.toContain('pr-'); // root-anchored guard (rely on Next's basePath prepend)
        }

        // Root-level exclusions the source must express (Next handles the /pr-{N} prefix itself):
        const re = new RegExp(`^${config.matcher[0]}$`);
        expect(re.test('/profile')).toBe(true);
        expect(re.test('/_next/static/chunk.js')).toBe(false);
        expect(re.test('/sentry-tunnel')).toBe(false);
    });
});
