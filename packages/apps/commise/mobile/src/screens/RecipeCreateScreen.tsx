/**
 * Recipe-create screen (mobile, T067; CP-6/P1 — `RecipeEditor` is a controlled component, so this screen
 * owns its own `values`/`errors` state — a create has no seed/conflict/version concerns, so it does NOT use
 * `useRecipeEditor` (that hook's seed-once/409/resolution machinery is edit-only); w3/e1,e2 — this screen
 * ALSO owns the wizard's own step/draft/publish navigation state, reimplementing the SAME step-gating
 * (`canAdvanceFromStep`/`stepErrorsFor`) and draft-vs-publish floor the hook uses for edit, so the two flows
 * cannot drift on what "valid enough to advance/draft/publish" means. Mirrors the web
 * `RecipeCreateContainer`'s direct `Wizard` wiring, one layer down (through the shared `RecipeEditor` leaf
 * mobile's create AND edit screens both compose).
 *
 * ⛔ **PHOTOS ARE A FIELD NOW (U33, owner ruling 2026-08-25).** This screen used to pass a "save this recipe
 * first" notice as its photo slot, because the uploader needed a recipe id. A pick is now recorded in the
 * DRAFT (`useRecipeDraftPhotos`) and flushed into the upload queue the moment the create mutation returns an
 * id — the SAME rule the edit screen runs, where the id is simply already there. The uploader itself is
 * unchanged and shared: only the DESTINATION of a pick differs (`onPick` vs its own queue).
 *
 * ⚠️ **The create is not "done" the instant the POST returns.** A save is create-THEN-upload, so this screen
 * hands the created id to `onCreated` only once every picked photo has left the queue. Navigating sooner
 * would unmount the queue mid-flight and lose the upload silently — the exact failure the draft seam exists
 * to make visible rather than to introduce. While uploads are outstanding the editor stays mounted with the
 * photo surface showing each file's own state and its Retry.
 *
 * ⚠️ **Auto-save is deliberately NOT wired here.** An unattended write needs an `expectedVersion` to be safe
 * and a recipe that does not exist has no version; the first write on this route is a POST, not a CAS-guarded
 * PATCH. Auto-save begins on the edit screen. Firing a create on a timer would also mint a recipe from a form
 * the cook has not finished.
 */
import {
    canAdvanceFromStep,
    defaultRecipeFormValues,
    stepErrorsFor,
    toCreateRecipeInput,
    useDiscardGuard,
    validateRecipeForm,
    type RecipeFormErrors,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '@commise/features-recipes';
import { visibleQueueItems } from '@commise/features-recipes';
import {
    useRecipeDraftPhotos,
    useRecipePhotoUpload,
    useRecipePhotoUploadQueue,
} from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { RecipeStatus } from '@kitchensink/recipe-core';
import { useCreateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import { RecipePhotoUploader } from '../components/RecipePhotoUploader.js';
import { mobileMessages } from '../i18n/messages.js';
import { RecipeEditor } from './RecipeEditor.js';

/** Props for {@link RecipeCreateScreen}. */
export interface RecipeCreateScreenProps {
    /** Invoked with the created recipe's id after a successful create. */
    readonly onCreated: (recipeId: string) => void;
    /** Invoked when the user cancels the editor. */
    readonly onCancel: () => void;
}

/**
 * The recipe-create screen.
 *
 * @param props - The success + cancel callbacks the navigator wires.
 * @returns The blank 4-step create wizard wired to the create mutation.
 */
export function RecipeCreateScreen({ onCreated, onCancel }: RecipeCreateScreenProps): JSX.Element {
    const { recipes: t, recipePhotos: photoMessages } = useMessages(mobileMessages);
    const create = useCreateRecipe();
    const [values, setValues] = useState<RecipeFormValues>(defaultRecipeFormValues);
    const [errors, setErrors] = useState<RecipeFormErrors>({});
    const [step, setStep] = useState<RecipeWizardStep>(1);

    // Blank-default IS the baseline from the very first render (`ready: true`); re-captured once the create
    // mutation succeeds (moot in practice — a successful create navigates away — but keeps the contract
    // identical to the edit screen's).
    const isDirty = useDiscardGuard(values, { ready: true, justSaved: create.isSuccess });

    /** The created recipe's id, once the POST has returned. `null` until then — the flush's own trigger. */
    const [createdId, setCreatedId] = useState<string | null>(null);

    // Created unconditionally (Rules of Hooks) but fed only once `createdId` is set, because
    // `useRecipeDraftPhotos` holds every pick until then — so `''` is never used as a recipe id on a request.
    const uploader = useRecipePhotoUpload(createdId ?? '', t.createError);
    const queue = useRecipePhotoUploadQueue(uploader, 0, {
        tooLarge: photoMessages.tooLargeError,
        badType: photoMessages.unsupportedTypeError,
    });
    const draftPhotos = useRecipeDraftPhotos({
        recipeId: createdId,
        values,
        onChange: setValues,
        enqueue: queue.enqueue,
    });

    const pendingUploads = visibleQueueItems(queue.items);

    // Hand the id upward only once nothing is left in flight — see this module's doc on why a successful
    // create does not leave immediately.
    useEffect(() => {
        if (createdId !== null && pendingUploads.length === 0) {
            onCreated(createdId);
        }
    }, [createdId, pendingUploads.length, onCreated]);

    const persist = (nextErrors: RecipeFormErrors, status: RecipeStatus): void => {
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length > 0) {
            return;
        }

        create.mutate(toCreateRecipeInput(values, status), {
            // Records the id and STOPS. Handing it upward is the effect's job, once the photo queue drains.
            onSuccess: (recipe) => setCreatedId(recipe.id),
        });
    };

    return (
        <RecipeEditor
            mode="create"
            values={values}
            errors={errors}
            onChange={setValues}
            submitting={create.isPending}
            submitError={create.isError ? t.createError : undefined}
            step={step}
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
            saveDraft={() => persist(stepErrorsFor(values, 1), RecipeStatus.DRAFT)}
            publish={() => persist(validateRecipeForm(values), RecipeStatus.PUBLISHED)}
            isDirty={isDirty}
            onCancel={onCancel}
            photosSlot={
                <RecipePhotoUploader
                    recipeId={createdId}
                    onPick={(pick) => draftPhotos.addPhotos([pick])}
                    pendingDrafts={values.photos}
                />
            }
        />
    );
}
