/**
 * Unit tests for the pure provenance-declaration policy (004-FR-024 / 004-FR-025, ADR-0023).
 *
 * Pins EVERY row of the declarable-provenance matrix over `(declared, grantedScopes)`. The evaluator is
 * pure — inputs only, decision out — so no DB, DI, principal object or fixture is involved.
 *
 * The two rows that carry the security argument, and which a mutant must not survive:
 *
 *  1. **An ABSENT declaration is `user_created` with NO source fields.** 004-FR-024 requires that omitting
 *     provenance leaves `POST /api/v1/recipes` behaving exactly as it did before this policy existed. A
 *     mutant that defaulted to `imported_public`, or that leaked a `sourceUrl` from a previous call, would
 *     silently reclassify every ordinary user recipe.
 *  2. **`imported_public` WITHOUT the curator grant is DENIED.** That is the whole of 004-FR-025's threat
 *     model — a caller who can declare `imported_public` can attach false attribution to public content.
 *     The grant is read from the token's SIGNED `public_metadata`, so the denial is the only thing standing
 *     between an ordinary bearer and an attributed public recipe.
 */
import { describe, expect, it } from 'vitest';
import { RecipeSourceType } from '@kitchensink/recipe-core';

import { CURATOR_IMPORT_SCOPE } from '../../recipes.schema.js';
import { evaluateProvenance, type ProvenanceDecision } from '../provenancePolicy.js';

/** A well-formed curated declaration — the only non-default shape the wire admits. */
const CURATED = {
    sourceType: RecipeSourceType.IMPORTED_PUBLIC,
    sourceUrl: 'https://www.gutenberg.org/cache/epub/12350/pg12350.txt',
    sourceAttribution: 'The International Jewish Cook Book by Florence Kreisler Greenbaum',
} as const;

/**
 * Assert a decision's outcome AND that it carries a non-empty reason.
 *
 * The reason check kills the `reason -> ''` mutant: a denial's reason is surfaced as the user-facing error
 * message, and an allow's reason is what a reviewer reads to understand why the grant applied. Neither is
 * coupled to exact wording.
 */
function expectDecision(decision: ProvenanceDecision, allowed: boolean): void {
    expect(decision.allowed).toBe(allowed);
    expect(decision.reason.length).toBeGreaterThan(0);
}

describe('evaluateProvenance — an absent declaration (004-FR-024: existing behaviour unchanged)', () => {
    it('resolves to user_created with NO source fields, whatever the caller holds', () => {
        for (const grantedScopes of [[], [CURATOR_IMPORT_SCOPE], ['admin:users']]) {
            const decision = evaluateProvenance({ declared: undefined, grantedScopes });

            expectDecision(decision, true);
            expect(decision.allowed && decision.provenance).toEqual({
                sourceType: RecipeSourceType.USER_CREATED,
                sourceUrl: null,
                sourceAttribution: null,
            });
        }
    });
});

describe('evaluateProvenance — an explicit user_created declaration', () => {
    it('is ALLOWED for an ungranted caller and carries no source fields', () => {
        const decision = evaluateProvenance({
            declared: { sourceType: RecipeSourceType.USER_CREATED },
            grantedScopes: [],
        });

        expectDecision(decision, true);
        expect(decision.allowed && decision.provenance).toEqual({
            sourceType: RecipeSourceType.USER_CREATED,
            sourceUrl: null,
            sourceAttribution: null,
        });
    });
});

describe('evaluateProvenance — imported_public is grant-gated (004-FR-025 / ADR-0023)', () => {
    it('DENIES a caller holding NO scopes', () => {
        expectDecision(evaluateProvenance({ declared: CURATED, grantedScopes: [] }), false);
    });

    it('DENIES a caller holding OTHER scopes — the grant is not "any privilege"', () => {
        expectDecision(
            evaluateProvenance({ declared: CURATED, grantedScopes: ['admin:users', 'recipes:import'] }),
            false,
        );
    });

    it('names the scope the caller would need, so the denial is actionable', () => {
        const decision = evaluateProvenance({ declared: CURATED, grantedScopes: [] });

        expect(decision.allowed).toBe(false);
        expect(decision.allowed === false && decision.requiredScope).toBe(CURATOR_IMPORT_SCOPE);
    });

    it('ALLOWS a caller holding the curator grant, and passes the declared source fields through VERBATIM', () => {
        const decision = evaluateProvenance({ declared: CURATED, grantedScopes: [CURATOR_IMPORT_SCOPE] });

        expectDecision(decision, true);
        expect(decision.allowed && decision.provenance).toEqual({
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            sourceUrl: CURATED.sourceUrl,
            sourceAttribution: CURATED.sourceAttribution,
        });
    });

    it('ALLOWS when the grant arrives alongside unrelated scopes', () => {
        expectDecision(
            evaluateProvenance({ declared: CURATED, grantedScopes: ['admin:users', CURATOR_IMPORT_SCOPE] }),
            true,
        );
    });
});
