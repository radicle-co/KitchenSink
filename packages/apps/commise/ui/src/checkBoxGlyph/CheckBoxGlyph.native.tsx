/**
 * @module @commise/ui/check-box-glyph — the native design-system {@link CheckBoxGlyph}.
 *
 * A box with a rounded corner: a 1 pt `lineControl` outline when unchecked, the `action` fill with an `onAction` check
 * when checked. Checking springs the check in from scale 0.9 with the signature overshoot, through the named `check`
 * spring in the Tamagui config (§1.9: stiffness 600, damping 28); under reduced motion, or while the preference is still
 * being read, it appears at once (`checkMarkMotion`). Hidden from assistive
 * technology — the row it sits in is the checkbox. Colours are theme tokens, so it repaints in the dark scheme.
 *
 * The box grows with its row's text: its 1x side (`checkBoxSideOf`: 18 beside body sizes, 22 beside a 28 pt role) times
 * the role's own growth under the system text scale (`grownScale`), so it never outgrows that text's cap. It sits
 * centred in a slot one scaled line of its role tall, so in a row that aligns its items to the top the box stays beside
 * the FIRST line when the text wraps.
 *
 * @pattern Strategy — `checkMarkMotion` picks the check's entrance (the named spring, or none) from the OS preference
 * @pattern Glyph — a mark sized by its row's text role that owns its corner (`GLYPH_CORNER`), which no radius step fits
 */
import type { FC } from 'react';
import { styled, XStack } from 'tamagui';

import { Icon } from '../icon/Icon.native.js';
import { useReduceMotion } from '../motion/useReduceMotion.native.js';
import { scaledTypeSize } from '../text/scaledType.js';
import { TextScaleContext } from '../text/textScaleContext.native.js';
import {
    CHECK_BOX_MIN_SIDE,
    DEFAULT_CHECK_BOX_TEXT_ROLE,
    GLYPH_CORNER_PER_SIDE,
    checkBoxSideAt,
    checkMarkMotion,
    type CheckBoxGlyphProps,
} from './props.js';

/** The slot one line of the row's text tall, with the box centred in it. */
const CheckBoxSlot = styled(XStack, {
    name: 'CheckBoxSlot',
    flexShrink: 0,
    alignItems: 'center',
});

/** The drawn box: a thin outline, or the action fill once checked. */
const CheckBoxFrame = styled(XStack, {
    name: 'CheckBoxFrame',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',

    variants: {
        checked: {
            true: { backgroundColor: '$action', borderColor: '$action' },
            false: { backgroundColor: 'transparent', borderColor: '$lineControl' },
        },
    } as const,
});

/** The check mark's frame: drawn at the 16 pt icon size and scaled with the box, because `Icon` has a closed size set. */
const CheckMark = styled(XStack, {
    name: 'CheckMark',
});

/** The native whole-row checkbox's box. */
export const CheckBoxGlyph: FC<CheckBoxGlyphProps> = ({ checked, textRole = DEFAULT_CHECK_BOX_TEXT_ROLE }) => {
    const reduceMotion = useReduceMotion();
    const { textScale } = TextScaleContext.useStyledContext();
    const side = checkBoxSideAt(textRole, textScale);
    const growth = side / CHECK_BOX_MIN_SIDE;

    return (
        <CheckBoxSlot height={scaledTypeSize(textRole, textScale).lineHeight}>
            <CheckBoxFrame
                aria-hidden
                importantForAccessibility="no-hide-descendants"
                checked={checked}
                width={side}
                height={side}
                borderRadius={side * GLYPH_CORNER_PER_SIDE}
            >
                {checked ? (
                    // Mounts when checked, so the named spring plays as it enters (`checkMarkMotion`).
                    <CheckMark scale={growth} {...checkMarkMotion(reduceMotion, growth)}>
                        <Icon name="check" size={16} tone="onAction" />
                    </CheckMark>
                ) : null}
            </CheckBoxFrame>
        </CheckBoxSlot>
    );
};
