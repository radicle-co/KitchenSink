/**
 * What a stated source leaves behind in `recipe_source_evidence`, and the one call of the evidence rule (ADR-0089).
 *
 * DESIGN PATTERN: **Mapper + Specification adapter**. {@link evidenceRowOf} is the ONE place a `ResolvedProvenance` becomes an
 * evidence row, shared by `create` (a statement, or the bulk import's per-recipe statement) and a `PATCH` that applies one, so
 * the row's shape is written once. {@link sourceConflictOfEvidence} is the ONE call of recipe-core's `sourceConflictOf` in this
 * service: no route reads evidence rows to decide Public, and none states `verifiedSiteClaims` itself. When the feature-020
 * hold replaces the refusal, this file and `sourceConflictOf` are what change.
 */
import {
    sourceConflictOf,
    type RecipeSourceKind,
    type RecipeSourceKindView,
    type RecipeSourceType,
} from '@kitchensink/recipe-core';

import type { NewRecipeSourceEvidenceRow, SourceEvidenceCapture } from '../../database/schema/recipeSourceEvidence.js';
import type { ResolvedProvenance } from './provenancePolicy.js';

/** An evidence row before it is attached to a recipe. */
export type EvidenceToWrite = Omit<NewRecipeSourceEvidenceRow, 'recipeId'>;

/** What the rule reads of an evidence row, as a stored row or a row about to be written carries it. */
export interface EvidenceFacts {
    readonly sourceDomain?: string | null;
    readonly sourceKind?: RecipeSourceKind | null;
}

/** The registrable domains the cook has proved they own (016 FR-069 site claims). None are built: always empty. */
const NO_VERIFIED_SITE_CLAIMS: readonly string[] = [];

/**
 * The key a later paste matches a source by. ⚠️ OPEN: no normaliser exists beyond `parseSourceLink`'s re-serialised address, so
 * the key IS that address. One function, so the owner's ruling on the real key changes one line.
 *
 * @param address - The proved web address (`parseSourceLink`'s `url`).
 * @returns The key. Pure.
 */
function sourceKeyOf(address: string): string {
    return address;
}

/**
 * The evidence row a provenance leaves, or `undefined` when it states no source.
 *
 * @param provenance - What the write persists as the recipe's source.
 * @param capture - How the statement reached the service: `editorLink` (a link on a recipe write) or `importFile`.
 * @returns The row to append, or `undefined` for a recipe with no stated kind (the cook's own, or the curator's text).
 * @throws {Error} A web provenance with no address: the caller built it wrong, and no row would record the source.
 */
export function evidenceRowOf(
    provenance: ResolvedProvenance,
    capture: SourceEvidenceCapture,
): EvidenceToWrite | undefined {
    switch (provenance.sourceKind) {
        case null:
            return undefined;

        case 'public_web': {
            if (provenance.sourceUrl === null) {
                throw new Error('A web source was stated with no address, so no evidence row can record it.');
            }

            return {
                capture,
                sourceUrl: provenance.sourceUrl,
                sourceKey: sourceKeyOf(provenance.sourceUrl),
                // The site `parseSourceLink` proved, which `resolveStatementProvenance` stores as the attribution.
                sourceDomain: provenance.sourceAttribution,
                sourceKind: 'public_web',
            };
        }

        case 'book':
        case 'paid_site':
            return {
                capture,
                sourceKind: provenance.sourceKind,
                citation: provenance.sourceAttribution,
            };
    }
}

/**
 * Whether the evidence holds the recipe out of Public. The ONE call of `sourceConflictOf` in this service.
 *
 * @param evidence - Every evidence row of the recipe (or the facts of the rows about to be written).
 * @param recipe - The recipe's label and kind AS THE WRITE LEAVES THEM.
 * @returns `true` when Public must be refused. Pure.
 */
export function sourceConflictOfEvidence(
    evidence: readonly EvidenceFacts[],
    recipe: { readonly sourceType: RecipeSourceType; readonly sourceKind: RecipeSourceKindView | null },
): boolean {
    return sourceConflictOf({
        evidence: evidence.map((row) => ({
            sourceDomain: row.sourceDomain ?? null,
            sourceKind: row.sourceKind ?? null,
        })),
        ...recipe,
        verifiedSiteClaims: NO_VERIFIED_SITE_CLAIMS,
    });
}
