/**
 * @module @commise/ui/icon-button — the native design-system {@link IconButton}: a 44 circle inside a frame of the touch
 * floor (48 dp on Android, 44 elsewhere), named by the caller. The Android 48 dp is a real frame, not a `hitSlop`, so a
 * device inspection sees the bounds a finger gets. The 24 glyph, the circle and the frame never grow with the text (designer
 * D85: an icon-only control keeps its pixel size). Styled with Tamagui only (ADR-0080).
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Decorator — `PressScale` adds the press motion and owns the one `Pressable`
 */
import type { FC } from 'react';
import { styled, View } from 'tamagui';

import { Icon } from '../icon/Icon.native.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { PressScale } from '../pressScale/PressScale.native.js';
import type { IconButtonProps } from './props.js';

/** The visible circle: the 44 the design draws. */
const CIRCLE_PX = 44;

/** The circle. A Tamagui view, so the leaf sets no React Native style. */
const Circle = styled(View, {
    name: 'IconButtonCircle',
    width: CIRCLE_PX,
    height: CIRCLE_PX,
    borderRadius: CIRCLE_PX / 2,
    alignItems: 'center',
    justifyContent: 'center',
});

/** The frame that carries the touch floor around the circle. */
const Frame = styled(View, {
    name: 'IconButtonFrame',
    alignItems: 'center',
    justifyContent: 'center',
});

/** The native design-system icon button. */
export const IconButton: FC<IconButtonProps> = ({ icon, accessibilityLabel, onPress }) => (
    <PressScale onPress={onPress} accessibilityLabel={accessibilityLabel}>
        <Frame width={touchFloor()} height={touchFloor()}>
            <Circle>
                <Icon name={icon} size={24} tone="ink" />
            </Circle>
        </Frame>
    </PressScale>
);
