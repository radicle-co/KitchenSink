import { describe, it, expect, vi } from 'vitest';

import { extractExternalIdFromJwt, pollForExternalId } from '../recipeApi.js';

/** Build a fake JWT whose middle segment base64url-encodes `claims`. */
function jwt(claims: Record<string, unknown>): string {
    return ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');
}

describe('extractExternalIdFromJwt', () => {
    it('returns the external_id claim when present', () => {
        expect(extractExternalIdFromJwt(jwt({ external_id: 'usr_01ABC', sub: 'user_clerk' }))).toBe('usr_01ABC');
    });

    it('returns undefined when the claim is absent (never falls back to sub)', () => {
        expect(extractExternalIdFromJwt(jwt({ sub: 'user_clerk' }))).toBeUndefined();
    });

    it('returns undefined for an empty-string claim', () => {
        expect(extractExternalIdFromJwt(jwt({ external_id: '' }))).toBeUndefined();
    });

    it('returns undefined for a malformed token (no payload / bad base64) instead of throwing', () => {
        expect(extractExternalIdFromJwt('not-a-jwt')).toBeUndefined();
    });
});

describe('pollForExternalId', () => {
    it('resolves once the asynchronously-backfilled claim appears', async () => {
        const tokens = [jwt({ sub: 'x' }), jwt({ sub: 'x' }), jwt({ external_id: 'usr_01ABC' })];
        let i = 0;
        const getToken = vi.fn(async () => tokens[Math.min(i++, tokens.length - 1)] ?? null);

        await expect(pollForExternalId(getToken, { timeoutMs: 5_000, intervalMs: 1 })).resolves.toBe('usr_01ABC');
        expect(getToken).toHaveBeenCalledTimes(3);
    });

    it('tolerates a null token (session not ready yet) before the claim lands', async () => {
        const tokens: (string | null)[] = [null, jwt({ external_id: 'usr_01XYZ' })];
        let i = 0;
        const getToken = vi.fn(async () => tokens[Math.min(i++, tokens.length - 1)] ?? null);

        await expect(pollForExternalId(getToken, { timeoutMs: 5_000, intervalMs: 1 })).resolves.toBe('usr_01XYZ');
    });

    it('throws a loud, diagnostic error after the timeout (never falls back to sub)', async () => {
        const getToken = vi.fn(async () => jwt({ sub: 'user_clerk' }));

        await expect(pollForExternalId(getToken, { timeoutMs: 30, intervalMs: 10 })).rejects.toThrow(/external_id/);
    });
});
