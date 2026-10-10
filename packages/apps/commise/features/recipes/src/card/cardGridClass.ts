/**
 * @module @commise/features-recipes/card — the web grid rhythms recipe cards sit in, stated once so a populated grid and
 * its skeleton can never reflow against each other (`docs/design/uiOverhaul/buildSpec.md` §4.1–§4.3, `homeCardsB.md`
 * §2.2).
 *
 * - The library grid: `auto-fill` columns of at least 15 rem; each card is a subgrid six rows tall, so its rows line up
 *   with its neighbours' across one grid row (an empty row keeps its track).
 * - The library list: one column of row cards, 8 px apart.
 * - Home: two columns below a 600 container (2 × 2), four from 600, and from 960 exactly four columns of full cards —
 *   never `auto-fill`, which would give a fourth recipe a row of its own at 960 and an empty fifth column at 1440.
 *
 * Web-only class strings; native lays its rows out in `cardGridLayout.native.ts`.
 */

/** The library's grid of full cards. */
export const LIBRARY_GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 @regular/main:gap-6';

/** One cell of a grid of full cards: a subgrid spanning the card's six rows, so the rows align across the grid row. */
export const GRID_CELL_CLASS = 'row-span-6 grid grid-rows-subgrid gap-0';

/** The library's list of row cards. */
export const LIBRARY_LIST_CLASS = 'flex flex-col gap-2';

/** Home's recent recipes: 2 × 2 below a 600 container, one row of four from 600 (compact, then full from 960). */
export const HOME_GRID_CLASS = 'grid grid-cols-2 gap-3 @regular/main:grid-cols-4 @regular/main:gap-4 @wide/main:gap-6';

/** Compact cards (Discover's results, a collection's members) in two columns below a 600 container, where a full card needs more than half the width. */
export const COMPACT_GRID_CLASS = 'grid grid-cols-2 gap-3';
