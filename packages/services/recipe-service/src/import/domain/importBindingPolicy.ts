/**
 * `bindingOf` — what a bulk import binds a line to, and who gets the credit (`bound_by`).
 *
 * DESIGN PATTERN: **Specification / Policy module**, pure and total, a sibling of `matchStateOf`. It reads the paste
 * view's own state (`MatchState`, `MatchReason`) and decides; it derives no state itself and names no route or table.
 *
 * ## The rulings it holds (owner)
 *  - A cook's decision wins, including "keep this as written". A late verdict replaces neither.
 *  - A confident match binds in every mode. Its `bound_by` follows the reason it was confident.
 *  - Defaults are for imports only, so they bind only where the cook chose to save lines as written (or left a
 *    wizard with Save and leave, which works like it) and never after the cook went through the item.
 *  - "Pick the best match for me" binds every top match: the shown proposal, else the first candidate.
 *  - A skipped item keeps its open lines as written. Its confident lines still bind.
 *
 * ⚠️ PINNED READING: in `bindBest` a `default` line binds the TOP candidate as `autoBest`, not the default candidate
 * as `default`. The ruling says "binds every top match" and the default is a suggestion, not a top match. Flip it in
 * `bestOf` and in the named test if the owner reads it the other way.
 */
import type { BoundBy } from '../../recipes/domain/bindingOriginCarryForward.js';
import { proposalShownIn, type MatchReason, type MatchState } from '../../recipes/domain/matchState.js';

/** The three ways a bulk import can match: Save lines as written, Pick the best match for me, Let me review each. */
export const MATCH_MODES = ['keepAsWritten', 'bindBest', 'review'] as const;

/** One mode. */
export type MatchMode = (typeof MATCH_MODES)[number];

/** Where the cook stands on one item of the wizard. */
export const ITEM_REVIEWS = ['pending', 'reviewed', 'skipped'] as const;

/** One mark. */
export type ItemReview = (typeof ITEM_REVIEWS)[number];

/** What is known about one line. */
export interface LineFacts {
    readonly state: MatchState;
    readonly reason: MatchReason;
    /** The shown proposal's food, or `undefined`. */
    readonly proposedFoodId: string | undefined;
    /** The shortlist, best first. */
    readonly candidates: readonly { readonly foodId: string; readonly isDefault: boolean }[];
    /** What the cook decided, or `undefined` when nothing yet. */
    readonly cookChoice:
        { readonly kind: 'food'; readonly foodId: string } | { readonly kind: 'asWritten' } | undefined;
}

/** The answer for one line. */
export type LineBinding =
    { readonly kind: 'bind'; readonly foodId: string; readonly boundBy: BoundBy } | { readonly kind: 'asWritten' };

/** The inputs of {@link bindingOf}. `reviewClosed` matters only in `review` mode and is ignored elsewhere. */
export interface BindingInput {
    readonly mode: MatchMode;
    readonly itemReview: ItemReview;
    readonly reviewClosed: boolean;
    readonly line: LineFacts;
}

const AS_WRITTEN: LineBinding = { kind: 'asWritten' };

/**
 * Whether the cook still has something to settle on a line: nothing decided and not confident.
 *
 * @param line - The line.
 * @returns `true` for an open line. Pure.
 */
export function isOpenLine(line: LineFacts): boolean {
    return line.cookChoice === undefined && line.state !== 'confident';
}

/**
 * Who gets the credit for a confident match, by the reason it was confident.
 *
 * @param reason - The reason the line is confident.
 * @returns The origin. Pure and total.
 */
function originOfConfident(reason: MatchReason): BoundBy {
    switch (reason) {
        case 'exactName':
            return 'exact';
        case 'curatedMapping':
            return 'curated';
        case 'rememberedMatch':
        case 'reviewVerified':
            return 'review';
        // A confident state never carries these; the exhaustive list makes a new reason a compile error.
        case 'noCandidates':
        case 'noProposal':
        case 'defaultApplies':
        case 'reviewContradicted':
        case 'reviewAbstained':
        case 'reviewRefused':
        case 'reviewUnchecked':
        case 'reviewNotAsked':
        case 'awaitingReview':
            return 'review';
    }
}

/**
 * Whether defaults bind in this regime.
 *
 * @param input - The mode, the item's mark and whether the wizard was closed.
 * @returns `true` when a default line binds its default candidate. Pure and total.
 */
function bindsDefaults(input: BindingInput): boolean {
    switch (input.mode) {
        case 'keepAsWritten':
            return true;
        case 'review':
            // Save and leave works like keepAsWritten, but only for an item the cook never went through.
            return input.reviewClosed && input.itemReview === 'pending';
        case 'bindBest':
            return false;
    }
}

/**
 * The top match for a line: the shown proposal, else the first candidate.
 *
 * @param line - The line.
 * @returns The binding, or as written when there is nothing to bind. Pure.
 */
function bestOf(line: LineFacts): LineBinding {
    const shown = proposalShownIn(line.state) ? line.proposedFoodId : undefined;
    const foodId = shown ?? line.candidates[0]?.foodId;

    return foodId === undefined ? AS_WRITTEN : { kind: 'bind', foodId, boundBy: 'autoBest' };
}

/**
 * Decide what one line becomes when its item is saved.
 *
 * @param input - The mode, the item's mark, whether the wizard was closed, and the line.
 * @returns The binding, or as written. Pure and total.
 */
export function bindingOf(input: BindingInput): LineBinding {
    const { line } = input;

    if (line.cookChoice !== undefined) {
        return line.cookChoice.kind === 'food'
            ? { kind: 'bind', foodId: line.cookChoice.foodId, boundBy: 'cook' }
            : AS_WRITTEN;
    }

    if (line.state === 'confident') {
        return line.proposedFoodId === undefined
            ? AS_WRITTEN
            : { kind: 'bind', foodId: line.proposedFoodId, boundBy: originOfConfident(line.reason) };
    }

    if (input.itemReview === 'skipped') {
        return AS_WRITTEN;
    }

    if (input.mode === 'bindBest') {
        return bestOf(line);
    }

    if (line.state === 'default' && bindsDefaults(input)) {
        const dflt = line.candidates.find((candidate) => candidate.isDefault);

        return dflt === undefined ? AS_WRITTEN : { kind: 'bind', foodId: dflt.foodId, boundBy: 'default' };
    }

    return AS_WRITTEN;
}
