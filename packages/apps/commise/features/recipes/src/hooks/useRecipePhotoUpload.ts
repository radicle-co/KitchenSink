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
 * **Single-flight.** `upload` is a de-facto mutex guarded by the `AbortController` ref: a non-null
 * controller means an upload is already in flight, and a concurrent second `upload(...)` call starts
 * nothing and resolves {@link RecipePhotoUploadOutcome}'s `busy` arm rather than interleaving a second
 * presign→PUT→confirm sequence against the same `uploading`/`errorMessage` state.
 *
 * ⚠️ IT IS NO LONGER WHERE B24 IS FIXED, and saying so was stale. B24 was "a second pick mid-upload must
 * not start a second concurrent sequence": the web leaf's `<input type="file">` stayed enabled, while mobile
 * gated it at its Pressable. That requirement MIGRATED to `useRecipePhotoUploadQueue`, which satisfies it by
 * ENQUEUEING — a tap during an upload is now welcomed, which is the queue's whole reason to exist. This
 * mutex is therefore a defensive invariant against queue re-entry, not the user-facing fix; the queue is
 * the only caller, and it awaits each verdict before driving the next file.
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
/**
 * What one `upload` attempt AMOUNTED TO — a resolved value, deliberately not a status flag to be watched.
 *
 * ⛔ THE POINT: a consumer that needs a per-attempt verdict reads it HERE. `useRecipePhotoUploadQueue` used
 * to infer it from the FALLING EDGE of `uploading` and then consult `errorMessage`, which coupled its
 * scheduling to the exact moment this hook happened to flip a boolean. That coupling broke the day the hook
 * was briefly made a react-query mutation (status there propagates through the notify manager, asynchronously
 * and correctly) — the queue settled an attempt that had not started and marked a photo `ok` that never
 * uploaded. A value has no edge to mis-time.
 *
 * ⛔ `busy` IS LOAD-BEARING, not a formality. The single-flight no-op must resolve to neither `ok` — that is
 * the original defect class, a photo reported uploaded that never was — nor `failed`, which would condemn a
 * perfectly good file. A refusal to START is ABSENCE, not dissent: ADR-0026 §3's `single-engine` ≠ `differ`,
 * one layer over. A caller seeing `busy` should leave the file queued and let the next commit re-drive it.
 *
 * ⚠️ `failed` CARRIES the copy rather than making the caller read `errorMessage` back, which is what keeps
 * the verdict self-contained; this hook still knows no strings of its own (see the i18n note above).
 */
export type RecipePhotoUploadOutcome =
    | { readonly status: 'ok' }
    | { readonly status: 'failed'; readonly errorMessage: string }
    | { readonly status: 'busy' };

export interface UseRecipePhotoUploadResult {
    /** True for the full duration of an in-flight presign → PUT → confirm sequence. */
    readonly uploading: boolean;
    /** The caller-supplied localized error message from the most recent failed attempt, else `undefined`. */
    readonly errorMessage: string | undefined;
    /**
     * Run the presign → PUT → confirm sequence for an already-acquired file, resolving what it amounted to.
     *
     * NEVER REJECTS: every failure resolves as {@link RecipePhotoUploadOutcome}'s `failed` arm (and is also
     * reflected in `errorMessage`, for the leaves that render it). An upload already in flight resolves
     * `busy` and starts nothing — see the single-flight contract above.
     */
    readonly upload: (file: RecipePhotoUploadFile) => Promise<RecipePhotoUploadOutcome>;
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
        async (file: RecipePhotoUploadFile): Promise<RecipePhotoUploadOutcome> => {
            if (abortControllerRef.current !== null) {
                // An upload is already in flight, so this call starts nothing and is NOT interleaved with
                // the first. It resolves `busy` rather than silently resolving: a caller that cannot tell
                // "refused to start" from "succeeded" is the defect class this whole type exists to close.
                return { status: 'busy' };
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

                return { status: 'ok' };
            } catch {
                if (mountedRef.current) {
                    setErrorMessage(uploadErrorMessage);
                }

                // Resolved, never rethrown — the leaves render `errorMessage` and the queue reads this
                // verdict, so a rejection here would only give both of them an exception to swallow.
                return { status: 'failed', errorMessage: uploadErrorMessage };
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
