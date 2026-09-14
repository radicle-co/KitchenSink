'use client';

/**
 * @module @commise/features-recipes/hooks — the DRAFT-PHOTO seam (U33, owner ruling 2026-08-25): photos
 * behave like every other field, held in the draft until the recipe exists and handed to the upload queue by an
 * explicit {@link UseRecipeDraftPhotosResult.flush}.
 *
 * **What it replaces.** `RecipePhotoUploaderContainer` takes a REQUIRED `recipeId` and keys every operation
 * on it, so before this the create path could show no uploader at all — it rendered "Save this recipe
 * first". Moving that notice onto step 1 would have greeted every new recipe with a disabled control, which
 * is the outcome the ruling refuses. A pick is instead recorded in the DRAFT, and handed to the queue when
 * an id appears.
 *
 * **The hand-off is an EVENT, issued by the create mutation's success — not an effect keyed on the id.** Only
 * the create routes use this hook; the edit routes already have an id and enqueue straight into their uploader,
 * so there was never "one rule" across create and edit to preserve. The id arrives from our own mutation after
 * the cook presses Publish, which is the case React places in the event handler. The effect form needed an
 * idempotence set and a `set-state-in-effect` suppression, and it was safe against a double enqueue only by
 * accident. `onSuccess` fires once per success, and `flush` removes what it hands over, so neither is needed.
 *
 * ⚠️ **`flush` reads the draft as of the render that issued the create.** The caller's `onSuccess` closure was
 * captured when Publish was pressed, so a pick added or removed while the create is in flight would be missed
 * or uploaded anyway. The composing container therefore locks photo add and remove while the create is pending.
 *
 * ⛔ **The BINARY is deliberately NOT draft state.** `recipeFormValuesEqual` — the discard guard's dirty
 * test — is a `JSON.stringify` comparison whose own contract says it is EXACT because every field is plain
 * data. A `Blob` serialises to `{}`, so two different pending photos would compare EQUAL and swapping one
 * for another would be reported as "no unsaved changes". The bytes live HERE, keyed by the descriptor's
 * `localId`; only the JSON-comparable descriptor reaches `RecipeFormValues`.
 *
 * ⛔ **Every draft write is an UPDATER.** A whole-object `{ ...values, photos }` write from a render snapshot
 * overwrites any other updater queued in the same batch — the ingredient status poller writes that way — so a
 * title typed or a line resolved beside a pick or a flush would silently revert.
 *
 * ⚠️ **THE FAILURE MODE THIS SEAM CREATES, AND WHERE IT IS ANSWERED.** The create endpoint takes JSON and
 * photos go through a separate presign/PUT/confirm mutation, so a save is create-THEN-upload: a create can
 * succeed while an upload fails, leaving a recipe whose photo did not land. This hook does NOT answer that —
 * it deliberately hands off to `useRecipePhotoUploadQueue`, whose statechart already models per-file
 * `queued | uploading | ok | failed` with a per-item message and a Retry, and whose failures are therefore
 * SURFACED and RETRYABLE rather than silent. The composing container is what must not navigate away while
 * items are still in flight; see `RecipeCreateContainer`'s own note on the post-save flush panel.
 */
import { useCallback, useState } from 'react';

import { fillTemplate } from '../list/model.js';
import { admitPhotoBatch, type RecipePhotoAdmission } from '../photos/model.js';
import type { RecipeFormValues } from '../form/values.js';

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
    /** The controlled draft. */
    readonly values: RecipeFormValues;
    /**
     * Update the draft from its CURRENT value — the updater form of the container's `useState` setter.
     *
     * ⛔ An updater, not a replacement: see the module doc on why a snapshot write loses concurrent edits.
     */
    readonly setValues: (update: (current: RecipeFormValues) => RecipeFormValues) => void;
    /**
     * Hand files to the upload queue (`useRecipePhotoUploadQueue`'s `enqueue`), which admits them whole or refuses
     * them whole.
     *
     * ⛔ Typed to RETURN the verdict, not `void`. A verdict-returning function is assignable to a `void` one, so
     * a `void` option would let the flush ignore a refusal and clear files the queue never took — the silent
     * loss this seam exists to prevent.
     */
    readonly enqueue: (files: readonly DraftPhotoFlush[]) => RecipePhotoAdmission;
    /** How many more photos the draft may take, and the copy shown when a pick exceeds it. */
    readonly capacity: DraftPhotoCapacity;
}

/** What {@link useRecipeDraftPhotos} gives a container. */
export interface UseRecipeDraftPhotosResult {
    /**
     * Record one or more chosen files in the draft. Nothing uploads until {@link flush}.
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
    /**
     * Hand every held pick to the upload queue — issued once, from the create mutation's success, when the recipe
     * first has an id.
     *
     * Handed-over picks leave the draft and release their bytes. A refusal hands over NOTHING: the picks stay,
     * `capError` is set, and the verdict is returned. A descriptor this hook holds no bytes for (a restored draft)
     * is never reported handed over — it stays in the draft, where the cook can see it and remove it.
     *
     * @returns The queue's verdict, or `accepted` when nothing was held.
     * @sideEffect Enqueues uploads.
     */
    readonly flush: () => RecipePhotoAdmission;
}

/** Monotonic within a session — the descriptor's identity, and the key the byte map is keyed by. */
let nextLocalId = 0;

/**
 * Hold a draft's chosen-but-not-yet-uploaded photos until the caller flushes them to the upload queue.
 *
 * @param options - The controlled draft and its updater, the queue's `enqueue`, and the remaining capacity.
 * @returns `addPhotos`/`removePhoto` for the picker, `previewFor` for the grid, and `flush` for the create's success.
 * @sideEffect Stores the chosen files' bytes until they are flushed or removed.
 */
export function useRecipeDraftPhotos(options: UseRecipeDraftPhotosOptions): UseRecipeDraftPhotosResult {
    const { values, setValues, enqueue, capacity } = options;
    const [picks, setPicks] = useState<ReadonlyMap<string, DraftPhotoPick>>(new Map());
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
            const admission = admitPhotoBatch(capacity.remaining, chosen.length);

            if (admission.status === 'overCap') {
                setCapError(fillTemplate(capacity.overCapMessage, { count: admission.remaining }));

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

            setValues((current) => ({
                ...current,
                photos: [
                    ...current.photos,
                    ...withIds.map(({ localId, photoPick }) => ({
                        localId,
                        fileName: photoPick.fileName,
                        contentType: photoPick.contentType,
                        fileSize: photoPick.fileSize,
                    })),
                ],
            }));
        },
        [setValues, capacity],
    );

    const removePhoto = useCallback(
        (localId: string): void => {
            setPicks((current) => {
                const next = new Map(current);

                next.delete(localId);

                return next;
            });
            setCapError(undefined);
            setValues((current) => ({
                ...current,
                photos: current.photos.filter((photo) => photo.localId !== localId),
            }));
        },
        [setValues],
    );

    const previewFor = useCallback((localId: string): string | undefined => picks.get(localId)?.previewUri, [picks]);

    const flush = useCallback((): RecipePhotoAdmission => {
        // Only descriptors this hook holds bytes for can be handed over. One without (a restored draft) is left in
        // the draft rather than reported as handed over — deleting it here would lose the photo with no trace.
        const files = values.photos.flatMap((photo): DraftPhotoFlush[] => {
            const stored = picks.get(photo.localId);

            return stored === undefined ? [] : [{ ...stored, localId: photo.localId }];
        });

        if (files.length === 0) {
            return { status: 'accepted' };
        }

        // Nothing leaves the draft unless the queue took it. The draft's own capacity check makes a refusal here a
        // race rather than a normal path, but that holds only while two separately computed numbers agree — so the
        // verdict is read, not assumed.
        const admission = enqueue(files);

        if (admission.status === 'overCap') {
            setCapError(fillTemplate(capacity.overCapMessage, { count: admission.remaining }));

            return admission;
        }

        const handedOver = new Set(files.map((file) => file.localId));

        setCapError(undefined);
        setPicks((current) => new Map([...current].filter(([localId]) => !handedOver.has(localId))));
        // Once a photo is the queue's responsibility it is no longer an unsaved edit, and leaving it here would make
        // the discard guard warn about work that is already under way.
        setValues((current) => ({
            ...current,
            photos: current.photos.filter((photo) => !handedOver.has(photo.localId)),
        }));

        return admission;
    }, [values.photos, picks, enqueue, capacity.overCapMessage, setValues]);

    return { addPhotos, capError, removePhoto, previewFor, flush };
}
