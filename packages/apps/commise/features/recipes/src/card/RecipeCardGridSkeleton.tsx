/**
 * @module @commise/features-recipes — the ONE authoritative web recipe-card loading skeleton.
 *
 * **Pattern: Null Object for the loading phase.** A single presentational unit (pure `props → JSX`) that stands in for
 * the recipe cards while the first page is in flight. Every web surface that paints recipe cards composes THIS
 * component, so "what a loading recipe card looks like" has exactly one representation.
 *
 * Three invariants it exists to hold:
 *
 *  1. **The live region carries its label as CONTENT, not only as `aria-label`.** An empty `role="status"` is
 *     zero-height and silent, because a live region announces its content, not its label.
 *  2. **It draws the variant the loaded cards will use, in their grid** (`docs/design/uiOverhaul/buildSpec.md` §4.1:
 *     "the same rows at the same sizes"), from the same class strings as the populated grid (`./cardGridClass.ts`), so
 *     nothing moves when the page lands.
 *  3. **It pulses once, for one second, in `surfaceMuted`**, and not at all under reduced motion. The placeholders are
 *     decorative (`aria-hidden`); the caption alone announces the wait.
 *
 * `RecipeCardGridSkeleton.native.tsx` is its RN counterpart.
 *
 * @pattern Null Object — the loading phase's stand-in for the cards
 */
import type { FC } from 'react';

import {
    COMPACT_GRID_CLASS,
    GRID_CELL_CLASS,
    HOME_GRID_CLASS,
    LIBRARY_GRID_CLASS,
    LIBRARY_LIST_CLASS,
} from './cardGridClass.js';
import type { CardVariant } from './cardVariant.js';
import { RECIPE_CARD_SKELETON_COUNT } from './model.js';

/**
 * Which grid the skeleton sits in: the library's (grid or list by variant), Home's fixed one, or Discover's results
 * (compact cards two per row, or grid cards in the library's grid — the grids `RecipeDiscoveryResults` draws).
 */
export type SkeletonLayout = 'library' | 'home' | 'discover';

/** Props for {@link RecipeCardGridSkeleton}. */
export interface RecipeCardGridSkeletonProps {
    /** The localized "loading…" copy — announced by the live region AND rendered as its visible caption. */
    readonly label: string;
    /** How many placeholder cards to paint. Defaults to {@link RECIPE_CARD_SKELETON_COUNT}. */
    readonly count?: number;
    /** The variant the loaded cards will use. Defaults to `grid`. */
    readonly variant?: CardVariant;
    /** The grid the cards sit in. Defaults to `library`. */
    readonly layout?: SkeletonLayout;
}

/** One bar or cover, pulsing once for a second, still under reduced motion. */
const PULSE =
    'animate-pulse bg-surface-muted [animation-duration:1s] [animation-iteration-count:1] motion-reduce:animate-none';

const CARD = 'rounded-md border border-line-divider bg-paper';

/** The grid card's six rows: the cover and five lines. */
const GridSkeleton: FC = () => (
    <div data-skeleton-variant="grid" className={`${GRID_CELL_CLASS} ${CARD}`}>
        <div className={`aspect-[4/3] w-full rounded-t-md ${PULSE}`} />
        <div className="px-4 pt-3">
            <div className={`h-4 w-3/4 rounded-sm ${PULSE}`} />
        </div>
        <div className="px-4 pt-2">
            <div className={`h-4 w-1/2 rounded-sm ${PULSE}`} />
        </div>
        <div className="px-4 pt-1">
            <div className={`h-4 w-2/3 rounded-sm ${PULSE}`} />
        </div>
        <div className="px-4 pt-1">
            <div className={`h-3 w-1/2 rounded-sm ${PULSE}`} />
        </div>
        <div className="px-4 pb-4 pt-1">
            <div className={`h-3 w-1/3 rounded-sm ${PULSE}`} />
        </div>
    </div>
);

/** The row card: the thumbnail and two lines. */
const RowSkeleton: FC = () => (
    <div data-skeleton-variant="row" className={`flex min-h-24 gap-3 p-3 ${CARD}`}>
        <div className={`size-20 shrink-0 rounded-md ${PULSE}`} />
        <div className="flex flex-1 flex-col gap-2 pt-1">
            <div className={`h-4 w-3/4 rounded-sm ${PULSE}`} />
            <div className={`h-3 w-1/2 rounded-sm ${PULSE}`} />
        </div>
    </div>
);

/** The compact card: the cover and the title. */
const CompactSkeleton: FC = () => (
    <div data-skeleton-variant="compact" className={`flex flex-col ${CARD}`}>
        <div className={`aspect-[4/3] w-full rounded-t-md ${PULSE}`} />
        <div className="p-3">
            <div className={`h-4 w-3/4 rounded-sm ${PULSE}`} />
        </div>
    </div>
);

const SKELETON: Readonly<Record<CardVariant, FC>> = { grid: GridSkeleton, row: RowSkeleton, compact: CompactSkeleton };

/**
 * The grid class a skeleton sits in. Pure.
 *
 * @param variant - The variant.
 * @param layout - The grid.
 * @returns The populated grid's own class string.
 */
function gridClassOf(variant: CardVariant, layout: SkeletonLayout): string {
    if (layout === 'home') {
        return HOME_GRID_CLASS;
    }

    if (layout === 'discover') {
        return variant === 'grid' ? LIBRARY_GRID_CLASS : COMPACT_GRID_CLASS;
    }

    return variant === 'row' ? LIBRARY_LIST_CLASS : LIBRARY_GRID_CLASS;
}

/**
 * A busy status region captioned with its localized label, over inert placeholders of the variant the cards will use.
 *
 * @param props - The caption, the count, the variant and the grid.
 * @returns The captioned live region wrapping the decorative skeletons.
 */
export const RecipeCardGridSkeleton: FC<RecipeCardGridSkeletonProps> = ({
    label,
    count = RECIPE_CARD_SKELETON_COUNT,
    variant = 'grid',
    layout = 'library',
}) => {
    const Skeleton = SKELETON[variant];

    return (
        <div role="status" aria-label={label} className="flex flex-col gap-4">
            <p className="text-meta text-ink-muted">{label}</p>
            <div aria-hidden="true" className={gridClassOf(variant, layout)}>
                {Array.from({ length: count }, (_unused, index) => (
                    <Skeleton key={index} />
                ))}
            </div>
        </div>
    );
};
