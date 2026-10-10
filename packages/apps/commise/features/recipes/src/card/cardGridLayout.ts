/**
 * @module @commise/features-recipes/card — the native card grids' columns: the web's `auto-fill` rule computed, and
 * Home's fixed grid as a lookup (`docs/design/uiOverhaul/buildSpec.md` §4.1–§4.2, `homeCardsB.md` §2.2). The web grids
 * are CSS (`./cardGridClass.ts`); both read the same 240 minimum.
 *
 * Pure.
 *
 * @pattern Policy — the column count of a width
 */
import type { ContainerClass } from '@commise/ui/container-class';

/** The narrowest column a full card holds its one-line rows in (15 rem). */
export const GRID_CARD_MIN_WIDTH = 240;

/** The gap between grid cards below a 600 container (`gapGrid`). */
export const GRID_GAP = 16;

/** Home's recent recipes: 2 × 2 below a 600 container, one row of 4 from 600. */
export const HOME_COLUMNS: Readonly<Record<ContainerClass, number>> = { narrow: 2, regular: 4, wide: 4 };

/**
 * How many columns of at least {@link GRID_CARD_MIN_WIDTH} fit a container, the web's `auto-fill` rule.
 *
 * @param contentPx - The container's width.
 * @returns The column count, never below 1.
 */
export function libraryGridColumnsOf(contentPx: number): number {
    return Math.max(1, Math.floor((contentPx + GRID_GAP) / (GRID_CARD_MIN_WIDTH + GRID_GAP)));
}
