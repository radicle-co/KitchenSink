/**
 * @module CookingNav — Back and Next step on native: a navigation landmark of two equal halves at the foot of the step column, Back first and Next last in reading
 * order, both the house `lg` Button (52). Both are the quiet secondary tier with ink chevrons; Next takes the filled
 * primary tier only when its tone says it is the action now ("Start step n", or "Finish" once every line is ticked).
 * Under 360 wide no chevrons are drawn, so the labels keep one line; a filled Next keeps its glyph, because the primary
 * tier requires one.
 *
 * Props are the shared contract's `CookingNavProps` plus native's `narrow`, read once by the screen, because a leaf never reads the device.
 *
 * Presentational: props → JSX. The labels and accessible names are resolved by the screen.
 *
 * @pattern Variant — `narrow` selects the under-360 layout (no chevrons); display only, no behaviour
 */
import { Button } from '@commise/ui/button';
import type { FC } from 'react';
import { XStack, YStack } from 'tamagui';

import { nameOf } from './cookingCopy.js';
import type { CookingNavProps } from './cookingViewProps.js';

/** Props for the native {@link CookingNav}: the shared contract, plus the width fact web gets from CSS. */
export type NativeCookingNavProps = CookingNavProps & {
    /** Under 360 wide: no chevrons, so the labels keep their width. */
    readonly narrow: boolean;
    /** The screen asks the forward control to take the screen-reader cursor; it acknowledges with `onFocusHandled`. */
    readonly forwardFocusRequested?: boolean;
    readonly onFocusHandled?: () => void;
};

/** The native nav pair. */
export const CookingNav: FC<NativeCookingNavProps> = ({
    back,
    forward,
    disabled,
    narrow,
    forwardFocusRequested = false,
    onFocusHandled,
}) => (
    <XStack role="navigation" collapsable={false} gap="$3" paddingHorizontal="$4" paddingVertical="$3">
        <YStack flex={1}>
            <Button
                variant="secondary"
                size="lg"
                width="fill"
                {...(narrow ? {} : { icon: 'chevronLeft' as const })}
                {...nameOf(back)}
                disabled={disabled}
                onPress={back.onPress}
            >
                {back.label}
            </Button>
        </YStack>
        <YStack flex={1}>
            {/* Two branches: `ButtonProps` is a union on `variant`, so one Button with a computed variant does not type. */}
            {forward.tone === 'filled' ? (
                <Button
                    variant="primary"
                    size="lg"
                    width="fill"
                    icon="chevronRight"
                    iconPlacement="end"
                    {...nameOf(forward)}
                    disabled={disabled}
                    focusRequested={forwardFocusRequested}
                    {...(onFocusHandled === undefined ? {} : { onFocusRequestHandled: onFocusHandled })}
                    onPress={forward.onPress}
                >
                    {forward.label}
                </Button>
            ) : (
                <Button
                    variant="secondary"
                    size="lg"
                    width="fill"
                    {...(narrow ? {} : { icon: 'chevronRight' as const, iconPlacement: 'end' as const })}
                    {...nameOf(forward)}
                    disabled={disabled}
                    focusRequested={forwardFocusRequested}
                    {...(onFocusHandled === undefined ? {} : { onFocusRequestHandled: onFocusHandled })}
                    onPress={forward.onPress}
                >
                    {forward.label}
                </Button>
            )}
        </YStack>
    </XStack>
);
