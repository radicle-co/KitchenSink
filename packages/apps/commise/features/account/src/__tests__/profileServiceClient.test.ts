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
import { makeUserProfile, makeUserProfileUser } from '../__fixtures__/index.js';
import { isInvalidRequestError } from '../errors.js';
import { AVATAR_PRESIGN_PATH, PROFILE_ME_PATH, ProfileServiceClient } from '../profileServiceClient.js';

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
        const profile = makeUserProfile();
        const fetchMock = stubFetch({ status: 200, body: profile });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        const result = await client.getMe();

        // ⚠️ The API call is IDENTIFIED, not assumed to be the only one. The transport also fires the
        // drift-layer-3 skew probe at `GET /health` (once per origin per process, fire-and-forget — see
        // `../contractSkew.ts`), so a `toHaveBeenCalledTimes(1)` here would assert "no diagnostics exist" rather
        // than anything about `getMe`. `profileServiceClientSkew.test.ts` owns the probe's own behaviour.
        const apiCall = fetchMock.mock.calls.find(([called]) => !String(called).endsWith('/health'));

        expect(apiCall).toBeDefined();
        const [url, init] = apiCall as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toBe(`${BASE}${PROFILE_ME_PATH}`);
        expect(init.method).toBe('GET');
        expect(init.headers['authorization']).toBe('Bearer tok_123');
        expect(result).toEqual(profile);
    });

    it('patchMe() PATCHes the update as a JSON body to /api/v1/users/me — NOT /api/v1/profiles/me', async () => {
        const updated = makeUserProfile({ user: makeUserProfileUser({ displayName: 'Ada Lovelace' }) });
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

    /**
     * Plan U2. `eraseMe` is the call that makes an erasure reach anything beyond the recipe service, so what
     * matters here is that it is a genuinely DIFFERENT request from `deleteMe` — different verb, different
     * path. If it ever collapsed onto `DELETE /api/v1/users/me`, the app's irreversible control would
     * silently perform the RECOVERABLE closure instead, and every test above would still pass.
     */
    it('eraseMe() POSTs /api/v1/users/me/erasure — not the closure endpoint — and returns the accepted body', async () => {
        const accepted = { sub: 'usr_1', erasedAt: '2026-08-16T00:00:00.000Z', message: 'Account erasure initiated' };
        const fetchMock = stubFetch({ status: 202, body: accepted });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        const result = await client.eraseMe();

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.method).toBe('POST');
        expect(String(url)).toContain('/api/v1/users/me/erasure');
        expect(result).toEqual(accepted);
    });

    it('resolves undefined for a genuinely empty response body (e.g. a 204)', async () => {
        const fetchMock = stubFetch({ status: 204, text: '' });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        await expect(client.deleteMe()).resolves.toBeUndefined();
    });

    it('sends no body/content-type header on a GET', async () => {
        const fetchMock = stubFetch({ status: 200, body: makeUserProfile() });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        await client.getMe();

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(init.body).toBeUndefined();
        expect(init.headers['content-type']).toBeUndefined();
    });

    it('omits the Authorization header when constructed with no token', async () => {
        const fetchMock = stubFetch({ status: 200, body: makeUserProfile() });
        const client = new ProfileServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await client.getMe();

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(init.headers['authorization']).toBeUndefined();
    });

    it('resolves a callback TokenSource per request, forwarding forceRefresh', async () => {
        const fetchMock = stubFetch({ status: 200, body: makeUserProfile() });
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
        const fetchMock = stubFetch({ status: 200, body: makeUserProfile() });
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
        const fetchMock = stubFetch({ status: 200, body: makeUserProfile() });
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

/**
 * BOTH DIRECTIONS of the published identity contract (ADR-0014), which this client previously checked in
 * neither. The suite is deliberately about the DISTINCTION between the three "400-ish" failures, not merely
 * that something throws: `InvalidRequestError` means the body never left, `BadRequestError` means the service
 * rejected a legal body, and a `ZodError` out of a read means the SERVICE's body drifted. A test that accepted
 * any of them interchangeably would not notice them being merged.
 */
describe('ProfileServiceClient — contract validation', () => {
    /** A fetch double that FAILS the test if called — the proof that no request was issued. */
    const neverFetch: typeof fetch = () => {
        throw new Error('the client must not issue a request for a body that fails the published contract');
    };

    it('rejects an unknown key on patchMe before issuing a request, because the schema is strict', async () => {
        const client = new ProfileServiceClient({ baseUrl: BASE, fetch: neverFetch });
        // `patchUserMeRequestSchema` is a `z.strictObject`, so the identity service answers 400 to an unknown
        // key rather than stripping it. A misspelled field is therefore a caller bug, and it is caught here.
        const error = await client
            .patchMe({ displayNam: 'Ada' } as unknown as Parameters<typeof client.patchMe>[0])
            .catch((caught: unknown) => caught);

        expect(isInvalidRequestError(error)).toBe(true);
        expect(error).not.toBeInstanceOf(BadRequestError);
    });

    it('rejects a non-URL avatarUrl before issuing a request', async () => {
        const client = new ProfileServiceClient({ baseUrl: BASE, fetch: neverFetch });
        // `z.url()` requires a scheme — a deliberate tightening over the `@IsUrl()` this replaced, which
        // accepted a bare `example.com/x.png` for a value that is rendered as an image source.
        const error = await client.patchMe({ avatarUrl: 'example.com/a.png' }).catch((caught: unknown) => caught);

        expect(isInvalidRequestError(error)).toBe(true);
    });

    // The mirror image, and what stops the three cases above from passing against an unconditional throw.
    it('sends a body that satisfies the published request schema', async () => {
        const fetchMock = stubFetch({ status: 200, body: makeUserProfile() });
        const client = new ProfileServiceClient({ baseUrl: BASE, fetch: fetchMock });

        await expect(client.patchMe({ displayName: 'Ada', avatarUrl: null })).resolves.toStrictEqual(makeUserProfile());
    });

    it('REJECTS a response that does not match the published contract, instead of casting it', async () => {
        // The defect this whole change closes: `{ user: {}, account: {} }` used to be returned as a `UserProfile`
        // and only surfaced as a missing field deep inside a component. It must now fail at the edge.
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            fetch: stubFetch({ status: 200, body: { user: {}, account: {} } }),
        });

        await expect(client.getMe()).rejects.toThrow(/expected string/iu);
    });
});

/**
 * `POST /api/v1/users/me/avatar/presign` — the identity call MOBILE makes, and the ONE that used to bypass this
 * client entirely (GR-017 §17-b.5's recorded residual). It lives here so the avatar path runs the published zod in
 * both directions and reaches the same drift-layer-3 probe as every other identity call, rather than depending on
 * a second hand-rolled transport (`mobile/src/services/api.ts`'s `apiRequest`, retired with this change) that no
 * guard could see.
 */
describe('ProfileServiceClient — avatar presign', () => {
    /** A valid presign response body. */
    const presigned = { uploadUrl: 'https://s3.example.test/put', publicUrl: 'https://media.example.test/a.png' };

    it('presigns UNDER the profile path — the avatar is a field of the viewer’s own profile', () => {
        expect(AVATAR_PRESIGN_PATH).toBe(`${PROFILE_ME_PATH}/avatar/presign`);
    });

    it('POSTs to the presign path with type + size on the query string, and returns the parsed body', async () => {
        const fetchMock = stubFetch({ status: 200, body: presigned });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok_123', fetch: fetchMock });

        const result = await client.presignAvatar({ type: 'image/png', size: 2048 });

        const apiCall = fetchMock.mock.calls.find(([called]) => !String(called).endsWith('/health'));

        expect(apiCall).toBeDefined();
        const [url, init] = apiCall as [string, RequestInit & { headers: Record<string, string> }];
        // The MIME slash must be percent-encoded, or the query names a type the server never matches.
        expect(url).toBe(`${BASE}${AVATAR_PRESIGN_PATH}?type=image%2Fpng&size=2048`);
        expect(init.method).toBe('POST');
        expect(init.headers['authorization']).toBe('Bearer tok_123');
        // The presign carries its arguments in the query string; a body would be a different contract.
        expect(init.body).toBeUndefined();
        expect(init.headers['content-type']).toBeUndefined();
        expect(result).toStrictEqual(presigned);
    });

    /*
     * `size` is what makes this parse worth running at the CALLER. The identity controller signs it into the
     * presigned URL as `ContentLength`, and its predecessor hand-parsed it with `Number.parseInt`, so `?size=abc`
     * reached S3 as `ContentLength: NaN`. Rejecting it here fails at the call site that computed the number
     * instead of spending a round trip — and every case below must issue NO request at all.
     */
    it.each([
        ['zero', { type: 'image/png', size: 0 }],
        ['negative', { type: 'image/png', size: -1 }],
        ['fractional', { type: 'image/png', size: 2.5 }],
        ['NaN', { type: 'image/png', size: Number.NaN }],
        ['an empty MIME type', { type: '', size: 2048 }],
    ] as const)('refuses %s without issuing a request', async (_label, query) => {
        const fetchMock = stubFetch({ status: 200, body: presigned });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const error = await client.presignAvatar(query).catch((caught: unknown) => caught);

        expect(isInvalidRequestError(error)).toBe(true);
        // Not a `BadRequestError`: nothing was sent, so the service said nothing.
        expect(error).not.toBeInstanceOf(BadRequestError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    /*
     * The server keeps the ALLOWED-TYPE list and the size CAP (`avatar.schema.ts` deliberately restates neither, so
     * there is one authority on the security rule). A type the schema admits and the controller refuses must
     * therefore still surface as the service's own `400`, distinguishable from the caller-bug case above.
     */
    it('surfaces the controller’s policy rejection as BadRequestError, not InvalidRequestError', async () => {
        const fetchMock = stubFetch({ status: 400, body: { code: 'BAD_REQUEST', message: 'Invalid type.' } });
        const client = new ProfileServiceClient({ baseUrl: BASE, token: 'tok', fetch: fetchMock });

        const error = await client.presignAvatar({ type: 'image/gif', size: 2048 }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestError);
        expect(isInvalidRequestError(error)).toBe(false);
        expect((error as BadRequestError).message).toBe('Invalid type.');
    });

    /*
     * A cast here is how an upload silently "succeeds" into nothing: `publicUrl` would be `undefined`, the caller
     * would persist it as the avatar, and the failure would surface as a broken image rather than as a drift.
     */
    it('REJECTS a presign response missing publicUrl instead of casting it', async () => {
        const client = new ProfileServiceClient({
            baseUrl: BASE,
            fetch: stubFetch({ status: 200, body: { uploadUrl: 'https://s3.example.test/put' } }),
        });

        await expect(client.presignAvatar({ type: 'image/png', size: 2048 })).rejects.toThrow(/publicUrl/iu);
    });
});
