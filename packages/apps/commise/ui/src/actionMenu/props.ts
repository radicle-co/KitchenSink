/**
 * @module @commise/ui/action-menu — the platform-neutral contract of the design-system `ActionMenu`: a row's actions
 * behind one `⋮` trigger (`docs/design/ingredientStatusExplanation.md` §3a). The web leaf (`ActionMenu.tsx`) is a
 * Radix DropdownMenu, which carries the full APG Menu Button keyboard model; the native leaf
 * (`ActionMenu.native.tsx`) is a bottom sheet of `menuitem` rows, which cannot obscure the row it acts on.
 *
 * ⛔ Distinct from `MoreActionsMenu` (`@commise/features-recipes` actions): that menu mixes menu items with a radio
 * group and so declined roving focus; this one holds uniform menu items and OWES the full APG model (§3a).
 *
 * Every string is a caller-supplied, already-localised prop; the caller orders the items (remedy first).
 *
 * The row editor's three rules live here, once for both leaves (`docs/design/rowEditorOpenDecisions.md` system change
 * 6, `docs/design/rowEditorBlueprint.md` decision 5):
 * - a chosen item is HELD and runs only once the menu has gone, so whatever it opens never meets the menu on screen;
 * - while it waits, a press on the trigger does nothing;
 * - an open menu keeps the items it opened with, so nothing appears under the cook's finger.
 */

/** One action in the menu. */
export interface ActionMenuItem {
    /** Stable identity among the items (the React key). */
    readonly key: string;
    /** The item's localised label. */
    readonly label: string;
    readonly onSelect: () => void;
    /** `destructive` items read in the error tone. A display derivation only. */
    readonly tone?: 'default' | 'destructive';
}

/** Props for the `ActionMenu` leaves (web and native). */
export interface ActionMenuProps {
    /** The trigger's accessible name. ⛔ It names its row ("Actions for {food}"), never a bare "More". */
    readonly triggerLabel: string;
    /** The native sheet's title (the row it acts on). */
    readonly title: string;
    /** The native sheet's Close control name. */
    readonly closeLabel: string;
    /** The actions, in the order shown. Read when the menu opens; an open menu keeps the list it opened with. */
    readonly items: readonly ActionMenuItem[];
    /**
     * A host asks for focus on the trigger: keyboard focus on web, the screen-reader cursor on native (a Change food
     * cancel returns there long after the menu closed). A LEVEL, not a counter: it stands until
     * {@link onFocusRequestHandled} acknowledges it, so a trigger that mounts while the request stands still takes it.
     */
    readonly focusRequested?: boolean;
    /** Called once the trigger has taken a requested focus; the host clears its request here. */
    readonly onFocusRequestHandled?: () => void;
    /**
     * Work on the row is in flight, so its actions are unavailable: the trigger is `aria-disabled`, stays focusable and
     * opens nothing (`docs/design/ingredientStatusExplanation.md`, "Busy and disabled", rule 2).
     */
    readonly unavailable?: boolean;
}
