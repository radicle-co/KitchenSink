/**
 * Tests for `useAvatarUpload` (U2) — the native avatar upload orchestration behind the profile screen's
 * image-picker flow. It mirrors the recipe-photo upload model: presign against the identity service
 * (`POST /v1/users/me/avatar/presign`) with the exact bytes' type + size, then PUT the blob to the
 * returned presigned S3 URL, and hand back the durable public URL for the profile PATCH to persist.
 *
 * `@clerk/expo` (the native token source) and the global `fetch` are mocked, so these cover the hook's own
 * request contract in isolation; the on-device picker + real S3 PUT are exercised by the Maestro flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useAuth } from '@clerk/expo';

import { useAvatarUpload } from '../../src/hooks/useAvatarUpload.js';

vi.mock('@clerk/expo', () => ({ useAuth: vi.fn() }));

const useAuthMock = vi.mocked(useAuth);
const getToken = vi.fn(async () => 'native-token');
const fetchMock = vi.fn();

beforeEach(() => {
    getToken.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useAuthMock.mockReturnValue({ getToken } as any);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('useAvatarUpload', () => {
    it('presigns with the blob type + size, PUTs the bytes, and returns the public URL', async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    uploadUrl: 'https://s3.example.com/avatars/usr_1/put',
                    publicUrl: 'https://media.example.com/avatars/usr_1/1.jpg',
                }),
            })
            .mockResolvedValueOnce({ ok: true, status: 200 });

        const { result } = renderHook(() => useAvatarUpload());
        const blob = new Blob([new Uint8Array(2048)], { type: 'image/png' });
        const publicUrl = await result.current.upload({ blob, contentType: 'image/png' });

        expect(publicUrl).toBe('https://media.example.com/avatars/usr_1/1.jpg');

        // The native token template is used for the identity call.
        expect(getToken).toHaveBeenCalledWith({ template: 'commise-native' });

        // 1) Presign: POST to the identity avatar endpoint, carrying the blob's real type + size.
        const [presignUrl, presignInit] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(presignUrl).toContain('/v1/users/me/avatar/presign');
        expect(presignUrl).toContain('type=image%2Fpng');
        expect(presignUrl).toContain('size=2048');
        expect(presignInit.method).toBe('POST');
        expect((presignInit.headers as Record<string, string>)['Authorization']).toBe('Bearer native-token');

        // 2) PUT the exact blob to the presigned URL (unauthenticated; content-type must match the signature).
        const [putUrl, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(putUrl).toBe('https://s3.example.com/avatars/usr_1/put');
        expect(putInit.method).toBe('PUT');
        expect((putInit.headers as Record<string, string>)['Content-Type']).toBe('image/png');
        expect(putInit.body).toBe(blob);

        const presignOrder = fetchMock.mock.invocationCallOrder[0];
        const putOrder = fetchMock.mock.invocationCallOrder[1];
        expect(presignOrder).toBeLessThan(putOrder);
    });

    it('rejects (and never PUTs) when the presign request fails', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'bad type' }) });

        const { result } = renderHook(() => useAvatarUpload());
        const blob = new Blob(['x'], { type: 'image/png' });

        await expect(result.current.upload({ blob, contentType: 'image/png' })).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects when the S3 PUT fails', async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ uploadUrl: 'https://s3.example.com/put', publicUrl: 'https://cdn/x.jpg' }),
            })
            .mockResolvedValueOnce({ ok: false, status: 403 });

        const { result } = renderHook(() => useAvatarUpload());
        const blob = new Blob(['x'], { type: 'image/jpeg' });

        await expect(result.current.upload({ blob, contentType: 'image/jpeg' })).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
