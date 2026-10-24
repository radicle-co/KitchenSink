/**
 * @module @commise/features-recipes — native recipe-detail HERO (the RN leaf of RecipeHero).
 *
 * Same contract and same two states as `RecipeHero`: the hero IS the photo carousel (slide 1 the cover, the service's
 * rule), so the cover is shown once (F2, `docs/design/uiOverhaul/evaluateRecipeAndWizard.md`); a recipe with no photo
 * shows the 96 pt `RecipeCover` monogram band (`buildSpec.md` §1.8, §6.7). The band is a tint chosen by the recipe id
 * with the title's first letter: it never renders an image component (an empty `source` paints a broken-image glyph),
 * it keeps a real height, and it is decorative, because the title below names the recipe. The picture glyph it
 * replaces read as "the image failed" and overflowed the right edge (`evaluateFinal.md` F10).
 *
 * The leaf holds no state, fetches nothing and navigates nowhere. The overlaid back and ⋯ controls are NOT this leaf's:
 * they are navigation and mutations, so the orchestration layer passes them in as `overlay`.
 *
 * @pattern Null Object for the no-cover state — the monogram band stands in for the missing photo, the same
 *     `RecipeCover` the web leaf draws.
 */
import { nativeTokens } from '@commise/ui/native';
import { RecipeCover } from '@commise/ui/recipe-cover';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import type { RecipeHeroProps } from './model.js';
import { PhotoCarousel } from './PhotoCarousel.native.js';

export type { RecipeHeroProps };

/** The recipe-detail hero (native): the photo carousel, or its deliberate compact no-photo fallback. */
export const RecipeHero: FC<RecipeHeroProps> = ({ recipeId, title, cuisine, photos, overlay }) => {
    if (overlay === undefined) {
        return (
            <HeroMedia
                recipeId={recipeId}
                title={title}
                {...(cuisine === undefined ? {} : { cuisine })}
                photos={photos}
            />
        );
    }

    // The overlay comes FIRST (Back is reached before the photos) and paints above them through `zIndex`. `box-none`
    // lets a swipe between the two controls reach the carousel beneath.
    return (
        <View>
            <View pointerEvents="box-none" style={styles.overlay}>
                {overlay}
            </View>
            <HeroMedia
                recipeId={recipeId}
                title={title}
                {...(cuisine === undefined ? {} : { cuisine })}
                photos={photos}
            />
        </View>
    );
};

/** The hero's media: the carousel, or the monogram band. */
const HeroMedia: FC<Omit<RecipeHeroProps, 'overlay'>> = ({ recipeId, title, cuisine, photos }) => {
    // No photo: the 96 pt monogram band (`buildSpec.md` §1.8, §6.7) — a tint by the recipe id and the title's first
    // letter, decorative because the title names the recipe. A picture glyph read as "the image failed" (F10).
    if (photos.length === 0) {
        return (
            <View style={styles.band}>
                <RecipeCover
                    recipeId={recipeId}
                    title={title}
                    {...(cuisine === undefined ? {} : { cuisine })}
                    aspect="band"
                />
            </View>
        );
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
    band: { width: '100%', borderRadius: nativeTokens.radius.lg, overflow: 'hidden' },
});
