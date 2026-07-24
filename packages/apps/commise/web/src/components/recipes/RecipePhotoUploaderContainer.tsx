'use client';

/**
 * The upload orchestration the shared `RecipePhotoManager` block deliberately omits (it is presentational
 * and holds no fetching or DOM/file APIs). This container owns the recipe-photo lifecycle for the web app:
 * it reads the photos via `useRecipePhotos`, supplies the block's `addControl` (an accessible label wrapping
 * a hidden `<input type="file">`), and on a file selection delegates the three-step direct-to-S3 upload —
 * presign → PUT the raw file → confirm (which invalidates the photos + recipe caches) — to the shared,
 * single-flight `useRecipePhotoUpload` headless hook (CP-6/P3, B24). Remove wires the per-photo control to
 * `useDeleteRecipePhoto`, busying just the row whose deletion is in flight.
 *
 * Remote state stays in TanStack Query; the hook owns the transient upload `uploading` flag and the last
 * localized `errorMessage`. This container keeps only the web-specific bits the hook deliberately stays
 * free of: the `inputRef` reset-in-`finally` (so the same file can be re-picked) and the B24 DOM guard —
 * the input is `disabled` while `uploading`, so a second pick mid-upload can't even open a file dialog that
 * would fire a second (now single-flight-rejected, but still-attempted) `handleFileChange`.
 */
import { RecipePhotoManager } from '@commise/features-recipes';
import { useRecipePhotoUpload } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import { useDeleteRecipePhoto, useRecipePhotos } from '@kitchensink/recipe-service-client/hooks';
import { useRef } from 'react';
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
 * @returns The shared photo-manager block wired to the presign → PUT → confirm upload + delete mutations.
 */
export const RecipePhotoUploaderContainer: FC<RecipePhotoUploaderContainerProps> = ({ recipeId }) => {
    const { recipes } = useMessages(webMessages);
    const photosQuery = useRecipePhotos(recipeId);
    const deletePhoto = useDeleteRecipePhoto();
    const { uploading, errorMessage, upload } = useRecipePhotoUpload(recipeId, recipes.photos.uploadError);

    const inputRef = useRef<HTMLInputElement>(null);

    const photos: readonly RecipePhoto[] = photosQuery.data ?? [];

    // Acquire the picked File, delegate the presign → PUT → confirm sequence to the shared single-flight
    // hook, then reset the input in `finally` so re-selecting the same file re-fires `change`.
    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        // B24 guard (belt + suspenders): the input is also `disabled` while `uploading` below, but a change
        // event already in the queue when `uploading` flips true must not start a second flow either.
        if (uploading) {
            return;
        }

        const file = event.target.files?.[0];

        if (file === undefined) {
            return;
        }

        try {
            await upload({ blob: file, fileName: file.name, contentType: file.type, fileSize: file.size });
        } finally {
            if (inputRef.current !== null) {
                inputRef.current.value = '';
            }
        }
    };

    const removingPhotoId = deletePhoto.isPending ? (deletePhoto.variables?.photoId ?? null) : null;

    const addControl = (
        <label>
            {recipes.photos.addLabel}
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                hidden
                disabled={uploading}
                onChange={(event) => void handleFileChange(event)}
            />
        </label>
    );

    return (
        <RecipePhotoManager
            photos={photos}
            onRemovePhoto={(photoId) => deletePhoto.mutate({ id: recipeId, photoId })}
            removingPhotoId={removingPhotoId}
            uploading={uploading}
            addControl={addControl}
            {...(errorMessage === undefined ? {} : { errorMessage })}
        />
    );
};
