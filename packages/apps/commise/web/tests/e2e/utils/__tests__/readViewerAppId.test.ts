import { describe, it, expect, vi } from 'vitest';

import { extractExternalIdFromJwt, pollForExternalId, type ViewerSessionRead } from '../recipeApi.js';

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

/** A read that found a token. */
const tokenRead = (token: string): ViewerSessionRead => ({ kind: 'token', token });

/** A `read` that answers `reads` in order, then repeats the last one. */
function readsInOrder(reads: readonly ViewerSessionRead[]): () => Promise<ViewerSessionRead> {
    let i = 0;

    return vi.fn(async () => reads[Math.min(i++, reads.length - 1)] ?? { kind: 'clerkLoading' });
}

describe('pollForExternalId', () => {
    it('resolves once the asynchronously-backfilled claim appears', async () => {
        const read = readsInOrder([
            tokenRead(jwt({ sub: 'x' })),
            tokenRead(jwt({ sub: 'x' })),
            tokenRead(jwt({ external_id: 'usr_01ABC' })),
        ]);

        await expect(pollForExternalId(read, { timeoutMs: 5_000, intervalMs: 1 })).resolves.toBe('usr_01ABC');
        expect(read).toHaveBeenCalledTimes(3);
    });

    it('waits through a session that is not ready yet (Clerk loading, no session, no token) before the claim', async () => {
        const read = readsInOrder([
            { kind: 'clerkLoading' },
            { kind: 'signedOut' },
            { kind: 'noToken' },
            tokenRead(jwt({ external_id: 'usr_01XYZ' })),
        ]);

        await expect(pollForExternalId(read, { timeoutMs: 5_000, intervalMs: 1 })).resolves.toBe('usr_01XYZ');
    });

    it('throws a loud, diagnostic error about the CLAIM only when a token without it was read (never falls back to sub)', async () => {
        const read = readsInOrder([tokenRead(jwt({ sub: 'user_clerk' }))]);

        await expect(pollForExternalId(read, { timeoutMs: 30, intervalMs: 10 })).rejects.toThrow(
            /carries no 'external_id' claim/,
        );
    });

    /**
     * Run 38433716728 (web shard 4, `recipeEditor.spec.ts` P4): the helper blamed the claim on a test whose session
     * was simply not ready, while every earlier test on the same signer read the claim. A session that never became
     * ready is a different fault with a different fix, and the message must say which one it saw.
     */
    it.each([
        { last: { kind: 'clerkLoading' } as const, names: /Clerk never finished loading/ },
        { last: { kind: 'signedOut' } as const, names: /no Clerk session/ },
        { last: { kind: 'noToken' } as const, names: /returned no session token/ },
    ])('names a session that never became ready ($last.kind), never the claim', async ({ last, names }) => {
        const read = readsInOrder([last]);
        const failure = pollForExternalId(read, { timeoutMs: 30, intervalMs: 10 });

        await expect(failure).rejects.toThrow(names);
        await expect(failure).rejects.not.toThrow(/external_id/);
    });

    it('reports what it saw LAST: a token without the claim after a slow start is the claim fault', async () => {
        const read = readsInOrder([{ kind: 'clerkLoading' }, tokenRead(jwt({ sub: 'user_clerk' }))]);

        await expect(pollForExternalId(read, { timeoutMs: 30, intervalMs: 5 })).rejects.toThrow(
            /carries no 'external_id' claim/,
        );
    });
});
