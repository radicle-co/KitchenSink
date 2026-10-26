/**
 * The pure rules the paste matcher applies to one (line, food) of a paste job before it stores or sends anything
 * (ADR-0071). The impure half is `MatchProposalService`.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the pure `decide` of the decide/evaluate split
 * `verificationRequests.ts` uses for the save path. Three questions, answered from inputs alone:
 *
 *  1. **Which judgement a proposal asks for** ({@link matchJudgementOf}). The key must equal what the save path computes
 *     if the cook keeps this food, so a kept line is never asked about twice. The measure is recipe-core's
 *     `pastedLineMeasureOf`, the rule the editor saves a pasted row with: the cook's own words (`2 tbsp` keys unit
 *     `tbsp`, not the parse's `tablespoon`), and only the FIRST food of a line carries it.
 *  2. **Whether the gate may be asked** ({@link proposalVerificationDecision}). Identity is ALWAYS asked for a paste
 *     proposal: no band and no curated skip (ADR-0071, the exception to earned autonomy D1).
 *  3. **Which candidates the cook sees** ({@link candidatesFor}). At most five, the proposal first, and a default that
 *     applies is never cut off, because whether one applies decides the line's state (`matchState.ts`).
 */
import type { IngredientQuantity } from '@kitchensink/recipe-core';
import { pastedLineMeasureOf } from '@kitchensink/recipe-core/parsing/pasted-line-measure';
import {
    decideProposalVerification,
    PROVISIONAL_VERIFICATION_THRESHOLDS,
    unattributedEvidence,
    type VerificationDecision,
} from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import type { VerifiedLineIdentity } from '@kitchensink/recipe-core/resolution/verification-key';

import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { RankedCandidate } from '../../ingredients/resolution/resolutionCascade.js';
import { verifiedLineIdentity } from './lineVerification.js';
import type { MatchCandidate } from './parseJobMatch.js';

/** How many candidates a match keeps. The column's CHECK holds the same bound. */
export const MAX_MATCH_CANDIDATES = 5;

/**
 * The rung food publishes for a seeded default (salt → table salt, owner ruling 1, ADR-0070's ladder).
 *
 * Read as a plain string so this compiles against a food contract that does not list the rung yet.
 */
const DEFAULT_RUNG = 'default';

/** What a parsed line contributes to a judgement: its text, the parse's own measure and the source's words for it. */
export interface ParsedLineMeasure {
    readonly sourceLine: string;
    readonly quantity: IngredientQuantity;
    /** The parse's canonical unit, or `null` when the line states none. */
    readonly unit: string | null;
    /** The source's own words for the measure ("2 tbsp"), when the parse kept them. */
    readonly statedMeasure?: string | null | undefined;
}

/**
 * The judgement the proposal for one food of a parsed line asks for, keyed as the save path would key the kept line.
 *
 * @param line - The parsed line: its text and measure.
 * @param foodIndex - Which food of the line. Only the first carries the measure (`pastedLineMeasureOf`).
 * @param foodRefId - The proposed food's id at its forward end (root or variant).
 * @returns The identity, or `undefined` for a blank line. Pure.
 */
export function matchJudgementOf(
    line: ParsedLineMeasure,
    foodIndex: number,
    foodRefId: string,
): VerifiedLineIdentity | undefined {
    const saved = pastedLineMeasureOf(line, foodIndex);

    return verifiedLineIdentity(
        {
            sourceLine: line.sourceLine,
            quantity: saved.quantity,
            unit: saved.unit,
            // The parse's `statedMeasure` is the source's WORDS ("a handful"), already read into the measure above; it is
            // not a restatement of a historical unit, and the editor saves no restatement for a pasted line.
            statedMeasure: undefined,
        },
        foodRefId,
    );
}

/**
 * Whether the gate may be asked about a paste proposal, and about what: recipe-core's `decideProposalVerification`,
 * the same rule the worker re-runs (ADR-0071), so both ends judge a proposal identically. Identity is always asked.
 *
 * @param sourceLine - The line as stored.
 * @param boundTo - Whether the proposal is a root or a variant.
 * @returns `verify` (both aspects), `skip` for a blank line, or `reject` for an over-cap one. Pure.
 */
export function proposalVerificationDecision(sourceLine: string, boundTo: FoodRef['kind']): VerificationDecision {
    return decideProposalVerification({
        sourceLine,
        evidence: unattributedEvidence(),
        thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
        boundTo,
    });
}

/**
 * Whether a rung marks a seeded default.
 *
 * @param rung - A rung as food published it, or none.
 * @returns `true` only for the default rung. Pure.
 */
export function isDefaultRung(rung: string | null | undefined): boolean {
    return rung === DEFAULT_RUNG;
}

/**
 * Whether a default applies to the phrase: the shortlist holds a candidate on the default rung.
 *
 * @param candidates - The stored candidates.
 * @returns Whether any is a default. Pure.
 */
export function defaultApplies(candidates: readonly MatchCandidate[]): boolean {
    return candidates.some((candidate) => isDefaultRung(candidate.rung));
}

/**
 * The candidates to store: the proposal first, then the ranked shortlist, at most {@link MAX_MATCH_CANDIDATES}.
 *
 * ⛔ A default in the shortlist is kept even when the limit would cut it: the proposal can push the list over five,
 * and losing the default would turn a `default` line into a `confident` one, which auto-selects for the cook.
 *
 * @param proposal - The proposed food, or `undefined` when nothing was proposed.
 * @param ranked - The lexical shortlist, in food's ranked order.
 * @returns The candidates, ids and rungs only. Pure.
 */
export function candidatesFor(
    proposal: FoodRef | undefined,
    ranked: readonly RankedCandidate[],
): readonly MatchCandidate[] {
    const sameFood = (a: FoodRef, b: FoodRef): boolean => a.kind === b.kind && a.id === b.id;
    const toCandidate = (candidate: RankedCandidate): MatchCandidate => ({
        kind: candidate.food.kind,
        id: candidate.food.id,
        rung: candidate.rung ?? null,
    });
    const head: MatchCandidate[] = [];

    if (proposal !== undefined) {
        const ranking = ranked.find((candidate) => sameFood(candidate.food, proposal));

        head.push(ranking === undefined ? { kind: proposal.kind, id: proposal.id, rung: null } : toCandidate(ranking));
    }

    const rest = ranked.filter((candidate) => proposal === undefined || !sameFood(candidate.food, proposal));
    const fallbackDefault = rest.find((candidate) => isDefaultRung(candidate.rung));
    const listed = [...head, ...rest.map(toCandidate)].slice(0, MAX_MATCH_CANDIDATES);

    if (fallbackDefault !== undefined && !listed.some((candidate) => isDefaultRung(candidate.rung))) {
        return [...listed.slice(0, MAX_MATCH_CANDIDATES - 1), toCandidate(fallbackDefault)];
    }

    return listed;
}
