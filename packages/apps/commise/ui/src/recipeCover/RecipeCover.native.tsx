/**
 * @module @commise/ui/recipe-cover — the native design-system {@link RecipeCover} (spec §1.8).
 *
 * With a photo it draws the photo through `expo-image` (disk-cached), covering its box from the centre 40% down. Without
 * one it draws a monogram on the recipe's own tint: the title's first letter in Manrope 700 `ink` at 40% of the cover's
 * height, and the cuisine as a `caption` under it from 96 pt tall, unless the caller lays a chip over the cover. React
 * Native has no container query, so the cover measures its own height (`onLayout`) and holds it as local view state. The
 * photo and the letter's region are hidden from assistive tech either way: the title is the name of the control the cover
 * sits in. Each aspect reserves its box.
 *
 * The cover is a column. A caller's `footer` (the meta-chip band) is its last child, in flow at its natural height, and
 * the letter's region is the flexible space above it, so the letter is centred above the band's top edge and never under
 * it, however tall the band grows with the text size (designer ruling 2026-11-03). With no footer the region is the whole
 * cover. The band is not hidden: it carries its own accessible name. No ref and no measuring of the band.
 *
 * The letter does not scale with the system text size (designer ruling c10ecadbf, 2026-11-03): it is decoration like avatar
 * initials, drawn with the design-system Text's `fixedPx`.
 *
 * Styled with Tamagui (ADR-0080): the tint is a theme key (`$coverSteel`), so the cover follows the scheme with no hook.
 *
 * @pattern Null Object — the monogram stands in for a missing photo, so a caller never branches on one
 * @pattern Variant — the aspect and the tint are Tamagui variants over closed unions, the discriminated-union render map
 */
import type { FC } from 'react';
import { useState } from 'react';
import { styled, YStack } from 'tamagui';

import { Photo } from '../photo/Photo.native.js';
import { Text } from '../text/Text.native.js';
import { nativeTokens } from '../tokens/native.js';
import type { CoverTintName } from '../tokens/covers.js';
import { coverTintOf, monogramOf } from './coverTint.js';
import { LETTER_SHARE, CUISINE_FROM, type CoverAspect, type RecipeCoverProps } from './props.js';

const Cover = styled(YStack, {
    name: 'RecipeCover',
    overflow: 'hidden',

    variants: {
        // The box each aspect reserves.
        aspect: {
            '4:3': { width: '100%', aspectRatio: 4 / 3 },
            '1:1': { aspectRatio: 1 },
            band: { width: '100%', height: CUISINE_FROM },
        } as const satisfies Record<CoverAspect, object>,
        tint: {
            steel: { backgroundColor: '$coverSteel' },
            cream: { backgroundColor: '$coverCream' },
            sky: { backgroundColor: '$coverSky' },
            peach: { backgroundColor: '$coverPeach' },
            success: { backgroundColor: '$coverSuccess' },
            warning: { backgroundColor: '$coverWarning' },
        } as const satisfies Record<CoverTintName, object>,
    } as const,
});

/** Fills the cover behind everything else: a photo is drawn here, out of the column's flow. */
const Backdrop = styled(YStack, {
    name: 'RecipeCoverBackdrop',
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
});

/** The space above the footer: it takes what the band leaves and centres the letter (and the cuisine) in it. */
const Region = styled(YStack, {
    name: 'RecipeCoverRegion',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '$1',
});

/** The band, at its natural height, at the bottom start. `auto` keeps it down when the region is empty (a photo). */
const Footer = styled(YStack, {
    name: 'RecipeCoverFooter',
    marginTop: 'auto',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    padding: '$2',
});

/** The monogram letter, in the display face. */
const Letter = styled(Text, {
    name: 'RecipeCoverLetter',
    fontFamily: nativeTokens.fontFace.display.bold,
});

/** The native design-system recipe cover. */
export const RecipeCover: FC<RecipeCoverProps> = ({
    recipeId,
    title,
    cuisine,
    photoUrl,
    aspect,
    showCuisine = true,
    footer,
}) => {
    const [height, setHeight] = useState<number | null>(null);
    const hasPhoto = photoUrl !== undefined;

    return (
        <Cover
            aspect={aspect}
            onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
            {...(hasPhoto ? {} : { tint: coverTintOf(recipeId) })}
        >
            {hasPhoto ? (
                <Backdrop aria-hidden>
                    <Photo
                        fill
                        source={{ uri: photoUrl }}
                        contentFit="cover"
                        contentPosition={{ left: '50%', top: '40%' }}
                    />
                </Backdrop>
            ) : (
                <Region aria-hidden>
                    {/* Decoration like avatar initials: it stays at its share of the cover's height at every text size. */}
                    {height === null ? (
                        <Letter typeRole="label">{monogramOf(title)}</Letter>
                    ) : (
                        <Letter typeRole="label" fixedPx={Math.round(height * LETTER_SHARE)}>
                            {monogramOf(title)}
                        </Letter>
                    )}
                    {showCuisine && cuisine !== undefined && height !== null && height >= CUISINE_FROM ? (
                        <Text typeRole="caption">{cuisine}</Text>
                    ) : null}
                </Region>
            )}
            {footer === undefined ? null : <Footer>{footer}</Footer>}
        </Cover>
    );
};
