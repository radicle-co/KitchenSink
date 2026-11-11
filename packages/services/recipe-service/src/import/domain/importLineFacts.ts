/**
 * Turning a snapshot line and the paste match view into the facts `bindingOf` decides on (ADR-0072 §7, §10).
 *
 * DESIGN PATTERN: **Adapter**, pure and total, between the wire match view (`ParseProposalMatch`, whose `reason` is an opaque
 * key) and the domain's `LineFacts`. It owns the three judgements that only this seam can get wrong:
 *
 *  - the cook's pick applies only against the judgement they saw (`picked_against_digest`);
 *  - a spent budget is read off the shipped reason key (`reviewBudgetSpent`), so the importer needs no knowledge of how the
 *    worker records it;
 *  - ⛔ a reason this build does not know can NEVER read as a confident match: a newer server's key degrades to "ask the
 *    cook", not to "bind it". The known list is typed over `MatchReason`, so a reason added there is a compile error here
 *    until it is placed.
 */
import type { MatchReason } from '../../recipes/domain/matchState.js';
import type { ParseProposalMatch } from '../../recipes/parseJobs.schema.js';
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { LineFacts } from './importBindingPolicy.js';

/** The reason the worker's ceiling-denial outcome reads as (ADR-0072 §10). A one-way door for installed clients. */
export const BUDGET_SPENT_REASON = 'reviewBudgetSpent';

/** The cook's stored decision on one snapshot line. */
export interface SnapshotPick {
    readonly foodId?: string;
    readonly foodVariantId?: string;
    readonly asWritten?: boolean;
    /** The judgement digest the cook saw when they chose. */
    readonly againstDigest: string | null;
}

/** Every reason this build knows. `satisfies` makes a new `MatchReason` a compile error until it is listed. */
const KNOWN_REASONS = {
    noCandidates: true,
    noProposal: true,
    defaultApplies: true,
    curatedMapping: true,
    rememberedMatch: true,
    exactName: true,
    reviewVerified: true,
    reviewContradicted: true,
    reviewAbstained: true,
    reviewRefused: true,
    reviewUnchecked: true,
    reviewNotAsked: true,
    awaitingReview: true,
} satisfies Record<MatchReason, true>;

/** Whether a wire reason is one this build knows. Pure. */
function isKnownReason(reason: string): reason is MatchReason {
    return Object.hasOwn(KNOWN_REASONS, reason);
}

/** What `lineFactsOf` reads. */
export interface LineFactsInput {
    readonly match: ParseProposalMatch;
    readonly pick: SnapshotPick | undefined;
    /** The line's stored judgement digest. */
    readonly judgementDigest: string;
}

/**
 * The facts `bindingOf` and `isReadyToSave` decide on for one line.
 *
 * @param input - The projected match, the cook's pick and the line's judgement digest.
 * @returns The line's facts. Pure and total.
 */
export function lineFactsOf(input: LineFactsInput): LineFacts {
    const { match, pick } = input;
    const budgetSpent = match.reason === BUDGET_SPENT_REASON;
    const knownReason = isKnownReason(match.reason) ? match.reason : undefined;
    // A reason from a newer server must not read as a confident match (module doc): the cook is asked instead.
    const state =
        knownReason === undefined && !budgetSpent && match.state === 'confident' ? 'needsChoice' : match.state;
    const applies = pick !== undefined && pick.againstDigest === input.judgementDigest;

    return {
        state,
        reason: knownReason ?? 'noProposal',
        proposedFoodId: match.proposed?.id,
        candidates: match.candidates.map((candidate) => ({ foodId: candidate.id, isDefault: candidate.isDefault })),
        budgetSpent,
        cookChoice: applies ? cookChoiceOf(pick) : undefined,
    };
}

/** The cook's decision a pick states. Pure. */
function cookChoiceOf(pick: SnapshotPick): LineFacts['cookChoice'] {
    if (pick.asWritten === true) {
        return { kind: 'asWritten' };
    }

    const foodId = pick.foodId ?? pick.foodVariantId;

    return foodId === undefined ? undefined : { kind: 'food', foodId };
}

/**
 * The food reference (root or variant) a food id stands for, so the importer binds it through the right door.
 *
 * ⛔ A food the COOK picked takes its kind from the pick, never from the shortlist: a result of the picker's own search is
 * no candidate, and guessing a root for it would bind the wrong thing or fail.
 *
 * @param match - The projected match.
 * @param pick - The cook's pick, if any.
 * @param foodId - The food `bindingOf` chose.
 * @returns The reference, or `undefined` for an id the view never showed. Pure.
 */
export function foodRefOfId(
    match: ParseProposalMatch,
    pick: SnapshotPick | undefined,
    foodId: string,
): FoodRef | undefined {
    if (pick?.foodVariantId === foodId) {
        return { kind: 'variant', id: foodId };
    }

    if (pick?.foodId === foodId) {
        return { kind: 'root', id: foodId };
    }

    const shown = [...(match.proposed === null ? [] : [match.proposed]), ...match.candidates].find(
        (food) => food.id === foodId,
    );

    return shown === undefined ? undefined : { kind: shown.kind, id: shown.id };
}
