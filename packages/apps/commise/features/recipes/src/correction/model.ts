/**
 * @module @commise/features-recipes/correction — the CLIENT-side model for the ingredient-correction
 * affordance (plan U14 / R19, R20): the state space a correction can be in, and the one sentence each state
 * renders.
 *
 * **Design pattern: discriminated union + exhaustive switch (Visitor, satisfied by the language).** Both
 * leaves render the union with an exhaustive `switch` instead of re-deriving the state from raw mutation
 * flags, which is the shape `IngredientResolverViewState` and `RecipeNutritionViewState` already use. A new
 * member is a COMPILE error at the projection below rather than a silently blank notice.
 *
 * ⛔ NOTHING HERE RE-DECLARES A WIRE SHAPE (§15 / ADR-0014). `scope` and `outcome` are DERIVED from
 * `@kitchensink/schema-recipe`'s `RecordCorrectionResponse` with `Extract` + indexed access, so a member
 * added to, removed from, or renamed on the wire is a compile error here rather than a silent divergence.
 *
 * ## ⛔ Why the reach is part of the state, and not an implementation detail
 *
 * A correction either binds a phrase for its author or for EVERY user of the installation, and which one
 * happened is decided server-side by a pure policy reading grants from the caller's signed token — grants
 * the client cannot see and the request does not carry. So the reach cannot be inferred; it must be
 * REPORTED, and the `saved` member carries it precisely so a surface cannot render one sentence for both
 * and tell a curator they made a private note when they rewrote the phrase for everyone.
 *
 * ## ⚠️ Why "nothing was written" is a SUCCESS
 *
 * Re-asserting a binding already in force writes no row, and a concurrent correction for the same phrase may
 * have committed first. Both come back as `recorded: false`, and both are correct, idempotent outcomes — see
 * `evaluateMappingWrite`'s idempotence branch, which exists so a re-opened line does not mint a churn row
 * and inflate the corroboration count that decides promotion. `unchanged` is therefore a member of its own
 * with a NEUTRAL tone; folding it into `failed` would show a fault on the happy path.
 */
import type { RecordCorrectionResponse } from '@kitchensink/schema-recipe';

import type { RecipeCorrectionMessages } from './messages.js';

/** How far a recorded correction reaches. DERIVED from the wire member, never declared. */
export type CorrectionScope = Extract<RecordCorrectionResponse, { recorded: true }>['scope'];

/** Why a correction wrote nothing. DERIVED from the wire member, never declared. */
export type CorrectionNoOutcome = Extract<RecordCorrectionResponse, { recorded: false }>['outcome'];

/**
 * Every state the correction affordance can be in.
 *
 * `idle` is the client-only resting condition — it has no wire counterpart, exactly as
 * `RecipeCaloriePending` has none, because "the user has not corrected anything" is not something a server
 * can say.
 */
export type CorrectionViewState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'saving' }
    | { readonly kind: 'saved'; readonly scope: CorrectionScope }
    | { readonly kind: 'unchanged'; readonly outcome: CorrectionNoOutcome }
    | { readonly kind: 'failed' };

/**
 * How a notice should be presented.
 *
 * ⛔ `error` is reserved for {@link CorrectionViewState} `failed` ALONE. The other two settled outcomes —
 * a recorded correction and a no-op — are both successes, and an error tone on either would report a fault
 * where none occurred. Leaves map `error` to their platform's alert role and the rest to a status role, so
 * this distinction also decides whether a screen reader is interrupted.
 */
export type CorrectionNoticeTone = 'progress' | 'success' | 'neutral' | 'error';

/** What a leaf renders for one settled or in-flight correction. */
export interface CorrectionNoticeModel {
    /** How to present it — see {@link CorrectionNoticeTone}. */
    readonly tone: CorrectionNoticeTone;
    /** The localized sentence. Always from the message set; never assembled by concatenation. */
    readonly text: string;
}

/**
 * Project a correction's view state into the notice a leaf renders. Pure and TOTAL over the union.
 *
 * @param state - The correction's current state.
 * @param messages - The resolved correction copy for the active locale.
 * @returns The notice, or `undefined` when there is nothing to say yet (`idle`).
 */
export const toCorrectionNoticeModel = (
    state: CorrectionViewState,
    messages: RecipeCorrectionMessages,
): CorrectionNoticeModel | undefined => {
    switch (state.kind) {
        case 'idle':
            return undefined;
        case 'saving':
            return { tone: 'progress', text: messages.saving };
        case 'saved':
            // ⛔ The reach decides the sentence. Collapsing these two is the bug this module exists to
            // prevent — see the module docstring.
            return {
                tone: 'success',
                text: state.scope === 'global' ? messages.savedForEveryone : messages.savedForYou,
            };
        case 'unchanged':
            // Both no-op outcomes read the same to a cook — "the system already knows this" — so they share
            // one sentence. They stay DISTINCT on the wire because an operator reading the audit trail needs
            // to tell an idempotent re-assertion from a lost concurrent race.
            return { tone: 'neutral', text: messages.alreadySaved };
        case 'failed':
            return { tone: 'error', text: messages.failed };
    }
};

/**
 * The correction's view state, derived from a mutation's flags and its last answer. Pure.
 *
 * Kept here rather than inside the hook so the derivation is table-testable without React, and so both
 * platforms' leaves cannot disagree about what "saving" means.
 *
 * @param flags - Whether a write is in flight and whether the last one threw.
 * @param response - The last successful answer, if any.
 * @returns The state a leaf renders.
 */
export const toCorrectionViewState = (
    flags: { readonly isPending: boolean; readonly isError: boolean },
    response: RecordCorrectionResponse | undefined,
): CorrectionViewState => {
    if (flags.isPending) {
        return { kind: 'saving' };
    }

    if (flags.isError) {
        return { kind: 'failed' };
    }

    if (response === undefined) {
        return { kind: 'idle' };
    }

    return response.recorded
        ? { kind: 'saved', scope: response.scope }
        : { kind: 'unchanged', outcome: response.outcome };
};
