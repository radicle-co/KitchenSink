/**
 * @module linearGradient — `expo-linear-gradient` for the browser: a View painted with the CSS gradient its props
 * and its laid-out size describe (`gradientCss` explains why the size matters).
 *
 * @pattern Adapter over expo-linear-gradient (typed against its props)
 */
import type { LinearGradientProps } from 'expo-linear-gradient';
import { useState } from 'react';
import type { FC } from 'react';
import { View } from 'react-native-web';
import type { LayoutChangeEvent, ViewStyle } from 'react-native';

import { linearGradientCss } from './gradientCss.js';
import type { GradientSize } from './gradientCss.js';

/** What the gradient is drawn against until the view reports its size. */
const UNMEASURED: GradientSize = { width: 1, height: 1 };

/** react-native-web paints `backgroundImage`; React Native's `ViewStyle` has no such key, so the one cast is here. */
function paint(backgroundImage: string): ViewStyle {
    return { backgroundImage } as ViewStyle;
}

/** A view painted with a CSS linear gradient, re-laid-out when the view's size changes. */
export const LinearGradient: FC<LinearGradientProps> = ({
    colors,
    locations,
    start,
    end,
    style,
    children,
    onLayout,
    ...rest
}) => {
    const [size, setSize] = useState<GradientSize>(UNMEASURED);

    const measured = (event: LayoutChangeEvent): void => {
        const { width, height } = event.nativeEvent.layout;

        setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
        onLayout?.(event);
    };

    return (
        <View
            {...rest}
            onLayout={measured}
            style={[style, paint(linearGradientCss({ colors, locations, start, end }, size))]}
        >
            {children}
        </View>
    );
};

export default LinearGradient;
