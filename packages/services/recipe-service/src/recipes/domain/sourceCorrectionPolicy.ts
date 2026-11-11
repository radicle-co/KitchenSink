/**
 * The pure source-correction policy: may a `PATCH` change a recipe's source, and what does the write leave? (ADR-0089)
 *
 * DESIGN PATTERN: **Specification / Policy module**, a sibling of `evaluateProvenance` (what the recipe IS, on create),
 * `evaluateVisibility` and `evaluatePublication`. It answers from its inputs alone: no DB, no principal, no I/O, so the whole
 * rule is one total, table-testable function.
 *
 * ## Why a PATCH may touch the source at all
 *
 * The editor's draft checkpoints may create the server row BEFORE the cook pastes the link, so the link must be settable on
 * the draft that already exists. Provenance by DECLARATION (the curator's `source`) stays create-only (ADR-0023); this is the
 * cook's STATEMENT, which a cook may correct until the recipe is first published.
 *
 * ## ⛔ The window and what it protects
 *
 * It closes at `first_published_at` (ADR-0058, set by a trigger and never cleared) and stays closed: a recipe set back to
 * draft is still locked, because a source label that could be removed after publishing would be the relabel route ADR-0077
 * section 2 refuses. It is also closed for any source the cook did not state through a link (the curator's public-domain
 * text, a book, a paid site): a pasted link restates nothing about those. And it is closed for a source a clone inherited,
 * so cloning is not a way to relabel a recipe. The rule is `sourceIsCorrectable`, which the editor reads too.
 *
 * ## Visibility
 *
 * Every write that SETS a source sets Private with it, in the same write: a web copy is private only, and a draft holds no
 * slot, so nothing is counted. The policy does not read the stored visibility, so a draft that raced to public still ends
 * private. A clear never touches visibility: removing the source does not make a recipe public.
 *
 * @pattern Specification — one pure predicate over the stored source and the statement
 */
import { sourceIsCorrectable, type CorrectableSourceFacts } from '@kitchensink/recipe-core';

import type { RecipeStatementInput } from '../recipes.schema.js';
import { evaluateProvenance, type ResolvedProvenance } from './provenancePolicy.js';

/** The facts of the stored recipe the decision reads: exactly what `sourceIsCorrectable` reads, the one lock rule. */
export type StoredSource = CorrectableSourceFacts;

/**
 * What a PATCH does to the source.
 *
 * - `unchanged`: the body carried no statement.
 * - `apply`: write `provenance`; `makePrivate` says the same write also sets visibility to private.
 * - `locked`: refused, the source cannot change (published once, or not a statement the cook made).
 * - `unusable`: refused, the statement is not a usable web source (the wire schema refuses it first).
 */
export type SourceCorrection =
    | { readonly kind: 'unchanged' }
    | { readonly kind: 'apply'; readonly provenance: ResolvedProvenance; readonly makePrivate: boolean }
    | { readonly kind: 'locked' }
    | { readonly kind: 'unusable' };

/**
 * Decide what a PATCH's `statement` does. Pure.
 *
 * @param input.statement - The body's statement: `undefined` (absent), `null` (remove the source) or a statement.
 * @param input.stored - The stored recipe's source facts.
 * @returns The correction to write, or why it is refused.
 */
export function evaluateSourceCorrection(input: {
    readonly statement: RecipeStatementInput | null | undefined;
    readonly stored: StoredSource;
}): SourceCorrection {
    const { statement, stored } = input;

    if (statement === undefined) {
        return { kind: 'unchanged' };
    }

    // ONE lock rule, shared with the editor (`sourceIsCorrectable`, recipe-core): published once, not stated by link, or
    // inherited by a clone.
    if (!sourceIsCorrectable(stored)) {
        return { kind: 'locked' };
    }

    // No statement is the shipped default reading: user_created with no source fields. No grant is read on either branch.
    const decision =
        statement === null
            ? evaluateProvenance({ declared: undefined, grantedScopes: [] })
            : evaluateProvenance({ statement, grantedScopes: [] });

    if (!decision.allowed) {
        return { kind: 'unusable' };
    }

    return {
        kind: 'apply',
        provenance: decision.provenance,
        // Every write that SETS a source sets Private with it. It is not decided from a visibility read outside the lock: a
        // draft that raced to public between that read and this write must still end private.
        makePrivate: statement !== null,
    };
}
