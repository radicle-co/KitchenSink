/**
 * @module @commise/features-recipes — web recipe-detail HERO cover (mockup `screen-recipe-detail`).
 *
 * The mockup opens the recipe detail with the cover photo: a full-width image (`h-64 md:h-96 object-cover`)
 * under a bottom-up scrim (`bg-gradient-to-t from-charcoal/60 to-transparent`) that keeps overlaid chrome
 * legible on a light photo. The web detail previously had no lead treatment at all and started at the title
 * band, so this is the missing first impression.
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
 * Pure `props → JSX`: no fetching, no state, no navigation. The mockup's overlaid back/share/save controls are
 * NOT part of this leaf — those are navigation and mutations, so they belong to the orchestration layer.
 */
import { useMessages } from '@commise/i18n/react';
import { GradientSurface } from '@commise/ui/surface';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeHeroProps } from './model.js';

export type { RecipeHeroProps };

/** Shared hero geometry — the mockup's `h-64` on phones, `md:h-96` from tablet up. */
const HERO_BOX = 'h-64 w-full md:h-96';

/** The recipe-detail hero cover, with its deliberate no-cover fallback. */
export const RecipeHero: FC<RecipeHeroProps> = ({ title, coverPhotoUrl }) => {
    const { card } = useMessages(recipeMessages);

    if (coverPhotoUrl === undefined) {
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
                    className={`flex items-center justify-center text-mist ${HERO_BOX}`}
                >
                    <svg aria-hidden="true" className="h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                    </svg>
                </div>
            </GradientSurface>
        );
    }

    return (
        <div className="relative overflow-hidden rounded-2xl">
            {/* FOLLOW-UP-CR-001-A applies here too: this is the full-size original, painted at hero size. It is
                the screen's lead image, so it loads eagerly — a lazy hero is a guaranteed layout flash. */}
            <img
                src={coverPhotoUrl}
                alt={title}
                loading="eager"
                decoding="async"
                className={`object-cover ${HERO_BOX}`}
            />
            {/* Decorative scrim — it carries no information, so it is hidden from assistive tech. */}
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-charcoal/60 to-transparent" />
        </div>
    );
};
