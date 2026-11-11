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
import { RecipeSourceType, parseSourceLink, type RecipeSourceKind } from '@kitchensink/recipe-core';

import { CURATOR_IMPORT_SCOPE, type RecipeSourceInput, type RecipeStatementInput } from '../recipes.schema.js';

/**
 * The complete input to a provenance decision.
 *
 * ⛔ A UNION, so "both" is unrepresentable (ADR-0089). A caller either DECLARES a provenance (the curator's `source`, which
 * the grant gates) or STATES one (the cook's pasted web link, `statement`, which no grant gates and which never reads the
 * grant). A body carrying both is a `400` before this policy is asked, and the type refuses to build it anyway.
 */
export type ProvenancePolicyInput = {
    /**
     * Every grant the caller holds.
     *
     * The service passes `scopes` ∪ `permissions`, mirroring `identity`'s `ScopesGuard` rule that a scope is
     * satisfied by EITHER list. Both are read from the token's SIGNED `public_metadata`; a top-level claim is
     * never a grant.
     */
    readonly grantedScopes: readonly string[];
} & (
    | {
          /** The provenance the caller declared, or `undefined` when the body carried none. */
          readonly declared: RecipeSourceInput | undefined;
          readonly statement?: undefined;
      }
    | {
          readonly declared?: undefined;
          /** The cook's statement: a pasted link to the public web page the recipe was copied from. */
          readonly statement: RecipeStatementInput;
      }
);

/** The provenance the service will persist, fully resolved. `null` means "no such source", never `''`. */
export interface ResolvedProvenance {
    /** The recipe's provenance classification. */
    readonly sourceType: RecipeSourceType;
    /** The original source URL, or `null` for content with no external source. */
    readonly sourceUrl: string | null;
    /** The human-readable credit, or `null` for content with no external source. */
    readonly sourceAttribution: string | null;
    /**
     * What the cook said the source is, or `null`. ONLY a statement sets it: the curator's reading keeps `null`, which is
     * what tells the curator's public-domain text (may be public) from a web copy (private only) under the same label.
     */
    readonly sourceKind: RecipeSourceKind | null;
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
    | {
          /** The caller lacks the grant the declaration needs (a `403`). */
          readonly allowed: false;
          readonly denial: 'grant';
          readonly reason: string;
          readonly requiredScope: string;
      }
    | {
          /** The statement's link is not a usable web source, which no grant could change (a `400`). */
          readonly allowed: false;
          readonly denial: 'unusable';
          readonly reason: string;
      };

/** The provenance of a recipe whose author declared none — the shipped default, unchanged (004-FR-024). */
const UNDECLARED: ResolvedProvenance = {
    sourceType: RecipeSourceType.USER_CREATED,
    sourceUrl: null,
    sourceAttribution: null,
    sourceKind: null,
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
    const { declared, statement, grantedScopes } = input;

    if (statement !== undefined) {
        // ⛔ The statement branch NEVER reads `grantedScopes`: a cook states where a copy came from, and the label says
        // exactly that (ADR-0072 section 9). It is a web copy whatever else the caller holds, so a curator who states a link
        // gets a private web copy, not the curator's public-domain reading.
        const parsed = parseSourceLink(statement.citation);

        if (!parsed.ok) {
            return { allowed: false, denial: 'unusable', reason: 'The source link is not a public web page address.' };
        }

        return {
            allowed: true,
            provenance: {
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                sourceUrl: parsed.link.url,
                sourceAttribution: parsed.link.site,
                sourceKind: statement.kind,
            },
            reason: 'The cook stated that this recipe was copied from a public web page.',
        };
    }

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
                    denial: 'grant',
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
                    // The curator's reading is the one `imported_public` with NO kind (ADR-0089).
                    sourceKind: null,
                },
                reason: 'The caller holds the curator grant for public-domain imports.',
            };
    }
}
