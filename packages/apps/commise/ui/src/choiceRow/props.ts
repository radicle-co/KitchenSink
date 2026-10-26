/**
 * @module @commise/ui/choice-row — the shared contract of the design-system `ChoiceRow`: one row of a list of choices
 * whose press IS the choice, such as a food a matched ingredient line could be, or "Keep … as written"
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). A button, never a radio: in a radio group the
 * arrow keys would choose the row they land on.
 *
 * The row owns its states — chosen (a trailing check), busy (a spinner, its send in flight), refused (a sibling's send
 * in flight) — and a host's focus request. Its label is the caller's (`children`), so a tagged food and the quiet keep
 * row share one row. Every string is the caller's, already localised.
 */
import type { ReactNode } from 'react';

/** Props for the `ChoiceRow` leaves (web and native). */
export interface ChoiceRowProps {
    /** The row's label: an `OptionLabel`, or the caller's own text. Display only; the row owns the press. */
    readonly children: ReactNode;
    /** The accessible name. It must start with the visible label (WCAG 2.5.3) and say ", chosen" when chosen. */
    readonly accessibilityLabel: string;
    /** The row holds the current choice: a check is drawn after the label. */
    readonly chosen: boolean;
    /** This row's send is in flight: a spinner replaces the check, it reads busy, and its press is refused. */
    readonly busy: boolean;
    /** Another row's send is in flight: its press is refused, and it stays focusable on web. */
    readonly refused: boolean;
    /** The row was pressed. Never called while busy or refused. */
    readonly onPress: () => void;
    /**
     * A host asks for focus on the row: keyboard focus on web, the screen-reader cursor on native. A LEVEL, as on
     * `Button`: it stands until {@link onFocusRequestHandled} acknowledges it.
     */
    readonly focusRequested?: boolean;
    /** Called once the row has taken a requested focus; the host clears its request here. */
    readonly onFocusRequestHandled?: () => void;
}
