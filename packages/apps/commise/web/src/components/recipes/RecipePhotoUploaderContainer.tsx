'use client';

/**
 * The upload orchestration the shared `RecipePhotoManager` block deliberately omits (it is presentational
 * and holds no fetching or DOM/file APIs). This container owns the recipe-photo lifecycle for the web app:
 * it reads the photos via `useRecipePhotos`, supplies the block's `addControl` (an accessible label wrapping
 * a hidden, `multiple` `<input type="file">`), and on a file selection ENQUEUES every picked file onto
 * `useRecipePhotoUploadQueue` (w3/e4) — the layer that drives the shared, single-flight `useRecipePhotoUpload`
 * headless hook (CP-6/P3, B24) once per file, sequentially, while the grid shows each file's own status.
 * Remove wires the per-photo control to `useDeleteRecipePhoto`, busying just the row whose deletion is in
 * flight; the queue's own `retry`/`remove` handle a queued/failed FILE (not yet a confirmed photo).
 *
 * Remote state stays in TanStack Query; `confirm → invalidateRecipeProjections` still runs exactly once per
 * successful upload, from inside `useRecipePhotoUpload` — this container and the queue layer above it never
 * reimplement that call. The web-specific bits neither hook owns: acquiring `File`s from the DOM `change`
 * event, minting a per-file preview object URL (revoked once a file is no longer pending — removed, or
 * folded into the confirmed `photos` list on success), and resetting the input so the same file can be
 * re-picked after being removed from the queue.
 */
import { RecipePhotoManager } from '@commise/features-recipes';
import { useRecipePhotoUpload, useRecipePhotoUploadQueue } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import { useDeleteRecipePhoto, useRecipePhotos } from '@kitchensink/recipe-service-client/hooks';
import { useEffect, useRef } from 'react';
import type { ChangeEvent, FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipePhotoUploaderContainer}. */
export interface RecipePhotoUploaderContainerProps {
    /** The recipe whose photos this manages (from the `[id]` route segment). */
    readonly recipeId: string;
}

/**
 * The live recipe photo uploader.
 *
 * @param props - The recipe id whose photos to manage.
 * @returns The shared photo-manager block wired to the presign → PUT → confirm upload queue + delete mutation.
 */
export const RecipePhotoUploaderContainer: FC<RecipePhotoUploaderContainerProps> = ({ recipeId }) => {
    const { recipes } = useMessages(webMessages);
    const photosQuery = useRecipePhotos(recipeId);
    const deletePhoto = useDeleteRecipePhoto();
    const uploader = useRecipePhotoUpload(recipeId, recipes.photos.uploadError);

    const photos: readonly RecipePhoto[] = photosQuery.data ?? [];
    const queue = useRecipePhotoUploadQueue(uploader, photos.length);

    const inputRef = useRef<HTMLInputElement>(null);

    // Object URLs are a browser-only resource this container mints (not the platform-agnostic queue hook) —
    // revoked as soon as a file is no longer PENDING: removed from the queue, or resolved `ok` (the confirmed
    // `photos` list — refetched by the same `confirm` call — takes over rendering it via its own `photo.url`).
    const previewUrlsRef = useRef(new Map<number, string>());

    useEffect(() => {
        const tracked = previewUrlsRef.current;

        for (const item of queue.items) {
            if (item.previewUri !== undefined && !tracked.has(item.fileId)) {
                tracked.set(item.fileId, item.previewUri);
            }
        }

        for (const [fileId, url] of tracked) {
            const stillPending = queue.items.some((item) => item.fileId === fileId && item.status !== 'ok');

            if (!stillPending) {
                URL.revokeObjectURL(url);
                tracked.delete(fileId);
            }
        }
    }, [queue.items]);

    useEffect(() => {
        const tracked = previewUrlsRef.current;

        return () => {
            for (const url of tracked.values()) {
                URL.revokeObjectURL(url);
            }
        };
    }, []);

    // Acquire every picked File and enqueue them all — the queue drives each one's presign → PUT → confirm
    // sequentially (one at a time, respecting the single-flight hook's own guarantee) while the grid shows
    // every file's own status. Reset the input immediately so re-selecting the same file (e.g. after
    // removing it from the queue) still fires a fresh `change` event.
    const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const files = Array.from(event.target.files ?? []);

        queue.enqueue(
            files.map((file) => ({
                blob: file,
                fileName: file.name,
                contentType: file.type,
                fileSize: file.size,
                previewUri: URL.createObjectURL(file),
            })),
        );

        if (inputRef.current !== null) {
            inputRef.current.value = '';
        }
    };

    const removingPhotoId = deletePhoto.isPending ? (deletePhoto.variables?.photoId ?? null) : null;

    const addControl = (
        <label>
            {recipes.photos.addLabel}
            <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={handleFileChange} />
        </label>
    );

    return (
        <RecipePhotoManager
            photos={photos}
            onRemovePhoto={(photoId) => deletePhoto.mutate({ id: recipeId, photoId })}
            removingPhotoId={removingPhotoId}
            uploading={uploader.uploading}
            queueItems={queue.items}
            onRetryQueueItem={queue.retry}
            onRemoveQueueItem={queue.remove}
            addControl={addControl}
        />
    );
};
