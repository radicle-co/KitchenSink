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
 */
import type { FC } from 'react';
import { styled, View } from 'tamagui';

import { IconButton } from '../iconButton/IconButton.native.js';
import { ICON_BUTTON_CIRCLE_PX } from '../iconButton/props.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import type { CookingTimerRowProps } from './props.js';
import { timerRowActions } from './timerRowActions.js';

/** The gap between two 44 circles, in points. */
const CIRCLE_GAP_PX = 8;

/** The row: the body, then the actions. */
const Row = styled(View, {
    name: 'CookingTimerRow',
    flexDirection: 'row',
    alignItems: 'center',
});

/** The native cooking timer row frame. */
export const CookingTimerRow: FC<CookingTimerRowProps> = ({ state, body }) => (
    <Row gap={CIRCLE_GAP_PX - (touchFloor() - ICON_BUTTON_CIRCLE_PX)}>
        {body}
        {timerRowActions(state).map(({ icon, action }) => (
            <IconButton key={icon} icon={icon} accessibilityLabel={action.label} onPress={action.onPress} />
        ))}
    </Row>
);
