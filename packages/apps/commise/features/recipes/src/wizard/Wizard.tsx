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
 * match the active step renders nothing (a closed-union render-map switch, one arm per step; the RAIL's own per-step state is
 * `wizard/model.ts`'s `deriveRailStepState`).
 *
 * The Wizard is a SHELL: it renders none of the recipe's fields itself. The composing container places the
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
 * ONE element carrying `Previous · Save Draft · Next` (`Publish` on the last step), and it is rendered ONCE.
 * Pinned, it is inside `Wizard.Header`'s DOM, and its POSITION is what the breakpoint changes, not its existence:
 *  - below `lg` it is `fixed inset-x-0 bottom-0` — pinned OUTSIDE every scroll container by construction, and
 *    padded by `env(safe-area-inset-bottom)` so it clears the gesture bar;
 *  - at `lg` and above it is `static`, so it sits in the sticky header band, which is where the desktop
 *    layout wants the Previous / Next row.
 *
 * **A1 — past a limit the bar unpins** (`docs/design/compactHeightLayout.md` A1, §4, the native editor's rule).
 * When the band and the bar together are taller than half the viewport (`@commise/ui/pinned-footer`, over the
 * viewport, the Sheet's rule), the Root places the bar after the step bodies instead, in the page's flow, and the band
 * keeps Back. One place or the other renders it, never both. Moving it remounts it, so the control that had focus
 * takes it again in the new bar (`./barControlFocus.ts` names the controls, SC 2.4.3).
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
 * `Cancel`. Below `lg` that menu is not rendered at all: its only item's job is done by the back arrow.
 * The disclosure is a small self-contained one (house style): a trigger with `aria-haspopup`/`aria-expanded`,
 * a `role="menu"` of real `role="menuitem"` buttons, Escape-to-close and an outside-click backdrop — no new
 * dependency, since `@commise/ui` ships no menu primitive.
 *
 * ⛔ **`Save Draft` is NOT in that menu, at any width.** The ruling reads two ways — "Save Draft leaves the
 * kebab below `lg`" and "the same three [Previous · Save Draft · Next] in the sticky header above it" — and
 * only one of them can be true at `lg`. Keeping it in both the header row AND the menu would put two
 * controls named `Save Draft` on one surface, which is the same duplicate-accessible-name failure that
 * rejected rendering the bar twice (and that renamed meal type's clear option to `No meal type`). The bar
 * carries it at EVERY width; the menu carries what the bar does not.
 *
 * ⛔ **The composing container renders `Wizard.Header` and NOT `Wizard.Controls`** — the header (or, unpinned,
 * the Root) places the bar itself, so a container that also placed it would ship two. (The native leaf is the
 * mirror image: its screen owns a `ScrollView`, so IT places `Wizard.Controls` as a sibling BELOW that scroller,
 * which is the whole point of the fix. Each platform places the bar where "outside the scroll container" actually
 * is.)
 *
 * **U33 — Preview is GONE, replaced by the Review step** (owner ruling 2026-08-25). The top-bar `Preview`
 * button and the `role="dialog"` overlay it opened are DELETED, not kept alongside `Wizard.Step step={4}`'s
 * new Review body: two surfaces rendering the same draft drift, and each would need its own tests. Accepted
 * cost, already ruled: a cook can no longer sanity-check from step 1 without walking forward.
 *
 * **The discard guard** (the back arrow, the overflow `Cancel`, and backward step navigation while dirty) is
 * owned entirely by the Root — the composing container does not place or wire it; it renders itself (via the
 * shared `@commise/ui/confirm-dialog` `ConfirmDialog`, house pattern B6) whenever `<Wizard>` is mounted,
 * keyed off `isDirty` (from `useDiscardGuard.js`) and the navigation `useWizardNavigation` holds pending.
 *
 * ⚠️ It calls itself a SHELL and renders none of the fields, so it reads as layout — but it is
 * ORCHESTRATION. Every navigation primitive arrives as a prop and it still DECIDES: `requestGoNext` /
 * `requestGoPrev` / `requestGoToStep` / `requestCancel` each interpose the attempted-set and the discard
 * guard between the intent and the prop it eventually calls, so a `Next` can be refused and a `Cancel` can
 * be deferred until the cook answers. That interposition is the Root's own statechart, not the container's:
 * `./useWizardNavigation.ts`, which the native leaf shares.
 *
 * **V3-1 — the chrome a popup keeps clear of** (`docs/design/rowEditorOpenDecisions.md`). A popup in a step body
 * (the ingredient row's food list) must never paint over the band or the bar. The Root provides
 * `@commise/ui/popup-insets`' reader, which measures both at the moment a popup places itself (`./chromeInsets.ts`).
 * The band and the bar hand their nodes to the pinned-footer hook through its callback refs into state, and the Root
 * reads them back from it, so there is no ref object. ⚠️ Residual: a popup re-places on scroll and resize, not when the bar grows (a refusal
 * notice), so until then it reads the bar's old height.
 *
 * @pattern Compound Component (Root + context + parts) composed with the discard-guard statechart
 *     `useWizardNavigation`, which holds a navigation the cook has not yet confirmed, so no part has to know it was asked
 * @pattern Dependency Injection through a context — the Root provides `@commise/ui/popup-insets`' reader to every popup
 *     in the step bodies
 * @pattern Adapter over external DOM geometry — the band and the bar reach the Root through callback refs into state,
 *     and their rects are read at each placement and on each resize
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { PopupInsetsContext } from '@commise/ui/popup-insets';
import { usePinnedFooter } from '@commise/ui/pinned-footer';
import { useMessages } from '@commise/i18n/react';
import { createContext, useCallback, useContext, useEffect, useState, type FC, type ReactNode } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeFormMessages } from '../form/messages.js';
import type { RecipeWizardStep } from '../form/steps.js';
import {
    blockedAdvanceErrors,
    deriveRailStepState,
    nextStep,
    previousStep,
    RAIL_STATE_WORD,
    WIZARD_STEPS,
    WIZARD_TOTAL_STEPS,
} from './model.js';
import { BAR_CONTROL_FOCUS, barControlSlot, type BarControl } from './barControlFocus.js';
import { readChromeInsets } from './chromeInsets.js';
import { wizardMessages } from './messages.js';
import { useUnloadGuard } from './useUnloadGuard.js';
import { useWizardNavigation, type WizardNavigation, type WizardProps } from './useWizardNavigation.js';

/** The wizard's navigation view-model plus the web chrome the Root measures and moves (V3-1, A1). */
interface WizardModel extends WizardNavigation {
    /** The header band's callback ref: the Root measures the band for its popups (V3-1). */
    readonly placeBand: (node: HTMLDivElement | null) => void;
    /** The controls bar's callback ref: the Root measures the bar for its popups (V3-1). */
    readonly placeBar: (node: HTMLDivElement | null) => void;
    /** Whether the bar sits after the step bodies instead of pinned (`compactHeightLayout.md` A1). */
    readonly unpinned: boolean;
    /** The bar control that takes focus again after the bar moved (`@commise/ui/pinned-footer`). */
    readonly refocus: BarControl | null;
    /** Clears {@link refocus} once that control has focus. */
    readonly refocusHandled: () => void;
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
    const m = useMessages(wizardMessages);
    const { navigation, discard } = useWizardNavigation(props);
    // The band is the pinned top row and the bar the footer; the page scrolls under a band stuck to its top, so the
    // frame is the viewport (`docs/design/compactHeightLayout.md` A1).
    const pinning = usePinnedFooter<BarControl>({ frame: 'viewport', focusCarry: BAR_CONTROL_FOCUS });
    const { top: band, footer: bar, unpinned, refocus, refocusHandled } = pinning;
    // A new reader only when a node changes, so the popups below re-render for the chrome, not for every keystroke.
    const readInsets = useCallback(() => readChromeInsets(band, bar), [band, bar]);

    // The WEB half of "warn before losing unsaved work" (the native leaf intercepts the hardware back button
    // instead). Called here, in the Root, so BOTH containers — create and edit — are covered with no change of
    // their own, exactly as the native interceptor is. See the hook for what `beforeunload` does NOT cover and
    // why no client-side route blocker is built.
    useUnloadGuard(props.isDirty);

    const model: WizardModel = {
        ...navigation,
        placeBand: pinning.topRef,
        placeBar: pinning.footerRef,
        unpinned,
        refocus,
        refocusHandled,
    };

    return (
        <WizardContext.Provider value={model}>
            <PopupInsetsContext value={readInsets}>
                {props.children}
                {/* Past the limit only: the bar as the content's last item. Pinned, `Wizard.Header` places it. */}
                {unpinned ? <WizardControls /> : null}
            </PopupInsetsContext>

            <ConfirmDialog
                open={discard.open}
                title={m.discardTitle}
                body={m.discardBody}
                confirm={{ label: m.discardConfirm, icon: 'trash' }}
                keep={{ label: m.discardCancel }}
                onConfirm={discard.confirm}
                onKeep={discard.keepEditing}
            />
        </WizardContext.Provider>
    );
};

/** Renders its children only while `step` is the wizard's active step. */
const WizardStep: FC<{ readonly step: RecipeWizardStep; readonly children: ReactNode }> = ({ step, children }) => {
    const model = useWizardModel();

    return model.step === step ? <>{children}</> : null;
};

// The marker's NUMERAL is read text (SC 1.4.3, 4.5:1) while its BORDER is a non-text boundary (SC 1.4.11,
// 3:1) — so `current` keeps `border-selected-edge` and takes `text-action-text` for the numeral. See the palette
// JSDoc in `@commise/ui`'s `tokens/colors.ts` for the one authoritative statement of that split.
const RAIL_MARKER_CLASS: Record<'completed' | 'current' | 'invalid' | 'upcoming', string> = {
    completed: 'border-selected-edge bg-action text-on-action',
    current: 'border-selected-edge bg-paper text-action-text',
    invalid: 'border-danger bg-danger text-on-action',
    upcoming: 'border-line-divider bg-paper text-ink-muted',
};

/** The step-rail: `[1] Details → [2] Ingredients → [3] Instructions → [4] Review`, "Step N of 4" (FR-044). */
const WizardRail: FC = () => {
    const model = useWizardModel();
    const m = useMessages(wizardMessages);

    return (
        <nav aria-label={m.railLabel} className="flex flex-col gap-2">
            <p className="text-body-sm text-ink-muted">
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
                    const stateWord = m[RAIL_STATE_WORD[railState]];

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
                                className="flex items-center gap-2 rounded-full px-2 py-1 text-body-sm text-ink transition hover:bg-ink/6"
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
 * The header's overflow ("More actions") disclosure: a kebab trigger opening a `role="menu"` list carrying
 * `Cancel`. Self-contained (no `@commise/ui` menu primitive exists): the trigger carries
 * `aria-haspopup`/`aria-expanded` + a localized `aria-label`; the item is a real `role="menuitem"` button
 * (keyboard-operable); Escape and an outside-click backdrop both close it. Cancel routes through
 * `requestCancel`, so the discard guard fires exactly as it does for the back arrow that replaces it below
 * `lg`.
 *
 * ⚠️ U32 makes this DESKTOP-ONLY, and one item wide. Below `lg` its job is done by the header's back arrow,
 * so `Wizard.Header` does not render it there at all rather than disclosing a list of one. `Save Draft` is
 * deliberately NOT here — see the module doc: it is in the action bar at every width, and putting it in both
 * would name two controls the same thing on one surface.
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
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-divider bg-paper px-3 text-ink shadow-sm transition hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring md:min-h-0 md:py-2.5"
            >
                <Icon name="ellipsis" size={20} />
            </button>
            {open && (
                <>
                    {/* Outside-click backdrop: a click anywhere off the menu dismisses it. Below the menu's
                        z-index and decorative (the menu items own the interaction). */}
                    <div aria-hidden="true" onClick={() => setOpen(false)} className="fixed inset-0 z-30" />
                    <ul
                        role="menu"
                        aria-label={m.actionsMenu}
                        className="absolute right-0 z-40 mt-2 flex min-w-44 flex-col gap-1 rounded-2xl border border-line-divider bg-paper p-1 shadow-lg"
                    >
                        <li role="none">
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => runAndClose(model.requestCancel)}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-body-sm font-medium text-danger-text transition hover:bg-danger/10"
                            >
                                <Icon name="x" size={20} />
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
 *  - **While pinned** — `Wizard.Controls`, rendered ONCE. Its own classes move it between `fixed bottom-0` (below
 *    `lg`) and `static` in this band (at `lg`), so there is exactly one of each control in the document at
 *    every width. See the module doc for why two breakpoint-hidden copies were rejected, and for where the bar
 *    goes once it unpins.
 *
 * `sticky top-0` is safe for the bar's `position: fixed`: a sticky ancestor does not create a containing
 * block for fixed descendants (only `transform`/`filter`/`contain` do), and this band has none.
 */
const WizardHeader: FC = () => {
    const { placeBand, requestCancel, unpinned } = useWizardModel();
    const m = useMessages(wizardMessages);

    return (
        <div
            ref={placeBand}
            role="toolbar"
            aria-label={m.headerLabel}
            className="sticky top-0 z-20 flex flex-col border-b border-line-divider bg-paper px-4 py-3"
        >
            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    aria-label={m.back}
                    onClick={requestCancel}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink transition hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring lg:hidden"
                >
                    <Icon name="chevronLeft" size={20} />
                </button>
                {/* Keeps the kebab hard right at `lg` once the back arrow is gone. */}
                <span className="hidden lg:block" />
                <div className="hidden lg:flex">
                    <WizardActionsMenu />
                </div>
            </div>
            {unpinned ? null : <WizardControls />}
        </div>
    );
};

/**
 * The action-bar step label: bare below `md`, full from `md` up, one accessible name throughout.
 *
 * ⛔ THE FULL LABEL DOES NOT FIT ON A PHONE. Measured on the shipped geometry, the three-control row needs
 * 388px against 288 available at 320 — worst case "Prev: Details" / "Save Draft" / "Next: Instructions" —
 * so the primary action was clipped 84px off the right edge. A `fixed` element is excluded from scrollable
 * overflow, so the page never gained a horizontal scrollbar and no overflow check could see it.
 *
 * ⚠️ VISIBLE text only. The button carries the full templated string as `accessibilityLabel`, so the
 * accessible name is unchanged at every width and name-based selection (RTL / Playwright) keeps working
 * against the full label.
 *
 * @param props - The short and full forms of one label.
 * @returns Both spans, one visible per breakpoint. Pure.
 */
const ResponsiveStepLabel: FC<{ readonly short: string; readonly full: string }> = ({ short, full }) => (
    <>
        <span aria-hidden className="md:hidden">
            {short}
        </span>
        <span aria-hidden className="hidden md:inline">
            {full}
        </span>
    </>
);

/**
 * The bar's box, in either place. Unpinned, its row is never wider than pinned, and at `lg` it keeps its padding and
 * hairline, so the bar is never shorter: the rule that moved it cannot move it straight back
 * (`docs/design/compactHeightLayout.md` §3.1, `pinnedFooterMeasureOf`). Its top padding is also the space under the
 * band's row at `lg`, inside the bar's own box.
 */
const BAR =
    'flex flex-col gap-2 border-t border-line-divider bg-paper px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]';

/**
 * Pinned: fixed to the viewport's foot below `lg`; at `lg`, in the band's flow, and the band supplies the sides and the
 * hairline.
 *
 * ⛔ `z-60`, ABOVE `HomeTabBar`'s `z-50`. Both are `fixed bottom-0` and there is no stacking context between them and
 * the root, so at `z-30` the tab bar painted OVER all three controls at every width below `lg` — Prev, Save Draft and
 * Next were each unreachable, and recipe create and edit could not be completed on any phone or tablet web viewport.
 * The bar is 80–90% opaque with a 24px blur, so the controls stayed faintly visible underneath and it read as a
 * rendering oddity rather than a dead end.
 *
 * ⚠️ THIS IS THE BELT. The braces are `AppShell`'s `focusedTask`, which suppresses the tab bar on wizard routes
 * entirely — a destination change mid-creation discards work, so the foot belongs to the task. This `z-60` is what
 * keeps a FUTURE pinned surface from reintroducing the same collision.
 *
 * ⚠️ The old spec could not see it: it asserted the bar's Y POSITION, and a covered bar sits exactly where it should.
 * `recipeWizardActionBar.spec.ts` hit-tests with `elementFromPoint` now.
 */
const BAR_PINNED = `${BAR} fixed inset-x-0 bottom-0 z-60 lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0`;

/**
 * A bar control's slot: it names the control, so the control takes focus again after the bar moves
 * (`./barControlFocus.ts`). `contents`, so the row lays the control out as if the slot were not there.
 */
const ControlSlot: FC<{ readonly control: BarControl; readonly children: ReactNode }> = ({ control, children }) => (
    <span className="contents" {...barControlSlot(control)}>
        {children}
    </span>
);

/**
 * The action bar (U32) — `Previous · Save Draft · Next`, with `Publish` taking Next's slot on the last step.
 *
 * ⛔ **Its `position` is the whole unit.** Pinned below `lg` it is `fixed inset-x-0 bottom-0`, which puts it outside
 * every scroll container BY CONSTRUCTION — the mockup's `sticky bottom-0` only pins because of one exact flex
 * structure, and drifts back into flow the moment that structure changes. `pb-[env(safe-area-inset-bottom)]`
 * is what clears the phone's gesture bar. At `lg` it becomes `static` and sits in the sticky header band it
 * is rendered inside. Unpinned (the module doc's A1), it is `static` at every width, after the step bodies.
 *
 * Three controls, never four: `Save Draft` is a real control here (it was an overflow item that a phone user
 * had to go looking for), and `Publish` stays the last step's primary rather than a duplicate desktop button.
 *
 * The blocked-advance notice is voiced HERE, next to the control that refused — see `blockedAdvanceErrors`.
 */
const WizardControls: FC = () => {
    // Taken apart from the model: `react-hooks/refs` reads every property of an object a ref callback came from as a ref.
    const { placeBar, ...model } = useWizardModel();
    const m = useMessages(wizardMessages);
    const f = useMessages(recipeFormMessages);
    const prev = previousStep(model.step);
    const next = nextStep(model.step);
    const blocking = blockedAdvanceErrors(model.blockedStep === model.step, model.stepErrors(model.step));
    const focusFor = (control: BarControl) => ({
        focusRequested: model.refocus === control,
        onFocusRequestHandled: model.refocusHandled,
    });

    return (
        <div ref={placeBar} className={model.unpinned ? BAR : BAR_PINNED}>
            {blocking.length > 0 && (
                <div role="alert" className="flex flex-col gap-1">
                    {blocking.map((code) => (
                        <p key={code} className="text-body-sm text-danger-text">
                            {f.errors[code]}
                        </p>
                    ))}
                </div>
            )}
            <div aria-label={m.controlsLabel} className="flex items-center justify-between gap-3">
                {prev !== null ? (
                    <ControlSlot control="previous">
                        <Button
                            variant="secondary"
                            icon="chevronLeft"
                            onPress={model.requestGoPrev}
                            accessibilityLabel={fillTemplate(m.prevLabel, { name: m.stepNames[prev] })}
                            {...focusFor('previous')}
                        >
                            <ResponsiveStepLabel
                                short={m.prevLabelShort}
                                full={fillTemplate(m.prevLabel, { name: m.stepNames[prev] })}
                            />
                        </Button>
                    </ControlSlot>
                ) : (
                    <span />
                )}
                <ControlSlot control="saveDraft">
                    <Button
                        variant="secondary"
                        icon="save"
                        busy={model.submitting}
                        onPress={model.saveDraft}
                        accessibilityLabel={m.saveDraft}
                        {...focusFor('saveDraft')}
                    >
                        <ResponsiveStepLabel short={m.saveDraftShort} full={m.saveDraft} />
                    </Button>
                </ControlSlot>
                <ControlSlot control="primary">
                    {next !== null ? (
                        <Button
                            icon="chevronRight"
                            onPress={model.requestGoNext}
                            accessibilityLabel={fillTemplate(m.nextLabel, { name: m.stepNames[next] })}
                            {...focusFor('primary')}
                        >
                            <ResponsiveStepLabel
                                short={m.nextLabelShort}
                                full={fillTemplate(m.nextLabel, { name: m.stepNames[next] })}
                            />
                        </Button>
                    ) : (
                        <Button
                            icon="check"
                            busy={model.submitting}
                            onPress={model.requestPublish}
                            {...focusFor('primary')}
                        >
                            {m.publish}
                        </Button>
                    )}
                </ControlSlot>
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
