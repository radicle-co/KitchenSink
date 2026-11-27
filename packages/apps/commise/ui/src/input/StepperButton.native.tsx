/**
 * @module @commise/ui/input — the native step button of the {@link Stepper}: the shared icon button inside the stepper's
 * own frame, a circle on the neutral surface with its 1 pt control line, as wide as the touch floor (44 pt on iOS, 48 dp
 * on Android). The icon button is seated over the line by a point, so its own target is the whole frame.
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

/** The frame: the control line and the paper fill, round. */
const StepFrame = styled(View, {
    name: 'StepperStepFrame',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '$lineControl',
    backgroundColor: '$paper',
    borderRadius: '$full',
});

/** Seats the icon button over the frame's line by a point. */
const StepSeat = styled(View, { name: 'StepperStepSeat', margin: -1, collapsable: false });

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
        <StepFrame width={target} height={target}>
            <StepSeat>
                <IconButton
                    icon={icon}
                    accessibilityLabel={accessibilityLabel}
                    {...(description === undefined ? {} : { description })}
                    disabled={disabled}
                    onPress={onPress}
                />
            </StepSeat>
        </StepFrame>
    );
};
