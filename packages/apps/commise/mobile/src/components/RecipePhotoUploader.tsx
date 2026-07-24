/**
 * Recipe photo uploader (mobile, T067, wireframe step 4). The container that turns the shared, presentational
 * {@link RecipePhotoManager} block (its native leaf) into a working photo surface: it reads the recipe's
 * photos from the query cache, supplies the native image-picker button as the block's `addControl`, and
 * delegates the direct-to-S3 upload orchestration the block deliberately stays free of to the shared,
 * single-flight `useRecipePhotoUpload` headless hook (CP-6/P3, B24).
 *
 * Upload flow, on a picked asset: read the asset's bytes as a Blob, then hand `{ blob, fileName, contentType,
 * fileSize }` to `upload`, which mints a presigned URL, `PUT`s the bytes straight to S3, then confirms so the
 * service records the photo — driving the hook's `uploading` busy state and, on any failure, a localized
 * `errorMessage`. Removal delegates to `useDeleteRecipePhoto`, busying just the row whose deletion is in
 * flight. Cross-platform peer of the web container; the picker (`expo-image-picker`) and the real S3 upload
 * require on-device verification.
 *
 * **Two leaf-local guards this container owns (the hook deliberately stays free of either):**
 *  1. **Stale-error cross-clear.** The hook only clears its own `errorMessage` when a NEW `upload()` starts,
 *     so a failed upload followed by an unrelated, successful remove would otherwise leave the upload-error
 *     banner on screen forever. `uploadErrorSlot` mirrors the hook's `errorMessage` via effect so `removePhoto`
 *     can clear it exactly like its own `removeErrorMessage` slot — restoring the pre-refactor symmetry where
 *     ANY fresh action cleared ANY prior error.
 *  2. **Pick + blob-read re-entrancy (B24, closed for the full window).** The hook's `uploading` only flips
 *     true once `upload()` is actually called, but the picker launch + local blob read that happen BEFORE that
 *     call are themselves awaited work with no guard of their own. `picking` covers that window: the add
 *     control is disabled on `uploading || picking`, and `addPhoto` early-returns if either is already true —
 *     so a second tap during the picker/blob-read can't launch `expo-image-picker` a second time concurrently.
 */
import { RecipePhotoManager } from '@commise/features-recipes';
import { useRecipePhotoUpload } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { useDeleteRecipePhoto, useRecipePhotos } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
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
 * @returns The photo manager block wired to the native picker and the upload/remove mutations.
 */
export function RecipePhotoUploader({ recipeId }: RecipePhotoUploaderProps): JSX.Element {
    const { recipePhotos: t } = useMessages(mobileMessages);
    const photosQuery = useRecipePhotos(recipeId);
    const deletePhoto = useDeleteRecipePhoto();
    const { uploading, errorMessage: uploadErrorMessage, upload } = useRecipePhotoUpload(recipeId, t.uploadError);

    // Two local error slots the upload hook deliberately knows nothing about: `pickErrorMessage` covers a
    // failed local Blob read of the picked asset's URI (before `upload` is ever called, so the hook's own
    // `errorMessage` can't carry it); `removeErrorMessage` covers a failed delete. A fresh attempt at either
    // action clears its own slot; the displayed error prefers the more likely-current source.
    const [pickErrorMessage, setPickErrorMessage] = useState<string | undefined>(undefined);
    const [removeErrorMessage, setRemoveErrorMessage] = useState<string | undefined>(undefined);
    // A locally-clearable mirror of the hook's own `errorMessage` (see the stale-error cross-clear guard in
    // the module doc above). The hook clears ITS `errorMessage` only when a new `upload()` starts; this slot
    // additionally lets `removePhoto` clear it, so a successful unrelated remove can't leave a stale
    // upload-error banner on screen.
    const [uploadErrorSlot, setUploadErrorSlot] = useState<string | undefined>(undefined);

    useEffect(() => {
        setUploadErrorSlot(uploadErrorMessage);
    }, [uploadErrorMessage]);

    // Tracks the picker-launch + local-blob-read window, BEFORE `upload()` (and so the hook's own
    // `uploading`) ever starts — see the re-entrancy guard in the module doc above.
    const [picking, setPicking] = useState(false);
    const errorMessage = removeErrorMessage ?? pickErrorMessage ?? uploadErrorSlot;

    const photos = photosQuery.data ?? [];
    // The delete mutation carries its target in `variables`; busy only that row while its deletion is pending.
    const removingPhotoId = deletePhoto.isPending ? (deletePhoto.variables?.photoId ?? null) : null;

    // Pick an image, then delegate the presign → PUT-to-S3 → confirm sequence to the shared, single-flight
    // `useRecipePhotoUpload` hook. A canceled pick is a silent no-op. `picking` spans the ENTIRE picker-launch
    // + blob-read + upload window so the add control's `uploading || picking` guard never opens a gap for a
    // concurrent second launch (B24, re-entrancy).
    const addPhoto = async (): Promise<void> => {
        if (picking || uploading) {
            // Already mid-flight (picker open, reading the blob, or uploading) — a second tap is a no-op.
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
            const fileSize = asset.fileSize ?? 0;

            setRemoveErrorMessage(undefined);
            setPickErrorMessage(undefined);

            let blob: Blob;

            try {
                blob = await (await fetch(asset.uri)).blob();
            } catch {
                setPickErrorMessage(t.uploadError);

                return;
            }

            await upload({ blob, fileName, contentType, fileSize });
        } finally {
            setPicking(false);
        }
    };

    const removePhoto = (photoId: string): void => {
        // Unconditional cross-clear (pre-refactor symmetry): a fresh remove attempt clears ANY prior error,
        // including a stale upload-error banner the hook itself would otherwise never clear for us.
        setRemoveErrorMessage(undefined);
        setUploadErrorSlot(undefined);
        deletePhoto.mutate({ id: recipeId, photoId }, { onError: () => setRemoveErrorMessage(t.removeError) });
    };

    const addControl = (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.addLabel}
            accessibilityState={{ busy: uploading || picking, disabled: uploading || picking }}
            disabled={uploading || picking}
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
            uploading={uploading}
            errorMessage={errorMessage}
            addControl={addControl}
        />
    );
}
