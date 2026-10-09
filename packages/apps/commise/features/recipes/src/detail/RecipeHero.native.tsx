/**
 * @module @commise/features-recipes — native recipe-detail HERO (the RN leaf of RecipeHero).
 *
 * Same contract and same two designed states as `RecipeHero`: the hero IS the photo carousel (slide 1 the cover, the
 * service's rule), so the cover is shown once (F2, `docs/design/uiOverhaul/evaluateRecipeAndWizard.md`); a recipe with no
 * photo gets a DELIBERATE branded placeholder rather than nothing. The placeholder derives from the shared tokens —
 * its surface from `gradient.hero`, its geometry from `nativeTokens.mediaHeight` — so the platforms cannot drift.
 *
 * ## The no-cover state is a designed state, not an error path
 *
 * Most recipes will have no photo for a while (a draft, an import, a quick capture), so the fallback must not
 * be any of the three easy failures — an `<Image>` with an empty `source` (which paints a broken-image glyph
 * on device exactly as a browser does), a zero-height box that makes the screen look truncated, or an
 * unlabelled grey rectangle that a screen-reader user perceives as nothing at all. So it renders NO image
 * component, keeps a real height, and carries `accessibilityRole="image"` plus the localized
 * `card.noPhotoLabel` — the SAME copy the recipe card's placeholder uses, so "no photo yet" is stated once in
 * the dictionary and read identically on both surfaces.
 *
 * ## PLATFORM-FORK: the no-cover placeholder is COMPACT on native, full-height on web
 *
 * The web fallback fills the whole hero box (`h-64`, `md:h-96` — up to 384px). That is right on a desktop
 * viewport and wrong on a phone, for two compounding reasons:
 *
 *  1. **It costs the first screen.** A ~384dp empty gradient on a ~700dp phone viewport is over half of
 *     everything the reader can see, spent on a panel that says only "no photo yet" — and it pushes the recipe
 *     TITLE, the one thing they opened the screen for, below the fold.
 *  2. **It claims the screen for nothing.** At full height the no-cover placeholder is a beach-glow slab with the
 *     label floating in it, over a canvas that is already the same wash — which reads as a rendering fault rather
 *     than a design.
 *
 * The photos-PRESENT leg is the carousel, which sizes itself from the same window cap (`carouselBox`).
 * Only the empty state shrinks — the state where there is, by definition, nothing to show. Deliberately NOT
 * omitting the hero entirely: the labelled placeholder is the only thing that tells a non-sighted reader the
 * recipe has no photo, and dropping the element would remove that signal along with the space.
 *
 * ## The window caps the box (`docs/design/compactHeightLayout.md` §8)
 *
 * The placeholder is `mediaBoxHeight(token, window height)`: at most 40% of the window's height, so on a phone held
 * sideways the recipe's title stays on the first screen.
 *
 * The leaf holds no state, fetches nothing and navigates nowhere; it reads only the window's height. The mockup's overlaid back/share/save controls are
 * NOT part of this leaf — those are navigation and mutations, so they belong to the orchestration layer.
 *
 * @pattern Null Object for the no-cover state — the same designed placeholder as the web leaf, derived from the
 *     shared gradient and geometry tokens so the two cannot drift.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { mediaBoxHeight } from '@commise/ui/layout';
import { GradientSurface } from '@commise/ui/surface';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { RecipeHeroProps } from './model.js';
import { PhotoCarousel } from './PhotoCarousel.native.js';

export type { RecipeHeroProps };

/** The recipe-detail hero (native): the photo carousel, or its deliberate compact no-photo fallback. */
export const RecipeHero: FC<RecipeHeroProps> = ({ title, photos }) => {
    const { card } = useMessages(recipeMessages);
    const { height: windowHeight } = useWindowDimensions();

    if (photos.length === 0) {
        return (
            <GradientSurface gradient="hero" style={styles.placeholderSurface}>
                {/* ONE perceivable thing, announced once: the role + localized label sit on the same node, so
                    assistive tech reports "No photo yet, image" instead of an unlabelled decorative glyph. */}
                <View
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={card.noPhotoLabel}
                    style={[
                        styles.placeholderBox,
                        { height: mediaBoxHeight(nativeTokens.mediaHeight.heroPlaceholder, windowHeight) },
                    ]}
                >
                    <Icon name="image" size={48} tone="inkMuted" />
                </View>
            </GradientSurface>
        );
    }

    return <PhotoCarousel photos={photos} title={title} />;
};

const styles = StyleSheet.create({
    // The COMPACT band (see the module doc's PLATFORM-FORK note) — not the full `hero` box.
    placeholderSurface: {
        width: '100%',
        borderRadius: nativeTokens.radius.lg,
        overflow: 'hidden',
    },
    placeholderBox: {
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
