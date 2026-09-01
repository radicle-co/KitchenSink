/**
 * Tests for {@link useRecipePhotoUpload} — the shared photo-upload orchestration hook (CP-6/P3, B24).
 * Pins the exact behavior the two uploader leaves must now get for free: (1) single-flight — a concurrent
 * second `upload()` call while the first is in flight is a no-op, so the presign mutation fires exactly
 * once (the B24 fix); (2) the happy path runs presign → PUT → confirm in order; (3) a failed PUT surfaces
 * the caller-supplied localized error and clears `uploading`; (4) unmounting mid-flight aborts the PUT's
 * `AbortController` and a late resolution never writes state into the unmounted hook instance.
 *
 * `useCreatePhotoUploadUrl`/`useConfirmPhotoUpload` are mocked (their own behavior — including
 * `useConfirmPhotoUpload`'s cache invalidation — is covered by the recipe-service-client's own tests); the
 * global `fetch` is stubbed per test.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useCreatePhotoUploadUrlMock, useConfirmPhotoUploadMock } = vi.hoisted(() => ({
    useCreatePhotoUploadUrlMock: vi.fn(),
    useConfirmPhotoUploadMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useCreatePhotoUploadUrl: useCreatePhotoUploadUrlMock,
    useConfirmPhotoUpload: useConfirmPhotoUploadMock,
}));

import { useRecipePhotoUpload } from '../useRecipePhotoUpload.js';
import type { RecipePhotoUploadFile } from '../useRecipePhotoUpload.js';

const UPLOAD_ERROR = 'We couldn’t upload that photo. Please try again.';
const RECIPE_ID = 'rec_1';

/** A minimal, complete upload input. */
function makeFile(overrides: Partial<RecipePhotoUploadFile> = {}): RecipePhotoUploadFile {
    return {
        blob: new Blob(['bytes'], { type: 'image/png' }),
        fileName: 'dinner.png',
        contentType: 'image/png',
        fileSize: 5,
        ...overrides,
    };
}

/** Build a controllable `mutateAsync` double, exposing `resolve`/`reject` to settle it later. */
function deferredMutateAsync<T>(): {
    mutateAsync: ReturnType<typeof vi.fn>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    const mutateAsync = vi.fn().mockReturnValue(promise);

    return { mutateAsync, resolve, reject };
}

const fetchMock = vi.fn();

beforeEach(() => {
    useCreatePhotoUploadUrlMock.mockReset();
    useConfirmPhotoUploadMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('useRecipePhotoUpload — single-flight (B24)', () => {
    it('invokes the presign mutation exactly once when a second upload is called while the first is in flight', async () => {
        const presign = deferredMutateAsync<{ uploadUrl: string; key: string }>();
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign.mutateAsync });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

        const { result } = renderHook(() => useRecipePhotoUpload(RECIPE_ID, UPLOAD_ERROR));

        act(() => {
            void result.current.upload(makeFile());
        });
        act(() => {
            // A second concurrent call while the first is still awaiting presign — must be a no-op.
            void result.current.upload(makeFile());
        });

        expect(presign.mutateAsync).toHaveBeenCalledTimes(1);
        expect(result.current.uploading).toBe(true);

        // Settle the first call so the test doesn't leave a dangling unresolved promise.
        presign.resolve({ uploadUrl: 'https://s3.example.com/put', key: 'k' });
        fetchMock.mockResolvedValue({ ok: true, status: 200 });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
    });
});

describe('useRecipePhotoUpload — happy path', () => {
    it('runs presign → PUT → confirm in order with the right args', async () => {
        const presign = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        const confirm = vi.fn().mockResolvedValue(undefined);
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: confirm });
        fetchMock.mockResolvedValue({ ok: true, status: 200 });

        const { result } = renderHook(() => useRecipePhotoUpload(RECIPE_ID, UPLOAD_ERROR));
        const file = makeFile();

        await act(async () => {
            await result.current.upload(file);
        });

        expect(presign).toHaveBeenCalledWith({
            id: RECIPE_ID,
            request: { fileName: 'dinner.png', contentType: 'image/png', fileSize: 5 },
        });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://s3.example.com/put',
            expect.objectContaining({ method: 'PUT', body: file.blob, headers: { 'Content-Type': 'image/png' } }),
        );
        expect(confirm).toHaveBeenCalledWith({ id: RECIPE_ID, request: { key: 'k1', contentType: 'image/png' } });
        expect(presign.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
        expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]);
        expect(result.current.uploading).toBe(false);
        expect(result.current.errorMessage).toBeUndefined();
    });
});

describe('useRecipePhotoUpload — error path', () => {
    it('sets the caller-supplied error message and clears uploading when the PUT fails', async () => {
        const presign = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        const confirm = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: confirm });
        fetchMock.mockResolvedValue({ ok: false, status: 500 });

        const { result } = renderHook(() => useRecipePhotoUpload(RECIPE_ID, UPLOAD_ERROR));

        await act(async () => {
            await result.current.upload(makeFile());
        });

        expect(result.current.errorMessage).toBe(UPLOAD_ERROR);
        expect(result.current.uploading).toBe(false);
        expect(confirm).not.toHaveBeenCalled();
    });

    it('clears a previous error at the start of a new attempt', async () => {
        const presign = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        const confirm = vi.fn().mockResolvedValue(undefined);
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: confirm });
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValueOnce({ ok: true, status: 200 });

        const { result } = renderHook(() => useRecipePhotoUpload(RECIPE_ID, UPLOAD_ERROR));

        await act(async () => {
            await result.current.upload(makeFile());
        });
        expect(result.current.errorMessage).toBe(UPLOAD_ERROR);

        await act(async () => {
            await result.current.upload(makeFile());
        });
        expect(result.current.errorMessage).toBeUndefined();
    });
});

describe('useRecipePhotoUpload — abort-on-unmount', () => {
    it('aborts the in-flight AbortController on unmount and a late resolution writes no state', async () => {
        const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
        const presign = deferredMutateAsync<{ uploadUrl: string; key: string }>();
        const confirm = vi.fn().mockResolvedValue(undefined);
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign.mutateAsync });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: confirm });
        fetchMock.mockResolvedValue({ ok: true, status: 200 });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { result, unmount } = renderHook(() => useRecipePhotoUpload(RECIPE_ID, UPLOAD_ERROR));

        act(() => {
            void result.current.upload(makeFile());
        });
        expect(result.current.uploading).toBe(true);
        const frozenSnapshot = result.current;

        act(() => {
            unmount();
        });

        expect(abortSpy).toHaveBeenCalledTimes(1);

        // Resolve the presign the hook was awaiting when it was unmounted, letting the PUT + confirm run
        // to completion; the hook's post-await setState calls must be skipped, not throw, and not warn.
        await act(async () => {
            presign.resolve({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(errorSpy).not.toHaveBeenCalled();
        // `result.current` is frozen at the last pre-unmount render; the guarded post-unmount continuation
        // never produced a further render to observe, which is itself the point of the mounted-flag guard.
        expect(result.current).toBe(frozenSnapshot);

        errorSpy.mockRestore();
    });
});
