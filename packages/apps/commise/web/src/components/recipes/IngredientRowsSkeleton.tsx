'use client';

/**
 * @module components/recipes/IngredientRowsSkeleton — the ONE authoritative placeholder for a list of
 * ingredient rows that is still loading (web).
 *
 * **Pattern: Null Object for the loading phase**, the same shape `RecipeCardGridSkeleton` takes for a card
 * grid and `RecipeCalorieSkeleton` takes for a chip: a captioned live region over decorative, inert
 * placeholders sized like the rows they stand in for. Pure `props → JSX`.
 *
 * It replaces a bare line of text in the two places the ingredient picker waits (the blended typeahead and
 * the post-pick resolution poll). A text line in the space a LIST is about to fill is an empty flash: the
 * panel reads as blank, then rows appear and shove the actions beneath them down the page.
 *
 * ⛔ THE CAPTION IS THE REGION'S CONTENT, not only its `aria-label`, and the shimmer is `aria-hidden`. An
 * empty `role="status"` node is doubly broken — silent (a live region announces its CONTENT) and
 * zero-height — and a shimmer that is NOT hidden announces a row count that does not exist yet. This is the
 * same doctrine `RecipeCardGridSkeleton`, `RecipePhotoManager` and the mobile `LoadingState` already hold.
 */
import type { FC } from 'react';

/** How many placeholder rows to paint when the caller does not say — a short list, not a full page. */
export const INGREDIENT_SKELETON_ROW_COUNT = 3;

/**
 * Sized to the real row beneath it (`px-3 py-2 text-body-md` ⇒ a ~40px line box), so the panel does not
 * change height when the suggestions land.
 */
const ROW_CLASS = 'h-10 w-full animate-pulse rounded-lg bg-pearl motion-reduce:animate-none';

/** Props for {@link IngredientRowsSkeleton}. */
export interface IngredientRowsSkeletonProps {
    /** The localized wait copy — announced by the live region AND rendered as its visible caption. */
    readonly label: string;
    /** How many placeholder rows to paint. Defaults to {@link INGREDIENT_SKELETON_ROW_COUNT}. */
    readonly rowCount?: number;
}

/**
 * A busy region captioned with its localized label, over inert row-shaped placeholders.
 *
 * @param props - The localized caption and, optionally, how many rows to reserve.
 * @returns The captioned live region wrapping the decorative placeholder rows.
 */
export const IngredientRowsSkeleton: FC<IngredientRowsSkeletonProps> = ({
    label,
    rowCount = INGREDIENT_SKELETON_ROW_COUNT,
}) => (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
        <p className="px-2 py-1 text-body-sm text-slate">{label}</p>
        <div aria-hidden="true" className="flex flex-col gap-2">
            {Array.from({ length: rowCount }, (_unused, index) => index).map((key) => (
                <div key={key} className={ROW_CLASS} />
            ))}
        </div>
    </div>
);
