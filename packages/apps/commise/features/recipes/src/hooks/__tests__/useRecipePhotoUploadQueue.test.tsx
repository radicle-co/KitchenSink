/**
 * Tests for {@link useRecipePhotoUploadQueue} — the per-file upload QUEUE layer driven above the existing
 * single-flight {@link useRecipePhotoUpload} hook (w3/e4). Composes the REAL `useRecipePhotoUpload` (with
 * only its `useCreatePhotoUploadUrl`/`useConfirmPhotoUpload`/`fetch` dependencies mocked, exactly like
 * `useRecipePhotoUpload.test.tsx`) so these tests prove the queue drives the ACTUAL single-flight hook
 * correctly, not a hand-rolled stand-in that could silently diverge from its real state-transition timing.
 *
 * Pins the contract the step-4 grid depends on: (1) `enqueue` drives `upload` once per file, SEQUENTIALLY —
 * the second file's presign call never fires until the first file's full presign→PUT→confirm sequence has
 * settled; (2) each file's status transitions `queued` → `uploading` → `ok`/`failed` as its underlying
 * upload resolves/rejects; (3) `retry(fileId)` re-runs ONLY the failed file, flipping it `uploading` → `ok`,
 * and is a no-op for any other status; (4) `remove(fileId)` drops exactly that item; (5) the 10-photo cap
 * (confirmed + active queue items) caps/rejects an `enqueue` call that would exceed it.
 *
 * The mutation lens: a broken "start next" or "settle" effect (interleaved uploads, retrying the wrong file,
 * losing track of which file is active, double-counting the cap) fails these assertions, not just a
 * happy-path smoke test.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useCreatePhotoUploadUrlMock, useConfirmPhotoUploadMock } = vi.hoisted(() => ({
    useCreatePhotoUploadUrlMock: vi.fn(),
    useConfirmPhotoUploadMock: vi.fn(),
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useCreatePhotoUploadUrl: useCreatePhotoUploadUrlMock,
    useConfirmPhotoUpload: useConfirmPhotoUploadMock,
}));

import { MAX_RECIPE_PHOTOS } from '../../photos/model.js';
import { useRecipePhotoUpload } from '../useRecipePhotoUpload.js';
import { useRecipePhotoUploadQueue } from '../useRecipePhotoUploadQueue.js';
import type { RecipePhotoQueueFile } from '../useRecipePhotoUploadQueue.js';

const UPLOAD_ERROR = 'We couldn’t upload that photo. Please try again.';
const RECIPE_ID = 'rec_1';

/** A minimal, complete queue file input. */
function makeQueueFile(overrides: Partial<RecipePhotoQueueFile> = {}): RecipePhotoQueueFile {
    return {
        blob: new Blob(['bytes'], { type: 'image/png' }),
        fileName: 'dinner.png',
        contentType: 'image/png',
        fileSize: 5,
        ...overrides,
    };
}

/** A presign `mutateAsync` double that returns a fresh, independently-resolvable promise per call. */
function makeControllablePresign(): {
    mutateAsync: ReturnType<typeof vi.fn>;
    resolveNext: (value: { uploadUrl: string; key: string }) => void;
} {
    const pending: Array<(value: { uploadUrl: string; key: string }) => void> = [];
    const mutateAsync = vi.fn(
        () =>
            new Promise<{ uploadUrl: string; key: string }>((resolve) => {
                pending.push(resolve);
            }),
    );

    return {
        mutateAsync,
        resolveNext: (value) => {
            const resolve = pending.shift();

            if (resolve === undefined) {
                throw new Error('No pending presign call to resolve');
            }

            resolve(value);
        },
    };
}

/** Composes the real `useRecipePhotoUpload` with the queue under test — the exact production wiring. */
function useHarness(confirmedCount: number) {
    const uploader = useRecipePhotoUpload(RECIPE_ID, UPLOAD_ERROR);
    const queue = useRecipePhotoUploadQueue(uploader, confirmedCount);

    return { uploader, queue };
}

const fetchMock = vi.fn();

beforeEach(() => {
    useCreatePhotoUploadUrlMock.mockReset();
    useConfirmPhotoUploadMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('useRecipePhotoUploadQueue — sequential drive + per-file status', () => {
    it('drives upload once per file, sequentially, marking each ok as it resolves', async () => {
        const presign = makeControllablePresign();
        const confirm = vi.fn().mockResolvedValue(undefined);
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign.mutateAsync });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: confirm });

        const { result } = renderHook(() => useHarness(0));
        const fileA = makeQueueFile({ fileName: 'a.png' });
        const fileB = makeQueueFile({ fileName: 'b.png' });

        act(() => {
            result.current.queue.enqueue([fileA, fileB]);
        });

        // File A's upload started synchronously off the enqueue-triggered "start next" effect; file B must
        // NOT have started — its presign call has not fired, and it is still `queued`.
        expect(presign.mutateAsync).toHaveBeenCalledTimes(1);
        expect(result.current.queue.items.find((item) => item.fileName === 'a.png')?.status).toBe('uploading');
        expect(result.current.queue.items.find((item) => item.fileName === 'b.png')?.status).toBe('queued');

        act(() => {
            presign.resolveNext({ uploadUrl: 'https://s3.example.com/put', key: 'kA' });
        });
        await waitFor(() => {
            expect(result.current.queue.items.find((item) => item.fileName === 'a.png')?.status).toBe('ok');
        });

        // ONLY once file A settled did file B's presign fire — never interleaved with A's.
        expect(presign.mutateAsync).toHaveBeenCalledTimes(2);
        expect(result.current.queue.items.find((item) => item.fileName === 'b.png')?.status).toBe('uploading');

        act(() => {
            presign.resolveNext({ uploadUrl: 'https://s3.example.com/put', key: 'kB' });
        });
        await waitFor(() => {
            expect(result.current.queue.items.find((item) => item.fileName === 'b.png')?.status).toBe('ok');
        });
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('marks a file failed with the localized error once its upload settles unsuccessfully', async () => {
        const presign = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });
        fetchMock.mockResolvedValue({ ok: false, status: 500 });

        const { result } = renderHook(() => useHarness(0));

        act(() => {
            result.current.queue.enqueue([makeQueueFile({ fileName: 'fails.png' })]);
        });

        await waitFor(() => {
            expect(result.current.queue.items[0]?.status).toBe('failed');
        });
        expect(result.current.queue.items[0]?.errorMessage).toBe(UPLOAD_ERROR);
    });
});

describe('useRecipePhotoUploadQueue — retry', () => {
    it('re-runs only the failed file, flipping it uploading -> ok', async () => {
        const presign = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        const confirm = vi.fn().mockResolvedValue(undefined);
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: confirm });
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValue({ ok: true, status: 200 });

        const failing = makeQueueFile({ fileName: 'fails.png' });
        const { result } = renderHook(() => useHarness(0));

        act(() => {
            result.current.queue.enqueue([failing]);
        });
        await waitFor(() => expect(result.current.queue.items[0]?.status).toBe('failed'));
        const fileId = result.current.queue.items[0]?.fileId;
        expect(fileId).toBeDefined();

        presign.mockClear();
        act(() => {
            result.current.queue.retry(fileId as number);
        });

        expect(presign).toHaveBeenCalledTimes(1);
        expect(presign).toHaveBeenCalledWith({
            id: RECIPE_ID,
            request: { fileName: 'fails.png', contentType: 'image/png', fileSize: 5 },
        });
        expect(result.current.queue.items[0]?.status).toBe('uploading');
        expect(result.current.queue.items[0]?.errorMessage).toBeUndefined();

        await waitFor(() => expect(result.current.queue.items[0]?.status).toBe('ok'));
        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when retrying a file that is not failed', async () => {
        const presign = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined) });

        const { result } = renderHook(() => useHarness(0));

        act(() => {
            result.current.queue.enqueue([makeQueueFile({ fileName: 'still-going.png' })]);
        });
        expect(result.current.queue.items[0]?.status).toBe('uploading');
        const fileId = result.current.queue.items[0]?.fileId as number;

        presign.mockClear();
        act(() => {
            result.current.queue.retry(fileId);
        });

        // Not failed — retry is a no-op; no additional presign call, status unchanged.
        expect(presign).not.toHaveBeenCalled();
        expect(result.current.queue.items[0]?.status).toBe('uploading');
    });
});

describe('useRecipePhotoUploadQueue — remove', () => {
    it('drops the item with the given fileId, leaving the rest untouched', () => {
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: vi.fn(() => new Promise(() => undefined)) });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

        const { result } = renderHook(() => useHarness(0));

        act(() => {
            result.current.queue.enqueue([makeQueueFile({ fileName: 'a.png' }), makeQueueFile({ fileName: 'b.png' })]);
        });

        const removedId = result.current.queue.items.find((item) => item.fileName === 'a.png')?.fileId as number;
        act(() => {
            result.current.queue.remove(removedId);
        });

        expect(result.current.queue.items).toHaveLength(1);
        expect(result.current.queue.items[0]?.fileName).toBe('b.png');
    });
});

describe('useRecipePhotoUploadQueue — max-10 cap', () => {
    it('caps an enqueue call so confirmed + queued items never exceed the max', () => {
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: vi.fn(() => new Promise(() => undefined)) });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

        // 8 photos already confirmed — only 2 more slots available.
        const { result } = renderHook(() => useHarness(MAX_RECIPE_PHOTOS - 2));

        act(() => {
            result.current.queue.enqueue([
                makeQueueFile({ fileName: '1.png' }),
                makeQueueFile({ fileName: '2.png' }),
                makeQueueFile({ fileName: '3.png' }),
                makeQueueFile({ fileName: '4.png' }),
                makeQueueFile({ fileName: '5.png' }),
            ]);
        });

        expect(result.current.queue.items).toHaveLength(2);
        expect(result.current.queue.items.map((item) => item.fileName)).toEqual(['1.png', '2.png']);
    });

    it('rejects an enqueue call entirely once already at the cap', () => {
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: vi.fn(() => new Promise(() => undefined)) });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

        const { result } = renderHook(() => useHarness(MAX_RECIPE_PHOTOS));

        act(() => {
            result.current.queue.enqueue([makeQueueFile()]);
        });

        expect(result.current.queue.items).toHaveLength(0);
        expect(useCreatePhotoUploadUrlMock).toHaveBeenCalled();
    });
});
