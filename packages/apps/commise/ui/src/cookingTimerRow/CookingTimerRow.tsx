/**
 * @module @commise/ui/cooking-timer-row — the web {@link CookingTimerRow}: one frame that holds a body slot and the
 * row's icon-button actions. The state picks which actions exist and which glyphs they draw, and nothing else: a
 * running
 * timer shows Pause and Cancel, a paused one Resume and Cancel, a finished one a single Stop.
 *
 * The frame has no role and no name of its own, and it is not a live region: the controls and the body name themselves.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Slot — `body` is filled by the caller
 */
import type { FC } from 'react';

import { IconButton } from '../iconButton/IconButton.js';
import type { CookingTimerRowProps } from './props.js';
import { timerRowActions } from './timerRowActions.js';

/** The cooking timer row frame. */
export const CookingTimerRow: FC<CookingTimerRowProps> = ({ state, body }) => (
    <div className="flex items-center gap-2">
        {body}
        {timerRowActions(state).map(({ icon, action }) => (
            <IconButton key={icon} icon={icon} accessibilityLabel={action.label} onPress={action.onPress} />
        ))}
    </div>
);
