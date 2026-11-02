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

import type { CardVariant } from './cardVariant.js';

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

/** The narrowest a compact tile's column may be, at the capped text scale (designer rule, 2026-11-02): below it a tile title breaks inside a word. */
export const COMPACT_COLUMN_MIN_WIDTH = 320;

/**
 * How many columns the compact tile gets: two while the container width divided by the capped text scale is at least
 * {@link COMPACT_COLUMN_MIN_WIDTH}, one below. At 1x on a 343 pt container that is two; at 2x it is one.
 *
 * @param contentPx - The container's width.
 * @param textScale - The scale capped text is drawn at (`cappedFontScale`, not the raw system scale). Zero or less reads as 1.
 * @returns 2 or 1.
 */
export function compactColumnsOf(contentPx: number, textScale: number): number {
    const scale = textScale > 0 ? textScale : 1;

    return contentPx / scale >= COMPACT_COLUMN_MIN_WIDTH ? HOME_COLUMNS.narrow : 1;
}

/**
 * How many columns a native list of cards in this variant gets: a row is one, the compact tile is Home's two while it fits
 * ({@link compactColumnsOf}), and a full card takes as many 240 columns as the container holds. The one rule for every native
 * card list.
 *
 * @param variant - The card variant the host decided.
 * @param contentPx - The container's width.
 * @param textScale - The capped text scale (`cappedFontScale`).
 * @returns The column count, never below 1.
 */
export function columnsOfVariant(variant: CardVariant, contentPx: number, textScale: number): number {
    switch (variant) {
        case 'row':
            return 1;
        case 'compact':
            return compactColumnsOf(contentPx, textScale);
        case 'grid':
            return libraryGridColumnsOf(contentPx);
    }
}
