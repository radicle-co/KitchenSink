/**
 * @module @commise/features-recipes — the ONE authoritative web recipe-card-grid loading skeleton.
 *
 * **Pattern: Null Object for the loading phase.** A single presentational unit (pure `props → JSX`) that
 * stands in for a grid of recipe cards while the first page is still in flight. Every web surface that paints
 * a recipe-card grid — `RecipeList` and `RecipeDiscoveryList` — composes THIS component, so "what a loading
 * recipe grid looks like" has exactly one representation and the two surfaces cannot drift apart.
 *
 * Two invariants it exists to hold, both of which were live defects before it:
 *
 *  1. **The live region carries its label as CONTENT, not only as `aria-label`.** A `role="status"` node
 *     rendered EMPTY is doubly broken: it is zero-height (nothing for a sighted viewer, and Playwright's
 *     `getByRole('status')` resolves it as `hidden`) AND it is silent, because a live region announces its
 *     CONTENT, not its label. So the localized label doubles as the visible caption — the same doctrine as
 *     `RecipePhotoManager`, `IngredientPicker`, and the mobile `LoadingState`.
 *  2. **The placeholder grid mirrors the populated grid's column rhythm**, so the layout does not jump when
 *     the first page lands. The shimmer cards themselves are decorative (`aria-hidden`) — the caption alone
 *     announces the wait — and they honour `prefers-reduced-motion`.
 *
 * This is the WEB leaf; `RecipeCardGridSkeleton.native.tsx` is its RN counterpart, and the two are imported
 * by path rather than through the platform-neutral `card/` barrel (the barrel would resolve one leaf per
 * bundle, which is right for the card but wrong here — the native list surfaces import the native leaf
 * explicitly, exactly as they do the native card).
 */
import type { FC } from 'react';

import { RECIPE_CARD_SKELETON_COUNT } from './model.js';

/**
 * The column rhythm shared with every populated recipe-card grid. It MUST stay in step with the `<ul>` in
 * `RecipeList` / `RecipeDiscoveryList`: a skeleton on a different grid reflows the whole page on load.
 */
const GRID_COLUMNS = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

/** Props for {@link RecipeCardGridSkeleton}. */
export interface RecipeCardGridSkeletonProps {
    /** The localized "loading…" copy — announced by the live region AND rendered as its visible caption. */
    readonly label: string;
    /** How many placeholder cards to paint. Defaults to {@link RECIPE_CARD_SKELETON_COUNT}. */
    readonly count?: number;
}

/**
 * A busy status region captioned with its localized label, over a grid of inert card-shaped shimmer
 * placeholders.
 *
 * @param props - The localized loading caption and, optionally, how many placeholder cards to paint.
 * @returns The captioned live region wrapping the decorative skeleton grid.
 */
export const RecipeCardGridSkeleton: FC<RecipeCardGridSkeletonProps> = ({
    label,
    count = RECIPE_CARD_SKELETON_COUNT,
}) => (
    <div role="status" aria-label={label} className="flex flex-col gap-4">
        <p className="text-body-sm font-medium text-slate">{label}</p>
        <div aria-hidden="true" className={GRID_COLUMNS}>
            {Array.from({ length: count }, (_unused, index) => index).map((key) => (
                <div key={key} className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-sm">
                    <div className="aspect-[4/3] w-full animate-pulse rounded-xl bg-pearl motion-reduce:animate-none" />
                    <div className="h-4 w-3/4 animate-pulse rounded bg-pearl motion-reduce:animate-none" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-pearl motion-reduce:animate-none" />
                </div>
            ))}
        </div>
    </div>
);
