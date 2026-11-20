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
    statementRequiredOf,
    type RecipeSourceKind,
    type RecipeSourceKindView,
    type RecipeSourceType,
    type RecipeStatementKind,
    type SourceEvidenceFacts,
} from '@kitchensink/recipe-core';

import type { NewRecipeSourceEvidenceRow } from '../../database/schema/recipeSourceEvidence.js';
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
 * The key a later paste matches a source by: the proved address without its `#fragment`, which never names a different page.
 * ⚠️ OPEN: tracking parameters and a trailing slash are NOT normalised here; the duplicate lookup settles that rule before it
 * writes any `pastedPage` row (the table is append-only, so a stored key cannot be rewritten). One function, so that ruling
 * changes one place.
 *
 * @param address - The proved web address (`parseSourceLink`'s `url`).
 * @returns The key. Pure.
 */
function sourceKeyOf(address: string): string {
    const page = new URL(address);

    page.hash = '';

    return page.href;
}

/**
 * How a statement reached the service: `editor` (the cook's own statement on a recipe write, which captures a pasted link or a
 * typed citation by its kind) or `importFile` (the bulk import).
 */
export type EvidenceCapturePath = 'editor' | 'importFile';

/**
 * The evidence row a provenance leaves, or `undefined` when it states no source.
 *
 * @param provenance - What the write persists as the recipe's source.
 * @param path - How the statement reached the service. An `editor` statement is captured as `editorLink` (a web address) or
 *   `editorCitation` (a book or a paid site), so the capture always matches the kind the database CHECK pairs it with.
 * @returns The row to append, or `undefined` for a recipe with no stated kind (the cook's own, or the curator's text).
 * @throws {Error} A web provenance with no address: the caller built it wrong, and no row would record the source.
 */
function evidenceRowOf(provenance: ResolvedProvenance, path: EvidenceCapturePath): EvidenceToWrite | undefined {
    switch (provenance.sourceKind) {
        case null:
            return undefined;

        case 'public_web': {
            if (provenance.sourceUrl === null) {
                throw new Error('A web source was stated with no address, so no evidence row can record it.');
            }

            return {
                capture: path === 'editor' ? 'editorLink' : 'importFile',
                sourceUrl: provenance.sourceUrl,
                sourceKey: sourceKeyOf(provenance.sourceUrl),
                // The site `parseSourceLink` proved, which `resolveStatementProvenance` stores as the attribution.
                sourceDomain: provenance.sourceAttribution,
                sourceKind: 'public_web',
            };
        }

        case 'book':
        case 'paid_site':
            // The editor states a book or a paid site by citation, the kinds `EDITOR_CITATION_SOURCE_KINDS` lists and the
            // database CHECK pairs with `editorCitation`.
            return {
                capture: path === 'editor' ? 'editorCitation' : 'importFile',
                sourceKind: provenance.sourceKind,
                citation: provenance.sourceAttribution,
            };
    }
}

/**
 * The evidence a provenance leaves, as a list: none for a recipe with no stated kind, else its one row. The ONE place a
 * `ResolvedProvenance` becomes evidence (create, a PATCH and set-visibility all read it), so no caller spells "none or one".
 *
 * @param provenance - What the write persists as the recipe's source.
 * @param path - How the statement reached the service ({@link evidenceRowOf}).
 * @returns Zero or one row to append. Pure.
 * @throws {Error} As {@link evidenceRowOf}.
 */
export function evidenceListOf(provenance: ResolvedProvenance, path: EvidenceCapturePath): EvidenceToWrite[] {
    const row = evidenceRowOf(provenance, path);

    return row === undefined ? [] : [row];
}

/** What `sourceConflictOf` and `statementRequiredOf` read of each evidence row: the ONE mapping, so the two cannot differ. */
function evidenceFactsOf(evidence: readonly EvidenceFacts[]): SourceEvidenceFacts[] {
    return evidence.map((row) => ({ sourceDomain: row.sourceDomain ?? null, sourceKind: row.sourceKind ?? null }));
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
        evidence: evidenceFactsOf(evidence),
        ...recipe,
        verifiedSiteClaims: NO_VERIFIED_SITE_CLAIMS,
    });
}

/**
 * Whether the recipe still needs the cook's statement before it may be left published and Public. The ONE call of
 * `statementRequiredOf` in this service, beside the one call of `sourceConflictOf`: the two rules are separate on purpose (the
 * feature-020 hold replaces only the first), and each is asked here and in the policy's order, never merged.
 *
 * @param evidence - Every evidence row of the recipe (or the facts of the rows about to be written).
 * @param recipe - The recipe's label and statement AS THE WRITE LEAVES THEM, and when content was first reported pasted
 *   (`null` or absent: never).
 * @returns `true` when the statement is still owed. Pure.
 */
export function statementRequiredOfEvidence(
    evidence: readonly EvidenceFacts[],
    recipe: {
        readonly sourceType: RecipeSourceType;
        readonly statementKind: RecipeStatementKind | null;
        readonly contentPastedAt: Date | string | null | undefined;
    },
): boolean {
    return statementRequiredOf({
        evidence: evidenceFactsOf(evidence),
        sourceType: recipe.sourceType,
        statementKind: recipe.statementKind,
        contentPasted: recipe.contentPastedAt !== null && recipe.contentPastedAt !== undefined,
    });
}
