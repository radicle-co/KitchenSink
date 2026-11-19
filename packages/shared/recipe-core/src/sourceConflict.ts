/**
 * Whether a recipe may not be Public because a third-party source was EVER stated for it (the evidence rule).
 *
 * DESIGN PATTERN: **Specification** — one pure predicate over the recipe's label and its append-only source evidence, with a
 * SQL twin in the database for the one place a query must ask the same question (account erasure).
 *
 * ⛔ THIS IS THE ONE SEAM the feature-020 hold (ADR-0074) replaces. Today the answer is "refused": a recipe that ever had
 * a web page, a book or a paid site stated for it cannot be Public, however the cook later edits the statement. The owner
 * may turn "refused" into something else (a check, a review, a site claim), and when that happens this predicate and the
 * `sourceConflict` input of the visibility policies change, AND the database function named below changes with a new
 * migration (the evidence half exists in SQL as well, held to this file by a LOCAL e2e parity test). No caller re-derives the
 * rule, and none reads evidence rows itself to decide Public.
 *
 * The SQL twin of the evidence half is the database function `recipe_holds_third_party_source(recipe_id)` (migration 0086), used
 * by account erasure beside the bound `PRIVATE_ONLY_SOURCE_KEYS`; a LOCAL e2e test checks the pair against this predicate over
 * the label cross product. It is a function and not an exported SQL string because no SQL text crosses a package boundary
 * (`sql.raw` is banned in services, `serviceSecurityInvariants` G3).
 *
 * Why evidence and not the stored statement: the statement can be cleared (`PATCH statement: null` resolves to
 * `user_created`), and a cleared statement must not launder a copied recipe into "my own work". Evidence is append-only.
 *
 * @pattern Specification — one pure predicate, one SQL twin
 */
import {
    privateRuleOf,
    type RecipeSourceKind,
    type RecipeSourceKindView,
    type RecipeSourceType,
} from './recipe.types.js';

/** The facts of one evidence row the rule reads. */
export interface SourceEvidenceFacts {
    /** The registrable domain of a stated or pasted web source, or `null` (a book, or a citation with no site). */
    readonly sourceDomain: string | null;
    /** The kind the cook stated, or `null` (a pasted page that stated none). */
    readonly sourceKind: RecipeSourceKind | null;
}

/** The input to {@link sourceConflictOf}. Every member is REQUIRED, so a caller states each. */
export interface SourceConflictInput {
    /** Every evidence row of the recipe, in any order. */
    readonly evidence: readonly SourceEvidenceFacts[];
    /** The recipe's provenance label now. */
    readonly sourceType: RecipeSourceType;
    /** The recipe's source kind now, or `null`. */
    readonly sourceKind: RecipeSourceKindView | null;
    /**
     * The registrable domains the cook has proved they own (016 FR-069 site claims). ALWAYS `[]` today: site claims are not
     * built, and the SQL twin assumes `[]`. REQUIRED so the day they exist every caller must pass them.
     */
    readonly verifiedSiteClaims: readonly string[];
}

/** A stated book or paid site names a source that is never the cook's own, whether or not it gave a domain. */
const OFFLINE_KINDS: ReadonlySet<string> = new Set(['book', 'paid_site']);

/**
 * Whether the recipe is held out of Public by its source evidence.
 *
 * A recipe already private-only (a web copy, a book, a paid site) is not asked: it can never be Public anyway, and the
 * existing private-only denial speaks for it.
 *
 * @param input - The recipe's label and kind, its evidence, and the cook's verified site claims.
 * @returns `true` when Public must be refused. Pure.
 */
export function sourceConflictOf(input: SourceConflictInput): boolean {
    if (privateRuleOf(input.sourceType, input.sourceKind) === 'privateOnly') {
        return false;
    }

    return input.evidence.some(
        (row) =>
            (row.sourceDomain !== null && !input.verifiedSiteClaims.includes(row.sourceDomain)) ||
            (row.sourceKind !== null && OFFLINE_KINDS.has(row.sourceKind)),
    );
}
