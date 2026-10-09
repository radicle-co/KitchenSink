/**
 * @module @commise/ui/recipe-cover — the native design-system {@link RecipeCover} (spec §1.8).
 *
 * With a photo it draws the photo through `expo-image` (disk-cached), covering its box from the centre 40% down.
 * Without one it draws a monogram on the recipe's own tint: the title's first letter in Playfair 700 `ink` at 40% of
 * the cover's height, and the cuisine as an `overline` under it from 96 pt tall. React Native has no container
 * query, so the cover measures its own height (`onLayout`) and holds it as local view state. The cover is hidden from
 * assistive tech either way: the title is the name of the control it sits in. Each aspect reserves its box.
 *
 * @pattern Null Object — the monogram stands in for a missing photo, so a caller never branches on one
 */
import { Image } from 'expo-image';
import { useState, type FC } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/useTheme.native.js';
import { nativeTokens } from '../tokens/native.js';
import { coverTintOf, monogramOf } from './coverTint.js';
import { LETTER_SHARE, OVERLINE_FROM, type CoverAspect, type RecipeCoverProps } from './props.js';

/** The box each aspect reserves. */
const ASPECT: Readonly<Record<CoverAspect, ViewStyle>> = {
    '4:3': { width: '100%', aspectRatio: 4 / 3 },
    '1:1': { aspectRatio: 1 },
    band: { width: '100%', height: OVERLINE_FROM },
};

/** The native design-system recipe cover. */
export const RecipeCover: FC<RecipeCoverProps> = ({ recipeId, title, cuisine, photoUrl, aspect }) => {
    const [height, setHeight] = useState<number | null>(null);
    const { colors, covers } = useTheme();

    if (photoUrl !== undefined) {
        return (
            <View aria-hidden style={[styles.box, ASPECT[aspect]]}>
                <Image
                    source={{ uri: photoUrl }}
                    contentFit="cover"
                    contentPosition={{ left: '50%', top: '40%' }}
                    style={StyleSheet.absoluteFill}
                />
            </View>
        );
    }

    return (
        <View
            aria-hidden
            onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
            style={[styles.box, styles.monogram, ASPECT[aspect], { backgroundColor: covers[coverTintOf(recipeId)] }]}
        >
            <Text
                style={[
                    styles.letter,
                    { color: colors.ink },
                    height === null
                        ? null
                        : {
                              fontSize: Math.round(height * LETTER_SHARE),
                              lineHeight: Math.round(height * LETTER_SHARE),
                          },
                ]}
            >
                {monogramOf(title)}
            </Text>
            {cuisine !== undefined && height !== null && height >= OVERLINE_FROM ? (
                <Text style={[styles.overline, { color: colors.ink }]}>{cuisine}</Text>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    box: { overflow: 'hidden' },
    monogram: { alignItems: 'center', justifyContent: 'center', gap: nativeTokens.spacing[1] },
    letter: { fontFamily: nativeTokens.fontFace.display.bold },
    overline: nativeTokens.type.overline,
});
