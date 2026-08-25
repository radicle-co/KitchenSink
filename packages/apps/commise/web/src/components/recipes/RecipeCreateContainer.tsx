'use client';

/**
 * Container for the recipe-create route (w3/e1,e2 on the 4-step `Wizard` shell; U32/U33/U34). Owns the
 * editable {@link RecipeFormValues} (seeded blank via `defaultRecipeFormValues`) AND the wizard's own
 * step/draft/publish navigation — unlike the edit route, create has no seed/conflict/version concerns, so it
 * does not use `useRecipeEditor` (that hook's machinery is edit-only); this container reimplements the SAME
 * step-gating (`canAdvanceFromStep`/`stepErrorsFor`) and the SAME draft-vs-publish floor
 * (`stepErrorsFor(values, 1)` for a draft, `validateRecipeForm` for a publish) the hook uses for edit, so the
 * two flows cannot drift on what "valid enough to advance/draft/publish" means.
 *
 * ⛔ **PHOTOS ARE A FIELD NOW, and the create path is why (U33, owner ruling 2026-08-25).** This container
 * used to render "Save this recipe first — you can add photos from its edit page" where a control should
 * have been, because `RecipePhotoUploaderContainer` takes a REQUIRED `recipeId`. A pick is now recorded in
 * the DRAFT (`useRecipeDraftPhotos`) and flushed into the upload queue the moment the create mutation
 * returns an id — the SAME rule the edit route runs, where the id is simply already there.
 *
 * ⛔ **THE FAILURE MODE THAT SEAM CREATES, AND THE OUTCOME CHOSEN FOR IT.** The create endpoint takes JSON
 * and photos go through a separate presign → PUT → confirm mutation, so a save is create-THEN-upload: the
 * create can succeed while an upload fails, leaving a recipe whose photo did not land. The two calls must
 * therefore NOT look like one to the cook. The outcome is **surface and retry, with an explicit discard**:
 *
 *   - a successful create does NOT navigate away while any picked photo is still queued, uploading, or
 *     failed — navigating would unmount the queue mid-flight and lose the upload silently, which is the very
 *     failure being designed away;
 *   - the recipe IS saved by then, and the surface says so: a `role="status"` line reports the photos still
 *     in flight, and the shared `RecipePhotoManager` renders each file's own `queued`/`uploading`/`failed`
 *     state with its message and its Retry;
 *   - when a file cannot be made to upload, the cook may leave anyway through an explicit "finish without
 *     them" control. Discarding is a DECISION they take, never an outcome they are handed;
 *   - once every file reaches `ok`, navigation happens on its own.
 *
 * ⚠️ **Auto-save is deliberately NOT wired on this route.** An unattended write needs an
 * `expectedVersion` to be safe, and a recipe that does not exist yet has no version to send — the first
 * write here is a POST, not a CAS-guarded PATCH. Auto-save begins on the edit route, once there is a version
 * token to carry. Firing a create on a timer would also mint a recipe from a form the cook has not finished
 * and may abandon.
 */
import {
    canAdvanceFromStep,
    defaultRecipeFormValues,
    isAtPhotoCap,
    pendingIngredientIds,
    RecipeBasicsFields,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipePhotoManager,
    RecipeReviewFields,
    RecipeVisibilityField,
    setIngredientStatusById,
    stepErrorsFor,
    toCreateRecipeInput,
    useDiscardGuard,
    validateRecipeForm,
    visibleQueueItems,
    Wizard,
} from '@commise/features-recipes';
import { MAX_RECIPE_PHOTOS } from '@kitchensink/recipe-core';
import type {
    RecipeFormErrors,
    RecipeFormIngredient,
    RecipeFormValues,
    RecipeWizardStep,
} from '@commise/features-recipes';
import { useRecipeDraftPhotos, useRecipePhotoUpload, useRecipePhotoUploadQueue } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { RecipeStatus, type FoodResolutionStatus } from '@kitchensink/recipe-core';
import { useCreateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FC } from 'react';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';
import { IngredientStatusPoller } from '@/components/recipes/IngredientStatusPoller';
import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeCreateContainer}. */
export interface RecipeCreateContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/**
 * The live recipe-create container.
 *
 * @param props - The active locale.
 * @returns The wired 4-step create wizard, or the post-save photo-flush surface.
 */
export const RecipeCreateContainer: FC<RecipeCreateContainerProps> = ({ locale }) => {
    const router = useRouter();
    const { recipes } = useMessages(webMessages);
    const createRecipe = useCreateRecipe();
    const [values, setValues] = useState<RecipeFormValues>(defaultRecipeFormValues);
    const [errors, setErrors] = useState<RecipeFormErrors>({});
    const [step, setStep] = useState<RecipeWizardStep>(1);
    /** The created recipe's id, once the POST has returned. `null` until then — the flush's own trigger. */
    const [createdId, setCreatedId] = useState<string | null>(null);

    const listRoute = `/${locale}/recipes` as Route;
    const detailRoute = createdId === null ? listRoute : (`/${locale}/recipes/${createdId}` as Route);

    // The upload queue is created UNCONDITIONALLY (Rules of Hooks) but is only ever fed once `createdId` is
    // set, because `useRecipeDraftPhotos` holds every pick until then. `''` is therefore never used as a
    // recipe id on any request — the hook's `upload` is unreachable while nothing has been enqueued.
    const uploader = useRecipePhotoUpload(createdId ?? '', recipes.photos.uploadError);
    const queue = useRecipePhotoUploadQueue(uploader, 0, {
        tooLarge: recipes.photos.tooLargeError,
        badType: recipes.photos.unsupportedTypeError,
    });

    const draftPhotos = useRecipeDraftPhotos({
        recipeId: createdId,
        values,
        onChange: setValues,
        enqueue: queue.enqueue,
        // ⛔ The cap has to be judged for the pick's OWN size, not only between picks. `<input multiple>`
        // lets a cook choose twelve files at once; the add control's `isAtPhotoCap` gate below cannot see
        // that, and the queue would have accepted what fit and dropped the rest while the draft cleared them
        // all. Both what is already held and what is already uploading are subtracted here.
        capacity: {
            remaining: Math.max(0, MAX_RECIPE_PHOTOS - values.photos.length - visibleQueueItems(queue.items).length),
            overCapMessage: recipes.form.photosOverCap,
        },
    });

    // ALLOWED REF (§3 — wraps a genuinely external, non-declarative system): the DOM `<input type="file">`.
    // Clearing `.value` after a pick is the only way to let the SAME file be picked again and still fire a
    // fresh `change` event; there is no declarative equivalent for resetting a file input.
    const inputRef = useRef<HTMLInputElement>(null);

    // ALLOWED REF (§3 — external-resource lifecycle, not state-in-a-ref): a browser Object URL leaks until
    // explicitly revoked, so tracking which are owed a revoke is bookkeeping for a system outside React's
    // model. It is never read to drive rendering — the cells render from the item's own `previewUri`.
    const previewUrlsRef = useRef<string[]>([]);

    useEffect(() => {
        const tracked = previewUrlsRef.current;

        return () => {
            for (const url of tracked) {
                URL.revokeObjectURL(url);
            }
        };
    }, []);

    const addIngredient = (line: RecipeFormIngredient): void => {
        setValues((current) => ({ ...current, ingredients: [...current.ingredients, line] }));
    };

    // Poll-after-add (data-model R5): a line added `PENDING` resolves in the background. The callback is
    // idempotent — `setIngredientStatusById` returns the same reference when the status is unchanged — so the
    // per-line pollers below cannot loop, and a line stops being polled the instant it leaves `PENDING`.
    const applyLineStatus = useCallback((ingredientId: string, status: FoodResolutionStatus): void => {
        setValues((current) => setIngredientStatusById(current, ingredientId, status));
    }, []);

    // The discard guard's baseline: `ready` from the very first render (the blank default IS the baseline),
    // re-captured once the create mutation succeeds.
    const isDirty = useDiscardGuard(values, { ready: true, justSaved: createRecipe.isSuccess });

    const pendingUploads = visibleQueueItems(queue.items);
    // ⛔ BOTH halves, and the DRAFT half is the one that is easy to miss. On the very render where `createdId`
    // first becomes non-null, `useRecipeDraftPhotos`'s flush effect has run and called `enqueue` — but
    // `enqueue` is a state update, so `queue.items` is STILL EMPTY on that same render. A check on the queue
    // alone would therefore see "nothing in flight" and navigate away in the exact window the picks are
    // mid-handover, unmounting the queue and losing every photo — on the create path this whole seam exists
    // for. `values.photos` is non-empty for precisely that render (its clear is the same un-applied update),
    // so reading both makes the window unrepresentable rather than merely unlikely.
    const awaitingPhotos = createdId !== null && (pendingUploads.length > 0 || values.photos.length > 0);

    // Navigate only once nothing is left in flight OR waiting to be handed over — see above, and this
    // module's doc on why a successful create does not leave immediately.
    useEffect(() => {
        if (createdId !== null && !awaitingPhotos) {
            router.push(`/${locale}/recipes/${createdId}` as Route);
        }
    }, [createdId, awaitingPhotos, router, locale]);

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
        draftPhotos.addPhotos(
            Array.from(event.target.files ?? []).map((file) => {
                // Minted here, and carried through the draft into the queue, so the cell shows the PHOTO
                // rather than only the word "Queued". A cook choosing between two pictures has to be able to
                // see which one they picked; the native picker gives an asset URI for free, and this is web's
                // equivalent. Revoked on unmount — bounded at the ten-photo cap, so a per-item revoke would
                // be bookkeeping for nothing.
                const previewUri = URL.createObjectURL(file);

                previewUrlsRef.current.push(previewUri);

                return { blob: file, fileName: file.name, contentType: file.type, fileSize: file.size, previewUri };
            }),
        );

        if (inputRef.current !== null) {
            inputRef.current.value = '';
        }
    };

    const persist = (nextErrors: RecipeFormErrors, status: RecipeStatus): void => {
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length > 0) {
            return;
        }

        createRecipe.mutate(toCreateRecipeInput(values, status), {
            // Records the id and STOPS. Navigation is the effect's job, once the photo queue has drained.
            onSuccess: (created) => setCreatedId(created.id),
        });
    };

    const saveDraft = (): void => persist(stepErrorsFor(values, 1), RecipeStatus.DRAFT);
    const publish = (): void => persist(validateRecipeForm(values), RecipeStatus.PUBLISHED);

    // The photos the cook has chosen but which have not reached the queue yet, rendered in the SAME grid the
    // queue's own items use so a pick looks identical before and after the recipe exists.
    const draftItems = values.photos.map((photo, index) => ({
        fileId: -(index + 1),
        fileName: photo.fileName,
        status: 'queued' as const,
        retryable: false,
        ...(draftPhotos.previewFor(photo.localId) === undefined
            ? {}
            : { previewUri: draftPhotos.previewFor(photo.localId) as string }),
    }));

    // The over-cap refusal takes precedence: it is the more recent thing the cook did, and it is the one that
    // explains why nothing appeared. An older upload failure still has its own per-file badge in the grid.
    const photoError = draftPhotos.capError ?? uploader.errorMessage;

    /**
     * Route a Remove to whichever layer owns that cell. Draft picks are injected with NEGATIVE `fileId`s
     * (`-(index + 1)`) precisely so they cannot collide with the queue's own monotonic positive ones — and so
     * that `queue.remove`, which filters by `fileId`, silently matches nothing for them. Without this
     * dispatch the Remove on a draft pick would appear to work and do nothing at all.
     */
    const removeQueueItem = (fileId: number): void => {
        if (fileId >= 0) {
            queue.remove(fileId);

            return;
        }

        const photo = values.photos[-fileId - 1];

        if (photo !== undefined) {
            draftPhotos.removePhoto(photo.localId);
        }
    };

    const photoManager = (
        <RecipePhotoManager
            photos={[]}
            onRemovePhoto={() => undefined}
            queueItems={[...draftItems, ...queue.items]}
            onRetryQueueItem={queue.retry}
            onRemoveQueueItem={removeQueueItem}
            uploading={uploader.uploading}
            {...(photoError === undefined ? {} : { errorMessage: photoError })}
            addControl={
                isAtPhotoCap(values.photos.length + visibleQueueItems(queue.items).length) ? undefined : (
                    <label className="inline-flex cursor-pointer items-center rounded-full border border-border px-4 py-2 text-body-sm font-medium text-charcoal transition hover:bg-pearl">
                        {recipes.photos.addLabel}
                        <input
                            ref={inputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            hidden
                            onChange={handleFileChange}
                        />
                    </label>
                )
            }
        />
    );

    if (awaitingPhotos) {
        return (
            <div className="flex flex-col gap-4 p-4">
                <p role="status">{recipes.form.photosFlushingNotice}</p>
                {photoManager}
                <button
                    type="button"
                    onClick={() => router.push(detailRoute)}
                    className="self-start rounded-full border border-border px-4 py-2 text-body-sm font-medium text-charcoal transition hover:bg-pearl"
                >
                    {recipes.form.photosFinishWithout}
                </button>
            </div>
        );
    }

    return (
        <div>
            <Wizard
                mode="create"
                step={step}
                values={values}
                canAdvanceFrom={(s) => canAdvanceFromStep(values, s)}
                stepErrors={(s) => stepErrorsFor(values, s)}
                goNext={() => {
                    if (step < 4 && canAdvanceFromStep(values, step)) {
                        setStep((step + 1) as RecipeWizardStep);
                    }
                }}
                goPrev={() => {
                    if (step > 1) {
                        setStep((step - 1) as RecipeWizardStep);
                    }
                }}
                goToStep={setStep}
                saveDraft={saveDraft}
                publish={publish}
                onCancel={() => router.push(listRoute)}
                isDirty={isDirty}
                submitting={createRecipe.isPending}
            >
                <Wizard.Header />
                <Wizard.Rail />
                <Wizard.Step step={1}>
                    <RecipeBasicsFields values={values} errors={errors} onChange={setValues} />
                    <RecipeVisibilityField values={values} onChange={setValues} />
                    {photoManager}
                </Wizard.Step>
                <Wizard.Step step={2}>
                    <IngredientPicker onSelect={addIngredient} />
                    {pendingIngredientIds(values).map((id) => (
                        <IngredientStatusPoller key={id} ingredientId={id} onStatus={applyLineStatus} />
                    ))}
                    <RecipeIngredientsFields values={values} errors={errors} onChange={setValues} />
                </Wizard.Step>
                <Wizard.Step step={3}>
                    <RecipeInstructionsFields values={values} errors={errors} onChange={setValues} />
                </Wizard.Step>
                <Wizard.Step step={4}>
                    <RecipeReviewFields values={values} />
                </Wizard.Step>
            </Wizard>
            {createRecipe.isError && <p role="alert">{recipes.form.submitError}</p>}
        </div>
    );
};
