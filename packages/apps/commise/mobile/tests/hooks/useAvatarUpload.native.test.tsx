/**
 * Tests for `useAvatarUpload` (U2) — the native avatar upload orchestration behind the profile screen's
 * image-picker flow. It presigns against the identity service (`POST /api/v1/users/me/avatar/presign`) with the
 * exact bytes' type + size, PUTs the blob to the returned presigned S3 URL, and hands back the durable public URL
 * for the profile PATCH to persist.
 *
 * ⚠️ IT NOW PRESIGNS THROUGH `ProfileServiceClient`, AND THESE CASES ARE ABOUT WHAT THAT BUYS. The hook used to
 * call the app's own `services/api.ts` `apiRequest` — a second hand-rolled transport to identity, outside the one
 * funnel that compares this binary's pinned `CONTRACT_HASH` against the fingerprint the deployed service publishes
 * (GR-017 §17-b.5). A released binary could therefore upload an avatar against a service that had moved ahead of
 * it and produce no signal at all. `reports contract skew…` below is that guarantee, asserted at the mobile call
 * site rather than only in the shared client.
 *
 * `@clerk/expo` (the native token source) and the global `fetch` are mocked, so these cover the hook's own request
 * contract in isolation; the on-device picker + real S3 PUT are exercised by the Maestro flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { CONTRACT_HASH } from '@kitchensink/schema-identity';
import { resetContractSkewLatchForTests } from '@commise/features-account';
import { useAuth } from '@clerk/expo';

import { useAvatarUpload } from '../../src/hooks/useAvatarUpload.js';

vi.mock('@clerk/expo', () => ({ useAuth: vi.fn() }));

const useAuthMock = vi.mocked(useAuth);
const getToken = vi.fn(async () => 'native-token');
const fetchMock = vi.fn();

/** The identity origin `vitest.config.ts` / `vitest.native.config.ts` configure for the suite. */
const IDENTITY = 'http://localhost:4000';

/** A well-formed fingerprint that is deliberately NOT the one this app bundles. */
const SERVED_HASH = 'b'.repeat(64);

const PRESIGNED = {
    uploadUrl: 'https://s3.example.com/avatars/usr_1/put',
    publicUrl: 'https://media.example.com/avatars/usr_1/1.jpg',
};

/** Calls the hook made, minus the fire-and-forget `/health` skew probe (which is not part of any endpoint's shape). */
function apiCalls(): [string, RequestInit][] {
    return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/health')) as [string, RequestInit][];
}

/** The skew probe's calls, if it fired. */
function probeCalls(): [string, RequestInit][] {
    return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/health')) as [string, RequestInit][];
}

/**
 * Answer `/health` with `contractHash`, the presign with `presign`, and anything else (the S3 PUT) with `put`.
 *
 * Routing by URL rather than by call ORDER, because the probe is fire-and-forget: its position in the sequence is
 * not something the hook controls, so an index-based double would pin scheduling instead of behaviour.
 */
function routeFetch(options: {
    contractHash?: string;
    presign?: { status: number; body: unknown };
    put?: { status: number };
}): void {
    fetchMock.mockImplementation(async (url: string | URL) => {
        const target = String(url);

        if (target.endsWith('/health')) {
            return new Response(
                JSON.stringify({
                    status: 'ok',
                    service: 'identity',
                    ...(options.contractHash !== undefined ? { contractHash: options.contractHash } : {}),
                }),
                { status: 200 },
            );
        }

        if (target.includes('/avatar/presign')) {
            const presign = options.presign ?? { status: 200, body: PRESIGNED };

            return new Response(JSON.stringify(presign.body), { status: presign.status });
        }

        return new Response(null, { status: options.put?.status ?? 200 });
    });
}

beforeEach(() => {
    getToken.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAuthMock.mockReturnValue({ getToken } as any);
    // The skew latch is module scope in `@commise/features-account`; without this the first case consumes it and
    // every later one silently observes "no probe" and passes for the wrong reason.
    resetContractSkewLatchForTests();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('useAvatarUpload', () => {
    it('presigns with the blob type + size, PUTs the bytes, and returns the public URL', async () => {
        routeFetch({ contractHash: CONTRACT_HASH });

        const { result } = renderHook(() => useAvatarUpload());
        const blob = new Blob([new Uint8Array(2048)], { type: 'image/png' });
        const publicUrl = await result.current.upload({ blob, contentType: 'image/png' });

        expect(publicUrl).toBe(PRESIGNED.publicUrl);

        // The native token template is used for the identity call (native tokens are azp-less and only admitted
        // when minted from it); the presign accepts a cached token — only the profile READ force-refreshes.
        expect(getToken).toHaveBeenCalledWith({ template: 'commise-native', skipCache: false });

        // 1) Presign: POST to the IDENTITY origin — not the recipe origin, which does not serve this route —
        //    carrying the blob's real type + size, percent-encoded.
        const [[presignUrl, presignInit], [putUrl, putInit]] = apiCalls();
        expect(presignUrl).toBe(`${IDENTITY}/api/v1/users/me/avatar/presign?type=image%2Fpng&size=2048`);
        expect(presignInit.method).toBe('POST');
        expect((presignInit.headers as Record<string, string>)['authorization']).toBe('Bearer native-token');

        // 2) PUT the exact blob to the presigned URL (unauthenticated — the URL is the credential; adding
        //    Authorization breaks the S3 signature — with a Content-Type matching what was signed).
        expect(putUrl).toBe(PRESIGNED.uploadUrl);
        expect(putInit.method).toBe('PUT');
        expect((putInit.headers as Record<string, string>)['Content-Type']).toBe('image/png');
        expect((putInit.headers as Record<string, string>)['Authorization']).toBeUndefined();
        expect(putInit.body).toBe(blob);

        expect(apiCalls()).toHaveLength(2);
    });

    /*
     * ⚠️ THE POINT OF ROUTING THIS PATH THROUGH `ProfileServiceClient` (GR-017 §17-b.5). A released binary must be
     * able to notice that identity moved ahead of the contract it was built against — the one case neither the
     * turbo layer nor CI can see, since the binary cannot be rebuilt in step with a backend deploy. Per the owner's
     * 2026-08-11 ruling the mismatch WARNS and never refuses, so the upload below must still succeed.
     */
    it('reports contract skew from the avatar path, and still completes the upload', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        routeFetch({ contractHash: SERVED_HASH });

        const { result } = renderHook(() => useAvatarUpload());
        const blob = new Blob([new Uint8Array(2048)], { type: 'image/png' });

        await expect(result.current.upload({ blob, contentType: 'image/png' })).resolves.toBe(PRESIGNED.publicUrl);

        await vi.waitFor(() => {
            expect(warn).toHaveBeenCalledTimes(1);
        });
        expect(probeCalls()).toHaveLength(1);
        expect(probeCalls()[0]?.[0]).toBe(`${IDENTITY}/health`);
        expect(warn.mock.calls[0]?.[0]).toContain('@kitchensink/schema-identity');
        expect(warn.mock.calls[0]?.[0]).toContain(SERVED_HASH.slice(0, 12));

        warn.mockRestore();
    });

    it('stays silent when identity serves the fingerprint this binary was built against', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        routeFetch({ contractHash: CONTRACT_HASH });

        const { result } = renderHook(() => useAvatarUpload());
        await result.current.upload({ blob: new Blob(['x'], { type: 'image/png' }), contentType: 'image/png' });

        await vi.waitFor(() => {
            expect(probeCalls()).toHaveLength(1);
        });

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('rejects (and never PUTs) when the presign request fails', async () => {
        // The identity error envelope (`{ code, message }`) — the controller's own `400` for an unlisted MIME type.
        // Its `message` must reach the caller, since that is the only text naming what the service will accept.
        routeFetch({
            contractHash: CONTRACT_HASH,
            presign: { status: 400, body: { code: 'BAD_REQUEST', message: 'Invalid type. Allowed: image/jpeg' } },
        });

        const { result } = renderHook(() => useAvatarUpload());
        const blob = new Blob(['x'], { type: 'image/png' });

        await expect(result.current.upload({ blob, contentType: 'image/png' })).rejects.toThrow(
            /Allowed: image\/jpeg/u,
        );
        expect(apiCalls()).toHaveLength(1);
    });

    it('rejects when the S3 PUT fails', async () => {
        routeFetch({ contractHash: CONTRACT_HASH, put: { status: 403 } });

        const { result } = renderHook(() => useAvatarUpload());
        const blob = new Blob(['x'], { type: 'image/jpeg' });

        await expect(result.current.upload({ blob, contentType: 'image/jpeg' })).rejects.toThrow(/403/u);
        expect(apiCalls()).toHaveLength(2);
    });

    /*
     * A presign body missing `publicUrl` used to be CAST, so `upload` resolved `undefined` and the caller persisted
     * it as the viewer's avatar — a drift surfacing as a broken image instead of a failure. It must reject, and it
     * must not PUT bytes it cannot report a URL for.
     */
    it('rejects a presign response that does not match the published contract', async () => {
        routeFetch({
            contractHash: CONTRACT_HASH,
            presign: { status: 200, body: { uploadUrl: PRESIGNED.uploadUrl } },
        });

        const { result } = renderHook(() => useAvatarUpload());
        const blob = new Blob(['x'], { type: 'image/png' });

        await expect(result.current.upload({ blob, contentType: 'image/png' })).rejects.toThrow(/publicUrl/iu);
        expect(apiCalls()).toHaveLength(1);
    });

    /*
     * The identity controller signs `size` into the presigned URL as `ContentLength`, so a size the contract cannot
     * admit must fail at the call site rather than reaching AWS. Zero-byte is the reachable case: an image picker
     * can hand back an empty file.
     */
    it('rejects a zero-byte blob before any request is issued', async () => {
        routeFetch({ contractHash: CONTRACT_HASH });

        const { result } = renderHook(() => useAvatarUpload());
        const blob = new Blob([], { type: 'image/png' });

        await expect(result.current.upload({ blob, contentType: 'image/png' })).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
