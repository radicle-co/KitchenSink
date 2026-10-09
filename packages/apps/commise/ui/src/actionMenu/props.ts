/**
 * @module @commise/ui/action-menu — the platform-neutral contract of the design-system `ActionMenu`: a row's actions
 * behind one `⋯` trigger (the `ellipsis` glyph; the vertical ⋮ is retired, `docs/design/uiOverhaul/buildSpec.md` §1.7) (`docs/design/ingredientStatusExplanation.md` §3a). The web leaf (`ActionMenu.tsx`) is a
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
 *
 * "Destructive last, after a divider" (§1.11) is STRUCTURAL: the destructive action is its own field, not a tone on an
 * item, so no caller can put it anywhere else or draw two.
 */
import type { IconName } from '../icon/props.js';

/** One action in the menu. */
export interface ActionMenuItem {
    /** Stable identity among the menu's actions, the destructive one included. */
    readonly id: string;
    /** The item's localised label. */
    readonly label: string;
    /** A glyph before the label. */
    readonly icon?: IconName;
    readonly onSelect: () => void;
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
    /** The one destructive action, if any: drawn last, after a divider, in the danger label. */
    readonly destructiveItem?: ActionMenuItem;
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

/** What an open menu shows: its actions and its destructive action, as they were when it opened. */
export interface ActionMenuSnapshot {
    readonly items: readonly ActionMenuItem[];
    readonly destructiveItem: ActionMenuItem | undefined;
}

/**
 * The host's current handler for a chosen action, looked up among BOTH its actions and its destructive one. Pure.
 *
 * ⛔ The held item runs the host's handler AT DISMISSAL, never the one the open menu was rendered with; a lookup that
 * forgot the destructive field would close the menu on Delete and run nothing.
 *
 * @param items - The host's actions now.
 * @param destructiveItem - The host's destructive action now.
 * @param id - The chosen action's id.
 * @returns The action, or `undefined` when the host no longer offers it.
 */
export function actionNamed(
    items: readonly ActionMenuItem[],
    destructiveItem: ActionMenuItem | undefined,
    id: string,
): ActionMenuItem | undefined {
    return [...items, ...(destructiveItem === undefined ? [] : [destructiveItem])].find((item) => item.id === id);
}
