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
    /** The actions, in the order shown. */
    readonly items: readonly ActionMenuItem[];
}
