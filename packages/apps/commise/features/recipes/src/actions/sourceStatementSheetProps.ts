/**
 * @module @commise/features-recipes/actions — the contract `SourceStatementSheet`'s web and native leaves share (ADR-0095).
 */
import type { StatementSheetAction, StatementSheetState, StatementSurface } from './sourceStatement.js';

/**
 * Props for `SourceStatementSheet`: a pure render of the sheet's state. The state is held by `useStatementSheet`, so the
 * two leaves cannot differ about what a phase is.
 */
export interface SourceStatementSheetProps {
    /** Whether the sheet is shown; closed, it renders nothing. */
    readonly open: boolean;
    /** Why it is asked: Publish, Make public, or one of the Source row's three sheets (ADR-0100). */
    readonly surface: StatementSurface;
    /** What the cook has done in this opening. */
    readonly state: StatementSheetState;
    /** Report what the cook did. */
    readonly dispatch: (action: StatementSheetAction) => void;
    /** The recipe's source is confirmed already, so a web page and a book show the lock note too. Defaults to `false`. */
    readonly recipeConfirmed?: boolean;
    /** What to say when the last change failed, in place of the general failure (the slots-full refusal, a lock refusal). */
    readonly failureText?: string;
    /** The cook pressed the confirm. */
    readonly onConfirm: () => void;
    /**
     * Keep as draft, or Cancel: nothing is sent. EVERY way out calls this (Close, Escape, the scrim, a swipe, Android Back),
     * and none does while the change is in flight.
     */
    readonly onDismiss: () => void;
}
