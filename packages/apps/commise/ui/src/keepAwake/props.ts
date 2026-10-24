/**
 * @module @commise/ui/keep-awake — the platform-neutral contract of the design-system `KeepAwakeToggle` ("Screen on",
 * `docs/design/uiOverhaul/buildSpec.md` §6.3): a switch the cook turns on to keep the screen awake while they cook.
 *
 * The toggle is controlled: the orchestration layer owns the one `on` state and holds the lock with `useKeepAwake`, so
 * the two positions the detail page draws it in (the action row from a 720 body, the section switch below it) can never
 * hold two locks or disagree.
 */

/** How the toggle shows itself: with its visible label, or as its glyph alone (still named in full). */
export type KeepAwakeDisplay = 'labelled' | 'icon';

/** Props for the `KeepAwakeToggle` leaves (web and native). */
export interface KeepAwakeToggleProps {
    /** Whether the screen is being kept awake. */
    readonly on: boolean;
    /** Called with the state the cook asked for. */
    readonly onChange: (on: boolean) => void;
    /** The localised name, "Screen on". It is the accessible name in both displays. */
    readonly label: string;
    /** Labelled (from a 720 body) or icon-only (in the section switch). */
    readonly display: KeepAwakeDisplay;
}
