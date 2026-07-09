import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, getUserMe, patchUserMe } from '../src/services/api';

describe('mobile api — getUserMe', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends Authorization: Bearer <token> to /v1/users/me', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ user: {}, account: {} }),
        });
        const getToken = vi.fn().mockResolvedValue('tok_123');

        await getUserMe(getToken);

        expect(getToken).toHaveBeenCalled();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toContain('/v1/users/me');
        expect(init.method).toBe('GET');
        expect(init.headers.Authorization).toBe('Bearer tok_123');
    });

    it('forwards the caller-provided token getter, so the hook’s skipCache request flows through', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
        const rawGetToken = vi.fn().mockResolvedValue('fresh_token');
        // Mirrors useUserProfile: the hook passes `() => getToken({ skipCache: true })`.
        const skipCacheGetter = () => rawGetToken({ skipCache: true });

        await getUserMe(skipCacheGetter);

        expect(rawGetToken).toHaveBeenCalledWith({ skipCache: true });
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(init.headers.Authorization).toBe('Bearer fresh_token');
    });

    it('throws ApiError(401) and does not fetch when no token is available', async () => {
        const getToken = vi.fn().mockResolvedValue(null);

        await expect(getUserMe(getToken)).rejects.toBeInstanceOf(ApiError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('mobile api — patchUserMe', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('PATCHes the update to /v1/users/me — NOT the drifted /v1/profiles/me', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ user: {}, account: {} }) });
        const getToken = vi.fn().mockResolvedValue('tok_123');

        await patchUserMe(getToken, { displayName: 'Ada', avatarUrl: null });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toContain('/v1/users/me');
        expect(url).not.toContain('/v1/profiles/me');
        expect(init.method).toBe('PATCH');
        expect(init.body).toBe(JSON.stringify({ displayName: 'Ada', avatarUrl: null }));
        expect(init.headers.Authorization).toBe('Bearer tok_123');
    });
});
