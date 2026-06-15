import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
    clerkMiddleware: (handler: unknown): unknown => handler,
    createRouteMatcher: () => (): boolean => false,
}));

import { config } from '@/middleware';

describe('clerk middleware matcher', () => {
    it('excludes the Sentry tunnel route so Clerk does not intercept it', () => {
        // Reference the asset/tunnel matcher by content, not index — the matcher array also carries a
        // bare `/` root entry (so middleware runs on the no-trailing-slash basePath root).
        expect(config.matcher.some((m) => m.includes('sentry-tunnel'))).toBe(true);
    });
});
