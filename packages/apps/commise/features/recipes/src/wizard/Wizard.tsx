'use client';

/**
 * @module @commise/features-recipes/wizard — web 4-step recipe-edit wizard SHELL (w3/e1,e2, P8).
 *
 * A COMPOUND COMPONENT modeled on `card/RecipeCard.tsx`'s Root + Context + `useXModel()` accessor-hook +
 * `Object.assign` shape: `Wizard` (Root) carries the wizard's navigation view-model in context — built from
 * the step-extended `useRecipeEditor` (`step`/`goNext`/`goPrev`/`canAdvanceFrom`/`stepErrors`/`saveDraft`/
 * `publish`) plus a small STATECHART this component owns itself (which steps have been ATTEMPTED, which step's `Next`
 * was refused, and the discard-guard's pending confirmation) — and its parts —
 * `Wizard.Step`/`Wizard.Rail`/`Wizard.Header`/`Wizard.Controls` — each read that context, so no field/step
 * body has to thread wizard-navigation props through. Passing no children into a `Wizard.Step` that does not
 * match the active step renders nothing (a closed-union render-map switch, one arm per step, styled after
 * `hooks/ingredientResolver.model.ts`'s `deriveViewState` discriminated-union convention for the RAIL's own
 * per-step state — see `wizard/model.ts`'s `deriveRailStepState`).
 *
 * The Wizard is a SHELL: it renders none of `RecipeForm`'s fields itself. The composing container places the
 * SAME extracted `RecipeBasicsFields`/`RecipeIngredientsFields`/`RecipeInstructionsFields`/
 * `RecipeVisibilityField` leaves (`../form/`, one file each) — plus the app-owned ingredient picker and
 * photo manager — as children of the matching `Wizard.Step`, so no field is duplicated or rewritten.
 *
 * **Deliberate split from the plan's literal "Wizard.Controls (footer nav + top-bar actions)" wording**: this
 * implementation exposes `Wizard.Header` (the sticky band) and `Wizard.Controls` (the action bar) as TWO
 * separate parts, not one — so the native leaf can place the bar outside its own `ScrollView` while the web
 * leaf places it inside the header band. Both parts read the SAME context, so nothing about the wizard's
 * behavior differs — only where the chrome is placed.
 *
 * **U32 — the action model, and the genuinely PINNED bar (owner rulings 2026-08-25).** `Wizard.Controls` is
 * ONE element carrying `Previous · Save Draft · Next` (`Publish` on the last step), and it is rendered ONCE,
 * inside `Wizard.Header`'s DOM. Its POSITION is what the breakpoint changes, not its existence:
 *  - below `lg` it is `fixed inset-x-0 bottom-0` — pinned OUTSIDE every scroll container by construction, and
 *    padded by `env(safe-area-inset-bottom)` so it clears the gesture bar;
 *  - at `lg` and above it is `static`, so it sits in the sticky header band, which is where the desktop
 *    layout wants the Previous / Next row.
 *
 * ⛔ Rendering the bar TWICE (once hidden per breakpoint) was rejected: both copies would carry the same
 * accessible names, so every `getByRole('button', { name: 'Save Draft' })` — in tests and in a screen
 * reader's control list — would find two. One element that moves is the only shape with one accessible name.
 *
 * ⚠️ `lg`, not `md`. The mockup's bar is `md:hidden`, so it does not exist at all in the 768–1023px band;
 * adopting that breakpoint would ship the gap rather than close it, and `lg` is already this app's chrome
 * cutover (`HomeSidebar`/`HomeTabBar`).
 *
 * **U32 — the header.** `Wizard.Header` (which REPLACES `Wizard.TopBar`) is the sticky band: a BACK
 * affordance below `lg` — routed through the SAME `requestCancel` the overflow menu's `Cancel` used, so the
 * discard guard still fires — and, at `lg` and above, the overflow ("More actions") disclosure carrying
 * `Save Draft` + `Cancel`. Below `lg` that menu has nothing left to hold (Save Draft is in the bar, Cancel is
 * the arrow), so it is not rendered at all rather than rendered empty. The disclosure is a small
 * self-contained one (house style): a trigger with `aria-haspopup`/`aria-expanded`, a `role="menu"` of real
 * `role="menuitem"` buttons, Escape-to-close and an outside-click backdrop — no new dependency, since
 * `@commise/ui` ships no menu primitive.
 *
 * ⛔ **The composing container renders `Wizard.Header` and NOT `Wizard.Controls`** — the header places the
 * bar itself, so a container that also placed it would ship two. (The native leaf is the mirror image: its
 * screen owns a `ScrollView`, so IT places `Wizard.Controls` as a sibling BELOW that scroller, which is the
 * whole point of the fix. Each platform places the bar where "outside the scroll container" actually is.)
 *
 * **U33 — Preview is GONE, replaced by the Review step** (owner ruling 2026-08-25). The top-bar `Preview`
 * button and the `role="dialog"` overlay it opened are DELETED, not kept alongside `Wizard.Step step={4}`'s
 * new Review body: two surfaces rendering the same draft drift, and each would need its own tests. Accepted
 * cost, already ruled: a cook can no longer sanity-check from step 1 without walking forward.
 *
 * **The discard guard** (the back arrow, the overflow `Cancel`, and backward step navigation while dirty) is
 * owned entirely by the Root — the composing container does not place or wire it; it renders itself (via the
 * shared `@commise/ui/confirm-dialog` `ConfirmDialog`, house pattern B6) whenever `<Wizard>` is mounted,
 * keyed off `isDirty` (from `useDiscardGuard.js`) and internal `pendingAction` state.
 */
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { useMessages } from '@commise/i18n/react';
import { createContext, useContext, useEffect, useState, type FC, type ReactNode } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeFormMessages } from '../form/messages.js';
import type { RecipeFormErrors, RecipeFormValues, RecipeWizardStep } from '../form/model.js';
import {
    ArrowLeftIcon,
    CheckIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    MoreVerticalIcon,
    SaveIcon,
    XIcon,
} from './icons.js';
import {
    blockedAdvanceErrors,
    deriveRailStepState,
    nextStep,
    previousStep,
    WIZARD_STEPS,
    WIZARD_TOTAL_STEPS,
} from './model.js';
import { wizardMessages } from './messages.js';

/** Props for {@link Wizard} (Root). */
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
    /** The step bodies — one or more `Wizard.Step` elements, plus wherever the container places
     *  `Wizard.Rail` and `Wizard.Header`. ⛔ On web the container must NOT place `Wizard.Controls`: the
     *  header renders it, and a second placement ships two action bars with duplicate accessible names. */
    readonly children: ReactNode;
}

/** The wizard's navigation view-model, carried to its parts so no step body threads these props through. */
interface WizardModel extends Omit<WizardProps, 'children'> {
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
    const { step, canAdvanceFrom, isDirty, onCancel, goNext, goPrev, goToStep, publish, children } = props;
    const m = useMessages(wizardMessages);
    const [attempted, setAttempted] = useState<ReadonlySet<RecipeWizardStep>>(new Set());
    const [blockedStep, setBlockedStep] = useState<RecipeWizardStep | null>(null);
    const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

    const markAttempted = (target: RecipeWizardStep): void =>
        setAttempted((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));

    const requestGoNext = (): void => {
        markAttempted(step);
        // Record a REFUSED advance so the footer can say why (`Next` is enabled but `goNext` no-ops on an
        // invalid step). Cleared on a successful advance so it never trails the author forward.
        setBlockedStep(canAdvanceFrom(step) ? null : step);
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
        // A refused Publish is answered by the container's own whole-form `errors`, which the step bodies
        // render inline — the footer must not repeat those sentences.
        setBlockedStep(null);
        publish();
    };

    const model: WizardModel = {
        ...props,
        attempted,
        blockedStep,
        requestGoNext,
        requestGoPrev,
        requestGoToStep,
        requestCancel,
        requestPublish,
    };

    return (
        <WizardContext.Provider value={model}>
            {children}

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

// The marker's NUMERAL is read text (SC 1.4.3, 4.5:1) while its BORDER is a non-text boundary (SC 1.4.11,
// 3:1) — so `current` keeps `border-seafoam` and takes `text-ocean-dark` for the numeral. See the palette
// JSDoc in `@commise/ui`'s `tokens/colors.ts` for the one authoritative statement of that split.
const RAIL_MARKER_CLASS: Record<'completed' | 'current' | 'invalid' | 'upcoming', string> = {
    completed: 'border-seafoam bg-seafoam text-white',
    current: 'border-seafoam bg-white text-ocean-dark',
    invalid: 'border-error bg-error text-white',
    upcoming: 'border-border bg-white text-slate',
};

/** The step-rail: `[1] Details → [2] Ingredients → [3] Instructions → [4] Review`, "Step N of 4" (FR-044). */
const WizardRail: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);

    return (
        <nav aria-label={m.railLabel} className="flex flex-col gap-2">
            <p className="text-body-sm text-slate">
                {fillTemplate(m.stepProgress, { current: model.step, total: WIZARD_TOTAL_STEPS })}
            </p>
            <ol className="flex flex-wrap items-center gap-3">
                {WIZARD_STEPS.map((s) => {
                    const name = m.stepNames[s];
                    const railState = deriveRailStepState({
                        step: s,
                        currentStep: model.step,
                        attempted: model.attempted.has(s),
                        hasErrors: Object.keys(model.stepErrors(s)).length > 0,
                    });
                    const stateWord = m[RAIL_STATE_LABEL[railState]];

                    return (
                        // `min-w-0` + the label's `break-words` are the web spelling of the native leaf's
                        // `flexShrink: 1` on the pill (see `Wizard.native.tsx`'s `railRow`): the wrapping row
                        // already moves an overflowing pill to the next line, and these let a single pill
                        // wider than the row itself break instead of overflowing it.
                        <li key={s} className="min-w-0">
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
                                <span className="break-words">{name}</span>
                            </button>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
};

/**
 * The header's overflow ("More actions") disclosure: a kebab trigger opening a `role="menu"` list with
 * `Save Draft` and `Cancel`. Self-contained (no `@commise/ui` menu primitive exists): the trigger carries
 * `aria-haspopup`/`aria-expanded` + a localized `aria-label`; each item is a real `role="menuitem"` button
 * (keyboard-operable); Escape and an outside-click backdrop both close it. Cancel routes through
 * `requestCancel` so the discard guard still fires; Save Draft through `saveDraft` and busies while submitting.
 *
 * ⚠️ U32 makes this DESKTOP-ONLY. Below `lg` both of its items have moved out — `Save Draft` into the pinned
 * action bar, `Cancel` into the header's back arrow — so `Wizard.Header` does not render it there at all,
 * rather than rendering a kebab that discloses an empty list.
 */
const WizardActionsMenu: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);
    const [open, setOpen] = useState(false);

    // Escape-to-close, scoped to exactly the window the menu is open (mirrors the preview panel's listener) so
    // it never fires — or leaks a listener — while closed. The trigger itself never holds DOM focus once an
    // item is focused, so a document-level listener is the reliable catch.
    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('keydown', onKeyDown);

        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open]);

    // Every item closes the menu first, then runs its action — so Cancel's discard dialog opens over a closed
    // menu, not behind an open one.
    const runAndClose = (action: () => void): void => {
        setOpen(false);
        action();
    };

    return (
        <div className="relative">
            <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={m.actionsMenu}
                onClick={() => setOpen((prev) => !prev)}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-border bg-white px-3 text-charcoal shadow-sm transition hover:bg-pearl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam md:min-h-0 md:py-2.5"
            >
                <MoreVerticalIcon />
            </button>
            {open && (
                <>
                    {/* Outside-click backdrop: a click anywhere off the menu dismisses it. Below the menu's
                        z-index and decorative (the menu items own the interaction). */}
                    <div aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-30" />
                    <ul
                        role="menu"
                        aria-label={m.actionsMenu}
                        className="absolute right-0 z-40 mt-2 flex min-w-44 flex-col gap-1 rounded-2xl border border-border bg-card p-1 shadow-lg"
                    >
                        <li role="none">
                            <button
                                type="button"
                                role="menuitem"
                                disabled={model.submitting}
                                aria-busy={model.submitting || undefined}
                                onClick={() => runAndClose(model.saveDraft)}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-body-sm font-medium text-charcoal transition hover:bg-pearl disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <SaveIcon />
                                {m.saveDraft}
                            </button>
                        </li>
                        <li role="none">
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => runAndClose(model.requestCancel)}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-body-sm font-medium text-error-dark transition hover:bg-error/10"
                            >
                                <XIcon />
                                {m.cancel}
                            </button>
                        </li>
                    </ul>
                </>
            )}
        </div>
    );
};

/**
 * The sticky wizard header (U32) — and the ONE place the action bar is placed on web.
 *
 * Three things live here, and the breakpoint decides which of them a cook sees:
 *  - **Below `lg`** — the BACK affordance (`lg:hidden`). It replaces the overflow menu's `Cancel` outright
 *    and routes through the SAME `requestCancel`, so the discard guard fires exactly as it did. The kebab is
 *    absent here, because both of its items have moved (Save Draft into the bar, Cancel into this arrow).
 *  - **At `lg` and above** — the overflow menu (`hidden lg:flex`), carrying Save Draft + Cancel.
 *  - **Always** — `Wizard.Controls`, rendered ONCE. Its own classes move it between `fixed bottom-0` (below
 *    `lg`) and `static` in this band (at `lg`), so there is exactly one of each control in the document at
 *    every width. See the module doc for why two breakpoint-hidden copies were rejected.
 *
 * `sticky top-0` is safe for the bar's `position: fixed`: a sticky ancestor does not create a containing
 * block for fixed descendants (only `transform`/`filter`/`contain` do), and this band has none.
 */
const WizardHeader: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);

    return (
        <div
            role="toolbar"
            aria-label={m.headerLabel}
            className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border bg-card px-4 py-3"
        >
            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    aria-label={m.back}
                    onClick={model.requestCancel}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-charcoal transition hover:bg-pearl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam lg:hidden"
                >
                    <ArrowLeftIcon />
                </button>
                {/* Keeps the kebab hard right at `lg` once the back arrow is gone. */}
                <span className="hidden lg:block" />
                <div className="hidden lg:flex">
                    <WizardActionsMenu />
                </div>
            </div>
            <WizardControls />
        </div>
    );
};

/**
 * The action bar (U32) — `Previous · Save Draft · Next`, with `Publish` taking Next's slot on the last step.
 *
 * ⛔ **Its `position` is the whole unit.** Below `lg` it is `fixed inset-x-0 bottom-0`, which puts it outside
 * every scroll container BY CONSTRUCTION — the mockup's `sticky bottom-0` only pins because of one exact flex
 * structure, and drifts back into flow the moment that structure changes. `pb-[env(safe-area-inset-bottom)]`
 * is what clears the phone's gesture bar. At `lg` it becomes `static` and sits in the sticky header band it
 * is rendered inside.
 *
 * Three controls, never four: `Save Draft` is a real control here (it was an overflow item that a phone user
 * had to go looking for), and `Publish` stays the last step's primary rather than a duplicate desktop button.
 *
 * The blocked-advance notice is voiced HERE, next to the control that refused — see `blockedAdvanceErrors`.
 */
const WizardControls: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);
    const f = useMessages(recipeFormMessages);
    const prev = previousStep(model.step);
    const next = nextStep(model.step);
    const blocking = blockedAdvanceErrors(model.blockedStep === model.step, model.stepErrors(model.step));

    return (
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 border-t border-border bg-card px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0">
            {blocking.length > 0 && (
                <div role="alert" className="flex flex-col gap-1">
                    {blocking.map((code) => (
                        <p key={code} className="text-body-sm text-error-dark">
                            {f.errors[code]}
                        </p>
                    ))}
                </div>
            )}
            <div aria-label={m.controlsLabel} className="flex items-center justify-between gap-3">
                {prev !== null ? (
                    <Button variant="secondary" icon={<ChevronLeftIcon />} onPress={model.requestGoPrev}>
                        {fillTemplate(m.prevLabel, { name: m.stepNames[prev] })}
                    </Button>
                ) : (
                    <span />
                )}
                <Button variant="secondary" icon={<SaveIcon />} busy={model.submitting} onPress={model.saveDraft}>
                    {m.saveDraft}
                </Button>
                {next !== null ? (
                    <Button icon={<ChevronRightIcon />} onPress={model.requestGoNext}>
                        {fillTemplate(m.nextLabel, { name: m.stepNames[next] })}
                    </Button>
                ) : (
                    <Button icon={<CheckIcon />} busy={model.submitting} onPress={model.requestPublish}>
                        {m.publish}
                    </Button>
                )}
            </div>
        </div>
    );
};

/** The 4-step recipe-edit wizard shell: `<Wizard>` plus its `.Step`/`.Rail`/`.Header`/`.Controls` parts. */
export const Wizard = Object.assign(WizardRoot, {
    Step: WizardStep,
    Rail: WizardRail,
    Header: WizardHeader,
    Controls: WizardControls,
});
