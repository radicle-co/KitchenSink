/**
 * @module @commise/features-recipes — web recipe-detail HERO (mockup `screenRecipeDetail`).
 *
 * The recipe detail opens with its photos. The hero IS the photo carousel: slide 1 is the cover, because the service
 * makes the cover `photos[0]` on every read path. It used to paint the cover as a separate image and then a second
 * carousel below repeated it as slide 1 (F2, `docs/design/uiOverhaul/evaluateRecipeAndWizard.md`), so there is now one
 * photo surface, built from `photos` alone (`specRecipeAndWizard.md` S2.1).
 *
 * ## No photo: the monogram band
 *
 * A recipe with no photo shows the 96 px `RecipeCover` band (`buildSpec.md` §1.8, §6.7): a tint chosen by the recipe
 * id with the title's first letter. It renders no `<img>` (an empty `src` paints a broken-image glyph), keeps a real
 * height, and is decorative, because the H1 names the recipe. The picture glyph in a 4:3 box it replaces read as "the
 * image failed" (`evaluateFinal.md` F10).
 *
 * The leaf itself holds no state, fetches nothing and navigates nowhere; the carousel's open slide is the carousel's
 * own view state. The mockup's overlaid back/share/save controls are NOT part of this leaf — those are navigation and
 * mutations, so they belong to the orchestration layer.
 *
 * @pattern Null Object for the no-cover state — the monogram band stands in for the missing photo.
 */
import { RecipeCover } from '@commise/ui/recipe-cover';
import type { FC } from 'react';

import type { RecipeHeroProps } from './model.js';
import { PhotoCarousel } from './PhotoCarousel.js';

export type { RecipeHeroProps };

/** The recipe-detail hero: the photo carousel, or its deliberate no-photo fallback. */
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

    // The overlay comes FIRST in the DOM (Back is reached before the photos) and paints above them through `z-10`.
    return (
        <div className="relative">
            <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">{overlay}</div>
            <HeroMedia
                recipeId={recipeId}
                title={title}
                {...(cuisine === undefined ? {} : { cuisine })}
                photos={photos}
            />
        </div>
    );
};

/** The hero's media: the carousel, or the monogram band. */
const HeroMedia: FC<Omit<RecipeHeroProps, 'overlay'>> = ({ recipeId, title, cuisine, photos }) => {
    // No photo: the 96 px monogram band (`buildSpec.md` §1.8, §6.7) — a tint by the recipe id and the title's first
    // letter, decorative because the H1 names the recipe. A picture glyph in a 4:3 box read as "the image failed" (F10).
    if (photos.length === 0) {
        return (
            <div className="overflow-hidden rounded-lg">
                <RecipeCover
                    recipeId={recipeId}
                    title={title}
                    {...(cuisine === undefined ? {} : { cuisine })}
                    aspect="band"
                />
            </div>
        );
    }

    return <PhotoCarousel photos={photos} title={title} />;
};
