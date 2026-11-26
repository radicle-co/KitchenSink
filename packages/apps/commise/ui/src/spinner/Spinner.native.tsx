/**
 * @module @commise/ui/spinner — the native in-flight spinner. INTERNAL to the design system (no package export):
 * `Button` draws it in its busy glyph slot.
 *
 * It stands beside a label and grows with it, as a glyph does (see `Icon`): its box is 20 times the label's growth under
 * the system text scale, to the label's cap, and the platform indicator is scaled to fill that box. Styled with Tamagui
 * only (ADR-0080). Decorative: whoever draws it carries the meaning, `Button` through its busy state.
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';
import { ActivityIndicator } from 'react-native';
import { View } from 'tamagui';

import type { IconScaleWith } from '../icon/props.js';
import { grownScale } from '../text/scaledType.js';
import { TextScaleContext } from '../text/textScaleContext.native.js';

/** Props for {@link Spinner}. */
export interface SpinnerProps {
    /** The indicator's colour. */
    readonly color: string;
    /** The label this spinner stands beside: it grows with that label's text. */
    readonly scaleWith: IconScaleWith;
}

/** The platform indicator draws 20 at its default size, so the box is 20 at 1x. */
const BASE = 20;

/** The spinning indicator in a box that grows with its label. */
export const Spinner: FC<SpinnerProps> = ({ color, scaleWith }) => {
    const { textScale } = TextScaleContext.useStyledContext();
    const grown = grownScale(scaleWith.role, textScale, scaleWith.chromeCap);

    return (
        <View width={BASE * grown} minHeight={BASE * grown} alignItems="center" justifyContent="center">
            <View scale={grown}>
                <ActivityIndicator color={color} />
            </View>
        </View>
    );
};
