/**
 * Two rules about a recipe's source that more than one layer must read the same way (ADR-0089).
 *
 * DESIGN PATTERN: **Specification**. Each is one authoritative, pure statement: the service policy, the editor and the
 * erasure worker import it, so none of them keeps its own copy.
 */
import {
    RECIPE_SOURCE_KINDS,
    RecipeSourceType,
    UNRECOGNISED_SOURCE_KIND,
    privateRuleOf,
    type RecipeSourceKind,
    type RecipeSourceKindView,
} from './recipe.types.js';

/** The facts of a stored recipe that decide whether its source can still change. */
export interface CorrectableSourceFacts {
    readonly sourceType: RecipeSourceType;
    /** What the cook said the source is, or `null`. A client may hold one it does not know. */
    readonly sourceKind: RecipeSourceKindView | null;
    /** When the recipe was first published. `null` or `undefined` (a wire omits it) means never. */
    readonly firstPublishedAt: Date | string | null | undefined;
    /** The recipe this one was cloned from, or `null`/`undefined` for an original. */
    readonly clonedFromId: string | null | undefined;
}

/**
 * Whether the cook can still set, replace or remove this recipe's source by pasting a link. Pure.
 *
 * `false` when ANY of these holds:
 * - it was first published: the source is frozen (ADR-0023 section 1b, ADR-0077 section 2, no relabel route), and a recipe
 *   set back to draft stays locked, because the fact is the first publish and not the status (ADR-0058);
 * - the stored source is one the cook did not state through a link: the curator's public-domain text, a book, a paid site;
 * - the source was INHERITED by a clone (a clone with a kind): otherwise cloning a public recipe would be a way to relabel it;
 * - the kind is one this client does not know: it fails closed.
 *
 * @param recipe - The stored recipe's source facts.
 * @returns Whether a statement may change the source.
 */
export function sourceIsCorrectable(recipe: CorrectableSourceFacts): boolean {
    if (
        (recipe.firstPublishedAt !== null && recipe.firstPublishedAt !== undefined) ||
        recipe.sourceKind === UNRECOGNISED_SOURCE_KIND
    ) {
        return false;
    }

    const statedByLinkOrNone =
        recipe.sourceType === RecipeSourceType.USER_CREATED || recipe.sourceKind === 'public_web';
    const inheritedByClone =
        recipe.clonedFromId !== null && recipe.clonedFromId !== undefined && recipe.sourceKind !== null;

    return statedByLinkOrNone && !inheritedByClone;
}

/**
 * The key a query matches a row's source by: `<sourceType>:<sourceKind>`, with an empty kind for none. ONE function builds
 * it, here for {@link PRIVATE_ONLY_SOURCE_KEYS} and in SQL as `source_type || ':' || COALESCE(source_kind, '')`.
 *
 * @param sourceType - The recipe's provenance label.
 * @param sourceKind - What the cook said the source is, or `null`.
 * @returns The key. Pure.
 */
export function privateOnlySourceKey(sourceType: RecipeSourceType, sourceKind: RecipeSourceKind | null): string {
    return `${sourceType}:${sourceKind ?? ''}`;
}

/**
 * The private-only rule as DATA: the key of every `(sourceType, sourceKind)` pair, `null` kind included, for which
 * {@link privateRuleOf} answers `privateOnly`. DERIVED over the cross product, so the TypeScript rule and what a query
 * matches cannot drift.
 *
 * Account erasure binds it as a parameter to keep a private-only recipe out of the donated set (a donation makes a recipe
 * public). It is data and not SQL text: no query text crosses the package boundary, and nothing is spliced into a statement.
 */
export const PRIVATE_ONLY_SOURCE_KEYS: readonly string[] = Object.values(RecipeSourceType).flatMap((sourceType) =>
    [...RECIPE_SOURCE_KINDS, null]
        .filter((sourceKind) => privateRuleOf(sourceType, sourceKind) === 'privateOnly')
        .map((sourceKind) => privateOnlySourceKey(sourceType, sourceKind)),
);
