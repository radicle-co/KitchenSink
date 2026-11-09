/**
 * Who may read a food (ADR-0029 §8): a catalog row and a PROMOTED authored row are world-readable, a private authored
 * row is its author's alone.
 *
 * DESIGN PATTERN: **Specification** — the read-side sibling of `evaluateAuthorship`. The pure predicate is the
 * contract; the two statements that must agree with it (the search scopes in `foodSearch.dao.ts` and the shared
 * nutrition read in `food.dao.ts`) cannot import a predicate, so each spells the SAME condition in SQL and its DAO
 * suite pins the text. Both import {@link PROMOTED_VISIBILITY} so the stored word lives once.
 *
 * @pattern Specification — pure predicate with SQL twins pinned by their DAO suites
 */

/** The `food.visibility` value an approved publication request writes (0013 CHECK). */
export const PROMOTED_VISIBILITY = 'promoted';

/** The facts the predicate reads. */
export interface ReadableFoodFacts {
    /** The author's app-user ULID, or `null` for a catalog row. */
    readonly userId: string | null;
    /** The 0013 visibility. */
    readonly visibility: 'public' | 'private' | 'promoted';
}

/**
 * Is this food readable by every caller?
 *
 * @param facts - The food's authorship facts.
 * @returns `true` for a catalog row or a promoted authored row.
 */
export function isWorldReadable(facts: ReadableFoodFacts): boolean {
    return facts.userId === null || facts.visibility === PROMOTED_VISIBILITY;
}
