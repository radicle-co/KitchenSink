/**
 * @module @commise/ui/keep-awake — the platform-neutral contract of the design-system `KeepAwakeToggle` ("Screen on",
 * `docs/design/uiOverhaul/buildSpec.md` §6.3): a switch the cook turns on to keep the screen awake while they cook.
 *
 * It is a QUIET text action in the page's action row (the sun glyph and the label, no fill and no outline), not a pill of
 * its own (designer, iosBatch1). The toggle is controlled: the orchestration layer owns the one `on` state and holds the
 * lock with `useKeepAwake`.
 */

/** Props for the `KeepAwakeToggle` leaves (web and native). */
export interface KeepAwakeToggleProps {
    /** Whether the screen is being kept awake. */
    readonly on: boolean;
    /** Called with the state the cook asked for. */
    readonly onChange: (on: boolean) => void;
    /** The localised name, "Screen on": the visible label and the accessible name. */
    readonly label: string;
    /**
     * What the switch does, as its accessibility hint (web: its description): spoken after the name and the state, and never
     * drawn (designer, after iosBatch1).
     */
    readonly hint?: string;
}
