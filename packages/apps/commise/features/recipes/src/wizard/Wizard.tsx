'use client';

/**
 * @module @commise/features-recipes/wizard — web 4-step recipe-edit wizard SHELL (w3/e1,e2, P8).
 *
 * A COMPOUND COMPONENT modeled on `card/RecipeCard.tsx`'s Root + Context + `useXModel()` accessor-hook +
 * `Object.assign` shape: `Wizard` (Root) carries the wizard's navigation view-model in context — built from
 * the step-extended `useRecipeEditor` (`step`/`goNext`/`goPrev`/`canAdvanceFrom`/`stepErrors`/`saveDraft`/
 * `publish`) plus a small STATECHART this component owns itself (which steps have been ATTEMPTED, whether the
 * preview panel is open, and the discard-guard's pending confirmation) — and its parts —
 * `Wizard.Step`/`Wizard.Rail`/`Wizard.TopBar`/`Wizard.Controls` — each read that context, so no field/step
 * body has to thread wizard-navigation props through. Passing no children into a `Wizard.Step` that does not
 * match the active step renders nothing (a closed-union render-map switch, one arm per step, styled after
 * `hooks/ingredientResolver.model.ts`'s `deriveViewState` discriminated-union convention for the RAIL's own
 * per-step state — see `wizard/model.ts`'s `deriveRailStepState`).
 *
 * The Wizard is a SHELL: it renders none of `RecipeForm`'s fields itself. The composing container places the
 * SAME extracted `RecipeBasicsFields`/`RecipeIngredientsFields`/`RecipeInstructionsFields`/
 * `RecipeVisibilityField` leaves (`../form/RecipeFormSections.js`) — plus the app-owned ingredient picker and
 * photo manager — as children of the matching `Wizard.Step`, so no field is duplicated or rewritten.
 *
 * **Deliberate split from the plan's literal "Wizard.Controls (footer nav + top-bar actions)" wording**: this
 * implementation exposes `Wizard.TopBar` (Save Draft / Preview / Cancel / Publish — the wireframe's persistent
 * header row, present on every step) and `Wizard.Controls` (the footer `< Prev` / `Next >` nav) as TWO
 * separate parts, not one. The wireframe places these in two visually distinct regions (a page header vs. a
 * per-step footer); a single component could not let the composing container position them independently
 * without an internal portal, which is more machinery than the wireframe calls for. Both parts read the SAME
 * context, so nothing about the wizard's behavior differs — only how the two chrome regions are placed.
 *
 * **The discard guard** (Cancel, and backward step navigation, while dirty) and the **preview panel** are
 * owned entirely by the Root — the composing container does not place or wire either; they render themselves
 * (via the shared `@commise/ui/confirm-dialog` `ConfirmDialog`, house pattern B6) whenever `<Wizard>` is
 * mounted, keyed off `isDirty` (from `useDiscardGuard.js`) and internal `previewOpen`/`pendingAction` state.
 */
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { useMessages } from '@commise/i18n/react';
import { createContext, useContext, useEffect, useState, type FC, type ReactNode } from 'react';

import { fillTemplate } from '../list/model.js';
import type { RecipeFormErrors, RecipeFormValues, RecipeWizardStep } from '../form/model.js';
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon, SaveIcon } from './icons.js';
import { deriveRailStepState, WIZARD_STEPS, WIZARD_TOTAL_STEPS } from './model.js';
import { wizardMessages } from './messages.js';

/** Props for {@link Wizard} (Root). */
export interface WizardProps {
    /** Create vs edit — selects the Publish action's PRESERVED accessible name (`Create recipe`/`Save changes`). */
    readonly mode: 'create' | 'edit';
    /** The active step (from `useRecipeEditor`'s `step`). */
    readonly step: RecipeWizardStep;
    /** The current draft — read by the preview panel. */
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
    /** The step bodies — one or more `Wizard.Step` elements, plus wherever the container places `Wizard.Rail`/`Wizard.TopBar`/`Wizard.Controls`. */
    readonly children: ReactNode;
}

/** The wizard's navigation view-model, carried to its parts so no step body threads these props through. */
interface WizardModel extends Omit<WizardProps, 'children'> {
    /** Steps the user has tried to leave (via Next) or tried to Publish through — gates the rail's invalid flag. */
    readonly attempted: ReadonlySet<RecipeWizardStep>;
    /** Whether the read-only preview panel is open. */
    readonly previewOpen: boolean;
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
    /** Toggle the preview panel. */
    readonly togglePreview: () => void;
}

const WizardContext = createContext<WizardModel | null>(null);

/** Read the wizard view-model from the nearest {@link Wizard}. Throws if a part is rendered outside one. */
function useWizardModel(): WizardModel {
    const model = useContext(WizardContext);

    if (model === null) {
        throw new Error('Wizard.* parts must be rendered inside a <Wizard>.');
    }

    return model;
}

const WizardRoot: FC<WizardProps> = (props) => {
    const { step, isDirty, onCancel, goNext, goPrev, goToStep, publish, children } = props;
    const m = useMessages(wizardMessages);
    const [attempted, setAttempted] = useState<ReadonlySet<RecipeWizardStep>>(new Set());
    const [previewOpen, setPreviewOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    const markAttempted = (target: RecipeWizardStep): void =>
        setAttempted((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));

    const requestGoNext = (): void => {
        markAttempted(step);
        goNext();
    };

    // Backward navigation (Prev, or the rail jumping to an earlier step) while dirty is guarded: the action
    // runs immediately when clean, or is deferred behind the discard-confirmation dialog when there are
    // unsaved edits to lose. Forward/lateral navigation is never guarded — nothing is discarded by it.
    const guardIfBackward = (target: RecipeWizardStep, action: () => void): void => {
        if (isDirty && target < step) {
            setPendingAction(() => action);
        } else {
            action();
        }
    };

    const requestGoPrev = (): void => {
        if (step > 1) {
            guardIfBackward((step - 1) as RecipeWizardStep, goPrev);
        }
    };

    const requestGoToStep = (target: RecipeWizardStep): void => guardIfBackward(target, () => goToStep(target));

    const requestCancel = (): void => {
        if (isDirty) {
            setPendingAction(() => onCancel);
        } else {
            onCancel();
        }
    };

    const requestPublish = (): void => {
        setAttempted(new Set(WIZARD_STEPS));
        publish();
    };

    const togglePreview = (): void => setPreviewOpen((open) => !open);
    const closePreview = (): void => setPreviewOpen(false);

    // Minor a11y gap (opus review): the hand-rolled preview panel is a `role="dialog"` with no Escape/backdrop
    // dismissal, unlike the Radix `ConfirmDialog` this same file renders below. Escape-to-close needs a
    // document-level listener (the panel itself never has DOM focus to catch a bubbled keydown), scoped to
    // exactly the window `previewOpen` is true so it never fires — or leaks a listener — while closed.
    useEffect(() => {
        if (!previewOpen) {
            return undefined;
        }

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                closePreview();
            }
        };

        document.addEventListener('keydown', onKeyDown);

        return () => document.removeEventListener('keydown', onKeyDown);
    }, [previewOpen]);

    const model: WizardModel = {
        ...props,
        attempted,
        previewOpen,
        requestGoNext,
        requestGoPrev,
        requestGoToStep,
        requestCancel,
        requestPublish,
        togglePreview,
    };

    return (
        <WizardContext.Provider value={model}>
            {children}

            {previewOpen && (
                <div
                    role="dialog"
                    aria-label={m.previewHeading}
                    // Backdrop-click-to-close: the click target check keeps a click that STARTS inside the
                    // card (then bubbles to this backdrop, e.g. a drag that ends outside) from closing it —
                    // only a click whose target IS the backdrop itself dismisses.
                    onClick={(event) => {
                        if (event.target === event.currentTarget) {
                            closePreview();
                        }
                    }}
                    className="fixed inset-0 z-40 flex items-center justify-center bg-charcoal/40 p-4"
                >
                    <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl bg-card p-6 shadow-lg">
                        <div className="flex items-center justify-between">
                            <h2 className="font-display text-heading-lg font-semibold text-charcoal">
                                {m.previewHeading}
                            </h2>
                            <button
                                type="button"
                                aria-label={m.previewClose}
                                onClick={togglePreview}
                                className="rounded-full p-1 text-slate transition hover:bg-pearl"
                            >
                                ×
                            </button>
                        </div>
                        <dl className="flex flex-col gap-2 text-body-sm text-charcoal">
                            <div className="flex justify-between gap-3">
                                <dt className="font-medium text-slate">{m.previewTitle}</dt>
                                <dd>{props.values.title}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                                <dt className="font-medium text-slate">{m.previewDescription}</dt>
                                <dd>{props.values.description}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                                <dt className="font-medium text-slate">{m.previewServings}</dt>
                                <dd>{props.values.servings}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                                <dt className="font-medium text-slate">{m.previewIngredientCount}</dt>
                                <dd>{props.values.ingredients.length}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                                <dt className="font-medium text-slate">{m.previewStepCount}</dt>
                                <dd>{props.values.steps.length}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                                <dt className="font-medium text-slate">{m.previewVisibility}</dt>
                                <dd>
                                    {props.values.visibility === 'private'
                                        ? m.previewVisibilityPrivate
                                        : m.previewVisibilityPublic}
                                </dd>
                            </div>
                        </dl>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={pendingAction !== null}
                title={m.discardTitle}
                description={m.discardBody}
                confirmLabel={m.discardConfirm}
                cancelLabel={m.discardCancel}
                destructive
                onConfirm={() => {
                    pendingAction?.();
                    setPendingAction(null);
                }}
                onCancel={() => setPendingAction(null)}
            />
        </WizardContext.Provider>
    );
};

/** Renders its children only while `step` is the wizard's active step. */
const WizardStep: FC<{ readonly step: RecipeWizardStep; readonly children: ReactNode }> = ({ step, children }) => {
    const model = useWizardModel();

    return model.step === step ? <>{children}</> : null;
};

type StateWordKey = 'stateCompleted' | 'stateCurrent' | 'stateInvalid' | 'stateUpcoming';

const RAIL_STATE_LABEL: Record<'completed' | 'current' | 'invalid' | 'upcoming', StateWordKey> = {
    completed: 'stateCompleted',
    current: 'stateCurrent',
    invalid: 'stateInvalid',
    upcoming: 'stateUpcoming',
};

const RAIL_MARKER_CLASS: Record<'completed' | 'current' | 'invalid' | 'upcoming', string> = {
    completed: 'border-seafoam bg-seafoam text-white',
    current: 'border-seafoam bg-white text-seafoam',
    invalid: 'border-error bg-error text-white',
    upcoming: 'border-border bg-white text-slate',
};

/** The step-rail: `[1] Basic → [2] Ingredients → [3] Instructions → [4] Photos`, "Step N of 4" (FR-044). */
const WizardRail: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);

    return (
        <nav aria-label={m.railLabel} className="flex flex-col gap-2">
            <p className="text-body-sm text-slate">
                {fillTemplate(m.stepProgress, { current: model.step, total: WIZARD_TOTAL_STEPS })}
            </p>
            <ol className="flex flex-wrap items-center gap-3">
                {WIZARD_STEPS.map((s, index) => {
                    const name = m.stepNames[index] ?? '';
                    const railState = deriveRailStepState({
                        step: s,
                        currentStep: model.step,
                        attempted: model.attempted.has(s),
                        hasErrors: Object.keys(model.stepErrors(s)).length > 0,
                    });
                    const stateWord = m[RAIL_STATE_LABEL[railState]];

                    return (
                        <li key={s}>
                            <button
                                type="button"
                                onClick={() => model.requestGoToStep(s)}
                                aria-current={railState === 'current' ? 'step' : undefined}
                                aria-label={fillTemplate(m.railStepLabel, { name, state: stateWord })}
                                className="flex items-center gap-2 rounded-full px-2 py-1 text-body-sm text-charcoal transition hover:bg-pearl"
                            >
                                <span
                                    aria-hidden="true"
                                    className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-semibold ${RAIL_MARKER_CLASS[railState]}`}
                                >
                                    {s}
                                </span>
                                <span>{name}</span>
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};

/** The persistent top bar: Save Draft (left) · Preview (center) · Cancel + Publish (right) — FR-002. */
const WizardTopBar: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);
    const publishLabel = model.mode === 'create' ? m.publishCreate : m.publishEdit;

    return (
        <div role="toolbar" aria-label={m.topBarLabel} className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" icon={<SaveIcon />} busy={model.submitting} onPress={model.saveDraft}>
                {m.saveDraft}
            </Button>
            <Button variant="secondary" icon={<EyeIcon />} onPress={model.togglePreview}>
                {m.preview}
            </Button>
            <div className="flex items-center gap-3">
                <Button variant="secondary" icon={<ChevronLeftIcon />} onPress={model.requestCancel}>
                    {m.cancel}
                </Button>
                <Button icon={<ChevronRightIcon />} busy={model.submitting} onPress={model.requestPublish}>
                    {publishLabel}
                </Button>
            </div>
        </div>
    );
};

/** The footer step nav: `< Prev: {name}` / `Next: {name} >`. */
const WizardControls: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);
    const index = model.step - 1;
    const prevName = index > 0 ? m.stepNames[index - 1] : undefined;
    const nextName = index < WIZARD_TOTAL_STEPS - 1 ? m.stepNames[index + 1] : undefined;

    return (
        <div aria-label={m.controlsLabel} className="flex items-center justify-between gap-3">
            {prevName !== undefined ? (
                <Button variant="secondary" icon={<ChevronLeftIcon />} onPress={model.requestGoPrev}>
                    {fillTemplate(m.prevLabel, { name: prevName })}
                </Button>
            ) : (
                <span />
            )}
            {nextName !== undefined && (
                <Button icon={<ChevronRightIcon />} onPress={model.requestGoNext}>
                    {fillTemplate(m.nextLabel, { name: nextName })}
                </Button>
            )}
        </div>
    );
};

/** The 4-step recipe-edit wizard shell: `<Wizard>` plus its `.Step`/`.Rail`/`.TopBar`/`.Controls` parts. */
export const Wizard = Object.assign(WizardRoot, {
    Step: WizardStep,
    Rail: WizardRail,
    TopBar: WizardTopBar,
    Controls: WizardControls,
});
