/**
 * @module the library list's two shared vocabulary types, in a module of their own so `model.ts` (which types its view
 * with them) and `library.ts` (which builds them from `model.ts`'s predicates) do not import each other.
 *
 * Types only: no runtime code, so it can never be the edge of an import cycle.
 */

/** One chip of the library's facets. */
export interface LibraryFacet {
    /** The facet value (a cuisine, a dietary flag, or `QUICK_TIME_FACET` (`model.ts`)). */
    readonly value: string;
    /** What the chip says. User data is its own label; the quick bucket is localized. */
    readonly label: string;
    /** How many recipes the chip would leave, beside the search and the other chips. */
    readonly count: number;
    readonly selected: boolean;
}

/** Which body the results draw. */
export type LibraryState = 'firstRun' | 'results' | 'noMatchQuery' | 'noMatchFilters' | 'noMatchBoth';
