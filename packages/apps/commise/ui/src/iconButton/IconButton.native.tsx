/**
 * @module @commise/ui/icon-button — the native design-system {@link IconButton}: a 44 circle inside a frame of the
 * touch floor (48 dp on Android, 44 elsewhere), named by the caller. The Android 48 dp is a real frame, not a
 * `hitSlop`, so a device inspection sees the bounds a finger gets. The 24 glyph, the circle and the frame never grow
 * with the text: an icon-only control keeps its pixel size. A press fills the circle with the surface's press row, and
 * a disabled control dims to 40% and cannot be pressed. Styled with Tamagui only (ADR-0080).
 *
 * Presentational: props → JSX, with no data, no mutation and no effect of its own.
 *
 * @pattern Decorator — `PressScale` adds the press motion and owns the one `Pressable`
 */
import type { FC, Ref } from 'react';
import type { View as NativeView } from 'react-native';
import { styled, View } from 'tamagui';

import { Icon } from '../icon/Icon.native.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { PressScale } from '../pressScale/PressScale.native.js';
import { usePressFill } from '../surfaceTone/usePressFill.native.js';
import { dimmedOpacity } from '../tokens/scale.js';
import { ICON_BUTTON_CIRCLE_PX, type IconButtonProps } from './props.js';

/** The circle. A Tamagui view, so the leaf sets no React Native style. */
const Circle = styled(View, {
    name: 'IconButtonCircle',
    width: ICON_BUTTON_CIRCLE_PX,
    height: ICON_BUTTON_CIRCLE_PX,
    borderRadius: '$full',
    alignItems: 'center',
    justifyContent: 'center',

    variants: {
        // The one dim every disabled control shares (`tokens/scale.ts`).
        dimmed: { true: { opacity: dimmedOpacity } },
    } as const,
});

/** The frame that carries the touch floor around the circle. */
const Frame = styled(View, {
    name: 'IconButtonFrame',
    alignItems: 'center',
    justifyContent: 'center',
});

/** Native props: the shared contract plus what a host passes through to the one `Pressable`. */
export interface IconButtonNativeProps extends IconButtonProps {
    /** The pressable, for moving the screen-reader cursor onto it. */
    readonly ref?: Ref<NativeView>;
    /** Whether the control opens something, and whether it is open. Absent means it is not a disclosure. */
    readonly expanded?: boolean;
    /** A longer explanation for the screen reader, read after the name (an error the control cannot fix). */
    readonly description?: string;
}

/** The native design-system icon button. */
export const IconButton: FC<IconButtonNativeProps> = ({
    icon,
    accessibilityLabel,
    onPress,
    tone = 'ink',
    disabled = false,
    ref,
    expanded,
    description,
}) => {
    const pressFill = usePressFill();

    return (
        <PressScale
            ref={ref}
            onPress={onPress}
            disabled={disabled}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={description}
            {...(expanded === undefined ? {} : { expanded })}
        >
            {({ pressed }) => (
                <Frame width={touchFloor()} height={touchFloor()}>
                    <Circle dimmed={disabled} backgroundColor={pressed && !disabled ? pressFill : undefined}>
                        <Icon name={icon} size={24} tone={tone} />
                    </Circle>
                </Frame>
            )}
        </PressScale>
    );
};
