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
import { evaluateProvenance, resolveStatementProvenance, type ProvenanceDecision } from '../provenancePolicy.js';

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
                sourceKind: null,
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
            sourceKind: null,
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
        expect(decision.allowed === false && decision.denial).toBe('grant');
        expect(decision.allowed === false && decision.denial === 'grant' && decision.requiredScope).toBe(
            CURATOR_IMPORT_SCOPE,
        );
    });

    it('ALLOWS a caller holding the curator grant, and passes the declared source fields through VERBATIM', () => {
        const decision = evaluateProvenance({ declared: CURATED, grantedScopes: [CURATOR_IMPORT_SCOPE] });

        expectDecision(decision, true);
        expect(decision.allowed && decision.provenance).toEqual({
            sourceType: RecipeSourceType.IMPORTED_PUBLIC,
            sourceUrl: CURATED.sourceUrl,
            sourceAttribution: CURATED.sourceAttribution,
            sourceKind: null,
        });
    });

    it('ALLOWS when the grant arrives alongside unrelated scopes', () => {
        expectDecision(
            evaluateProvenance({ declared: CURATED, grantedScopes: ['admin:users', CURATOR_IMPORT_SCOPE] }),
            true,
        );
    });

    it('keeps the curator reading with NO source kind, so the curator’s text stays distinct from a web copy (ADR-0089)', () => {
        const decision = evaluateProvenance({ declared: CURATED, grantedScopes: [CURATOR_IMPORT_SCOPE] });

        expect(decision.allowed && decision.provenance.sourceKind).toBeNull();
    });
});

// The bulk import (ADR-0072 section 9) sets provenance from its per-recipe statement. It must go through the SAME function as a
// recipe's own `statement`, and every resolution must carry the kind: an `imported_public` with no kind reads as the curator's
// public-domain text, which may be public — the hazard ADR-0089 closes.
describe('resolveStatementProvenance — the one reading of a statement, for create and for the bulk import', () => {
    const PAIRING: Record<string, string> = {
        public_web: 'imported_public',
        book: 'imported_physical',
        paid_site: 'imported_paid',
    };

    it('a public_web statement is a web copy with its kind, address and site: never the curator reading', () => {
        expect(resolveStatementProvenance({ kind: 'public_web', citation: 'https://www.allrecipes.com/r/1/' })).toEqual(
            {
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                sourceUrl: 'https://www.allrecipes.com/r/1/',
                sourceAttribution: 'allrecipes.com',
                sourceKind: 'public_web',
            },
        );
    });

    it.each([
        ['book', 'imported_physical'],
        ['paid_site', 'imported_paid'],
    ] as const)('a %s statement is %s with its own kind and the citation as the credit', (kind, sourceType) => {
        expect(resolveStatementProvenance({ kind, citation: 'Joy of Cooking, p. 12' })).toEqual({
            sourceType,
            sourceUrl: null,
            sourceAttribution: 'Joy of Cooking, p. 12',
            sourceKind: kind,
        });
    });

    it('"I wrote this" is the shipped default: user_created and no source at all', () => {
        expect(resolveStatementProvenance({ kind: 'authored' })).toEqual({
            sourceType: RecipeSourceType.USER_CREATED,
            sourceUrl: null,
            sourceAttribution: null,
            sourceKind: null,
        });
    });

    it('a web link that is not a usable source resolves to nothing', () => {
        expect(resolveStatementProvenance({ kind: 'public_web', citation: 'https://commise.app/r/1' })).toBeUndefined();
    });

    it('every resolution satisfies the pairing the 0065 CHECK enforces, so no import write can violate it', () => {
        for (const statement of [
            { kind: 'public_web', citation: 'https://example.com/r' },
            { kind: 'book', citation: 'A book' },
            { kind: 'paid_site', citation: 'A site' },
        ] as const) {
            const resolved = resolveStatementProvenance(statement);

            expect(resolved?.sourceKind).toBe(statement.kind);
            expect(resolved?.sourceType).toBe(PAIRING[statement.kind]);
            expect(statement.kind === 'public_web' ? resolved?.sourceUrl : 'n/a').not.toBeNull();
        }
    });

    it('the statement branch of evaluateProvenance IS this function, not a second copy', () => {
        const statement = { kind: 'public_web', citation: 'https://www.allrecipes.com/r/1/' } as const;
        const decision = evaluateProvenance({ declared: undefined, statement, grantedScopes: [] });

        expect(decision.allowed && decision.provenance).toEqual(resolveStatementProvenance(statement));
    });
});

describe('evaluateProvenance — a pasted web link as the cook’s statement (ADR-0089)', () => {
    const WEB = { kind: 'public_web', citation: 'https://www.allrecipes.com/recipe/1/soup/' } as const;

    it.each([[[]], [['admin:users']], [[CURATOR_IMPORT_SCOPE]]])(
        'is ALLOWED for any caller (grants %j) and resolves to a web copy of the registrable domain',
        (grantedScopes) => {
            const decision = evaluateProvenance({ declared: undefined, statement: WEB, grantedScopes });

            expectDecision(decision, true);
            expect(decision.allowed && decision.provenance).toEqual({
                sourceType: RecipeSourceType.IMPORTED_PUBLIC,
                sourceUrl: 'https://www.allrecipes.com/recipe/1/soup/',
                sourceAttribution: 'allrecipes.com',
                sourceKind: 'public_web',
            });
        },
    );

    it('⛔ never reads the curator grant: grant + statement is a web copy, not the curator reading', () => {
        const decision = evaluateProvenance({
            declared: undefined,
            statement: WEB,
            grantedScopes: [CURATOR_IMPORT_SCOPE],
        });

        expect(decision.allowed && decision.provenance.sourceKind).toBe('public_web');
    });

    it('refuses an address that is not a usable source (our own site), whatever the schema let through', () => {
        const decision = evaluateProvenance({
            declared: undefined,
            statement: { kind: 'public_web', citation: 'https://commise.app/recipes/1' },
            grantedScopes: [],
        });

        expectDecision(decision, false);
        expect(decision.allowed === false && decision.denial).toBe('unusable');
    });

    it('gives every other resolution a null source kind', () => {
        for (const declared of [undefined, { sourceType: RecipeSourceType.USER_CREATED } as const]) {
            const decision = evaluateProvenance({ declared, grantedScopes: [] });

            expect(decision.allowed && decision.provenance.sourceKind).toBeNull();
        }
    });
});
