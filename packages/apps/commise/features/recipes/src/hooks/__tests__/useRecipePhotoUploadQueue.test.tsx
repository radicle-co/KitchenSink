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
 * (confirmed + active queue items) caps/rejects an `enqueue` call that would exceed it; (6) client-side
 * pre-validation (REQ-011/REQ-012) admits an oversized/disallowed-type file straight into `failed` — with
 * the caller's localized copy — WITHOUT ever calling `uploader.upload` (so presign never fires), and
 * `retry` on such a file re-validates rather than blindly re-driving it.
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

import { MAX_RECIPE_PHOTO_UPLOAD_BYTES } from '@kitchensink/recipe-core';

import { MAX_RECIPE_PHOTOS } from '../../photos/model.js';
import { useRecipePhotoUpload } from '../useRecipePhotoUpload.js';
import { useRecipePhotoUploadQueue } from '../useRecipePhotoUploadQueue.js';
import type { RecipePhotoQueueFile, RecipePhotoValidationMessages } from '../useRecipePhotoUploadQueue.js';

const UPLOAD_ERROR = 'We couldn’t upload that photo. Please try again.';
const RECIPE_ID = 'rec_1';
const VALIDATION_MESSAGES: RecipePhotoValidationMessages = {
    tooLarge: 'That photo is larger than 5 MB.',
    badType: 'That file type isn’t supported.',
};

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
    const queue = useRecipePhotoUploadQueue(uploader, confirmedCount, VALIDATION_MESSAGES);

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
        // Single file enqueued into a fresh queue — the reducer's monotonic counter starts at 1.
        expect(fileId).toBe(1);

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

describe('useRecipePhotoUploadQueue — client-side pre-validation (REQ-011/REQ-012)', () => {
    it('admits an oversized file straight into failed, with the localized size error, and never calls upload', () => {
        const presign = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

        const { result } = renderHook(() => useHarness(0));
        const oversized = makeQueueFile({ fileName: 'huge.png', fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1 });

        act(() => {
            result.current.queue.enqueue([oversized]);
        });

        expect(result.current.queue.items[0]?.status).toBe('failed');
        expect(result.current.queue.items[0]?.errorMessage).toBe(VALIDATION_MESSAGES.tooLarge);
        // The file never reached the transport layer — no presign call, not even attempted.
        expect(presign).not.toHaveBeenCalled();
    });

    it('admits a disallowed MIME type straight into failed, with the localized type error, and never calls upload', () => {
        const presign = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

        const { result } = renderHook(() => useHarness(0));
        const wrongType = makeQueueFile({ fileName: 'clip.gif', contentType: 'image/gif' });

        act(() => {
            result.current.queue.enqueue([wrongType]);
        });

        expect(result.current.queue.items[0]?.status).toBe('failed');
        expect(result.current.queue.items[0]?.errorMessage).toBe(VALIDATION_MESSAGES.badType);
        expect(presign).not.toHaveBeenCalled();
    });

    it.each([['image/jpeg'], ['image/png'], ['image/webp']] as const)(
        'admits each allowlisted type (%s) as queued/uploading, driving upload',
        (contentType) => {
            const presign = vi.fn(() => new Promise(() => undefined));
            useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
            useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

            const { result } = renderHook(() => useHarness(0));

            act(() => {
                result.current.queue.enqueue([makeQueueFile({ fileName: `pic-${contentType}`, contentType })]);
            });

            // Passed validation — the single item became active and drove the underlying upload's presign call.
            expect(result.current.queue.items[0]?.status).toBe('uploading');
            expect(presign).toHaveBeenCalledTimes(1);
        },
    );

    it('does not block a second, VALID queued file behind an earlier validation-rejected one', () => {
        const presign = vi.fn(() => new Promise(() => undefined));
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

        const { result } = renderHook(() => useHarness(0));
        const rejected = makeQueueFile({ fileName: 'huge.png', fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1 });
        const valid = makeQueueFile({ fileName: 'ok.png' });

        act(() => {
            result.current.queue.enqueue([rejected, valid]);
        });

        expect(result.current.queue.items.find((item) => item.fileName === 'huge.png')?.status).toBe('failed');
        // The rejected file never occupies "active", so the valid file starts immediately in the same tick.
        expect(result.current.queue.items.find((item) => item.fileName === 'ok.png')?.status).toBe('uploading');
        expect(presign).toHaveBeenCalledTimes(1);
    });

    it('retrying a validation-rejected file re-validates and stays failed, without calling upload', () => {
        const presign = vi.fn();
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

        const { result } = renderHook(() => useHarness(0));
        const oversized = makeQueueFile({ fileName: 'huge.png', fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1 });

        act(() => {
            result.current.queue.enqueue([oversized]);
        });
        const fileId = result.current.queue.items[0]?.fileId as number;
        expect(result.current.queue.items[0]?.status).toBe('failed');

        act(() => {
            result.current.queue.retry(fileId);
        });

        // The file itself hasn't changed size — retry re-validates and rejects it again, still without ever
        // reaching the transport layer.
        expect(result.current.queue.items[0]?.status).toBe('failed');
        expect(result.current.queue.items[0]?.errorMessage).toBe(VALIDATION_MESSAGES.tooLarge);
        expect(presign).not.toHaveBeenCalled();
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

describe('useRecipePhotoUploadQueue — the per-file `onUploaded` continuation (U6 cancel-safe Replace)', () => {
    it('invokes onUploaded exactly once, and only AFTER the file’s confirm has resolved', async () => {
        const presign = makeControllablePresign();
        const confirm = vi.fn().mockResolvedValue(undefined);
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign.mutateAsync });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: confirm });

        const onUploaded = vi.fn();
        const { result } = renderHook(() => useHarness(0));

        act(() => {
            result.current.queue.enqueue([makeQueueFile({ fileName: 'replacement.png', onUploaded })]);
        });

        // Enqueued and mid-flight — the swap must NOT be committed yet (this is the whole point: nothing
        // destructive happens until the replacement is durably confirmed).
        expect(result.current.queue.items[0]?.status).toBe('uploading');
        expect(onUploaded).not.toHaveBeenCalled();

        act(() => {
            presign.resolveNext({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        });
        await waitFor(() => expect(result.current.queue.items[0]?.status).toBe('ok'));

        expect(confirm).toHaveBeenCalledTimes(1);
        expect(onUploaded).toHaveBeenCalledTimes(1);
        // Ordering: the confirm landed BEFORE the continuation fired.
        expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(onUploaded.mock.invocationCallOrder[0] as number);
    });

    it('never invokes onUploaded when the upload fails — and fires it on a later successful retry', async () => {
        const presign = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined) });
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValue({ ok: true, status: 200 });

        const onUploaded = vi.fn();
        const { result } = renderHook(() => useHarness(0));

        act(() => {
            result.current.queue.enqueue([makeQueueFile({ fileName: 'flaky.png', onUploaded })]);
        });

        await waitFor(() => expect(result.current.queue.items[0]?.status).toBe('failed'));
        expect(onUploaded).not.toHaveBeenCalled();

        const fileId = result.current.queue.items[0]?.fileId as number;
        act(() => {
            result.current.queue.retry(fileId);
        });

        await waitFor(() => expect(result.current.queue.items[0]?.status).toBe('ok'));
        expect(onUploaded).toHaveBeenCalledTimes(1);
    });

    it('never invokes onUploaded for a file rejected by client-side validation', () => {
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: vi.fn() });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn() });

        const onUploaded = vi.fn();
        const { result } = renderHook(() => useHarness(0));

        act(() => {
            result.current.queue.enqueue([
                makeQueueFile({ fileName: 'huge.png', fileSize: MAX_RECIPE_PHOTO_UPLOAD_BYTES + 1, onUploaded }),
            ]);
        });

        expect(result.current.queue.items[0]?.status).toBe('failed');
        expect(onUploaded).not.toHaveBeenCalled();
    });

    it('never invokes onUploaded for a file removed from the queue while its upload was in flight', async () => {
        const presign = makeControllablePresign();
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign.mutateAsync });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined) });

        const onUploaded = vi.fn();
        const { result } = renderHook(() => useHarness(0));

        act(() => {
            result.current.queue.enqueue([makeQueueFile({ fileName: 'abandoned.png', onUploaded })]);
        });
        const fileId = result.current.queue.items[0]?.fileId as number;

        act(() => {
            result.current.queue.remove(fileId);
        });
        act(() => {
            presign.resolveNext({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        });

        // The user withdrew the file — its continuation (which would delete a confirmed photo) must never run.
        await waitFor(() => expect(result.current.queue.items).toHaveLength(0));
        expect(onUploaded).not.toHaveBeenCalled();
    });

    it('leaves a file without a continuation entirely unaffected', async () => {
        const presign = vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/put', key: 'k1' });
        useCreatePhotoUploadUrlMock.mockReturnValue({ mutateAsync: presign });
        useConfirmPhotoUploadMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(undefined) });

        const { result } = renderHook(() => useHarness(0));

        act(() => {
            result.current.queue.enqueue([makeQueueFile({ fileName: 'plain.png' })]);
        });

        await waitFor(() => expect(result.current.queue.items[0]?.status).toBe('ok'));
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
