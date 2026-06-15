import { afterEach, describe, expect, it, vi } from 'vitest';

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
    afterEach(() => {
        delete process.env['NEXT_PUBLIC_BASE_PATH'];
        vi.resetModules();
    });

    async function loadWithPrefix(basePath: string) {
        process.env['NEXT_PUBLIC_BASE_PATH'] = basePath;
        vi.resetModules();

        return import('@/middleware');
    }

    it('protects /pr-123/profile when built with that prefix (the security fix)', async () => {
        const mod = await loadWithPrefix('/pr-123');
        const protect = vi.fn();
        const fakeAuth = Object.assign(() => Promise.resolve({ protect }), { protect });

        await (mod.default as unknown as (a: unknown, r: unknown) => Promise<unknown>)(fakeAuth, {
            nextUrl: { pathname: '/pr-123/profile' },
        });

        expect(protect).toHaveBeenCalled();
    });

    it('does not protect a bare /profile in a prefixed build (not a real route)', async () => {
        const mod = await loadWithPrefix('/pr-123');
        const protect = vi.fn();
        const fakeAuth = Object.assign(() => Promise.resolve({ protect }), { protect });

        await (mod.default as unknown as (a: unknown, r: unknown) => Promise<unknown>)(fakeAuth, {
            nextUrl: { pathname: '/profile' },
        });

        expect(protect).not.toHaveBeenCalled();
    });

    it('matcher tolerates the pr-N prefix: runs on routes, skips assets + tunnel (both prod and preview)', async () => {
        const mod = await loadWithPrefix('/pr-123');
        const re = new RegExp(`^${mod.config.matcher[0]}$`);

        expect(re.test('/pr-123/profile')).toBe(true);
        expect(re.test('/pr-123/_next/static/chunk.js')).toBe(false);
        expect(re.test('/pr-123/sentry-tunnel')).toBe(false);
        expect(re.test('/profile')).toBe(true);
        expect(re.test('/_next/static/chunk.js')).toBe(false);
    });
});
