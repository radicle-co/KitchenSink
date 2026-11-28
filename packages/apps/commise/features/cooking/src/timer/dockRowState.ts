/**
 * @module dockRowState — which actions a dock row carries, in the shape the timer row frame takes.
 *
 * @pattern Visitor — an exhaustive switch over the row's discriminated union
 */
import type { CookingTimerRowState } from '@commise/ui/cooking-timer-row';

import type { TimerDockRow } from './useCookingTimerDock.js';

/**
 * The row frame's state for a dock row.
 *
 * @param row - The row with its controls.
 * @returns Pause and Cancel, Resume and Cancel, or Stop, each with its label, press and focus request. Pure.
 */
export function dockRowState(row: TimerDockRow): CookingTimerRowState {
    switch (row.kind) {
        case 'running':
            return { kind: 'running', pause: row.primary, cancel: row.secondary };
        case 'paused':
            return { kind: 'paused', resume: row.primary, cancel: row.secondary };
        case 'done':
            return { kind: 'done', stop: row.primary };
    }
}
