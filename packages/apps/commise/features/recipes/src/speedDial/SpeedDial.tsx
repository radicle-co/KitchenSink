'use client';

/**
 * @module @commise/features-recipes — the web SpeedDial FAB (U34, owner ruling 2026-08-25).
 *
 * The floating create control, as a MENU BUTTON: the same pinned FAB a cook already presses, which now
 * discloses the creation destinations instead of running the only one. Exactly one destination is wired
 * today; Scan / Import / AI belong to features 004 and 005 and are **not rendered at all** — not disabled,
 * not "coming soon" — because promising a stopped feature is worse than omitting it.
 *
 * PATTERN — Menu Button (WAI-ARIA) implemented as an **Adapter** over `@radix-ui/react-dropdown-menu`, the
 * primitive Radix names for this exact use case: _"Displays a menu to the user—such as a set of actions or
 * functions—triggered by a button."_ It owns roving focus, arrow navigation with wrap-around, Home/End,
 * typeahead, Escape and outside-pointer dismissal, and focus restoration to the trigger.
 *
 * ## ⛔ `modal={false}` IS THE WHOLE POINT OF THE SWAP — do not remove it
 *
 * This adapted `@radix-ui/react-dialog` until 2026-08-27. The defect that forced the change was NOT missing
 * keyboard support — Dialog gave us a focus trap and dismissal — it was that `Dialog.Content` calls
 * `hideOthers(content)`, which `aria-hidden`s everything outside the content **including the trigger**. So
 * the trigger's `aria-expanded` was correct in the DOM and unreachable to a screen reader, and
 * `recipeCreateDial.spec.ts` had to assert the deviation rather than the property.
 *
 * ⚠️ **A naive swap does not fix that.** `MenuRootContentModal` calls the SAME `hideOthers`, and
 * `DropdownMenu.Root`'s `modal` prop DEFAULTS TO TRUE. Only `modal={false}` selects
 * `MenuRootContentNonModal`, which never calls it — so `aria-expanded` becomes reachable. Read out of the
 * installed source (`@radix-ui/react-menu`), not assumed.
 *
 * ## ⚠️ WHAT THIS STILL DOES NOT FIX, stated rather than implied
 *
 * **Radix swallows Tab in DropdownMenu too**: `MenuContentImpl`'s `onKeyDown` does
 * `if (event.key === "Tab") event.preventDefault()` unconditionally, regardless of `modal`. A maintainer
 * closed the request to change it in 2022 (_"we had decided that menus aren't tabbable"_) and
 * [PR #3833](https://github.com/radix-ui/primitives/pull/3833) has sat open since March 2026. So Tab does
 * not close the dial and move on, as the Menu Button pattern prescribes. What `modal={false}` changes is
 * that focus is no longer TRAPPED — Tab is inert rather than cycling, which is a smaller deviation, not an
 * absent one. No React menu primitive gets this right today; the deviation is asserted in the unit suite.
 *
 * ## What was DELETED, and why it is not a loss
 *
 * `nextMenuIndex` and `openIndexForTriggerKey` are gone: the primitive supplies roving focus, arrow
 * wrap-around, Home/End and typeahead, which is strictly more than the hand-rolled arithmetic covered. The
 * `itemRefs` array, the `focusIndex` state and the `onOpenAutoFocus` override went with them. `model.ts`
 * keeps `SpeedDialProps`/`SpeedDialAction` and the non-empty-tuple invariant, because the native leaf still
 * needs them and the two platforms must not drift on shape.
 *
 * @pattern Menu Button (WAI-ARIA) as an Adapter over `@radix-ui/react-dropdown-menu`, the primitive Radix names for
 *     exactly this use case.
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useState, type ComponentPropsWithoutRef, type FC, type KeyboardEvent } from 'react';

import { enterTransitionClassName } from '@commise/ui/motion';

import { PlusIcon } from '../form/icons.js';
import { type SpeedDialProps } from './model.js';

/**
 * `DropdownMenu.Content`, with the one prop Radix IMPLEMENTS but does not DECLARE.
 *
 * ⛔ A TYPE GAP, NOT A CAPABILITY GAP, and the distinction is why this is a cast rather than a workaround.
 * `MenuContentImpl` destructures `onOpenAutoFocus` and composes it into `FocusScope`'s `onMountAutoFocus` —
 * read out of the installed source. Only the public `MenuRootContentTypeProps` omits it, declaring
 * `onCloseAutoFocus` and no open-side counterpart.
 *
 * ⚠️ A cast on the COMPONENT TYPE, narrowed to exactly the missing prop — not `any`, not `@ts-expect-error`,
 * both of which the coding standards forbid outright. Everything else about the component stays typed, so a
 * misspelt prop or a wrong handler signature is still a compile error.
 */
const MenuContent = DropdownMenu.Content as FC<
    ComponentPropsWithoutRef<typeof DropdownMenu.Content> & {
        /** Fired when the menu takes focus on open. `preventDefault()` to place focus yourself. */
        readonly onOpenAutoFocus?: ((event: Event) => void) | undefined;
    }
>;

/**
 * The dial's whole open state: closed, or open with the end of the list this open should land focus on.
 *
 * ⛔ NOT an `open` boolean beside an `openOnLast` ref. The landing intent belongs to ONE open — it is set in
 * the same event that opens the dial and consumed by that open's focus callback — so folding it into the
 * open state costs no extra render and makes "open with no landing intent" and "landing intent while
 * closed" unrepresentable. A ref could hold both, which is why the ref version needed TWO resets (one in
 * `onOpenChange`, one after reading it) to stay honest; the state version needs none, because a close
 * discards the intent with the open it belonged to.
 */
type DialState =
    /** Closed. There is no landing intent because there is no open to land. */
    | { readonly open: false }
    /** Open, landing focus on this end of the destination list. */
    | { readonly open: true; readonly landOn: 'first' | 'last' };

export const SpeedDial: FC<SpeedDialProps> = ({ triggerLabel, menuLabel, actions }) => {
    const [dial, setDial] = useState<DialState>({ open: false });

    /**
     * ⛔ ARROW-UP OPENS ONTO THE LAST DESTINATION, and this handler exists because RADIX DOES NOT DO IT.
     *
     * Read out of the installed source: `DropdownMenuTrigger`'s own `onKeyDown` handles `Enter`, `" "` and
     * `ArrowDown` — and nothing else. WAI-ARIA's Menu Button pattern prescribes ArrowUp as well ("opens the
     * menu and moves focus to the LAST item"), the adapter this replaced supported it, and dropping it in a
     * refactor would be a silent capability loss rather than a considered trade.
     *
     * ⚠️ Radix composes handlers as `composeEventHandlers(props.onKeyDown, …)`, so this runs BEFORE the
     * primitive's — which is why it can open the menu without fighting it.
     */
    const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
        if (event.key !== 'ArrowUp') {
            return;
        }

        event.preventDefault();
        setDial({ open: true, landOn: 'last' });
    };

    return (
        // ⛔ NOT modal. See the module docstring: `modal` defaults to TRUE and a modal menu calls `hideOthers`,
        // which is the exact defect this swap exists to remove.
        <DropdownMenu.Root
            modal={false}
            open={dial.open}
            // Every open Radix itself initiates (pointer, Enter/Space, ArrowDown) lands on the FIRST
            // destination — only `onTriggerKeyDown`'s ArrowUp asks for the last, and Radix never sees that
            // key. A close discards the intent along with the open, so a pointer user cannot inherit a
            // previous ArrowUp's landing.
            onOpenChange={(next) => setDial(next ? { open: true, landOn: 'first' } : { open: false })}
        >
            {/* The offset is DERIVED, not hardcoded — inherited verbatim from the FAB this replaces. It clears
            the narrow-breakpoint bottom nav plus the device safe-area inset, and drops to the base offset
            once that nav becomes a desktop sidebar at the shared `lg` cutover. */}
            <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 lg:bottom-8">
                <DropdownMenu.Trigger
                    aria-label={triggerLabel}
                    onKeyDown={onTriggerKeyDown}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-seafoam text-white shadow-lg transition hover:bg-ocean-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-dark focus-visible:ring-offset-2"
                >
                    {/* An SVG, not the text "+": flex centres the LINE BOX but ink is placed by the BASELINE,
                    so a "+" character paints ~1.7px low and no centring property can correct it. This
                    glyph's extents are symmetric about the viewBox centre, matching the mockup. */}
                    <PlusIcon className="size-6" />
                </DropdownMenu.Trigger>

                {/* ⛔ NOT portalled, deliberately. `DropdownMenu.Portal` would move the content to `document.body`
                and hand positioning to `@radix-ui/react-popper`, which measures the trigger at open time.
                Positioning it in-flow against THIS anchor keeps the menu on the same derived offset
                expression as the FAB rather than a second copy of it, and keeps it inside the `z-40`
                stacking context the app shell's chrome is layered against.

                ⚠️ There is no overlay here and that is not an omission to "fix": the anchor is a `z-40`
                stacking context, so a scrim within it paints UNDER the narrow-breakpoint bottom tab bar,
                which is `z-50`. The result would be a dimmed page with one bright bar across the foot of it
                that answers no taps. Non-modal also means the page still scrolls behind the open dial —
                acceptable for a corner menu pinned to the viewport that dismisses on the next outside
                press, and recorded so nobody re-adds the scrim believing it costs nothing. */}
                <MenuContent
                    aria-label={menuLabel}
                    // ⛔ RADIX'S DEFAULT LABEL IS SUPPRESSED, and it has to be. The primitive sets
                    // `aria-labelledby` to the TRIGGER's id, and `aria-labelledby` WINS over `aria-label` in
                    // accessible-name computation — so without this the disclosed menu is announced "New
                    // recipe", the name of the button that opened it, and `menuLabel` is silently dead. The
                    // contract carries `triggerLabel` and `menuLabel` as separate props precisely because the
                    // control and the thing it discloses are different objects to a screen-reader user.
                    aria-labelledby={undefined}
                    side="top"
                    align="end"
                    sideOffset={12}
                    // ⛔ WRAP-AROUND, which Radix does NOT do by default (`loop = false` in `MenuContentImpl`).
                    // The adapter this replaced wrapped — `nextMenuIndex` was modular arithmetic — and a list
                    // that dead-ends at its last item makes a keyboard user reverse out of it. Measured before
                    // this line: ArrowDown went `From scratch -> Import -> Import`.
                    loop
                    /**
                     * ⛔ THE DIAL OPENS ONTO A DESTINATION, never onto the menu container — and ArrowUp lands on
                     * the LAST one, which the WAI-ARIA Menu Button pattern prescribes and Radix's trigger does
                     * not implement (its own handler covers `Enter`, `" "` and `ArrowDown`, nothing else).
                     *
                     * ⚠️ Queried off the content rather than held in a ref array. Refs would be the
                     * near-forbidden kind — bookkeeping the DOM already holds — and this runs once per open.
                     */
                    onOpenAutoFocus={(event) => {
                        const content = event.currentTarget;

                        if (!(content instanceof HTMLElement)) {
                            return;
                        }

                        const items = content.querySelectorAll<HTMLElement>('[role="menuitem"]');
                        // `dial.open` is true whenever this fires — the callback only exists on a mounted
                        // `MenuContent` — but the union is narrowed rather than asserted, so a future state
                        // that can render content while closed is a compile error, not a silent `'first'`.
                        const target = dial.open && dial.landOn === 'last' ? items[items.length - 1] : items[0];

                        if (target === undefined) {
                            return;
                        }

                        event.preventDefault();
                        target.focus();
                    }}
                    // The design-system enter utility rides THIS element, not a wrapper around it. A pure-CSS
                    // mount animation fires when the element carrying it is inserted, and this is the only thing
                    // here that is inserted on open — an always-rendered wrapper would have played its keyframe
                    // once, at list render, over an empty box. `motion-safe:` is the gate, so a reduce-motion
                    // viewer gets no animation and no hidden from-state.
                    className={`${enterTransitionClassName} flex min-w-48 flex-col items-stretch gap-1 rounded-2xl border border-border bg-card p-2 shadow-lg`}
                >
                    {actions.map((action) => (
                        <DropdownMenu.Item
                            key={action.id}
                            // ⛔ `onSelect`, not `onClick`. Radix fires it for a pointer press AND for Enter and
                            // Space on the focused item, and closes the menu itself — so the close-then-run
                            // ordering the old adapter hand-wrote is the primitive's job now.
                            onSelect={action.onSelect}
                            // ⚠️ The focus indicator rides `data-[highlighted]`, NOT `focus-visible`. Radix's
                            // roving focus marks the active item with that attribute, and a `:focus-visible`
                            // ring would go unpainted for a keyboard user arrowing through the list — the
                            // affordance would exist in the stylesheet and never appear on screen.
                            className="min-h-11 cursor-pointer whitespace-nowrap rounded-xl px-4 py-2 text-left text-body-sm font-medium text-charcoal transition data-[highlighted]:bg-pearl data-[highlighted]:outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-seafoam focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam"
                        >
                            {action.label}
                        </DropdownMenu.Item>
                    ))}
                </MenuContent>
            </div>
        </DropdownMenu.Root>
    );
};
