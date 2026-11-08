/**
 * @module @commise/features-recipes — native recipe-detail HERO (the RN leaf of RecipeHero).
 *
 * Same contract and same two states as `RecipeHero`: the hero IS the photo carousel (slide 1 the cover, the service's
 * rule), so the cover is shown once (F2, `docs/design/uiOverhaul/evaluateRecipeAndWizard.md`); a recipe with no photo
 * shows the 96 pt gradient band, with no disc, no monogram and no cuisine (`designAnswers.md` 2026-11-02; cards and thumbnails keep the
 * monogram and disc through `RecipeCover`). The band is the one no-photo gradient the cards use, decorative because the title below names the
 * recipe; it never renders an image component (an empty `source` paints a broken-image glyph).
 *
 * The leaf holds no state, fetches nothing and navigates nowhere. The overlaid back and ⋯ controls are NOT this leaf's:
 * they are navigation and mutations, so the orchestration layer passes them in as `overlay`.
 *
 * @pattern Null Object for the no-cover state — the tint band stands in for the missing photo.
 */
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RecipeHeroProps } from './model.js';
import { HeroBand } from './heroBand.native.js';
import { PhotoCarousel } from './PhotoCarousel.native.js';

export type { RecipeHeroProps };

/** The recipe-detail hero (native): the photo carousel, or its deliberate compact no-photo fallback. */
export const RecipeHero: FC<RecipeHeroProps> = ({ title, photos, overlay }) => {
    if (overlay === undefined) {
        return <HeroMedia title={title} photos={photos} />;
    }

    // The overlay comes FIRST (Back is reached before the photos) and paints above them through `zIndex`. `box-none`
    // lets a swipe between the two controls reach the carousel beneath.
    return (
        <View>
            <View pointerEvents="box-none" style={styles.overlay}>
                {overlay}
            </View>
            <HeroMedia title={title} photos={photos} />
        </View>
    );
};

/** The hero's media: the carousel, or the tint band. */
const HeroMedia: FC<Omit<RecipeHeroProps, 'overlay'>> = ({ title, photos }) => {
    // No photo: the 96 pt band, the recipe's cover tint and nothing on it (`designAnswers.md` 2026-11-02). It is decorative,
    // because the title names the recipe, and a picture glyph read as "the image failed" (F10).
    if (photos.length === 0) {
        return <HeroBand />;
    }

    return <PhotoCarousel photos={photos} title={title} />;
};

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        start: 0,
        end: 0,
        zIndex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: nativeTokens.spacing[2],
        padding: nativeTokens.spacing[3],
    },
});
