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
    sourceLockOf,
    type CorrectableSourceFacts,
    type RecipeSourceKind,
    type RecipeStatementKind,
} from '@kitchensink/recipe-core';

import type { RecipeStatementInput } from '../recipes.schema.js';
import { evaluateProvenance, type ResolvedProvenance, type StatementAnswer } from './provenancePolicy.js';
import { sourceKeyOf } from './sourceEvidence.js';

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
    /** The stored link (`recipes.source_url`), or `null`: a web link stated again is compared with it by its source key. */
    readonly sourceUrl: string | null;
    /**
     * Whether the recipe holds a past "from another person" attestation while it stores NO statement (a recipe cleared before the lock existed). It is read in
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
 * Whether a source-bearing statement says what the recipe already holds (KTD-2): the same kind and the same citation. A web link
 * is compared by its source key (the address without its `#fragment`), a book title and a paid-site citation exactly as stored,
 * because the write stores them as sent. Pure.
 */
export function restatesStored(statement: StatementAnswer, stored: StoredSource): boolean {
    switch (statement.kind) {
        case 'paid_site':
            return stored.sourceKind === 'paid_site' && stored.sourceAttribution === statement.citation;
        case 'book':
            return stored.sourceKind === 'book' && stored.sourceAttribution === statement.citation;
        case 'public_web':
            return (
                stored.sourceKind === 'public_web' &&
                stored.sourceUrl !== null &&
                sourceKeyOf(statement.citation) === sourceKeyOf(stored.sourceUrl)
            );
        default:
            return false;
    }
}

/**
 * Whether a statement would leave the recipe exactly as stored: the provenance it resolves to states no source and names the
 * statement the recipe already holds. Such a statement took no effect, so it is neither written nor recorded. A statement that
 * states a source is never "already held": a second link is a new fact, and its evidence is appended.
 */
export function holdsAlready(provenance: ResolvedProvenance, stored: StoredSource): boolean {
    return (
        provenance.sourceKind === null &&
        stored.sourceKind === null &&
        provenance.sourceType === stored.sourceType &&
        provenance.statementKind === stored.statementKind
    );
}

/** The routes that write a recipe's source or visibility, as {@link confirmsSource} tells them apart. */
export type SourceWriteRoute = 'create' | 'update' | 'setVisibility';

/**
 * Whether a request CONFIRMS the source answer (KTD-3, ADR-0100): the one act the database cannot see. Only Make public with a
 * statement does. A PATCH or a create carrying a statement never confirms: the editor's draft checkpoints state the source
 * before the cook has decided, and a first publish confirms it in the database anyway (migration 0092). Pure.
 *
 * @param route - The route the request came by.
 * @param request.statement - The request's statement: `undefined` (absent), `null` (a clear) or a statement.
 * @returns Whether the write sets `source_confirmed_at`.
 */
export function confirmsSource(
    route: SourceWriteRoute,
    request: { readonly statement: RecipeStatementInput | null | undefined },
): boolean {
    return route === 'setVisibility' && request.statement !== undefined && request.statement !== null;
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
    // An unusable statement never stops here, so it still meets the lock. KTD-2 (ADR-0100): a restatement is compared by kind and
    // citation, so the same link (by its source key), book title or paid-site citation stated again is such a write.
    if (statement !== null && restatesStored(statement, stored)) {
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

    // 3. ONE lock rule, shared with the editor (`sourceLockOf`, recipe-core): not stated by the cook, inherited by a clone, "from
    // another person", an unknown kind, or a confirmed answer (ADR-0100). A confirmed own answer can only be downgraded to a book or
    // a paid site. The first publish is not part of it.
    // The one move the lock lets through over a past "from another person" attestation: stating it again.
    const restatesFromPerson = stored.attestedFromPerson && statement?.kind === 'fromPerson';
    const lock = restatesFromPerson ? sourceLockOf({ ...stored, attestedFromPerson: false }) : sourceLockOf(stored);

    if (lock === 'locked') {
        return { kind: 'locked' };
    }

    if (
        lock === 'downgradeOnly' &&
        !(
            decision.allowed &&
            (decision.provenance.sourceKind === 'book' || decision.provenance.sourceKind === 'paid_site')
        )
    ) {
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
