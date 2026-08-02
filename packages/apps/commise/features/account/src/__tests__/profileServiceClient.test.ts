import { describe, expect, it, vi } from 'vitest';

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    UnexpectedResponseError,
    isBadRequestError,
    isForbiddenError,
    isNotFoundError,
    isProfileServiceClientError,
    isUnauthorizedError,
    isUnexpectedResponseError,
} from '../errors.js';
import { PROFILE_ME_PATH, ProfileServiceClient } from '../profileServiceClient.js';

const BASE = 'https://identity.example.test';

/** A `fetch` double that resolves a single canned `Response`-shaped value, recording every call. */
function stubFetch(response: { status: number; body?: unknown; text?: string }) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body ?? {},
        text: async () => (response.text !== undefined ? response.text : JSON.stringify(response.body ?? {})),
    });

    return fetchMock;
}

describe('ProfileServiceClient — request shape', () => {
    it('targets GET /api/v1/users/me — the route the identity service actually exposes', () => {
        // Guards against the historical drift where mobile PATCHed /api/v1/profiles/me (a route that does not
        // exist server-side).
        expect(PROFILE_ME_PATH).toBe('/api/v1/users/me');
    });

    it('getMe() sends GET /api/v1/users/me with the bearer token and returns the parsed profile', async () => {
        const profile = { user: { displayName: 'Ada' }, account: {} };
        const fetchMock = stubFetch({ status: 200, body: profile });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        const result = await client.getMe();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toBe(`${BASE}${PROFILE_ME_PATH}`);
        expect(init.method).toBe('GET');
        expect(init.headers['authorization']).toBe('Bearer tok_123');
        expect(result).toEqual(profile);
    });

    it('patchMe() PATCHes the update as a JSON body to /api/v1/users/me — NOT /api/v1/profiles/me', async () => {
        const updated = { user: { displayName: 'Ada Lovelace' }, account: {} };
        const fetchMock = stubFetch({ status: 200, body: updated });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        const result = await client.patchMe({ displayName: 'Ada Lovelace', avatarUrl: null });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toBe(`${BASE}${PROFILE_ME_PATH}`);
        expect(url).not.toContain('/api/v1/profiles/me');
        expect(init.method).toBe('PATCH');
        expect(init.body).toBe(JSON.stringify({ displayName: 'Ada Lovelace', avatarUrl: null }));
        expect(init.headers['content-type']).toBe('application/json');
        expect(result).toEqual(updated);
    });

    it('deleteMe() DELETEs /api/v1/users/me and returns the accepted-deletion body', async () => {
        const accepted = { sub: 'usr_1', deletedAt: '2026-07-24T00:00:00.000Z', message: 'Account deletion queued' };
        const fetchMock = stubFetch({ status: 202, body: accepted });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        const result = await client.deleteMe();

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.method).toBe('DELETE');
        expect(result).toEqual(accepted);
    });

    it('resolves undefined for a genuinely empty response body (e.g. a 204)', async () => {
        const fetchMock = stubFetch({ status: 204, text: '' });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        await expect(client.deleteMe()).resolves.toBeUndefined();
    });

    it('sends no body/content-type header on a GET', async () => {
        const fetchMock = stubFetch({ status: 200, body: { user: {}, account: {} } });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        await client.getMe();

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(init.body).toBeUndefined();
        expect(init.headers['content-type']).toBeUndefined();
    });

    it('omits the Authorization header when constructed with no token', async () => {
        const fetchMock = stubFetch({ status: 200, body: { user: {}, account: {} } });
        const client = new ProfileServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.getMe();

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(init.headers['authorization']).toBeUndefined();
    });

    it('resolves a callback TokenSource per request, forwarding forceRefresh', async () => {
        const fetchMock = stubFetch({ status: 200, body: { user: {}, account: {} } });
        const getToken = vi.fn((options?: { forceRefresh?: boolean }) =>
            options?.forceRefresh === true ? 'fresh_token' : 'cached_token',
        );
        const client = new ProfileServiceClient({ baseUrl: BASE, token: getToken, fetch: fetchMock });

        await client.getMe({ forceRefresh: true });

        expect(getToken).toHaveBeenCalledWith({ forceRefresh: true });
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(init.headers['authorization']).toBe('Bearer fresh_token');
    });

    it("propagates a callback TokenSource's rejection BEFORE issuing any fetch (fail-fast on no session)", async () => {
        const fetchMock = stubFetch({ status: 200, body: {} });
        const getToken = vi.fn().mockImplementation(() => {
            throw new UnauthorizedError('Not authenticated', 'unauthenticated');
        });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: getToken, fetch: fetchMock });

        await expect(client.getMe()).rejects.toBeInstanceOf(UnauthorizedError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('forwards configured credentials on every request', async () => {
        const fetchMock = stubFetch({ status: 200, body: { user: {}, account: {} } });
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            token: 'tok',
            fetch: fetchMock,
            credentials: 'include',
        });

        await client.getMe();

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.credentials).toBe('include');
    });

    it('strips a trailing slash from baseUrl before joining the path', async () => {
        const fetchMock = stubFetch({ status: 200, body: { user: {}, account: {} } });
        const client = new ProfileServiceClient({ baseUrl: `${BASE}/`, token: 'tok', fetch: fetchMock });

        await client.getMe();

        const [url] = fetchMock.mock.calls[0] as [string];
        expect(url).toBe(`${BASE}${PROFILE_ME_PATH}`);
    });
});

describe('ProfileServiceClient — status → typed error mapping', () => {
    it.each([
        [400, BadRequestError, isBadRequestError],
        [401, UnauthorizedError, isUnauthorizedError],
        [403, ForbiddenError, isForbiddenError],
        [404, NotFoundError, isNotFoundError],
    ] as const)('maps %i to the matching typed error, satisfying its is* guard', async (status, ErrorClass, guard) => {
        const fetchMock = stubFetch({ status, body: { message: 'nope', code: 'SOME_CODE' } });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const error = await client.getMe().catch((err: unknown) => err);

        expect(error).toBeInstanceOf(ErrorClass);
        expect(guard(error)).toBe(true);
        expect(isProfileServiceClientError(error)).toBe(true);
        expect((error as InstanceType<typeof ErrorClass>).message).toBe('nope');
        expect((error as InstanceType<typeof ErrorClass>).code).toBe('SOME_CODE');
        expect((error as InstanceType<typeof ErrorClass>).status).toBe(status);
    });

    it('maps an unmapped status to UnexpectedResponseError', async () => {
        const fetchMock = stubFetch({ status: 500, body: { message: 'boom' } });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const error = await client.getMe().catch((err: unknown) => err);

        expect(error).toBeInstanceOf(UnexpectedResponseError);
        expect(isUnexpectedResponseError(error)).toBe(true);
        expect((error as UnexpectedResponseError).status).toBe(500);
    });

    it('falls back to a generic message when the error body has none (or fails to parse)', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            json: async () => {
                throw new Error('not json');
            },
            text: async () => '',
        });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const error = await client.getMe().catch((err: unknown) => err);

        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as ForbiddenError).message).toBe('Request failed: 403');
    });

    it('invokes onUnauthorized on a 401, before the typed error rejects', async () => {
        const fetchMock = stubFetch({ status: 401, body: { message: 'expired' } });
        const onUnauthorized = vi.fn();
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock, onUnauthorized });

        await expect(client.getMe()).rejects.toBeInstanceOf(UnauthorizedError);
        expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('does NOT invoke onUnauthorized on a non-401 failure', async () => {
        const fetchMock = stubFetch({ status: 404, body: { message: 'gone' } });
        const onUnauthorized = vi.fn();
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock, onUnauthorized });

        await expect(client.getMe()).rejects.toBeInstanceOf(NotFoundError);
        expect(onUnauthorized).not.toHaveBeenCalled();
    });
});

describe('is* guards — negative cases', () => {
    it('reject a plain Error / non-error value', () => {
        expect(isBadRequestError(new Error('nope'))).toBe(false);
        expect(isUnauthorizedError('nope')).toBe(false);
        expect(isForbiddenError(undefined)).toBe(false);
        expect(isNotFoundError(null)).toBe(false);
        expect(isUnexpectedResponseError({})).toBe(false);
        expect(isProfileServiceClientError(new Error('nope'))).toBe(false);
    });

    it('a sibling typed error does not satisfy an unrelated guard (discriminates by subclass)', () => {
        expect(isBadRequestError(new UnauthorizedError())).toBe(false);
        expect(isNotFoundError(new ForbiddenError())).toBe(false);
    });
});
