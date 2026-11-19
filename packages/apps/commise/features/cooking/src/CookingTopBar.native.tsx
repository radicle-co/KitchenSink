/**
 * @module CookingTopBar — the native top bar: Exit as ONE control, the × and its visible label together with one
 * accessible name, on the quiet `md` house Button (44, lifted to the platform touch floor), then the place as plain
 * text, then, while the screen gives `ingredients`, the quiet Ingredients button with its `listChecks` glyph and its
 * label whole. Done passes no place, so it shows Exit alone. The bar wraps by whole controls, so no label wraps inside
 * its button or is cut. Wide, the order is Exit, the place, Ingredients. Narrow (under 360), the place takes its own
 * row under Exit and Ingredients, which stay side by side while they fit and wrap whole when they do not.
 * Ingredients sits at the end of the bar: wide, the place takes the free space; narrow, it has an auto start margin.
 *
 * Props are the shared contract's `CookingTopBarProps` plus native's `narrow`, which the screen reads from the window
 * once, because a leaf never reads the device: web's container query does the same work, so the web leaf has no such
 * prop.
 *
 * Presentational: props → JSX.
 *
 * @pattern Variant — `narrow` selects the under-360 layout (the place on its own row); display only, no behaviour
 */
import { Button } from '@commise/ui/button';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';
import { XStack, YStack } from 'tamagui';

import { nameOf } from './cookingCopy.js';
import type { CookingTopBarProps } from './cookingViewProps.js';

/** Props for the native {@link CookingTopBar}: the shared contract, plus the width fact web gets from CSS. */
export type NativeCookingTopBarProps = CookingTopBarProps & {
    /** Under 360 wide: the place takes its own full-width row under Exit. */
    readonly narrow: boolean;
};

/** The native cooking top bar. */
export const CookingTopBar: FC<NativeCookingTopBarProps> = ({ exit, place, ingredients, narrow }) => {
    const placeText =
        place === undefined ? null : (
            <Text
                typeRole="body"
                color={place.tone === 'muted' ? '$inkMuted' : '$ink'}
                {...(narrow ? {} : { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' })}
            >
                {place.text}
            </Text>
        );
    const ingredientsButton =
        ingredients === undefined ? null : (
            <Button variant="quiet" size="md" icon="listChecks" onPress={ingredients.onPress} {...nameOf(ingredients)}>
                {ingredients.label}
            </Button>
        );

    const exitButton = (
        <Button variant="quiet" size="md" icon="x" onPress={exit.onPress} {...nameOf(exit)}>
            {exit.label}
        </Button>
    );

    // Narrow: a column of one wrapping row (Exit, Ingredients, side by side while they fit) and the place under it.
    if (narrow) {
        return (
            <YStack
                testID="cooking-top-bar"
                alignItems="flex-start"
                gap="$1"
                paddingHorizontal="$3"
                paddingVertical="$2"
            >
                <XStack
                    testID="cooking-top-bar-controls"
                    alignSelf="stretch"
                    flexWrap="wrap"
                    alignItems="center"
                    gap="$1"
                >
                    {exitButton}
                    <YStack testID="cooking-top-bar-ingredients" marginLeft="auto">
                        {ingredientsButton}
                    </YStack>
                </XStack>
                {placeText}
            </YStack>
        );
    }

    return (
        <XStack
            testID="cooking-top-bar"
            flexWrap="wrap"
            alignItems="center"
            gap="$1"
            paddingHorizontal="$3"
            paddingVertical="$2"
        >
            {exitButton}
            {placeText}
            {ingredientsButton}
        </XStack>
    );
};
