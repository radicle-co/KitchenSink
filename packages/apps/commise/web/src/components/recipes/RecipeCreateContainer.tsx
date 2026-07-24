'use client';

/**
 * Container for the recipe-create route (w3/e1,e2: rewired onto the 4-step `Wizard` shell). Owns the
 * editable {@link RecipeFormValues} (seeded blank via `defaultRecipeFormValues`) AND the wizard's own
 * step/draft/publish navigation — unlike the edit route, create has no seed/conflict/version concerns, so it
 * does not use `useRecipeEditor` (that hook's machinery is edit-only); this container reimplements the SAME
 * step-gating (`canAdvanceFromStep`/`stepErrorsFor`) and the SAME draft-vs-publish floor
 * (`stepErrorsFor(values, 1)` for a draft, `validateRecipeForm` for a publish) the hook uses for edit, so the
 * two flows cannot drift on what "valid enough to advance/draft/publish" means. Renders the `Wizard` compound
 * shell with the SAME extracted `RecipeBasicsFields`/`RecipeIngredientsFields`/`RecipeInstructionsFields`/
 * `RecipeVisibilityField` leaves as the edit container, plus the app-owned {@link IngredientPicker} in step
 * 2. Photo upload (step 4) needs a persisted recipe id, so a fresh create shows no photo manager; the created
 * recipe's OWN detail/edit route is where photos are added next, matching this container's pre-wizard
 * behavior. On success it navigates to the new recipe's detail route.
 */
import {
    canAdvanceFromStep,
    defaultRecipeFormValues,
    pendingIngredientIds,
    RecipeBasicsFields,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipeVisibilityField,
    setIngredientStatusById,
    stepErrorsFor,
    toCreateRecipeInput,
    useDiscardGuard,
    validateRecipeForm,
    Wizard,
} from '@commise/features-recipes';
import type {
    RecipeFormErrors,
    RecipeFormIngredient,
    RecipeFormValues,
    RecipeWizardStep,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { RecipeStatus, type FoodResolutionStatus } from '@kitchensink/recipe-core';
import { useCreateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { FC } from 'react';

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
 * @returns The wired 4-step create wizard.
 */
export const RecipeCreateContainer: FC<RecipeCreateContainerProps> = ({ locale }) => {
    const router = useRouter();
    const { recipes } = useMessages(webMessages);
    const createRecipe = useCreateRecipe();
    const [values, setValues] = useState<RecipeFormValues>(defaultRecipeFormValues);
    const [errors, setErrors] = useState<RecipeFormErrors>({});
    const [step, setStep] = useState<RecipeWizardStep>(1);

    const listRoute = `/${locale}/recipes` as Route;

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
    // re-captured once the create mutation succeeds (moot in practice — a successful create navigates away
    // immediately — but keeps the contract identical to the edit container's).
    const isDirty = useDiscardGuard(values, { ready: true, justSaved: createRecipe.isSuccess });

    const persist = (nextErrors: RecipeFormErrors, status: RecipeStatus): void => {
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length > 0) {
            return;
        }

        createRecipe.mutate(toCreateRecipeInput(values, status), {
            onSuccess: (created) => router.push(`/${locale}/recipes/${created.id}` as Route),
        });
    };

    const saveDraft = (): void => persist(stepErrorsFor(values, 1), RecipeStatus.DRAFT);
    const publish = (): void => persist(validateRecipeForm(values), RecipeStatus.PUBLISHED);

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
                <Wizard.Rail />
                <Wizard.TopBar />
                <Wizard.Step step={1}>
                    <RecipeBasicsFields values={values} errors={errors} onChange={setValues} />
                    <RecipeVisibilityField values={values} onChange={setValues} />
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
                    <p>{recipes.form.photosAfterCreateNotice}</p>
                </Wizard.Step>
                <Wizard.Controls />
            </Wizard>
            {createRecipe.isError && <p role="alert">{recipes.form.submitError}</p>}
        </div>
    );
};
