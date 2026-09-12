/**
 * @module @commise/features-recipes — the SpeedDial's platform-neutral contract and its pure keyboard model
 * (U34, owner ruling 2026-08-25).
 *
 * The dial is a floating action button that DISCLOSES a menu of creation destinations. Exactly one is wired
 * today — "Create from Scratch" — and the ruling's stated purpose is that the shape exists so a second
 * destination (004 import, 005 AI) is a DATA change rather than a component change. That is why `actions` is
 * a list rather than a single callback: it is a known, owner-stated requirement, not a speculative one.
 *
 * ⛔ A destination that is not real is NOT rendered here — not disabled, not "coming soon". Promising a
 * stopped feature is worse than omitting it (U34).
 *
 * ## Why the arrow-key arithmetic is a pure function
 *
 * Everything else a menu owes its keyboard user — the focus trap, Escape, focus restoration to the trigger,
 * dismissal on an outside pointer press — is owned by the platform machinery each leaf adapts
 * (`@radix-ui/react-dialog` on web, the React Native `Modal` window on native). What neither supplies is
 * arrow navigation between destinations, so that is the ONE decision this feature actually makes, and it is
 * isolated here: provable without a DOM, without a renderer, and without simulating focus.
 */

/** One destination on the dial. Adding a real one is a change to this LIST, not to either leaf. */
export interface SpeedDialAction {
    /** Stable identity for the rendered item; never shown. */
    readonly id: string;
    /** Localized, user-visible label — also the item's accessible name. */
    readonly label: string;
    /** Runs when the destination is chosen. The dial closes first, so this may navigate away. */
    readonly onSelect: () => void;
}

/**
 * Shared prop contract for the web (`SpeedDial.tsx`) and native (`SpeedDial.native.tsx`) leaves, so the two
 * platform renders cannot drift on shape.
 *
 * Every string is a caller-supplied prop rather than a `useMessages` call inside the leaf — the same idiom
 * as the design-system `ConfirmDialogProps` — which keeps both leaves pure `props → JSX` and lets a
 * component test drive them without an i18n provider.
 */
export interface SpeedDialProps {
    /** Accessible name of the collapsed FAB. Unchanged from the button this dial replaces. */
    readonly triggerLabel: string;
    /** Accessible name of the disclosed menu. */
    readonly menuLabel: string;
    /**
     * The destinations, in the order they are presented — at least one.
     *
     * ⛔ A NON-EMPTY tuple, not a plain array, because an empty dial is an illegal state that a leaf cannot
     * render safely: it would disclose a `role="menu"` with no `menuitem` children (invalid ARIA), trap
     * focus over nothing tabbable, and hand the open-focus handler an `undefined` element to focus —
     * stranding the very keyboard user the trap exists to protect. Making it unrepresentable is cheaper than
     * a guard in each leaf, and it costs the two call sites nothing: both already pass one literal.
     */
    readonly actions: readonly [SpeedDialAction, ...SpeedDialAction[]];
}

/**
 * Which destination an arrow press on the COLLAPSED trigger should open onto.
 *
 * ⛔ Enter and Space are deliberately absent: the trigger is a real `<button>`, which already synthesises a
 * click from both, and reporting them here as well would open the dial on `keydown` and immediately toggle
 * it shut on the synthesised click.
 *
 * @param key - The `KeyboardEvent.key` value.
 * @param count - How many destinations the dial has.
 * @returns The index to open onto, or `undefined` when the key does not open the dial.
 */
export function openIndexForTriggerKey(key: string, count: number): number | undefined {
    if (count <= 0) {
        return undefined;
    }

    if (key === 'ArrowDown') {
        return 0;
    }

    return key === 'ArrowUp' ? count - 1 : undefined;
}

/**
 * Where an arrow / Home / End press inside the OPEN menu should move focus.
 *
 * Wraps in both directions, so a dial can be walked round without reversing. Enter and Space are absent for
 * the same reason as in {@link openIndexForTriggerKey}: each item is a `<button>` that synthesises its own
 * click, and Escape belongs to the platform machinery, not to this decision.
 *
 * @param key - The `KeyboardEvent.key` value.
 * @param index - The currently focused destination.
 * @param count - How many destinations the dial has.
 * @returns The index to focus, or `undefined` when the key does not navigate.
 */
export function nextMenuIndex(key: string, index: number, count: number): number | undefined {
    if (count <= 0) {
        return undefined;
    }

    switch (key) {
        case 'ArrowDown':
            return (index + 1) % count;
        case 'ArrowUp':
            return (index - 1 + count) % count;
        case 'Home':
            return 0;
        case 'End':
            return count - 1;
        default:
            return undefined;
    }
}

/**
 * The native leaf's props: {@link SpeedDialProps} plus the backdrop's accessible name.
 *
 * ⛔ Deliberately NOT part of the shared contract. On native the backdrop is a real tap target and must be
 * announced as one; on web everything outside the dialog content is `aria-hidden` while the dial is open, so
 * a labelled dismiss surface there is not merely unnecessary but unreachable — dismissal is owned by the
 * dismissable layer instead. Widening the shared shape would put a string on the web leaf that nothing could
 * ever read.
 */
export interface SpeedDialNativeProps extends SpeedDialProps {
    /** Accessible name of the backdrop behind the open menu; pressing it dismisses the dial. */
    readonly dismissLabel: string;
}
