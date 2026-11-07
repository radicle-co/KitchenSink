/**
 * @module @commise/ui/keep-awake — the native design-system {@link KeepAwakeToggle} ("Screen on").
 *
 * A `switch` with its checked state, drawn as a QUIET action: the `sun` glyph (in `actionText`, filled while on, so the
 * state never rests on colour alone) and the label in `ink`, with no fill and no outline, in the action row after Edit
 * recipe or Save a copy (designer, iosBatch1). It is pressed through the same `PressScale` Button uses, and is the touch
 * floor tall (44 pt, 48 dp on Android).
 *
 * Native always has the capability (`useKeepAwakeAvailable.native.ts`), so this leaf always renders; the Null Object
 * contract lives in the web leaf, where the capability can be missing.
 */
import type { FC } from 'react';
import { styled, XStack } from 'tamagui';

import { Icon } from '../icon/Icon.native.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { PressScale } from '../pressScale/index.js';
import { Text } from '../text/Text.native.js';
import type { KeepAwakeToggleProps } from './props.js';

const Row = styled(XStack, { name: 'KeepAwakeToggle', alignItems: 'center', gap: '$2', paddingHorizontal: '$2' });

/** The native "Screen on" switch. */
export const KeepAwakeToggle: FC<KeepAwakeToggleProps> = ({ on, onChange, label, hint }) => (
    <PressScale
        onPress={() => onChange(!on)}
        accessibilityRole="switch"
        checked={on}
        accessibilityLabel={label}
        {...(hint === undefined ? {} : { accessibilityHint: hint })}
    >
        <Row minHeight={touchFloor()}>
            <Icon name="sun" size={20} filled={on} tone="actionText" />
            <Text typeRole="label" color="$ink">
                {label}
            </Text>
        </Row>
    </PressScale>
);
