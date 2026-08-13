/**
 * @module @commise/features-recipes — native recipe-detail HERO cover (the RN leaf of RecipeHero).
 *
 * Same contract and same two designed states as `RecipeHero`: the mockup
 * (`screen-recipe-detail`) opens the recipe with the cover photo under a bottom-up scrim, and a recipe with no
 * cover gets a DELIBERATE branded placeholder rather than nothing. Both legs derive from the shared tokens —
 * the scrim from `gradient.scrim`, the placeholder surface from `gradient.hero`, the geometry from
 * `nativeTokens.mediaHeight` — so the two platforms cannot drift on the treatment.
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
 *  2. **It stacks two identical gradients.** The native detail view already opens with a `GradientSurface`
 *     `hero` title band immediately below this hero. At full height the no-cover placeholder and that band
 *     merge into one continuous beach-glow slab with the label floating in it, which reads as a rendering
 *     fault rather than a design.
 *
 * The cover-PRESENT leg keeps the full `hero` height, so a recipe with a photo is pixel-comparable to web.
 * Only the empty state shrinks — the state where there is, by definition, nothing to show. Deliberately NOT
 * omitting the hero entirely: the labelled placeholder is the only thing that tells a non-sighted reader the
 * recipe has no photo, and dropping the element would remove that signal along with the space.
 *
 * Pure `props → JSX`: no fetching, no state, no navigation. The mockup's overlaid back/share/save controls are
 * NOT part of this leaf — those are navigation and mutations, so they belong to the orchestration layer.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { nativeTokens } from '@commise/ui/native';
import { GradientSurface } from '@commise/ui/surface';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { recipeMessages } from '../messages.js';
import type { RecipeHeroProps } from './model.js';

export type { RecipeHeroProps };

/** The placeholder glyph's size — large enough to read as an intentional icon, not a stray mark. */
const PLACEHOLDER_GLYPH_SIZE = 40;

/** The recipe-detail hero cover (native), with its deliberate compact no-cover fallback. */
export const RecipeHero: FC<RecipeHeroProps> = ({ title, coverPhotoUrl }) => {
    const { card } = useMessages(recipeMessages);

    if (coverPhotoUrl === undefined) {
        return (
            <GradientSurface gradient="hero" style={styles.placeholderSurface}>
                {/* ONE perceivable thing, announced once: the role + localized label sit on the same node, so
                    assistive tech reports "No photo yet, image" instead of an unlabelled decorative glyph. */}
                <View
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={card.noPhotoLabel}
                    style={styles.placeholderBox}
                >
                    <Feather name="image" size={PLACEHOLDER_GLYPH_SIZE} color={palette.slate} />
                </View>
            </GradientSurface>
        );
    }

    return (
        <View style={styles.coverFrame}>
            {/* FOLLOW-UP-CR-001-A applies here too: this is the full-size original, painted at hero size.
                `accessibilityLabel` only (no `accessible`) — RNW copies it to the underlying <img alt>, giving
                ONE named node.

                This NO LONGER matches the card's cover, which #140 made decorative (it duplicated the name of
                the pressable containing it). The hero is the same duplication class — the detail screen's <h1>
                already carries the title — and is deliberately left as-is here because `recipeDetailHero.spec.ts`
                identifies the hero BY this name to prove the image decoded (`naturalWidth > 0`). Making it
                decorative is a follow-up that has to move that spec in the same change. */}
            <Image
                accessibilityLabel={title}
                source={{ uri: coverPhotoUrl }}
                contentFit="cover"
                cachePolicy="memory-disk"
                style={styles.coverImage}
            />
            {/* Decorative scrim, absolutely positioned over the cover exactly as the mockup draws it. It is
                excluded from assistive tech by CONSTRUCTION rather than by an ARIA attribute: React Native only
                surfaces a view as an accessibility element when it is `accessible`, carries a role/label, or has
                text children. This one has none of those, so it is already invisible to a screen reader — which
                is why no `aria-hidden` is passed (`GradientSurface` would drop it anyway, and a prop that does
                nothing is worse than none: it reads as a guarantee that isn't there). Pinned by the test that
                asserts the hero exposes exactly ONE accessible node. */}
            <GradientSurface gradient="scrim" style={styles.scrim} />
        </View>
    );
};

const styles = StyleSheet.create({
    // `overflow: 'hidden'` rounds the cover photo's corners; nothing here casts a shadow, so clipping is safe.
    coverFrame: {
        position: 'relative',
        width: '100%',
        height: nativeTokens.mediaHeight.hero,
        borderRadius: nativeTokens.radius.lg,
        overflow: 'hidden',
    },
    coverImage: { width: '100%', height: nativeTokens.mediaHeight.hero },
    scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0 },
    // The COMPACT band (see the module doc's PLATFORM-FORK note) — not the full `hero` box.
    placeholderSurface: {
        width: '100%',
        borderRadius: nativeTokens.radius.lg,
        overflow: 'hidden',
    },
    placeholderBox: {
        width: '100%',
        height: nativeTokens.mediaHeight.heroPlaceholder,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
