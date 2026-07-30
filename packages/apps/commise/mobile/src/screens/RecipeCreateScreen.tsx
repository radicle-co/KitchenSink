/**
 * Recipe-create screen (mobile, T067; CP-6/P1 — `RecipeEditor` is a controlled component, so this screen
 * owns its own `values`/`errors` state — a create has no seed/conflict/version concerns, so it does NOT use
 * `useRecipeEditor` (that hook's seed-once/409/resolution machinery is edit-only); w3/e1,e2 — this screen
 * ALSO owns the wizard's own step/draft/publish navigation state, reimplementing the SAME step-gating
 * (`canAdvanceFromStep`/`stepErrorsFor`) and draft-vs-publish floor the hook uses for edit, so the two flows
 * cannot drift on what "valid enough to advance/draft/publish" means. Mirrors the web
 * `RecipeCreateContainer`'s direct `Wizard` wiring, one layer down (through the shared `RecipeEditor` leaf
 * mobile's create AND edit screens both compose). Step 4 (Photos) shows a "save first" notice — a fresh
 * create has no recipe id yet to attach photos to; the created recipe's own edit screen is where photos are
 * added next.
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
import { useMessages } from '@commise/i18n/react';
import { RecipeStatus } from '@kitchensink/recipe-core';
import { useCreateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { Text } from 'react-native';

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
    const { recipes: t } = useMessages(mobileMessages);
    const create = useCreateRecipe();
    const [values, setValues] = useState<RecipeFormValues>(defaultRecipeFormValues);
    const [errors, setErrors] = useState<RecipeFormErrors>({});
    const [step, setStep] = useState<RecipeWizardStep>(1);

    // Blank-default IS the baseline from the very first render (`ready: true`); re-captured once the create
    // mutation succeeds (moot in practice — a successful create navigates away — but keeps the contract
    // identical to the edit screen's).
    const isDirty = useDiscardGuard(values, { ready: true, justSaved: create.isSuccess });

    const persist = (nextErrors: RecipeFormErrors, status: RecipeStatus): void => {
        setErrors(nextErrors);

        if (Object.keys(nextErrors).length > 0) {
            return;
        }

        create.mutate(toCreateRecipeInput(values, status), {
            onSuccess: (recipe) => onCreated(recipe.id),
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
            photosSlot={<Text>{t.photosAfterCreateNotice}</Text>}
        />
    );
}
