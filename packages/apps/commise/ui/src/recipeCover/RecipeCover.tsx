/**
 * @module @commise/ui/recipe-cover — the web design-system {@link RecipeCover} (spec §1.8).
 *
 * With a photo it draws the photo: lazily loaded, decoded off the main thread, cropped to cover its box from the
 * centre 40% down. Without one it draws a monogram: the recipe's own tint (`coverTintOf`), the title's first letter in
 * Manrope 600 `ink` at 40% of the cover's height, and the cuisine as a `caption` under it on a cover 96 px tall or
 * taller, unless the caller lays a chip over the cover (`showCuisine={false}`). The cover is a SIZE container, so both rules read its own height (`cqh`, a container query), never the
 * viewport. It is decorative either way — the photo has an empty `alt` and the monogram is hidden — because the title
 * is the name of the link the cover sits in. Each aspect reserves its box, so nothing shifts as an image arrives.
 *
 * A caller's `footer` (the meta-chip band) is the last child of the cover's column, in flow at its natural height. The
 * letter's region is the flexible space above it, so the letter is centred above the band's top edge and never under it,
 * however tall the band grows (designer ruling 2026-11-03); with no footer the region is the whole cover. No measuring.
 *
 * @pattern Null Object — the monogram stands in for a missing photo, so a caller never branches on one
 */
import type { FC } from 'react';

import type { CoverTintName } from '../tokens/covers.js';
import { coverTintOf, monogramOf } from './coverTint.js';
import type { CoverAspect, RecipeCoverProps } from './props.js';

/** The box each aspect reserves. */
const ASPECT: Readonly<Record<CoverAspect, string>> = {
    '4:3': 'aspect-[4/3] w-full',
    '1:1': 'aspect-square',
    band: 'h-24 w-full',
};

/**
 * Each tint's ground as a LITERAL class, so Tailwind generates all six; each reads `var(--color-cover-*)`, which the
 * dark block overrides (D15).
 */
const COVER_CLASS: Readonly<Record<CoverTintName, string>> = {
    steel: 'bg-cover-steel',
    cream: 'bg-cover-cream',
    sky: 'bg-cover-sky',
    peach: 'bg-cover-peach',
    success: 'bg-cover-success',
    warning: 'bg-cover-warning',
};

/** The web design-system recipe cover. */
export const RecipeCover: FC<RecipeCoverProps> = ({
    recipeId,
    title,
    cuisine,
    photoUrl,
    aspect,
    showCuisine = true,
    footer,
}) => (
    <div
        className={`relative flex flex-col overflow-hidden [container-name:cover] [container-type:size] ${ASPECT[aspect]} ${
            photoUrl === undefined ? COVER_CLASS[coverTintOf(recipeId)] : ''
        }`}
    >
        {photoUrl === undefined ? (
            // The region above the footer: it takes what the band leaves, and centres the letter in it.
            <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1">
                <span className="font-display font-bold leading-none text-ink text-[40cqh]">{monogramOf(title)}</span>
                {cuisine === undefined || !showCuisine ? null : (
                    <span className="hidden text-caption text-ink [@container_cover_(height>=6rem)]:block">
                        {cuisine}
                    </span>
                )}
            </div>
        ) : (
            <img
                src={photoUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 size-full object-cover object-[center_40%]"
            />
        )}
        {footer === undefined ? null : <div className="relative mt-auto max-w-full self-start p-2">{footer}</div>}
    </div>
);
