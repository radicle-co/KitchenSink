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
 * cook's STATEMENT, which a cook may change at any time, also after the first publish (ADR-0093 section 8, owner ruling 2026-11-15),
 * except that "From another person" is never changed or cleared (owner ruling 2026-11-19).
 *
 * ## ⛔ What stays locked
 *
 * The first publish locks nothing. The source stays locked where the cook did not state it in the editor (the curator's
 * public-domain text, a paid site): a pasted link restates nothing about those. It is also locked once the recipe stores
 * "From another person", and for a recipe with no stored statement whose only trace is a past "From another person"
 * attestation (a recipe cleared before the lock existed). Only stating it again passes, as a no-op. It is locked for a
 * source a clone inherited, so cloning is not a way to relabel a recipe, and for a kind or statement this service does not know. The rule is
 * `sourceIsCorrectable`, which the editor reads too. Detected source evidence is append-only and a statement never touches it, so a
 * recipe that holds evidence is still refused Public by `sourceConflict`, whatever the cook says.
 *
 * ## Visibility
 *
 * Every write that SETS a source sets Private with it, in the same write: a web copy or a book is private only, and a draft holds no
 * slot, so nothing is counted. The policy does not read the stored visibility, so a draft that raced to public still ends
 * private. A clear never touches visibility: removing the source does not make a recipe public.
 *
 * @pattern Specification — one pure predicate over the stored source and the statement
 */
import {
    fromPersonOf,
    sourceIsCorrectable,
    type CorrectableSourceFacts,
    type RecipeSourceKind,
    type RecipeStatementKind,
} from '@kitchensink/recipe-core';

import type { RecipeStatementInput } from '../recipes.schema.js';
import { evaluateProvenance, type ResolvedProvenance } from './provenancePolicy.js';

/**
 * The facts of the stored recipe the decision reads: exactly what `sourceIsCorrectable` reads, the one lock rule. The
 * service reads them from its own database, so the kind is always one it knows (a client may hold an unrecognised one).
 */
export type StoredSource = CorrectableSourceFacts & {
    readonly sourceKind: RecipeSourceKind | null;
    /** What the cook stated (`recipes.statement_kind`), or `null`. The database CHECK keeps it to the known vocabulary. */
    readonly statementKind: RecipeStatementKind | null;
    /** The stored citation (`recipes.source_attribution`), or `null`: what a paid site stated again is compared with. */
    readonly sourceAttribution: string | null;
    /**
     * Whether the recipe holds a past "from another person" attestation while it stores NO statement (R2, P7). It is read in
     * the write's transaction and only when a statement is sent and none is stored; everywhere else it is `false`. Such a
     * recipe is locked against every move except stating "from another person" again.
     */
    readonly attestedFromPerson: boolean;
};

/**
 * What a PATCH does to the source.
 *
 * - `unchanged`: the body carried no statement, or its statement would leave the recipe as it is.
 * - `apply`: write `provenance`; `makePrivate` says the same write also sets visibility to private.
 * - `locked`: refused, the source cannot change (not a statement the cook made, inherited by a clone, or "from another
 *   person", which only Commise changes), or the recipe holds a past "from another person" attestation and the move is not
 *   that statement again.
 * - `unusable`: refused, the statement is not a usable web source (the wire schema refuses it first).
 */
export type SourceCorrection =
    | { readonly kind: 'unchanged' }
    | { readonly kind: 'apply'; readonly provenance: ResolvedProvenance; readonly makePrivate: boolean }
    | { readonly kind: 'locked' }
    | { readonly kind: 'unusable' };

/**
 * Whether a statement would leave the recipe exactly as stored: the provenance it resolves to states no source and names the
 * statement the recipe already holds. Such a statement took no effect, so it is neither written nor recorded. A statement that
 * states a source is never "already held": a second link is a new fact, and its evidence is appended.
 */
function holdsAlready(provenance: ResolvedProvenance, stored: StoredSource): boolean {
    return (
        provenance.sourceKind === null &&
        stored.sourceKind === null &&
        provenance.sourceType === stored.sourceType &&
        provenance.statementKind === stored.statementKind
    );
}

/**
 * Decide what a PATCH's `statement` does. Pure.
 *
 * ## A statement after the first publish
 *
 * The cook may state, change or clear a statement after the first publish, whichever it is (I wrote this, a web page, a
 * cookbook, another person). A third-party statement forces Private in the same write and appends its evidence. Saying the
 * same statement again is `unchanged`, so a retry of "attest, then make public" does not meet a lock.
 *
 * ## What took effect
 *
 * A statement the recipe already holds, and a clear of a statement that was never made, are `unchanged`:
 * the attestation record is built from what a write DID, so it never says the cook cleared nothing.
 *
 * ⛔ Authored over a recipe that has source evidence is still refused Public, by `sourceConflict` and not here: the attestation
 * is recorded, and the evidence rule (the seam the feature-020 hold replaces) is a separate question.
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

    // 1. No statement: nothing to decide.
    if (statement === undefined) {
        return { kind: 'unchanged' };
    }

    // 2. A write that changes nothing is `unchanged` BEFORE the lock, for every kind: it writes nothing, so it can never break a
    // lock. That is what lets a resend (a lost response, a retry after a 409) through, and "from another person" over itself.
    // An unusable statement never stops here, so it still meets the lock.
    // The same paid site stated again is such a write: a paid-site answer rides every write until the server holds it.
    if (
        statement?.kind === 'paid_site' &&
        stored.sourceKind === 'paid_site' &&
        stored.sourceAttribution === statement.citation
    ) {
        return { kind: 'unchanged' };
    }

    // No statement is the shipped default reading: user_created with no source fields. No grant is read on either branch.
    const decision =
        statement === null
            ? evaluateProvenance({ declared: undefined, grantedScopes: [] })
            : evaluateProvenance({ statement, grantedScopes: [] });

    if (decision.allowed && holdsAlready(decision.provenance, stored)) {
        return { kind: 'unchanged' };
    }

    // 3. ONE lock rule, shared with the editor (`sourceIsCorrectable`, recipe-core): not stated by the cook, inherited by a
    // clone, "from another person" (only Commise changes it), or an unknown kind. The first publish is not part of it.
    if (!sourceIsCorrectable(stored)) {
        return { kind: 'locked' };
    }

    // 4. The attestation arm: a recipe with no stored statement but a past "from another person" attestation. A clear over it was
    // `unchanged` above; every move except stating "from another person" again is locked, an unusable one included.
    if (stored.attestedFromPerson && statement?.kind !== 'fromPerson') {
        return { kind: 'locked' };
    }

    // 5. Apply.
    return applyOf(decision);
}

/**
 * The correction a provenance decision stands for. Pure.
 *
 * Every write that SETS a source sets Private with it, keyed on the provenance that results (`sourceKind`) and not on the
 * statement's presence: "I wrote this" sets no source, so it never makes a recipe private, and a published recipe attested
 * after its first publish keeps the visibility it has. The one exception is "from another person" (`fromPerson`): it sets no
 * source either, but the recipe is not the cook's to publish, so it is private in the same write. It is not decided from a
 * visibility read outside the lock: a draft that raced to public between that read and this write must still end private.
 */
function applyOf(decision: ReturnType<typeof evaluateProvenance>): SourceCorrection {
    if (!decision.allowed) {
        return { kind: 'unusable' };
    }

    return {
        kind: 'apply',
        provenance: decision.provenance,
        makePrivate:
            decision.provenance.sourceKind !== null ||
            // `attestedFromPerson: false`: this decides only what the write itself sets Private; a past "from another person"
            // attestation keeps a cleared recipe off Public at the publish gate (`hasFromPerson`), not here.
            fromPersonOf({ statementKind: decision.provenance.statementKind, attestedFromPerson: false }),
    };
}
