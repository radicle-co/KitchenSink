import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, buildApiClient } from '@/lib/apiClient';

const mockNavigateTo = vi.fn();

vi.mock('@/lib/navigation', () => ({
    navigateTo: (url: string) => mockNavigateTo(url),
}));

describe('api-client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.history.replaceState(null, '', '/profile');
    });

    it('redirects expired sessions to IdP sign-in fallback on 401', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ message: 'Unauthorized' }),
        } as Response);

        await expect(buildApiClient('expired-token').get('/api/v1/users/me')).rejects.toThrow('Unauthorized');

        expect(mockNavigateTo).toHaveBeenCalledWith('/sign-in?redirect_url=%2Fprofile');
    });

    it('resolves (does not reject) on a 202 with an empty body — DELETE /api/v1/users/me success (B26)', async () => {
        // DELETE /api/v1/users/me returns 202 Accepted with no body. The old code only special-cased 204, so
        // response.json() threw on the empty 202 — the account was deleted server-side but signOut() never
        // ran and the user saw a parser error. An empty 2xx body must resolve to void.
        global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

        await expect(buildApiClient('tok').delete('/api/v1/users/me')).resolves.toBeUndefined();
    });

    it('returns undefined on a 204 (regression)', async () => {
        global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

        await expect(buildApiClient('tok').delete('/x')).resolves.toBeUndefined();
    });

    it('parses a JSON body on a 200', async () => {
        global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'u1' }), { status: 200 }));

        await expect(buildApiClient('tok').get<{ id: string }>('/x')).resolves.toEqual({ id: 'u1' });
    });

    it('throws a typed ApiError carrying statusCode and code on an error response (B26)', async () => {
        global.fetch = vi
            .fn()
            .mockResolvedValue(
                new Response(JSON.stringify({ message: 'Forbidden', code: 'FORBIDDEN' }), { status: 403 }),
            );

        const err = await buildApiClient('tok')
            .delete('/api/v1/users/me')
            .catch((caught: unknown) => caught);

        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(403);
        expect((err as ApiError).code).toBe('FORBIDDEN');
    });
});
