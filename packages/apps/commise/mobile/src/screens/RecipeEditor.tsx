/**
 * Recipe editor (mobile, T067; CP-6/P1 fully controlled; w3/e1,e2 rewired onto the 4-step `Wizard` shell).
 * The presentational orchestration layer shared by the create and edit screens: it wires the ingredient
 * typeahead ({@link IngredientPicker}) and poll-after-add into step 2, and renders the `Wizard` compound
 * shell (`Wizard.Rail`/`Wizard.TopBar` as a sticky header above the scrolling step content, one
 * `Wizard.Step` per step hosting the SAME extracted `RecipeBasicsFields`/`RecipeIngredientsFields`/
 * `RecipeInstructionsFields`/`RecipeVisibilityField` leaves the web edit container uses, and
 * `Wizard.Controls` as the footer nav). It performs NO data fetching and runs NO mutation, and owns NO state
 * of its own: `values`/`errors`/the wizard's `step`/navigation come in from the caller and every edit
 * reports back via `onChange`/`goNext`/`goPrev`/etc — exactly mirroring the web container's direct
 * `Wizard` wiring. Step 4's body is caller-supplied (`photosSlot`): the edit screen passes the real
 * `RecipePhotoUploader` (needs a persisted recipe id); the create screen passes a "save first" notice.
 *
 * The create screen (no seed/conflict/version concerns) owns its own local `values`/`errors`/step
 * `useState` and passes them down the same way the edit screen's `useRecipeEditor` hook does — same
 * controlled contract, different state owner.
 */
import {
    pendingIngredientIds,
    RecipeBasicsFields,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipeVisibilityField,
    setIngredientStatusById,
    Wizard,
    type RecipeFormErrors,
    type RecipeFormMode,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { JSX, ReactNode } from 'react';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { IngredientPicker, type ResolvedIngredient } from '../components/IngredientPicker.js';
import { IngredientStatusPoller } from '../components/IngredientStatusPoller.js';
import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link RecipeEditor}. */
export interface RecipeEditorProps {
    /** Create vs edit, forwarded to the `Wizard`. Informational only (w3/e7) — Publish is named the same in both modes. */
    readonly mode: RecipeFormMode;
    /** The controlled draft (blank for create, seeded from the loaded recipe for edit). */
    readonly values: RecipeFormValues;
    /** Field-level validation errors to surface; absent/empty when the form is valid. */
    readonly errors?: RecipeFormErrors;
    /** Called with the next values on every field/row edit (add, remove, or change). */
    readonly onChange: (next: RecipeFormValues) => void;
    /** Whether the composing screen's create/update mutation is in flight. */
    readonly submitting: boolean;
    /** A localized error to surface above the wizard when the mutation failed. */
    readonly submitError?: string;
    /** The wizard's active step. */
    readonly step: RecipeWizardStep;
    /** Whether `step` has no validation errors (the `[Next]` gate). */
    readonly canAdvanceFrom: (step: RecipeWizardStep) => boolean;
    /** The validation errors belonging to `step` — drives the rail's invalid flag. */
    readonly stepErrors: (step: RecipeWizardStep) => RecipeFormErrors;
    /** Advance one step. */
    readonly goNext: () => void;
    /** Go back one step. */
    readonly goPrev: () => void;
    /** Jump directly to a step. */
    readonly goToStep: (step: RecipeWizardStep) => void;
    /** Persist as a draft. */
    readonly saveDraft: () => void;
    /** Whole-form validate then persist as published. */
    readonly publish: () => void;
    /** Whether the draft has unsaved edits relative to its baseline — drives the discard guard. */
    readonly isDirty: boolean;
    /** Called once Cancel is confirmed (or immediately when nothing would be lost). */
    readonly onCancel: () => void;
    /** Step 4's body — the caller decides what "Photos" shows (a real uploader, or a "save first" notice). */
    readonly photosSlot: ReactNode;
}

/**
 * The recipe create/edit wizard editor.
 *
 * @param props - Mode, the controlled draft + its change handler, the wizard's step/navigation, submission
 *   state, the discard guard's `isDirty`, and the caller-supplied Photos step body.
 * @returns The typeahead-augmented, controlled `Wizard`.
 */
export function RecipeEditor({
    mode,
    values,
    errors,
    onChange,
    submitting,
    submitError,
    step,
    canAdvanceFrom,
    stepErrors,
    goNext,
    goPrev,
    goToStep,
    saveDraft,
    publish,
    isDirty,
    onCancel,
    photosSlot,
}: RecipeEditorProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);

    // U6 empty-state guidance: a brand-new create drops into a blank Basics form — show first-step guidance
    // until the author has put anything in. Edit mode (seeded from a saved recipe) never shows it.
    const isEmptyDraft = values.title.trim() === '' && values.ingredients.length === 0 && values.steps.length === 0;
    const showFirstStepGuidance = mode === 'create' && isEmptyDraft;

    // Carry the line's ACTUAL resolution status from the picker (a food added by name may be PENDING and
    // resolve later) — never assume RESOLVED, or a still-resolving line would never be polled. A line with no
    // status (a plain freeform create) simply carries none.
    const appendResolved = (ingredient: ResolvedIngredient): void => {
        onChange({
            ...values,
            ingredients: [
                ...values.ingredients,
                {
                    ingredientId: ingredient.id,
                    name: ingredient.name,
                    quantity: 1,
                    ...(ingredient.resolutionStatus === undefined
                        ? {}
                        : { resolutionStatus: ingredient.resolutionStatus }),
                },
            ],
        });
    };

    // Poll-after-add (data-model R5): a line added `PENDING` resolves in the background. `setIngredientStatusById`
    // is idempotent (returns the same reference when the status is unchanged) so the per-line pollers below
    // cannot loop. `onChange` takes the next full value (no functional-updater form), so this callback must
    // close over `values` and is only as stable as the draft itself — it still avoids rebuilding an identical
    // function on every unrelated re-render (e.g. `submitting` churn).
    const applyLineStatus = useCallback(
        (ingredientId: string, status: FoodResolutionStatus): void => {
            onChange(setIngredientStatusById(values, ingredientId, status));
        },
        [onChange, values],
    );

    return (
        <View style={styles.container}>
            {submitError !== undefined && submitError.length > 0 && (
                <Text accessibilityRole="alert">{submitError}</Text>
            )}
            <Wizard
                mode={mode === 'create' ? 'create' : 'edit'}
                step={step}
                values={values}
                canAdvanceFrom={canAdvanceFrom}
                stepErrors={stepErrors}
                goNext={goNext}
                goPrev={goPrev}
                goToStep={goToStep}
                saveDraft={saveDraft}
                publish={publish}
                onCancel={onCancel}
                isDirty={isDirty}
                submitting={submitting}
            >
                {/* Sticky header: Save Draft / Preview / Cancel / Publish, outside the scrolling step body. */}
                <Wizard.TopBar />
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                >
                    <Wizard.Rail />
                    <Wizard.Step step={1}>
                        {showFirstStepGuidance && (
                            <View accessibilityLabel={t.createGuidanceTitle} style={styles.guidance}>
                                <Text style={styles.guidanceTitle}>{t.createGuidanceTitle}</Text>
                                <Text style={styles.guidanceBody}>{t.createGuidanceBody}</Text>
                            </View>
                        )}
                        <RecipeBasicsFields values={values} errors={errors} onChange={onChange} />
                        <RecipeVisibilityField values={values} onChange={onChange} />
                    </Wizard.Step>
                    <Wizard.Step step={2}>
                        <IngredientPicker onResolve={appendResolved} />
                        {pendingIngredientIds(values).map((id) => (
                            <IngredientStatusPoller key={id} ingredientId={id} onStatus={applyLineStatus} />
                        ))}
                        <RecipeIngredientsFields values={values} errors={errors} onChange={onChange} />
                    </Wizard.Step>
                    <Wizard.Step step={3}>
                        <RecipeInstructionsFields values={values} errors={errors} onChange={onChange} />
                    </Wizard.Step>
                    <Wizard.Step step={4}>{photosSlot}</Wizard.Step>
                    <Wizard.Controls />
                </ScrollView>
            </Wizard>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { gap: 16, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48 },
    guidance: {
        gap: 4,
        borderRadius: 12,
        backgroundColor: 'rgba(46, 196, 182, 0.10)',
        borderWidth: 1,
        borderColor: 'rgba(46, 196, 182, 0.25)',
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    guidanceTitle: { fontSize: 15, fontWeight: '600', color: palette.charcoal },
    guidanceBody: { fontSize: 13, color: palette.slate },
});
