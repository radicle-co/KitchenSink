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
import { RecipePhotoManager } from '@commise/features-recipes';
import { useRecipePhotoUpload, useRecipePhotoUploadQueue } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { useDeleteRecipePhoto, useRecipePhotos } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link RecipePhotoUploader}. */
export interface RecipePhotoUploaderProps {
    /** The id of the recipe whose photos are managed. */
    readonly recipeId: string;
}

/**
 * The recipe photo uploader.
 *
 * @param props - The id of the recipe whose photos are managed.
 * @returns The photo manager block wired to the native picker and the upload-queue/remove mutations.
 */
export function RecipePhotoUploader({ recipeId }: RecipePhotoUploaderProps): JSX.Element {
    const { recipePhotos: t } = useMessages(mobileMessages);
    const photosQuery = useRecipePhotos(recipeId);
    const deletePhoto = useDeleteRecipePhoto();
    const uploader = useRecipePhotoUpload(recipeId, t.uploadError);
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

    // Tracks the picker-launch + local-blob-read window, BEFORE `enqueue()` ever runs — see the re-entrancy
    // guard in the module doc above.
    const [picking, setPicking] = useState(false);
    const errorMessage = removeErrorMessage ?? pickErrorMessage;

    // The delete mutation carries its target in `variables`; busy only that row while its deletion is pending.
    const removingPhotoId = deletePhoto.isPending ? (deletePhoto.variables?.photoId ?? null) : null;

    // Pick an image, then enqueue it onto the upload queue — the queue drives the presign → PUT-to-S3 →
    // confirm sequence itself. A canceled pick is a silent no-op. `picking` spans ONLY the picker-launch +
    // blob-read window (never the upload itself), so a second tap while a PREVIOUS pick is still resolving
    // can't launch `expo-image-picker` a second time concurrently — but a tap while a PREVIOUS upload is
    // still in flight is welcomed: it enqueues, exactly the queue's reason to exist.
    const addPhoto = async (): Promise<void> => {
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
            queue.enqueue([{ blob, fileName, contentType, fileSize: blob.size, previewUri: asset.uri }]);
        } finally {
            setPicking(false);
        }
    };

    const removePhoto = (photoId: string): void => {
        setRemoveErrorMessage(undefined);
        deletePhoto.mutate({ id: recipeId, photoId }, { onError: () => setRemoveErrorMessage(t.removeError) });
    };

    const addControl = (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.addLabel}
            accessibilityState={{ busy: picking, disabled: picking }}
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
            queueItems={queue.items}
            onRetryQueueItem={queue.retry}
            onRemoveQueueItem={queue.remove}
            addControl={addControl}
        />
    );
}
