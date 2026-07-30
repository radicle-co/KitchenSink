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
 *
 * Every picked file also passes through the queue's client-side pre-validation (REQ-011 size, REQ-012 MIME
 * allowlist) — this container's only involvement is supplying the two localized rejection strings; the
 * admission check itself lives in `useRecipePhotoUploadQueue`.
 *
 * **Replace is upload-first (U6, cancel-safe).** A second, single-select hidden input serves the per-photo
 * "Replace" control, and the original photo is deleted only from the replacement's `onUploaded` continuation
 * — never up-front. See the `handleReplacePhoto` comment for the full ordering + the at-cap refusal.
 */
import { RecipePhotoManager, isAtPhotoCap, visibleQueueItems } from '@commise/features-recipes';
import { useRecipePhotoUpload, useRecipePhotoUploadQueue } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import {
    useDeleteRecipePhoto,
    useRecipePhotos,
    useReorderRecipePhotos,
} from '@kitchensink/recipe-service-client/hooks';
import { useEffect, useRef, useState } from 'react';
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
    const reorderPhotos = useReorderRecipePhotos();
    const uploader = useRecipePhotoUpload(recipeId, recipes.photos.uploadError);

    const photos: readonly RecipePhoto[] = photosQuery.data ?? [];
    const queue = useRecipePhotoUploadQueue(uploader, photos.length, {
        tooLarge: recipes.photos.tooLargeError,
        badType: recipes.photos.unsupportedTypeError,
    });

    // ALLOWED REF (§3 — wraps a genuinely external, non-declarative system): the DOM `<input type="file">`
    // element itself. Imperatively clearing `.value` after a pick (below) is the only way to let the SAME
    // file be re-selected later (e.g. after being removed from the queue) and still fire a fresh `change`
    // event — there is no declarative/prop-driven equivalent for "reset a file input".
    const inputRef = useRef<HTMLInputElement>(null);

    // ALLOWED REF (§3 — external-resource lifecycle, not state-in-a-ref): a browser `Object URL` is a
    // resource OUTSIDE React's model (leaking memory until explicitly `revokeObjectURL`d), so tracking which
    // ones are still owed a revoke is bookkeeping for that external system, never read to drive rendering —
    // the grid renders each queue item's preview from `queue.items[].previewUri` (real React state owned by
    // `useRecipePhotoUploadQueue`), not from this map. This container mints the URLs (not the
    // platform-agnostic queue hook) and revokes each one as soon as its file is no longer PENDING: removed
    // from the queue, or resolved `ok` (the confirmed `photos` list — refetched by the same `confirm` call —
    // takes over rendering it via its own `photo.url`).
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

    // Removing a photo is exactly the advice the at-cap replace refusal gives, so it must not linger once
    // followed — the message would otherwise still claim there is no room after the user has made some.
    const handleRemovePhoto = (photoId: string): void => {
        setReplaceErrorMessage(undefined);
        deletePhoto.mutate({ id: recipeId, photoId });
    };

    // U6 "Set as cover": the cover is the LOWEST-sort-order photo, so choosing a cover is a REORDER that moves
    // the chosen id to index 0 (rest keep their current relative order). The existing `reorder` endpoint
    // persists it and `invalidateRecipeProjections` (inside the hook's `onSuccess`) reprojects the new
    // `coverPhotoUrl` into the card/detail surfaces — no backend change, no `isCover` field. Selecting the
    // photo that is ALREADY the cover would be a no-op reorder; a checked radio does not re-fire `onChange`,
    // so that call never happens.
    const handleSetCover = (photoId: string): void => {
        const photoIds = [photoId, ...photos.filter((photo) => photo.id !== photoId).map((photo) => photo.id)];
        reorderPhotos.mutate({ id: recipeId, photoIds });
    };

    // U6 "Replace" — UPLOAD-FIRST, then swap (cancel-safe). There is no atomic replace primitive server-side,
    // and the previous remove-then-add ordering deleted the original the instant Replace was pressed: a mere
    // picker CANCEL (or any upload failure afterwards) left the user with nothing. So the destructive half now
    // runs LAST, as the replacement's post-commit continuation:
    //   press Replace → open the picker → (cancel ⇒ nothing happened) → enqueue the picked file → presign →
    //   PUT → confirm → ONLY THEN delete the original (`onUploaded`, see `useRecipePhotoUploadQueue`).
    // A failed/withdrawn replacement never reaches that continuation, so the original survives every path
    // except a genuine, confirmed swap.
    //
    // Cover semantics are deliberately UNCHANGED: the cover is still the lowest-sort-order photo, the
    // replacement still appends to the end, and the delete still promotes the next photo when the cover is the
    // one replaced — the exact final ordering remove-then-add produced ([A,B,C] → replace B → [A,C,D] either
    // way). No reorder call is made here, so the U6 cover selection is untouched.
    //
    // The one behavioural trade-off: at the photo cap the server rejects the confirm (`MAX_PHOTOS_EXCEEDED`
    // is enforced in one transaction with the INSERT), so a lossless swap has nowhere to land. Rather than
    // delete first (data loss on cancel) or surface a bogus "upload failed", Replace refuses with an
    // actionable message and the user frees a slot deliberately.
    const [replacingPhotoId, setReplacingPhotoId] = useState<string | null>(null);
    const [replaceErrorMessage, setReplaceErrorMessage] = useState<string | undefined>(undefined);

    // ALLOWED REF (§3 — same rationale as `inputRef`): the replacement picker is its OWN hidden
    // `<input type="file">` (single-select) so a replacement pick can never be confused with an additive
    // multi-file Add pick, and so cancelling one does not disturb the other.
    const replaceInputRef = useRef<HTMLInputElement>(null);

    const handleReplacePhoto = (photoId: string): void => {
        if (isAtPhotoCap(photos.length + visibleQueueItems(queue.items).length)) {
            setReplaceErrorMessage(recipes.photos.replaceAtCapError);

            return;
        }

        setReplaceErrorMessage(undefined);
        setReplacingPhotoId(photoId);
        replaceInputRef.current?.click();
    };

    // The replacement pick. A cancelled dialog fires no `change` at all, so this never runs and the original
    // photo is still there; `replacingPhotoId` simply stays inert until the next Replace press overwrites it.
    const handleReplaceFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const [file] = Array.from(event.target.files ?? []);
        const replacedPhotoId = replacingPhotoId;

        setReplacingPhotoId(null);

        if (replaceInputRef.current !== null) {
            replaceInputRef.current.value = '';
        }

        if (file === undefined || replacedPhotoId === null) {
            return;
        }

        queue.enqueue([
            {
                blob: file,
                fileName: file.name,
                contentType: file.type,
                fileSize: file.size,
                previewUri: URL.createObjectURL(file),
                // The swap's commit step — runs exactly once, only after this file has been confirmed.
                onUploaded: () => deletePhoto.mutate({ id: recipeId, photoId: replacedPhotoId }),
            },
        ]);
    };

    const addControl = (
        <label>
            {recipes.photos.addLabel}
            <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={handleFileChange} />
        </label>
    );

    return (
        <>
            <RecipePhotoManager
                photos={photos}
                onRemovePhoto={handleRemovePhoto}
                removingPhotoId={removingPhotoId}
                uploading={uploader.uploading}
                errorMessage={replaceErrorMessage}
                queueItems={queue.items}
                onRetryQueueItem={queue.retry}
                onRemoveQueueItem={queue.remove}
                onSetCover={handleSetCover}
                onReplacePhoto={handleReplacePhoto}
                addControl={addControl}
            />
            {/* The replacement picker lives OUTSIDE the block (which hides `addControl` at the cap) so it is
                never conditionally unmounted mid-flow; it is named for assistive tech, never visible. */}
            <input
                ref={replaceInputRef}
                type="file"
                accept="image/*"
                hidden
                aria-label={recipes.photos.replaceInputLabel}
                onChange={handleReplaceFileChange}
            />
        </>
    );
};
