/**
 * @module CookingTopBar — the native top bar: Exit as ONE control, the × and its visible label together with
 * one accessible name, on the quiet `md` house Button (44, lifted to the platform touch floor), then the place as plain text. Done passes
 * no place, so it shows Exit alone. The place keeps the position and type of a later All steps button. No Ingredients pill
 * yet, not even a disabled one.
 *
 * Props are the shared contract's `CookingTopBarProps` plus native's `narrow`, which the screen reads from the window once,
 * because a leaf never reads the device: web's container query does the same work, so the web leaf has no such prop.
 *
 * Presentational: props → JSX.
 *
 * @pattern Variant — `narrow` selects the under-360 layout (the place on its own row under Exit); display only, no behaviour
 */
import { Button } from '@commise/ui/button';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { XStack } from 'tamagui';

import { nameOf } from './cookingCopy.js';
import type { CookingTopBarProps } from './cookingViewProps.js';

/** Props for the native {@link CookingTopBar}: the shared contract, plus the width fact web gets from CSS. */
export type NativeCookingTopBarProps = CookingTopBarProps & {
    /** Under 360 wide: the place takes its own full-width row under Exit. */
    readonly narrow: boolean;
};

/** The native cooking top bar. */
export const CookingTopBar: FC<NativeCookingTopBarProps> = ({ exit, place, narrow }) => (
    <XStack
        testID="cooking-top-bar"
        flexDirection={narrow ? 'column' : 'row'}
        alignItems={narrow ? 'flex-start' : 'center'}
        gap="$1"
        paddingHorizontal="$3"
        paddingVertical="$2"
    >
        <Button variant="quiet" size="md" icon="x" onPress={exit.onPress} {...nameOf(exit)}>
            {exit.label}
        </Button>
        {place === undefined ? null : (
            <Text typeRole="body" color={place.tone === 'muted' ? '$inkMuted' : '$ink'}>
                {place.text}
            </Text>
        )}
    </XStack>
);
