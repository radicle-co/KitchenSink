/**
 * Which of a root's variants a search query names (curated catalog plan U8, R15, R16, AE3).
 *
 * Retrieval reads names and synonyms only; this rule runs after it, over one retrieved root.
 *
 * 1. The leftovers are the query's ranking tokens minus those of the ONE name or synonym that matches the query
 *    best. Subtracting every synonym instead would delete words that name a variant: brisket's `flat` and `point`.
 * 2. With no leftovers the query names the root alone, and no variant is read.
 * 3. A variant attaches when exactly ONE live variant's part tokens contain every leftover. Two or none attach
 *    nothing, so the root is returned alone.
 *
 * Tokens are `describeRankingQuery`'s folded, singularized tokens, so a variant is matched by the same words ranking
 * compares.
 *
 * @pattern Specification — `matchVariant` answers "does this query name exactly one of these variants"
 * @module
 */
import { describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';

import { ALIAS_DELIMITER } from '../foodAliases.js';

/** The fields of a variant the rule reads. */
export interface VariantCandidate {
    readonly id: string;
    readonly parts: readonly { readonly text: string }[];
}

/** How well one name or synonym matches the query. */
interface NameMatch {
    /** Query tokens the name holds. */
    readonly matched: number;
    /** The name's own tokens the query does not hold. */
    readonly unmatched: number;
    /** The name's tokens. */
    readonly tokens: ReadonlySet<string>;
}

/**
 * Score one name against the query's tokens. Pure.
 *
 * @param queryTokens - The query's tokens.
 * @param name - The name or synonym.
 * @returns The match.
 */
function scoreName(queryTokens: ReadonlySet<string>, name: string): NameMatch {
    const tokens = new Set(describeRankingQuery(name).tokens);
    const matched = [...queryTokens].filter((token) => tokens.has(token)).length;

    return { matched, unmatched: tokens.size - [...tokens].filter((token) => queryTokens.has(token)).length, tokens };
}

/**
 * The query's tokens that the best-matching name or synonym does not hold. Pure.
 *
 * The best match holds the most query tokens; a tie goes to the name with fewer words of its own outside the query,
 * then to the earlier name, so the root's own name wins a tie with a synonym.
 *
 * @param query - The search query.
 * @param names - The root's name, then its synonyms.
 * @returns The leftovers in query order, without repeats; every query token when `names` is empty.
 */
export function leftoverTokens(query: string, names: readonly string[]): string[] {
    const queryTokens = [...new Set(describeRankingQuery(query).tokens)];
    const querySet = new Set(queryTokens);
    let best: NameMatch | undefined;

    for (const name of names) {
        const candidate = scoreName(querySet, name);

        if (
            best === undefined ||
            candidate.matched > best.matched ||
            (candidate.matched === best.matched && candidate.unmatched < best.unmatched)
        ) {
            best = candidate;
        }
    }

    const subtracted = best?.tokens ?? new Set<string>();

    return queryTokens.filter((token) => !subtracted.has(token));
}

/**
 * The one variant the query names, if exactly one does. Pure.
 *
 * @param query - The search query.
 * @param names - The root's name, then its synonyms.
 * @param variants - The root's live variants.
 * @returns The variant, or `undefined` when the query leaves no words, or when none or several variants hold them.
 */
export function matchVariant<V extends VariantCandidate>(
    query: string,
    names: readonly string[],
    variants: readonly V[],
): V | undefined {
    const leftovers = leftoverTokens(query, names);

    if (leftovers.length === 0) {
        return undefined;
    }

    const survivors = variants.filter((variant) => {
        const tokens = new Set(variant.parts.flatMap((part) => describeRankingQuery(part.text).tokens));

        return leftovers.every((token) => tokens.has(token));
    });

    return survivors.length === 1 ? survivors[0] : undefined;
}

/**
 * A root's name, then its synonyms, as the rule reads them. Pure.
 *
 * @param name - The root's name, or `null`.
 * @param aliases - Its synonyms, `ALIAS_DELIMITER`-joined, or `null`.
 * @returns The names, the root's own first.
 */
export function namesOf(name: string | null, aliases: string | null): string[] {
    return [...(name === null ? [] : [name]), ...(aliases === null ? [] : aliases.split(ALIAS_DELIMITER))];
}
