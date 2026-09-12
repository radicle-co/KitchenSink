import { useMutation } from '@tanstack/react-query';

import type { PhotoUploadUrlRequest } from '../types.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/** `POST /api/v1/recipes/{id}/photos/upload-url` — mint a presigned upload URL (no cache to invalidate). */
export function useCreatePhotoUploadUrl() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (vars: { id: string; request: PhotoUploadUrlRequest }) =>
            client.createPhotoUploadUrl(vars.id, vars.request),
    });
}
