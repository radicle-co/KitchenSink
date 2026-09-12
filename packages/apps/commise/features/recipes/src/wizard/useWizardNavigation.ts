/**
 * @module @commise/features-recipes/wizard — the wizard Root's props and its navigation statechart, shared by the web and
 * native `Wizard` leaves (w3/e1,e2, P8).
 *
 * Every navigation primitive arrives as a prop, and the Root still DECIDES: each request interposes the attempted set
 * and the discard guard between the cook's intent and the prop it eventually calls, so a `Next` can be refused and a
 * `Cancel` deferred until the cook answers. Backward navigation (Previous, or the rail jumping to an earlier step) and
 * Cancel are guarded while the draft is dirty; forward and lateral moves never are, because they discard nothing.
 *
 * @pattern State — `pendingAction` holds a navigation the cook has not yet confirmed, so no part has to know it was asked
 */
import { useState, type ReactNode } from 'react';

import type { RecipeWizardStep } from '../form/steps.js';
import type { RecipeFormErrors } from '../form/validate.js';
import type { RecipeFormValues } from '../form/values.js';
import { WIZARD_STEPS, firstStepWithErrors } from './model.js';

/** Props for the wizard Root (both leaves). */
export interface WizardProps {
    /**
     * Create vs edit. Informational only (w3/e7): the Publish action's accessible name is `Publish` in BOTH
     * modes — it no longer selects between two labels, since the button's behavior (always sets
     * `status: 'published'`) never differed by mode either. Retained so a caller's create/edit distinction
     * stays available to the wizard for any future mode-specific chrome.
     */
    readonly mode: 'create' | 'edit';
    /** The active step (from `useRecipeEditor`'s `step`). */
    readonly step: RecipeWizardStep;
    /** The current draft. Threaded to the parts through context; the Review step body reads it from the
     *  composing container, not from here. */
    readonly values: RecipeFormValues;
    /** Whether `step` has no validation errors (the hook's `canAdvanceFrom`). */
    readonly canAdvanceFrom: (step: RecipeWizardStep) => boolean;
    /** The validation errors belonging to `step` (the hook's `stepErrors`) — drives the rail's invalid flag. */
    readonly stepErrors: (step: RecipeWizardStep) => RecipeFormErrors;
    /** Advance one step (a no-op past step 4 or when the current step is invalid — the hook enforces this). */
    readonly goNext: () => void;
    /** Go back one step (a no-op before step 1). */
    readonly goPrev: () => void;
    /** Jump directly to `step` (free navigation, no validity gate). */
    readonly goToStep: (step: RecipeWizardStep) => void;
    /** Persist as a draft (relaxed step-1-only floor). */
    readonly saveDraft: () => void;
    /** Whole-form validate then persist as published; a no-op (no submit) when any step is invalid. */
    readonly publish: () => void;
    /** Invoked once Cancel is confirmed (or immediately, when there is nothing unsaved to lose). */
    readonly onCancel: () => void;
    /** Whether the draft has unsaved edits relative to its baseline (`useDiscardGuard`). */
    readonly isDirty: boolean;
    /** Whether a save is in flight — busies/disables Save Draft and Publish. */
    readonly submitting: boolean;
    /**
     * How many ingredient picks have failed (`IngredientRowEditor.pickFailures`). Each counts as an attempt on the step
     * that holds the ingredients (`docs/design/rowEditorOpenDecisions.md` E2): its text stays and blocks that step, so
     * the rail marks it from any step. REQUIRED, so no host can leave the rail blind to a failure it cannot see.
     */
    readonly pickFailures: number;
    /** The step bodies — one or more `Wizard.Step` elements, plus wherever the container places
     *  `Wizard.Rail` and `Wizard.Header`. ⛔ On web the container must NOT place `Wizard.Controls`: the
     *  header renders it, and a second placement ships two action bars with duplicate accessible names. */
    readonly children: ReactNode;
}

/** The wizard's navigation view-model, carried to its parts so no step body threads these props through. */
export interface WizardNavigation extends Omit<WizardProps, 'children'> {
    /** Steps the user has tried to leave (via Next) or tried to Publish through — gates the rail's invalid flag. */
    readonly attempted: ReadonlySet<RecipeWizardStep>;
    /**
     * The step whose `Next` was just REFUSED, or `null` — gates the footer's blocked-advance notice (see
     * `model.ts`'s `blockedAdvanceErrors`). Deliberately NOT `attempted`: Publish marks every step attempted
     * and the container answers a failed Publish by populating its own `errors`, which the step bodies render
     * inline, so reusing `attempted` here made the wizard say the same sentence twice.
     */
    readonly blockedStep: RecipeWizardStep | null;
    /** Advance, marking the CURRENT step attempted (so an invalid Next click flags it in the rail). */
    readonly requestGoNext: () => void;
    /** Go back one step, through the discard guard when dirty. */
    readonly requestGoPrev: () => void;
    /** Jump to `step`, through the discard guard when navigating BACKWARD while dirty. */
    readonly requestGoToStep: (step: RecipeWizardStep) => void;
    /** Cancel, through the discard guard when dirty. */
    readonly requestCancel: () => void;
    /** Publish, marking EVERY step attempted (a whole-form validation) before delegating to `publish`. */
    readonly requestPublish: () => void;
}

/** The discard guard's pending confirmation, which the Root draws as its dialog. */
export interface WizardDiscardGuard {
    /** Whether a guarded navigation is waiting for the cook's answer. */
    readonly open: boolean;
    /** Discard: run the waiting navigation, then close. */
    readonly confirm: () => void;
    /** Keep editing: close, running nothing. */
    readonly keepEditing: () => void;
}

/**
 * The wizard's navigation statechart.
 *
 * @param props - The Root's props.
 * @returns The navigation view-model for the parts, and the discard guard for the Root's dialog.
 * @sideEffect Calls the navigation props it is asked to, when the guard lets them through.
 */
export function useWizardNavigation(props: WizardProps): {
    readonly navigation: WizardNavigation;
    readonly discard: WizardDiscardGuard;
} {
    const { step, canAdvanceFrom, isDirty, onCancel, goNext, goPrev, goToStep, publish, pickFailures } = props;
    const [attempted, setAttempted] = useState<ReadonlySet<RecipeWizardStep>>(new Set());
    const [seenPickFailures, setSeenPickFailures] = useState(pickFailures);
    const [blockedStep, setBlockedStep] = useState<RecipeWizardStep | null>(null);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    const markAttempted = (target: RecipeWizardStep): void =>
        setAttempted((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));

    // A failed pick is an attempt on the step its text blocks (E2). Adjusted during render, React's previous-value form.
    if (pickFailures !== seenPickFailures) {
        setSeenPickFailures(pickFailures);

        const blocked = firstStepWithErrors({ ingredients: 'ingredientsPendingText' });

        if (blocked !== undefined) {
            markAttempted(blocked);
        }
    }

    const requestGoNext = (): void => {
        markAttempted(step);
        // Record a REFUSED advance so the footer can say why (`Next` is enabled but `goNext` no-ops on an
        // invalid step). Cleared on a successful advance so it never trails the author forward.
        setBlockedStep(canAdvanceFrom(step) ? null : step);
        goNext();
    };

    const guardIfBackward = (target: RecipeWizardStep, action: () => void): void => {
        if (isDirty && target < step) {
            setPendingAction(() => action);
        } else {
            action();
        }
    };

    const requestCancel = (): void => {
        if (isDirty) {
            setPendingAction(() => onCancel);
        } else {
            onCancel();
        }
    };

    return {
        navigation: {
            ...props,
            attempted,
            blockedStep,
            requestGoNext,
            requestGoPrev: () => {
                if (step > 1) {
                    guardIfBackward((step - 1) as RecipeWizardStep, goPrev);
                }
            },
            requestGoToStep: (target) => guardIfBackward(target, () => goToStep(target)),
            requestCancel,
            requestPublish: () => {
                setAttempted(new Set(WIZARD_STEPS));
                // A refused Publish is answered by the container's own whole-form `errors`, which the step bodies
                // render inline — the footer must not repeat those sentences.
                setBlockedStep(null);
                publish();
            },
        },
        discard: {
            open: pendingAction !== null,
            confirm: () => {
                pendingAction?.();
                setPendingAction(null);
            },
            keepEditing: () => setPendingAction(null),
        },
    };
}
