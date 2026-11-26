/**
 * @module @commise/ui/cooking-timer-row — the row's one rule: which actions a state offers, and which glyph each one
 * draws. Both platforms' row leaves read it, so a state cannot show a different control on each.
 *
 * @pattern Registry — a state-to-actions table, chosen by an exhaustive switch over the state's `kind`
 */
import type { IconName } from '../icon/props.js';
import type { CookingTimerRowState, TimerRowAction } from './props.js';

/** One action to draw: its glyph and what it does. */
export interface DrawnTimerAction {
    readonly icon: IconName;
    readonly action: TimerRowAction;
}

/**
 * The actions a state offers, in reading order.
 *
 * @param state - The row's state.
 * @returns Running: Pause then Cancel. Paused: Resume then Cancel. Done: Stop alone.
 */
export function timerRowActions(state: CookingTimerRowState): readonly DrawnTimerAction[] {
    switch (state.kind) {
        case 'running':
            return [
                { icon: 'pause', action: state.pause },
                { icon: 'x', action: state.cancel },
            ];
        case 'paused':
            return [
                { icon: 'play', action: state.resume },
                { icon: 'x', action: state.cancel },
            ];
        case 'done':
            return [{ icon: 'x', action: state.stop }];
    }
}
