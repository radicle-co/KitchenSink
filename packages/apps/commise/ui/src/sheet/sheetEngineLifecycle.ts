/**
 * @module @commise/ui/sheet — when the sheet's window may leave, given what Tamagui's Sheet reports.
 *
 * The window stays up until the engine has finished the exit animation; otherwise the window vanishes first and the
 * slide never shows. The engine says so through `onTransition`; this module is the pure reading of that event and the
 * one constant for the case where it never says.
 */
/**
 * How long the window waits for the engine's completion report before it leaves anyway, in ms. A driver can drop a
 * completion callback, and a transparent window left up would block every touch behind it. The spring settles well inside
 * this (the engine's own rest thresholds aim for 0.5 to 0.8 s), so the fallback only ever fires on a lost report.
 */
export const SHEET_EXIT_FALLBACK_MS = 1200;

/** The part of the engine's transition report this module reads (Tamagui's `SheetTransitionEvent`). */
export interface EngineTransition {
    readonly phase: 'start' | 'end';
    readonly cause: 'open' | 'close' | 'snap';
    readonly finished?: boolean;
}

/**
 * Whether an engine report is the end of a completed close. A close that was interrupted (`finished` false) or any open
 * or snap is not. Pure.
 *
 * @param event - The engine's transition report.
 */
export function isFinishedClose(event: EngineTransition): boolean {
    return event.phase === 'end' && event.cause === 'close' && event.finished === true;
}
