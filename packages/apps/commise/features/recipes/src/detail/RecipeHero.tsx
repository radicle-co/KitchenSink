/**
 * @module @commise/features-recipes — web recipe-detail HERO (mockup `screenRecipeDetail`).
 *
 * The recipe detail opens with its photos. The hero IS the photo carousel: slide 1 is the cover, because the service
 * makes the cover `photos[0]` on every read path. It used to paint the cover as a separate image and then a second
 * carousel below repeated it as slide 1 (F2, `docs/design/uiOverhaul/evaluateRecipeAndWizard.md`), so there is now one
 * photo surface, built from `photos` alone (`specRecipeAndWizard.md` S2.1).
 *
 * ## The no-cover state is a designed state, not an error path
 *
 * Most recipes will have no photo for a while (a draft, an import, a quick capture). A missing cover must
 * therefore look DELIBERATE, and specifically must not be any of the three easy failures:
 *  - an `<img>` with an empty/undefined `src` → the browser paints a broken-image glyph;
 *  - a zero-height box → the title jumps up and the screen looks truncated;
 *  - an unlabelled grey rectangle → a screen-reader user perceives nothing where sighted users see a panel.
 *
 * So the fallback is a branded surface at the SAME hero height, painted with the shared beach-glow
 * {@link GradientSurface} (the brand's own background ramp, not an off-palette grey), carrying a photo glyph
 * and the localized `card.noPhotoLabel` — the SAME copy the recipe card's placeholder uses, so "no photo yet"
 * is stated once in the dictionary and read identically on both surfaces.
 *
 * The leaf itself holds no state, fetches nothing and navigates nowhere; the carousel's open slide is the carousel's
 * own view state. The mockup's overlaid back/share/save controls are NOT part of this leaf — those are navigation and
 * mutations, so they belong to the orchestration layer.
 *
 * @pattern Null Object for the no-cover state — a designed, branded placeholder stands in for the missing photo,
 *     rather than an empty `src`, a zero-height box or an unlabelled rectangle.
 */
import { useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import { GradientSurface } from '@commise/ui/surface';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeHeroProps } from './model.js';
import { PhotoCarousel } from './PhotoCarousel.js';

export type { RecipeHeroProps };

/** Shared hero geometry — the mockup's `h-64` on phones, `md:h-96` from tablet up. */
const HERO_BOX = 'h-64 w-full md:h-96';

/** The recipe-detail hero: the photo carousel, or its deliberate no-photo fallback. */
export const RecipeHero: FC<RecipeHeroProps> = ({ title, photos }) => {
    const { card } = useMessages(recipeMessages);

    if (photos.length === 0) {
        return (
            <GradientSurface
                gradient="hero"
                className={`flex items-center justify-center overflow-hidden rounded-2xl ${HERO_BOX}`}
            >
                {/* `role="img"` + the localized label: the placeholder is a single perceivable thing, announced
                    once, rather than a decorative glyph that says nothing. */}
                <div
                    role="img"
                    aria-label={card.noPhotoLabel}
                    // A labelled `role="img"` is a MEANINGFUL graphic, so it is `slate`, not the `mist` hairline
                    // tone — see the palette JSDoc in `@commise/ui`'s `tokens/colors.ts`. The native leaf
                    // already uses `palette.slate`; this is the web half catching up.
                    className={`flex items-center justify-center text-ink-muted ${HERO_BOX}`}
                >
                    <Icon name="image" size={48} />
                </div>
            </GradientSurface>
        );
    }

    return <PhotoCarousel photos={photos} title={title} />;
};
