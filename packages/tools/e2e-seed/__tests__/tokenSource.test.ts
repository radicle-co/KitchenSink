/**
 * The caching decorator's two rules: reuse a fresh token, and NEVER reuse one the client has just told us
 * was refused.
 */
import { describe, expect, it, vi } from 'vitest';

import { memoizingTokenSource, shouldRemint, TOKEN_TTL_MS } from '../src/tokenSource.js';
import type { SessionHandle } from '@kitchensink/e2e-fixtures';

const handle = {
    sessionId: 's',
    devJwt: 'd',
    fapi: 'https://x/v1',
    origin: 'https://o',
    email: 'a+clerk_test@example.com',
} satisfies SessionHandle;

const credential = (token: string) => ({ token, azp: 'https://o', sub: 'u' });

describe('shouldRemint', () => {
    it('mints when nothing has been minted yet', () => {
        expect(shouldRemint(undefined, 0, TOKEN_TTL_MS)).toBe(true);
    });

    it('reuses a token inside the TTL and re-mints at the boundary', () => {
        expect(shouldRemint(0, TOKEN_TTL_MS - 1, TOKEN_TTL_MS)).toBe(false);
        expect(shouldRemint(0, TOKEN_TTL_MS, TOKEN_TTL_MS)).toBe(true);
    });
});

describe('memoizingTokenSource', () => {
    it('mints once and reuses within the TTL', async () => {
        const remint = vi.fn().mockResolvedValue(credential('t1'));
        const source = memoizingTokenSource(handle, { remint, now: () => 0, ttlMs: 1_000 });

        await expect(source()).resolves.toBe('t1');
        await expect(source()).resolves.toBe('t1');
        expect(remint).toHaveBeenCalledTimes(1);
    });

    it('re-mints once the TTL has passed', async () => {
        const remint = vi.fn().mockResolvedValueOnce(credential('t1')).mockResolvedValue(credential('t2'));
        let clock = 0;
        const source = memoizingTokenSource(handle, { remint, now: () => clock, ttlMs: 1_000 });

        await source();
        clock = 1_000;

        await expect(source()).resolves.toBe('t2');
    });

    it('ALWAYS re-mints on forceRefresh — the cached token is the one that was just refused', async () => {
        const remint = vi.fn().mockResolvedValueOnce(credential('t1')).mockResolvedValue(credential('t2'));
        const source = memoizingTokenSource(handle, { remint, now: () => 0, ttlMs: 1_000 });

        await expect(source()).resolves.toBe('t1');
        await expect(source({ forceRefresh: true })).resolves.toBe('t2');
        expect(remint).toHaveBeenCalledTimes(2);
    });

    it('propagates a mint failure rather than returning a stale token', async () => {
        const remint = vi.fn().mockResolvedValueOnce(credential('t1')).mockRejectedValue(new Error('session gone'));
        const source = memoizingTokenSource(handle, { remint, now: () => 0, ttlMs: 1_000 });

        await source();

        // ⛔ A stale token here would produce a 401 from the service, which reads like an app defect. The
        // real cause — a revoked session — must surface as itself.
        await expect(source({ forceRefresh: true })).rejects.toThrow(/session gone/);
    });
});
