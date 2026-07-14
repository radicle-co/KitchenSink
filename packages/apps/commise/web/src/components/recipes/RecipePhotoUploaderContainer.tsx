'use client';

/**
 * The upload orchestration the shared `RecipePhotoManager` block deliberately omits (it is presentational
 * and holds no fetching or DOM/file APIs). This container owns the recipe-photo lifecycle for the web app:
 * it reads the photos via `useRecipePhotos`, supplies the block's `addControl` (an accessible label wrapping
 * a hidden `<input type="file">`), and on a file selection runs the three-step direct-to-S3 upload —
 * presign (`useCreatePhotoUploadUrl`) → PUT the raw file to the presigned URL → confirm
 * (`useConfirmPhotoUpload`, which invalidates the photos + recipe caches). Remove wires the per-photo
 * control to `useDeleteRecipePhoto`, busying just the row whose deletion is in flight.
 *
 * Remote state stays in TanStack Query; the container holds only the transient upload `uploading` flag and
 * the last localized upload `errorMessage`. The file input is reset after every attempt so the same file can
 * be re-picked, and any failure across the three steps surfaces one localized error to the block.
 */
import { RecipePhotoManager } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import type { RecipePhoto } from '@kitchensink/recipe-core';
import {
    useConfirmPhotoUpload,
    useCreatePhotoUploadUrl,
    useDeleteRecipePhoto,
    useRecipePhotos,
} from '@kitchensink/recipe-service-client/hooks';
import { useRef, useState } from 'react';
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
    const createUploadUrl = useCreatePhotoUploadUrl();
    const confirmUpload = useConfirmPhotoUpload();
    const deletePhoto = useDeleteRecipePhoto();

    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

    const photos: readonly RecipePhoto[] = photosQuery.data ?? [];

    // presign → direct PUT → confirm; any step failing surfaces one localized error. The input is reset in
    // `finally` so re-selecting the same file re-fires `change`.
    const handleFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = event.target.files?.[0];

        if (file === undefined) {
            return;
        }

        setUploading(true);
        setErrorMessage(undefined);

        try {
            const { uploadUrl, key } = await createUploadUrl.mutateAsync({
                id: recipeId,
                request: { fileName: file.name, contentType: file.type, fileSize: file.size },
            });

            const response = await fetch(uploadUrl, {
                method: 'PUT',
                body: file,
                headers: { 'Content-Type': file.type },
            });

            if (!response.ok) {
                throw new Error(`Photo upload failed with status ${response.status}`);
            }

            await confirmUpload.mutateAsync({ id: recipeId, request: { key, contentType: file.type } });
        } catch {
            setErrorMessage(recipes.photos.uploadError);
        } finally {
            setUploading(false);

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
