/**
 * @module @commise/ui/recipe-cover — the web design-system {@link RecipeCover} (spec §1.8).
 *
 * With a photo it draws the photo: lazily loaded, decoded off the main thread, cropped to cover its box from the
 * centre 40% down. Without one it draws a monogram: the recipe's own tint (`coverTintOf`), the title's first letter in
 * Playfair 700 `ink` at 40% of the cover's height, and the cuisine as an `overline` under it on a cover 96 px tall or
 * taller. The cover is a SIZE container, so both rules read its own height (`cqh`, a container query), never the
 * viewport. It is decorative either way — the photo has an empty `alt` and the monogram is hidden — because the title
 * is the name of the link the cover sits in. Each aspect reserves its box, so nothing shifts as an image arrives.
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
    seafoam: 'bg-cover-seafoam',
    coral: 'bg-cover-coral',
    sky: 'bg-cover-sky',
    premium: 'bg-cover-premium',
    success: 'bg-cover-success',
    warning: 'bg-cover-warning',
};

/** The web design-system recipe cover. */
export const RecipeCover: FC<RecipeCoverProps> = ({ recipeId, title, cuisine, photoUrl, aspect }) => (
    <div className={`relative overflow-hidden [container-name:cover] [container-type:size] ${ASPECT[aspect]}`}>
        {photoUrl === undefined ? (
            <div
                aria-hidden="true"
                className={`absolute inset-0 flex flex-col items-center justify-center gap-1 ${COVER_CLASS[coverTintOf(recipeId)]}`}
            >
                <span className="font-display font-bold leading-none text-ink text-[40cqh]">{monogramOf(title)}</span>
                {cuisine === undefined ? null : (
                    <span className="hidden text-overline text-ink [@container_cover_(height>=6rem)]:block">
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
    </div>
);
