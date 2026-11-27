/**
 * @module @commise/ui/input — the native step button of the `Stepper`: the shared icon button inside the stepper's
 * own frame, a circle on the neutral surface with its 1 pt control line, as wide as the touch floor (44 pt on iOS, 48 dp
 * on Android), with the icon button over it.
 *
 * Presentational: props → JSX. Styled with Tamagui only (ADR-0080), which is why it is a file of its own: a file that
 * imports Tamagui holds no React Native styling, and the stepper's column and row are not migrated yet.
 *
 * @pattern Decorator — the control line and the surface are added around the icon button
 */
import type { FC } from 'react';
import { styled, View } from 'tamagui';

import { IconButton } from '../iconButton/IconButton.native.js';
import type { IconName } from '../icon/props.js';
import { touchFloor } from '../layout/touchFloor.native.js';
import { dimmedOpacity } from '../tokens/scale.js';

/** The seat: as wide as the touch floor, holding the frame layer and the icon button one over the other. */
const StepSeat = styled(View, { name: 'StepperStepSeat', alignItems: 'center', justifyContent: 'center' });

/**
 * The frame layer: a circle on the neutral surface with its control line, under the icon button. A layer of its own, so
 * a button at its bound dims the whole control once: this layer to 40%, and the icon button's own circle and glyph to
 * 40%, never one inside the other. Kept, so the dim (`opacity`) never moves what is above it
 * (`nativeFlattenFlips.test.ts`).
 */
const StepFrame = styled(View, {
    name: 'StepperStepFrame',
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 1,
    borderColor: '$lineControl',
    backgroundColor: '$paper',
    borderRadius: '$full',
    collapsable: false,

    variants: {
        dimmed: { true: { opacity: dimmedOpacity } },
    } as const,
});

/** What one step button needs. */
export interface StepperButtonProps {
    /** The glyph: minus or plus. */
    readonly icon: IconName;
    /** The button's accessible name, already localised by the caller. */
    readonly accessibilityLabel: string;
    /** The field's error, read after the name (React Native has no `aria-describedby`). */
    readonly description?: string;
    /** Whether the stepper is at this button's bound. */
    readonly disabled: boolean;
    /** Called once per press, and never while disabled. */
    readonly onPress: () => void;
}

/** The native step button. */
export const StepperButton: FC<StepperButtonProps> = ({ icon, accessibilityLabel, description, disabled, onPress }) => {
    const target = touchFloor();

    return (
        <StepSeat width={target} height={target}>
            <StepFrame width={target} height={target} dimmed={disabled} />
            <IconButton
                icon={icon}
                accessibilityLabel={accessibilityLabel}
                {...(description === undefined ? {} : { description })}
                disabled={disabled}
                onPress={onPress}
            />
        </StepSeat>
    );
};
