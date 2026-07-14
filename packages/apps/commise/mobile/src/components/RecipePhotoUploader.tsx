/**
 * Recipe photo uploader (mobile, T067, wireframe step 4). The container that turns the shared, presentational
 * {@link RecipePhotoManager} block (its native leaf) into a working photo surface: it reads the recipe's
 * photos from the query cache, supplies the native image-picker button as the block's `addControl`, and owns
 * the direct-to-S3 upload orchestration the block deliberately stays free of.
 *
 * Upload flow, on a picked asset: mint a presigned URL (`useCreatePhotoUploadUrl`), read the asset's bytes as
 * a Blob and `PUT` them straight to S3, then confirm (`useConfirmPhotoUpload`) so the service records the
 * photo — driving the block's `uploading` busy state and, on any failure, a localized `errorMessage`. Removal
 * delegates to `useDeleteRecipePhoto`, busying just the row whose deletion is in flight. Cross-platform peer
 * of the web container; the picker (`expo-image-picker`) and the real S3 upload require on-device verification.
 */
import { RecipePhotoManager } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import {
    useConfirmPhotoUpload,
    useCreatePhotoUploadUrl,
    useDeleteRecipePhoto,
    useRecipePhotos,
} from '@kitchensink/recipe-service-client/hooks';
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
 * @returns The photo manager block wired to the native picker and the upload/remove mutations.
 */
export function RecipePhotoUploader({ recipeId }: RecipePhotoUploaderProps): JSX.Element {
    const { recipePhotos: t } = useMessages(mobileMessages);
    const photosQuery = useRecipePhotos(recipeId);
    const createUploadUrl = useCreatePhotoUploadUrl();
    const confirm = useConfirmPhotoUpload();
    const deletePhoto = useDeleteRecipePhoto();

    const [uploading, setUploading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

    const photos = photosQuery.data ?? [];
    // The delete mutation carries its target in `variables`; busy only that row while its deletion is pending.
    const removingPhotoId = deletePhoto.isPending ? (deletePhoto.variables?.photoId ?? null) : null;

    // Pick an image, then presign → PUT-to-S3 → confirm. Any failure clears the busy state and shows a
    // localized error; a canceled pick is a silent no-op.
    const addPhoto = async (): Promise<void> => {
        // Load the native picker lazily (on first use). `expo-image-picker` pulls in `expo-modules-core`,
        // which can only be evaluated inside the native runtime — deferring the import keeps it out of the
        // module graph until the user actually taps Add, and out of environments that lack that runtime.
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

        setErrorMessage(undefined);
        setUploading(true);

        try {
            const { uploadUrl, key } = await createUploadUrl.mutateAsync({
                id: recipeId,
                request: { fileName, contentType, fileSize },
            });

            const blob = await (await fetch(asset.uri)).blob();
            const putResponse = await fetch(uploadUrl, {
                method: 'PUT',
                body: blob,
                headers: { 'Content-Type': contentType },
            });

            if (!putResponse.ok) {
                throw new Error(`Photo upload failed with status ${putResponse.status}`);
            }

            await confirm.mutateAsync({ id: recipeId, request: { key, contentType } });
        } catch {
            setErrorMessage(t.uploadError);
        } finally {
            setUploading(false);
        }
    };

    const removePhoto = (photoId: string): void => {
        setErrorMessage(undefined);
        deletePhoto.mutate({ id: recipeId, photoId }, { onError: () => setErrorMessage(t.removeError) });
    };

    const addControl = (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.addLabel}
            accessibilityState={{ busy: uploading, disabled: uploading }}
            disabled={uploading}
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
