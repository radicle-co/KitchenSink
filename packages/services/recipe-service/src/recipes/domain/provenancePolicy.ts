/**
 * The pure provenance-declaration policy (004-FR-024 / 004-FR-025, ADR-0023).
 *
 * DESIGN PATTERN: **Specification / Policy module**, the sibling of `evaluateVisibility`. It answers ONE
 * question — "may this caller declare this provenance, and what provenance results?" — from its inputs alone:
 * no DB, no `Principal` object, no I/O. Grants arrive as a primitive `readonly string[]` for exactly the
 * reason `evaluateVisibility` takes `isPremium: boolean` rather than a principal: a policy that can reach a
 * request cannot be exhausted as a truth table.
 *
 * ## The seam between the two policies
 *
 * This one decides **what the recipe IS**; `evaluateVisibility` decides **what visibility that thing may
 * hold**. `RecipesService.create` runs them in that order and feeds this policy's `sourceType` into that one.
 * Before ADR-0023 the second policy was handed the literal `USER_CREATED`, so a recipe's declared provenance
 * and the provenance its visibility was judged against could never be the same fact.
 *
 * ## ⛔ Why this is NOT a route Guard
 *
 * `identity`'s `ScopesGuard` + `@RequireScopes('admin:users')` is the codebase's established shape for scope
 * checks, and it is the WRONG tool here: it is **route**-level, and `POST /api/v1/recipes` must stay open to
 * every authenticated user. What is being authorized is a **field VALUE** — "declaring `imported_public`
 * requires a grant" — so the check belongs inside the rule, where the whole decision stays one pure, total,
 * table-testable function. Applying a guard would gate a route that must not be gated, and would split the
 * decision across two layers. This is a genuinely new authorization SHAPE in this codebase (field-level, not
 * route-level); it is not a new authorization CONCEPT — `Principal.scopes` has been read from the token's
 * signed `public_metadata` since the service shipped.
 *
 * ## The threat this closes
 *
 * A caller who can declare `imported_public` can attach FALSE ATTRIBUTION to public content — assert that a
 * recipe they wrote came from a named work by a named author. 004-FR-025's original text forbids any caller
 * from declaring it, on the reasoning that the server sets it "from the channel it observed". ADR-0023
 * amends that to **unprivileged** caller, because the curated-import channel's observation is an
 * administrator granting {@link CURATOR_IMPORT_SCOPE} out of band in Clerk, carried on the signing key's
 * authority — a stronger control than "the server fetched a URL the caller chose", which attributes content
 * the caller may have written.
 */
import { RecipeSourceType } from '@kitchensink/recipe-core';

import { CURATOR_IMPORT_SCOPE, type RecipeSourceInput } from '../recipes.schema.js';

/** The complete input to a provenance decision. */
export interface ProvenancePolicyInput {
    /** The provenance the caller declared, or `undefined` when the body carried none. */
    readonly declared: RecipeSourceInput | undefined;
    /**
     * Every grant the caller holds.
     *
     * The service passes `scopes` ∪ `permissions`, mirroring `identity`'s `ScopesGuard` rule that a scope is
     * satisfied by EITHER list. Both are read from the token's SIGNED `public_metadata`; a top-level claim is
     * never a grant.
     */
    readonly grantedScopes: readonly string[];
}

/** The provenance the service will persist, fully resolved. `null` means "no such source", never `''`. */
export interface ResolvedProvenance {
    /** The recipe's provenance classification. */
    readonly sourceType: RecipeSourceType;
    /** The original source URL, or `null` for content with no external source. */
    readonly sourceUrl: string | null;
    /** The human-readable credit, or `null` for content with no external source. */
    readonly sourceAttribution: string | null;
}

/**
 * The outcome of a provenance decision.
 *
 * A DISCRIMINATED UNION rather than `{ allowed, provenance? }`: a denied decision has no provenance to
 * carry, and an optional field would let a caller read `undefined` as `user_created` on the failure path.
 * Both members carry a `reason` — the denial's is surfaced as the error message, the allow's is what a
 * reviewer reads to see why the grant applied.
 */
export type ProvenanceDecision =
    | { readonly allowed: true; readonly provenance: ResolvedProvenance; readonly reason: string }
    | { readonly allowed: false; readonly reason: string; readonly requiredScope: string };

/** The provenance of a recipe whose author declared none — the shipped default, unchanged (004-FR-024). */
const UNDECLARED: ResolvedProvenance = {
    sourceType: RecipeSourceType.USER_CREATED,
    sourceUrl: null,
    sourceAttribution: null,
};

/**
 * Evaluate whether a caller may declare the provenance in its create body, and resolve what will be
 * persisted. Pure — inputs only.
 *
 * An ABSENT declaration resolves to `user_created` with no source fields, which is byte-for-byte what
 * `RecipesService.create` hardcoded before this policy existed; that equivalence is what makes 004-FR-024's
 * "existing behaviour is unchanged" a checked property rather than a claim.
 *
 * @param input - The declared provenance (or its absence) and the caller's grants.
 * @returns An allow decision carrying the resolved provenance, or a denial naming the scope required.
 */
export function evaluateProvenance(input: ProvenancePolicyInput): ProvenanceDecision {
    const { declared, grantedScopes } = input;

    if (declared === undefined) {
        return { allowed: true, provenance: UNDECLARED, reason: 'No provenance declared; the author is the source.' };
    }

    switch (declared.sourceType) {
        case RecipeSourceType.USER_CREATED:
            // Declaring the default explicitly is the same assertion as omitting it, and needs no grant: the
            // caller is claiming authorship of their own content, which no attribution rule protects against.
            return {
                allowed: true,
                provenance: UNDECLARED,
                reason: 'A caller may always declare their own content as user-created.',
            };
        case RecipeSourceType.IMPORTED_PUBLIC:
            if (!grantedScopes.includes(CURATOR_IMPORT_SCOPE)) {
                return {
                    allowed: false,
                    reason: `Declaring an imported public-domain source requires the '${CURATOR_IMPORT_SCOPE}' grant.`,
                    requiredScope: CURATOR_IMPORT_SCOPE,
                };
            }

            return {
                allowed: true,
                provenance: {
                    sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                    sourceUrl: declared.sourceUrl,
                    sourceAttribution: declared.sourceAttribution,
                },
                reason: 'The caller holds the curator grant for public-domain imports.',
            };
    }
}
