/**
 * Headless-hook seam (CP-6/B4, P3/B24) — the shared recipe-photo upload orchestration extracted from the
 * two near-duplicate uploader leaves (web `RecipePhotoUploaderContainer.tsx`, mobile
 * `RecipePhotoUploader.tsx`). Owns the `uploading`/`errorMessage` transient state and drives the
 * presign → direct-PUT → confirm sequence: `useCreatePhotoUploadUrl` (mint a presigned S3 URL), a raw
 * `fetch` PUT of the file bytes, then `useConfirmPhotoUpload` — which ALREADY invalidates the recipe
 * photo/detail/list/search projections on success (`packages/clients/recipe-service/src/hooks.ts`). This
 * hook does NOT reimplement that invalidation; it only calls the existing mutation, preserving the single
 * call site.
 *
 * **Single-flight (closes B24, the double-submit race).** `upload` is a de-facto mutex guarded by the
 * `AbortController` ref: a non-null controller means an upload is already in flight, and a concurrent
 * second `upload(...)` call is a silent no-op rather than interleaving a second presign→PUT→confirm
 * sequence against the same `uploading`/`errorMessage` state. Before this hook existed, the web leaf had
 * NO such guard (its `<input type="file">` stayed enabled through an in-flight upload, so a second pick
 * mid-upload started a second concurrent `handleFileChange`); mobile already gated the equivalent race at
 * its Pressable (`disabled={uploading}`). Both leaves now get the guard for free from this one hook — the
 * race is closed by construction, not by a DOM/prop convention either platform has to remember to apply.
 *
 * **Abort-on-unmount.** The same `AbortController` is passed as the PUT `fetch`'s `signal` and aborted in
 * an unmount cleanup effect, so an in-flight PUT is cancelled the instant the consuming component
 * disappears (e.g. the user navigates away mid-upload). A separate `mountedRef` boolean guards every
 * post-await `setState` call, so a late `confirm` resolution (or a rejected/aborted PUT) can never write
 * state into an unmounted component. These two refs are the only refs in this hook — everything else is
 * ordinary `useState`.
 *
 * **i18n stays at the leaf.** This hook is deliberately i18n-agnostic: it does not know the localized
 * upload-error copy. Callers pass their own already-localized `uploadErrorMessage` (e.g.
 * `recipes.photos.uploadError` on web, `t.uploadError` on mobile); the hook stores exactly that string in
 * `errorMessage` on failure and clears it to `undefined` on every new attempt. This keeps each platform's
 * existing user-visible copy byte-for-byte identical while the hook itself carries no strings.
 *
 * Platform-agnostic: no DOM or `expo-*` imports. Each leaf acquires its own file bytes (a web `File` —
 * itself a `Blob` — from the `<input>` change event, or `(await fetch(asset.uri)).blob()` from
 * `expo-image-picker` on mobile) and calls `upload` with the acquired `Blob` + metadata.
 *
 * @pattern Headless hook (Template Method) — the presign → PUT → confirm sequence is fixed here and each
 *     leaf supplies only the bytes and its own localized error copy.
 * @pattern Adapter over `AbortController`, doing double duty as the single-flight Mutex — a genuinely
 *     external, non-declarative object is the ref rule's carve-out, and "non-null IS an upload in flight"
 *     is why the guard and the abort handle are ONE ref rather than a ref plus a boolean.
 */
import { useConfirmPhotoUpload, useCreatePhotoUploadUrl } from '@kitchensink/recipe-service-client/hooks';
import { useCallback, useEffect, useRef, useState } from 'react';

/** The file bytes + metadata a leaf has already acquired, ready to upload. */
export interface RecipePhotoUploadFile {
    /** The raw file bytes (a web `File` — itself a `Blob` — or a mobile `Blob` read from the asset URI). */
    readonly blob: Blob;
    /** The original file name, sent to the presign step. */
    readonly fileName: string;
    /** The MIME type, sent to both the presign step and the S3 PUT's `Content-Type` header. */
    readonly contentType: string;
    /** The byte size, sent to the presign step (the server enforces its own size cap). */
    readonly fileSize: number;
}

/** The state + action {@link useRecipePhotoUpload} exposes to a leaf. */
export interface UseRecipePhotoUploadResult {
    /** True for the full duration of an in-flight presign → PUT → confirm sequence. */
    readonly uploading: boolean;
    /** The caller-supplied localized error message from the most recent failed attempt, else `undefined`. */
    readonly errorMessage: string | undefined;
    /**
     * Run the presign → PUT → confirm sequence for an already-acquired file. A silent no-op if an upload
     * is already in flight — see the single-flight contract above.
     */
    readonly upload: (file: RecipePhotoUploadFile) => Promise<void>;
}

/**
 * The shared recipe-photo upload orchestration (single-flight, abort-on-unmount).
 *
 * @param recipeId - The recipe whose photos are being uploaded to.
 * @param uploadErrorMessage - The caller's own localized copy for a failed upload; stored verbatim in
 *   `errorMessage` on failure (see the i18n-agnostic contract above).
 * @returns The `uploading`/`errorMessage` state plus the single-flight `upload` action.
 */
export function useRecipePhotoUpload(recipeId: string, uploadErrorMessage: string): UseRecipePhotoUploadResult {
    const createUploadUrl = useCreatePhotoUploadUrl();
    const confirmUpload = useConfirmPhotoUpload();

    const [uploading, setUploading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

    // `abortControllerRef` does double duty: non-null IS the single-flight guard (an upload is already in
    // flight), and it is the abort-on-unmount handle passed as the PUT's `signal`. `mountedRef` gates every
    // post-await setState so a late resolution can't write into an unmounted component.
    const abortControllerRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
            abortControllerRef.current?.abort();
        };
    }, []);

    const upload = useCallback(
        async (file: RecipePhotoUploadFile): Promise<void> => {
            if (abortControllerRef.current !== null) {
                // B24 guard: an upload is already in flight — a concurrent second call is a silent no-op,
                // never interleaved with the first.
                return;
            }

            const controller = new AbortController();
            abortControllerRef.current = controller;
            setUploading(true);
            setErrorMessage(undefined);

            try {
                const { uploadUrl, key } = await createUploadUrl.mutateAsync({
                    id: recipeId,
                    request: { fileName: file.fileName, contentType: file.contentType, fileSize: file.fileSize },
                });

                const response = await fetch(uploadUrl, {
                    method: 'PUT',
                    body: file.blob,
                    headers: { 'Content-Type': file.contentType },
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw new Error(`Photo upload failed with status ${response.status}`);
                }

                await confirmUpload.mutateAsync({ id: recipeId, request: { key, contentType: file.contentType } });
            } catch {
                if (mountedRef.current) {
                    setErrorMessage(uploadErrorMessage);
                }
            } finally {
                abortControllerRef.current = null;

                if (mountedRef.current) {
                    setUploading(false);
                }
            }
        },
        [recipeId, uploadErrorMessage, createUploadUrl, confirmUpload],
    );

    return { uploading, errorMessage, upload };
}
