/**
 * Two rules about a recipe's source that more than one layer must read the same way (ADR-0089).
 *
 * DESIGN PATTERN: **Specification**. Each is one authoritative, pure statement: the service policy, the editor and the
 * erasure worker import it, so none of them keeps its own copy.
 */
import { RECIPE_SOURCE_KINDS, RecipeSourceType, privateRuleOf } from './recipe.types.js';

/** The facts of a stored recipe that decide whether its source can still change. */
export interface CorrectableSourceFacts {
    readonly sourceType: RecipeSourceType;
    /** What the cook said the source is, or `null`. */
    readonly sourceKind: (typeof RECIPE_SOURCE_KINDS)[number] | null;
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
 * - the source was INHERITED by a clone (a clone with a kind): otherwise cloning a public recipe would be a way to relabel it.
 *
 * @param recipe - The stored recipe's source facts.
 * @returns Whether a statement may change the source.
 */
export function sourceIsCorrectable(recipe: CorrectableSourceFacts): boolean {
    if (recipe.firstPublishedAt !== null && recipe.firstPublishedAt !== undefined) {
        return false;
    }

    const statedByLinkOrNone =
        recipe.sourceType === RecipeSourceType.USER_CREATED || recipe.sourceKind === 'public_web';
    const inheritedByClone =
        recipe.clonedFromId !== null && recipe.clonedFromId !== undefined && recipe.sourceKind !== null;

    return statedByLinkOrNone && !inheritedByClone;
}

/** Every `(sourceType, sourceKind)` shape a row can hold, `null` kind included. */
function privateOnlyTerms(): string[] {
    const kinds = [...RECIPE_SOURCE_KINDS, null] as const;

    return Object.values(RecipeSourceType).flatMap((sourceType) => {
        const privateKinds = kinds.filter((kind) => privateRuleOf(sourceType, kind) === 'privateOnly');

        if (privateKinds.length === 0) {
            return [];
        }

        if (privateKinds.length === kinds.length) {
            return [`source_type = '${sourceType}'`];
        }

        const named = privateKinds.filter((kind): kind is NonNullable<typeof kind> => kind !== null);
        const kindTests = [
            ...(named.length > 0 ? [`source_kind IN (${named.map((kind) => `'${kind}'`).join(', ')})`] : []),
            ...(privateKinds.includes(null) ? ['source_kind IS NULL'] : []),
        ];

        return [`(source_type = '${sourceType}' AND ${kindTests.join(' OR ')})`];
    });
}

/**
 * The SQL twin of {@link privateRuleOf}`(...) === 'privateOnly'`, over the columns `source_type` and `source_kind` of
 * `recipes`. A boolean that is never NULL (a NULL kind makes no comparison unknown), so `NOT (...)` is safe in a WHERE.
 *
 * DERIVED from `privateRuleOf` over every pair, not hand-written, so the TypeScript rule and the SQL one cannot drift.
 * Account erasure reads it to keep a private-only recipe out of the donated set (a donation makes a recipe public).
 * `recipeSourceKind.e2e.test.ts` evaluates it against every pair in a real database.
 */
export const PRIVATE_ONLY_SQL = `COALESCE(${privateOnlyTerms().join(' OR ')}, false)`;
