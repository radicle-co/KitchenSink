'use client';

/**
 * @module @commise/features-recipes/hooks — the DRAFT-PHOTO seam (U33, owner ruling 2026-08-25): photos
 * behave like every other field, and flush to the upload queue the moment the recipe first has an id.
 *
 * **What it replaces.** `RecipePhotoUploaderContainer` takes a REQUIRED `recipeId` and keys every operation
 * on it, so before this the create path could show no uploader at all — it rendered "Save this recipe
 * first". Moving that notice onto step 1 would have greeted every new recipe with a disabled control, which
 * is the outcome the ruling refuses. A pick is instead recorded in the DRAFT, and handed to the queue when
 * an id appears.
 *
 * **One rule, not two paths.** The flush condition is `recipeId !== null && there are pending picks`, and it
 * is the same on create and on edit — on edit the id is already there, so the flush is immediate. That is
 * why "a photo chosen before the first save survives it" and "a photo chosen while editing uploads now" are
 * the same tested behaviour rather than two code paths that can disagree.
 *
 * ⛔ **The BINARY is deliberately NOT draft state.** `recipeFormValuesEqual` — the discard guard's dirty
 * test — is a `JSON.stringify` comparison whose own contract says it is EXACT because every field is plain
 * data. A `Blob` serialises to `{}`, so two different pending photos would compare EQUAL and swapping one
 * for another would be reported as "no unsaved changes". The bytes live HERE, keyed by the descriptor's
 * `localId`; only the JSON-comparable descriptor reaches `RecipeFormValues`.
 *
 * ⛔ **Enqueue is IDEMPOTENT BY LOCAL ID.** The effect clears the flushed picks from the draft in the same
 * tick it enqueues them, but a React state update is not a synchronous write: StrictMode's deliberate
 * double-invoke, and any re-render landing before the clear applies, both re-run the effect against the SAME
 * `values.photos`. Without identity tracking that uploads the file twice — two photos on the recipe, one of
 * them a duplicate the cook never chose. `flushed` is that identity set.
 *
 * ⚠️ **THE FAILURE MODE THIS SEAM CREATES, AND WHERE IT IS ANSWERED.** The create endpoint takes JSON and
 * photos go through a separate presign/PUT/confirm mutation, so a save is create-THEN-upload: a create can
 * succeed while an upload fails, leaving a recipe whose photo did not land. This hook does NOT answer that —
 * it deliberately hands off to `useRecipePhotoUploadQueue`, whose statechart already models per-file
 * `queued | uploading | ok | failed` with a per-item message and a Retry, and whose failures are therefore
 * SURFACED and RETRYABLE rather than silent. The composing container is what must not navigate away while
 * items are still in flight; see `RecipeCreateContainer`'s own note on the post-save flush panel.
 */
import { useCallback, useEffect, useState } from 'react';

import { fillTemplate } from '../list/model.js';
import type { RecipeFormValues } from '../form/model.js';

/** One file a cook has chosen, as the picker hands it over — bytes included. */
export interface DraftPhotoPick {
    /** The file's bytes, for the direct-to-S3 PUT. Never enters {@link RecipeFormValues}. */
    readonly blob: Blob;
    /** The chosen file's name. */
    readonly fileName: string;
    /** The chosen file's MIME type as the picker reported it (the service re-detects it from magic bytes). */
    readonly contentType: string;
    /** The chosen file's size in bytes, judged against the upload cap before any network call. */
    readonly fileSize: number;
    /** A local preview URI, when the platform's picker produced one. */
    readonly previewUri?: string;
}

/** One file being handed to the upload queue — a {@link DraftPhotoPick} plus the identity it flushed under. */
export interface DraftPhotoFlush extends DraftPhotoPick {
    /** The draft descriptor's `localId`, so a caller can correlate a queue item back to the pick. */
    readonly localId: string;
}

/**
 * How many photos the draft may still accept, and what the cook is told when a pick exceeds it.
 *
 * ⛔ **This exists because the cap could be BREACHED IN ONE PICK, and the breach was silent.** The add
 * control is hidden once the cap is reached, which bounds picks BETWEEN each other but not WITHIN one: a
 * `<input multiple>` (or a future multi-select picker) lets a cook choose twelve files at once. Every
 * descriptor was then recorded, but `useRecipePhotoUploadQueue.enqueue` accepts only what fits and DROPS the
 * rest — while the flush marked all twelve handed over and cleared them from the draft. Two photos vanished:
 * not uploaded, not queued, not surfaced, and the create then navigated away as if everything had landed.
 */
export interface DraftPhotoCapacity {
    /** How many more photos may be added — confirmed photos and in-flight uploads already subtracted. */
    readonly remaining: number;
    /** Told to the cook when a pick is larger than {@link remaining}; contains `{count}`. */
    readonly overCapMessage: string;
}

/** Options for {@link useRecipeDraftPhotos}. */
export interface UseRecipeDraftPhotosOptions {
    /** The recipe's id once it exists, or `null` while it does not (a create that has not saved yet). */
    readonly recipeId: string | null;
    /** The controlled draft. */
    readonly values: RecipeFormValues;
    /** Replace the draft — the same setter every other field reports through. */
    readonly onChange: (next: RecipeFormValues) => void;
    /** Hand files to the upload queue (`useRecipePhotoUploadQueue`'s `enqueue`). */
    readonly enqueue: (files: readonly DraftPhotoFlush[]) => void;
    /** How many more photos the draft may take, and the copy shown when a pick exceeds it. */
    readonly capacity: DraftPhotoCapacity;
}

/** What {@link useRecipeDraftPhotos} gives a container. */
export interface UseRecipeDraftPhotosResult {
    /**
     * Record one or more chosen files. They upload immediately if the recipe exists, else on its first save.
     *
     * A pick larger than the remaining capacity is REFUSED WHOLE, not truncated: taking the first two of five
     * and dropping three is the silent loss this rejects, and a cook who chose five wants to know that only
     * two fit rather than to discover it later on the recipe.
     */
    readonly addPhotos: (picks: readonly DraftPhotoPick[]) => void;
    /** Set when the last pick exceeded the cap; cleared by the next accepted pick. */
    readonly capError: string | undefined;
    /**
     * Drop a pick the cook has changed their mind about, before it reaches the queue (U33).
     *
     * ⛔ Without this, a photo chosen before the first save was the ONE field of the editor that could not be
     * changed: the wrong picture rode along to the create and the only way out was abandoning the recipe.
     * "Photos behave like every other field" has to include un-choosing one. It also releases the bytes,
     * which would otherwise be held for the lifetime of the draft.
     */
    readonly removePhoto: (localId: string) => void;
    /**
     * The local preview URI a pick was recorded with, if the platform's picker supplied one.
     *
     * The bytes are held here, so this is the only place that can answer it — and without it a draft cell
     * could render nothing but the word "Queued", which is no help at all to a cook choosing between two
     * pictures. Returns `undefined` for a descriptor with no stored pick (a restored draft).
     */
    readonly previewFor: (localId: string) => string | undefined;
}

/** Monotonic within a session — the descriptor's identity, and the key the byte map is keyed by. */
let nextLocalId = 0;

/**
 * Hold a draft's chosen-but-not-yet-uploaded photos, and flush them when the recipe first has an id.
 *
 * @param options - The recipe id (or `null`), the controlled draft and its setter, and the queue's `enqueue`.
 * @returns `addPhotos`, the one way a picker reports a chosen file.
 * @sideEffect Stores the chosen files' bytes for the lifetime of the draft, and enqueues uploads.
 */
export function useRecipeDraftPhotos(options: UseRecipeDraftPhotosOptions): UseRecipeDraftPhotosResult {
    const { recipeId, values, onChange, enqueue, capacity } = options;
    const [picks, setPicks] = useState<ReadonlyMap<string, DraftPhotoPick>>(new Map());
    const [flushed, setFlushed] = useState<ReadonlySet<string>>(new Set());
    const [capError, setCapError] = useState<string | undefined>(undefined);

    const addPhotos = useCallback(
        (chosen: readonly DraftPhotoPick[]): void => {
            if (chosen.length === 0) {
                return;
            }

            // ⛔ REFUSED WHOLE, never truncated — see `addPhotos`'s own doc. `capacity.remaining` already has
            // the confirmed photos and the in-flight uploads subtracted, so this is the only place a pick's
            // OWN size is judged; the add control's `isAtPhotoCap` gate bounds picks between each other and
            // cannot bound one.
            if (chosen.length > capacity.remaining) {
                setCapError(fillTemplate(capacity.overCapMessage, { count: capacity.remaining }));

                return;
            }

            setCapError(undefined);

            const withIds = chosen.map((photoPick) => {
                nextLocalId += 1;

                return { localId: `draft-photo-${nextLocalId}`, photoPick };
            });

            setPicks((current) => {
                const next = new Map(current);

                for (const { localId, photoPick } of withIds) {
                    next.set(localId, photoPick);
                }

                return next;
            });

            onChange({
                ...values,
                photos: [
                    ...values.photos,
                    ...withIds.map(({ localId, photoPick }) => ({
                        localId,
                        fileName: photoPick.fileName,
                        contentType: photoPick.contentType,
                        fileSize: photoPick.fileSize,
                    })),
                ],
            });
        },
        [onChange, values, capacity],
    );

    useEffect(() => {
        if (recipeId === null || values.photos.length === 0) {
            return;
        }

        // Identity-filtered, not merely "the draft is non-empty": see the module doc on why a re-run against
        // the same `values.photos` is the ordinary case rather than the exception.
        const pending = values.photos.filter((photo) => !flushed.has(photo.localId));

        if (pending.length === 0) {
            return;
        }

        const files = pending
            .map((photo) => {
                const stored = picks.get(photo.localId);

                return stored === undefined ? undefined : { ...stored, localId: photo.localId };
            })
            .filter((file): file is DraftPhotoFlush => file !== undefined);

        if (files.length > 0) {
            enqueue(files);
        }

        setFlushed((current) => {
            const next = new Set(current);

            for (const photo of pending) {
                next.add(photo.localId);
            }

            return next;
        });

        // Drop the flushed descriptors from the draft: once a photo is the queue's responsibility it is no
        // longer an unsaved edit, and leaving it here would make the discard guard warn about work that is
        // already under way.
        onChange({ ...values, photos: values.photos.filter((photo) => flushed.has(photo.localId)) });
    }, [recipeId, values, flushed, picks, enqueue, onChange]);

    const removePhoto = useCallback(
        (localId: string): void => {
            setPicks((current) => {
                const next = new Map(current);

                next.delete(localId);

                return next;
            });
            setCapError(undefined);
            onChange({ ...values, photos: values.photos.filter((photo) => photo.localId !== localId) });
        },
        [onChange, values],
    );

    const previewFor = useCallback((localId: string): string | undefined => picks.get(localId)?.previewUri, [picks]);

    return { addPhotos, capError, removePhoto, previewFor };
}
