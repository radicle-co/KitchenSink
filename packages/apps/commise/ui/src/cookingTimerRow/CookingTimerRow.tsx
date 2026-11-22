/**
 * @module @commise/ui/cooking-timer-row — the web {@link CookingTimerRow}: one frame that holds a body slot and the
 * row's icon-button actions. The state picks which actions exist and which glyphs they draw, and nothing else: a running
 * timer shows Pause and Cancel, a paused one Resume and Cancel, a finished one a single Stop.
 *
 * The frame has no role and no name of its own, and it is not a live region: the controls and the body name themselves.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Slot — `body` is filled by the caller
 * @pattern Registry — the state-to-actions table below is the one place the glyphs are chosen
 */
import type { FC } from 'react';

import { IconButton } from '../iconButton/IconButton.js';
import type { CookingTimerRowProps, CookingTimerRowState, TimerRowAction } from './props.js';
import type { IconName } from '../icon/props.js';

/** One action to draw: its glyph and what it does. */
interface DrawnAction {
    readonly icon: IconName;
    readonly action: TimerRowAction;
}

/** The actions a state offers, in reading order. */
function actionsOf(state: CookingTimerRowState): readonly DrawnAction[] {
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

/** The cooking timer row frame. */
export const CookingTimerRow: FC<CookingTimerRowProps> = ({ state, body }) => (
    <div className="flex items-center gap-2">
        {body}
        {actionsOf(state).map(({ icon, action }) => (
            <IconButton key={icon} icon={icon} accessibilityLabel={action.label} onPress={action.onPress} />
        ))}
    </div>
);
