/**
 * @module @commise/ui/icon-button — the web design-system {@link IconButton}: one glyph in a 44 px target, named by the
 * caller. The target is a fixed 44 px square and never grows with the text, and neither does the 24 glyph inside it (designer
 * D85: an icon-only control keeps its pixel size). A press scales the control through {@link PressScale} and fills it with the
 * neutral press row.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Decorator — `PressScale` adds the press motion around the button
 * @pattern Style Recipe — `TOUCH_TARGET_CLASS.fixed` and the focus ring and press fill rows are the whole look
 */
import type { FC } from 'react';

import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';
import { Icon } from '../icon/Icon.js';
import { PressScale } from '../pressScale/PressScale.js';
import { PRESS_FILL_CLASS } from '../surfaceTone/surfaceToneClass.js';
import { TOUCH_TARGET_CLASS } from '../touchTarget/touchTargetClass.js';
import type { IconButtonProps } from './props.js';

/** The control's classes, written whole so Tailwind finds each one. */
const ICON_BUTTON_CLASS = `inline-flex ${TOUCH_TARGET_CLASS.fixed} shrink-0 items-center justify-center rounded-full text-ink ${PRESS_FILL_CLASS.pointer} ${FOCUS_RING_CLASS.offset}`;

/** The design-system icon button. */
export const IconButton: FC<IconButtonProps> = ({ icon, accessibilityLabel, onPress }) => (
    <PressScale>
        <button
            type="button"
            aria-label={accessibilityLabel}
            className={ICON_BUTTON_CLASS}
            onClick={() => {
                onPress();
            }}
        >
            <Icon name={icon} size={24} />
        </button>
    </PressScale>
);
