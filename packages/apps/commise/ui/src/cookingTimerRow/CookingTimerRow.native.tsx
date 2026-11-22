/**
 * @module @commise/ui/cooking-timer-row — the native {@link CookingTimerRow}: one frame that holds a body slot and the
 * row's icon-button actions. The state picks which actions exist and which glyphs they draw, and nothing else.
 *
 * The frame is NOT `accessible` (that would fold its buttons into one element) and has no name of its own; the buttons
 * and the body name themselves. It is not a live region. Each action's frame is the touch floor (48 dp on Android), and
 * the gap between two is `8 - (floor - 44)`, so their 44 circles sit 8 apart on both platforms and the frames never
 * overlap. Styled with Tamagui only (ADR-0080).
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Slot — `body` is filled by the caller
 * @pattern Registry — the state-to-actions table below is the one place the glyphs are chosen
 */
import type { FC } from 'react';
import { styled, View } from 'tamagui';

import { IconButton } from '../iconButton/IconButton.native.js';
import type { IconName } from '../icon/props.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import type { CookingTimerRowProps, CookingTimerRowState, TimerRowAction } from './props.js';

/** The gap between two 44 circles, in points. */
const CIRCLE_GAP_PX = 8;

/** The side of a circle, in points. */
const CIRCLE_PX = 44;

/** The row: the body, then the actions. */
const Row = styled(View, {
    name: 'CookingTimerRow',
    flexDirection: 'row',
    alignItems: 'center',
});

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

/** The native cooking timer row frame. */
export const CookingTimerRow: FC<CookingTimerRowProps> = ({ state, body }) => (
    <Row gap={CIRCLE_GAP_PX - (touchFloor() - CIRCLE_PX)}>
        {body}
        {actionsOf(state).map(({ icon, action }) => (
            <IconButton key={icon} icon={icon} accessibilityLabel={action.label} onPress={action.onPress} />
        ))}
    </Row>
);
