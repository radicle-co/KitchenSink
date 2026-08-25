/**
 * Recipe photo uploader (mobile, T067, wireframe step 4; w3/e4 per-file queue grid). The container that turns
 * the shared, presentational {@link RecipePhotoManager} block (its native leaf) into a working photo surface:
 * it reads the recipe's photos from the query cache, supplies the native image-picker button as the block's
 * `addControl`, and ENQUEUES every picked asset onto `useRecipePhotoUploadQueue` (w3/e4) — the layer that
 * drives the shared, single-flight `useRecipePhotoUpload` headless hook (CP-6/P3, B24) once per file,
 * sequentially, while the grid shows each file's own status.
 *
 * Upload flow, on a picked asset: read the asset's bytes as a Blob, then enqueue `{ blob, fileName,
 * contentType, fileSize, previewUri: asset.uri }` (the asset's own URI doubles as the grid thumbnail while
 * queued/uploading/failed — no extra copy needed on this platform, unlike the web leaf's `createObjectURL`).
 * `fileSize` is read from the Blob (`blob.size`), NOT `asset.fileSize` — see `addPhoto`'s comment for why
 * the picker's own metadata is not a trustworthy source for the REQ-011 size check.
 * The queue drives the presign → S3 PUT → confirm sequence per file; `confirm → invalidateRecipeProjections`
 * still runs exactly once per successful upload, from inside `useRecipePhotoUpload`. Removal of a CONFIRMED
 * photo delegates to `useDeleteRecipePhoto`, busying just the row whose deletion is in flight; the queue's own
 * `retry`/`remove` handle a queued/failed FILE. Cross-platform peer of the web container; the picker
 * (`expo-image-picker`) and the real S3 upload require on-device verification.
 *
 * **Pick + blob-read re-entrancy (B24-adjacent, closed for the full window).** The queue's `uploading` only
 * reflects an upload that has actually STARTED, but the picker launch + local blob read that happen BEFORE
 * `enqueue()` are themselves awaited work with no guard of their own. `picking` covers that window: the add
 * control is disabled only while `picking` (never while an upload is in flight — the whole point of the
 * queue is that a second pick during an in-flight upload is accepted and queued, not blocked), and `addPhoto`
 * early-returns if a pick is already underway — so a second tap during the picker/blob-read can't launch
 * `expo-image-picker` a second time concurrently.
 *
 * Every enqueued asset also passes through the queue's client-side pre-validation (REQ-011 size, REQ-012
 * MIME allowlist) — this container's only involvement is supplying the two localized rejection strings;
 * the admission check itself lives in `useRecipePhotoUploadQueue`.
 */
import { RecipePhotoManager, isAtPhotoCap, visibleQueueItems, type RecipeFormPhoto } from '@commise/features-recipes';
import { useRecipePhotoUpload, useRecipePhotoUploadQueue, type DraftPhotoPick } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import {
    useDeleteRecipePhoto,
    useRecipePhotos,
    useReorderRecipePhotos,
} from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link RecipePhotoUploader}. */
export interface RecipePhotoUploaderProps {
    /** The recipe whose photos are managed, or `null` on a create that has not saved yet (U33). */
    readonly recipeId: string | null;
    /**
     * Where a pick goes BEFORE the recipe exists (U33). When given, a chosen file is handed here instead of
     * to the upload queue — the create screen records it in the draft (`useRecipeDraftPhotos`) and flushes it
     * once the create mutation returns an id.
     *
     * ⛔ This is why there is ONE mobile photo surface rather than a create twin: the picker, the blob read,
     * the `blob.size` rule and the manager wiring are all identical, and only the DESTINATION of a pick
     * differs. A second component would have had to restate every one of them.
     */
    readonly onPick?: (pick: DraftPhotoPick) => void;
    /**
     * Picks still held in the draft, rendered in the SAME grid as the queue's own items so a chosen photo
     * looks identical before and after the recipe exists — and so it counts toward the photo cap.
     */
    readonly pendingDrafts?: readonly RecipeFormPhoto[];
}

/**
 * The recipe photo uploader.
 *
 * @param props - The id of the recipe whose photos are managed.
 * @returns The photo manager block wired to the native picker and the upload-queue/remove mutations.
 */
export function RecipePhotoUploader({ recipeId, onPick, pendingDrafts = [] }: RecipePhotoUploaderProps): JSX.Element {
    const { recipePhotos: t } = useMessages(mobileMessages);
    // `''` disables the query (`enabled: id.length > 0`) — a create has no photos to list yet.
    const photosQuery = useRecipePhotos(recipeId ?? '');
    const deletePhoto = useDeleteRecipePhoto();
    const reorderPhotos = useReorderRecipePhotos();
    const uploader = useRecipePhotoUpload(recipeId ?? '', t.uploadError);
    const photos = photosQuery.data ?? [];
    const queue = useRecipePhotoUploadQueue(uploader, photos.length, {
        tooLarge: t.tooLargeError,
        badType: t.unsupportedTypeError,
    });

    // Two local error slots neither the upload hook nor the queue know about: `pickErrorMessage` covers a
    // failed local Blob read of the picked asset's URI (before `enqueue()` is ever called, so no queue item
    // exists yet to carry it); `removeErrorMessage` covers a failed delete of a CONFIRMED photo. A fresh
    // attempt at either action clears its own slot.
    const [pickErrorMessage, setPickErrorMessage] = useState<string | undefined>(undefined);
    const [removeErrorMessage, setRemoveErrorMessage] = useState<string | undefined>(undefined);
    // A third slot for the one way a REPLACE can be refused before anything happens: no free slot for the
    // replacement to land in (see `replacePhoto`). Cleared by the next replace attempt and by any removal
    // (which is exactly the advice the message gives, so it must not linger once followed).
    const [replaceErrorMessage, setReplaceErrorMessage] = useState<string | undefined>(undefined);

    // Tracks the picker-launch + local-blob-read window, BEFORE `enqueue()` ever runs — see the re-entrancy
    // guard in the module doc above.
    const [picking, setPicking] = useState(false);
    const errorMessage = replaceErrorMessage ?? removeErrorMessage ?? pickErrorMessage;

    // The delete mutation carries its target in `variables`; busy only that row while its deletion is pending.
    const removingPhotoId = deletePhoto.isPending ? (deletePhoto.variables?.photoId ?? null) : null;

    // Pick an image, then enqueue it onto the upload queue — the queue drives the presign → PUT-to-S3 →
    // confirm sequence itself. A canceled pick is a silent no-op. `picking` spans ONLY the picker-launch +
    // blob-read window (never the upload itself), so a second tap while a PREVIOUS pick is still resolving
    // can't launch `expo-image-picker` a second time concurrently — but a tap while a PREVIOUS upload is
    // still in flight is welcomed: it enqueues, exactly the queue's reason to exist.
    // `onUploaded` is the optional post-commit continuation carried on the enqueued file (see
    // `useRecipePhotoUploadQueue`): the queue runs it once, only after this file's confirm has landed. Add
    // passes none; Replace passes the "now delete the photo you replaced" step.
    const addPhoto = async (onUploaded?: () => void): Promise<void> => {
        if (picking) {
            // Already mid-flight (picker open, or reading the blob) — a second tap is a no-op.
            return;
        }

        setPicking(true);

        try {
            // Load the native picker lazily (on first use). `expo-image-picker` pulls in `expo-modules-core`,
            // which can only be evaluated inside the native runtime — deferring the import keeps it out of
            // the module graph until the user actually taps Add, and out of environments lacking that runtime.
            const ImagePicker = await import('expo-image-picker');
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8,
            });

            if (result.canceled) {
                return;
            }

            const asset = result.assets[0];

            if (asset === undefined) {
                return;
            }

            const contentType = asset.mimeType ?? 'image/jpeg';
            const fileName = asset.fileName ?? 'photo.jpg';

            setPickErrorMessage(undefined);

            let blob: Blob;

            try {
                blob = await (await fetch(asset.uri)).blob();
            } catch {
                setPickErrorMessage(t.uploadError);

                return;
            }

            // Authoritative size: `expo-image-picker`'s `asset.fileSize` is often null/undefined on
            // Android/web, and a `?? 0` default there would silently admit an oversized file past the
            // REQ-011 client pre-check (`0 > MAX` is always false). `blob.size` is the exact byte length of
            // what's actually about to be uploaded — always present, since a `Blob` requires it — and it's
            // also the presign request's `fileSize`, so that request now describes the SAME bytes the S3
            // PUT sends, rather than the picker's separate (and sometimes absent) size estimate.
            const picked = {
                blob,
                fileName,
                contentType,
                fileSize: blob.size,
                previewUri: asset.uri,
                ...(onUploaded === undefined ? {} : { onUploaded }),
            };

            // Before the recipe exists there is nothing to presign against, so the pick goes to the draft
            // instead of the queue — see `onPick`'s own doc, and `useRecipeDraftPhotos` for the flush.
            if (onPick !== undefined) {
                onPick(picked);

                return;
            }

            queue.enqueue([picked]);
        } finally {
            setPicking(false);
        }
    };

    // Unreachable while `recipeId` is null: there are no persisted photos to remove until the recipe exists,
    // so the manager renders no per-photo controls at all. Guarded anyway rather than asserted away — a
    // non-null assertion here would be a claim about a caller this component does not own.
    const removePhoto = (photoId: string): void => {
        if (recipeId === null) {
            return;
        }

        setRemoveErrorMessage(undefined);
        setReplaceErrorMessage(undefined);
        deletePhoto.mutate({ id: recipeId, photoId }, { onError: () => setRemoveErrorMessage(t.removeError) });
    };

    // U6 "Set as cover": the cover is the lowest-sort-order photo (server projection), so choosing a cover is
    // a reorder that moves the chosen id to the front, keeping the rest in their current order.
    const setCover = (photoId: string): void => {
        if (recipeId === null) {
            return;
        }

        const photoIds = [photoId, ...photos.filter((photo) => photo.id !== photoId).map((photo) => photo.id)];
        reorderPhotos.mutate({ id: recipeId, photoIds });
    };

    // U6 "Replace" — UPLOAD-FIRST, then swap (cancel-safe; mirrors the web container). No atomic replace
    // primitive exists server-side, and the previous ordering deleted the photo FIRST and only then opened the
    // picker: cancelling the picker (the single most likely outcome of an accidental tap) destroyed the
    // original, and so did any subsequent upload failure. The destructive half now runs LAST, as the
    // replacement's post-commit continuation — pick → blob-read → enqueue → presign → PUT → confirm → delete
    // the original. Every earlier exit (cancel, unreadable asset, validation rejection, failed PUT/confirm)
    // leaves the original photo exactly where it was.
    //
    // Cover semantics are deliberately unchanged: the replacement appends to the end, the delete promotes the
    // next photo when the cover was the one replaced, and no reorder is issued — the same final ordering the
    // old remove-then-add produced.
    //
    // At the cap there is nowhere for the replacement to land (the server enforces MAX_PHOTOS_EXCEEDED inside
    // the confirm transaction), so rather than delete first (data loss) or surface a misleading "upload
    // failed", Replace refuses with actionable copy and the user frees a slot deliberately.
    const replacePhoto = (photoId: string): void => {
        if (isAtPhotoCap(photos.length + pendingDrafts.length + visibleQueueItems(queue.items).length)) {
            setReplaceErrorMessage(t.replaceAtCapError);

            return;
        }

        setReplaceErrorMessage(undefined);
        void addPhoto(() => removePhoto(photoId));
    };

    const addControl = (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.addLabel}
            // The `disabled` half already reaches the DOM (react-native-web derives `aria-disabled` from the
            // `disabled` PROP below); `busy` did not, because RNW projects `accessibilityState` for nothing
            // (#123). That matters most here: the pick window has NO other affordance at all — the label never
            // changes, no spinner renders, and the picker is a system sheet — so `aria-busy` is the only thing
            // separating "the picker is opening" from "this button is dead". It is RN's own first-class ALIAS
            // for `accessibilityState.busy`, so it is device-correct too; omitted when idle.
            accessibilityState={{ busy: picking, disabled: picking }}
            aria-busy={picking || undefined}
            disabled={picking}
            onPress={() => void addPhoto()}
        >
            <Text>{t.addLabel}</Text>
        </Pressable>
    );

    return (
        <RecipePhotoManager
            photos={photos}
            onRemovePhoto={removePhoto}
            removingPhotoId={removingPhotoId}
            uploading={uploader.uploading}
            errorMessage={errorMessage}
            queueItems={[
                // Draft picks first: they were chosen before anything in the queue, and negative ids cannot
                // collide with the queue's own monotonic positive ones.
                ...pendingDrafts.map((photo, index) => ({
                    fileId: -(index + 1),
                    fileName: photo.fileName,
                    status: 'queued' as const,
                    retryable: false,
                })),
                ...queue.items,
            ]}
            onRetryQueueItem={queue.retry}
            onRemoveQueueItem={queue.remove}
            onSetCover={setCover}
            onReplacePhoto={replacePhoto}
            addControl={addControl}
        />
    );
}
