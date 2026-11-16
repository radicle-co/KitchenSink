/**
 * @module @commise/features-recipes/actions — the contract `SourceStatementSheet`'s web and native leaves share (ADR-0092).
 */
import type { StatementSheetAction, StatementSheetState, StatementSurface } from './sourceStatement.js';

/**
 * Props for `SourceStatementSheet`: a pure render of the sheet's state. The state is held by `useStatementSheet`, so the
 * two leaves cannot differ about what a phase is.
 */
export interface SourceStatementSheetProps {
    /** Whether the sheet is shown; closed, it renders nothing. */
    readonly open: boolean;
    /** Where it is asked: the editor offers five answers and "Publish", the recipe page four and "Make public". */
    readonly surface: StatementSurface;
    /** What the cook has done in this opening. */
    readonly state: StatementSheetState;
    /** Report what the cook did. */
    readonly dispatch: (action: StatementSheetAction) => void;
    /** The cook pressed the confirm. */
    readonly onConfirm: () => void;
    /**
     * Keep as draft, or Cancel: nothing is sent. EVERY way out calls this (Close, Escape, the scrim, a swipe, Android Back),
     * and none does while the change is in flight.
     */
    readonly onDismiss: () => void;
}
