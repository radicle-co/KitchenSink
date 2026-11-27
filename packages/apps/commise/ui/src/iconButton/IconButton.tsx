/**
 * @module @commise/ui/icon-button — the web design-system {@link IconButton}: one glyph in a 44 px target, named by the
 * caller. The target is a fixed 44 px square and never grows with the text, and neither does the 24 glyph inside it: an
 * icon-only control keeps its pixel size. A press scales the control through {@link PressScale} and fills it with the
 * neutral press row. A disabled control is refused but stays focusable, and dims to 40%.
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Decorator — `PressScale` adds the press motion around the button
 * @pattern Style Recipe — `ICON_BUTTON_CLASS` (the target, ring and press fill) plus one tone class is the whole look,
 *     shared with a control that keeps its own element
 */
import type { FC } from 'react';

import { refusedPressProps } from '../button/busyControlProps.js';
import { FOCUS_RING_CLASS } from '../focusRing/focusRingClass.js';
import { Icon } from '../icon/Icon.js';
import { PressScale } from '../pressScale/PressScale.js';
import { PRESS_FILL_CLASS } from '../surfaceTone/surfaceToneClass.js';
import { TOUCH_TARGET_CLASS } from '../touchTarget/touchTargetClass.js';
import type { IconButtonProps, IconButtonTone } from './props.js';

/**
 * The control's classes, written whole so Tailwind finds each one. They carry no colour: a control that keeps its own
 * element (a Radix trigger) shares this recipe and picks a tone from {@link ICON_BUTTON_TONE_CLASS}.
 */
export const ICON_BUTTON_CLASS = [
    'inline-flex shrink-0 items-center justify-center rounded-full',
    TOUCH_TARGET_CLASS.fixed,
    PRESS_FILL_CLASS.pointer,
    FOCUS_RING_CLASS.offset,
].join(' ');

/** The glyph colour of each tone: one class each, never stacked with the other. */
export const ICON_BUTTON_TONE_CLASS: Readonly<Record<IconButtonTone, string>> = {
    ink: 'text-ink',
    inkMuted: 'text-ink-muted',
};

/** The unavailable look: 40% like every disabled control, and a cursor that says so. */
const DISABLED_CLASS = 'aria-disabled:cursor-not-allowed aria-disabled:opacity-40';

/** The design-system icon button. */
export const IconButton: FC<IconButtonProps> = ({
    icon,
    accessibilityLabel,
    onPress,
    tone = 'ink',
    disabled = false,
}) => (
    <PressScale>
        <button
            type="button"
            aria-label={accessibilityLabel}
            className={`${ICON_BUTTON_CLASS} ${ICON_BUTTON_TONE_CLASS[tone]} ${DISABLED_CLASS}`}
            {...refusedPressProps({
                unavailable: disabled,
                onClick: () => {
                    onPress();
                },
            })}
        >
            <Icon name={icon} size={24} />
        </button>
    </PressScale>
);
