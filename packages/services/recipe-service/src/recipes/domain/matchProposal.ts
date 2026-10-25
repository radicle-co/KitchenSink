/**
 * The pure rules the paste matcher applies to one (line, food) of a paste job before it stores or sends anything
 * (ADR-0071). The impure half is `MatchProposalService`.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the pure `decide` of the decide/evaluate split
 * `verificationRequests.ts` uses for the save path. Three questions, answered from inputs alone:
 *
 *  1. **Which judgement a proposal asks for** ({@link matchJudgementOf}). The key must equal what the save path computes
 *     if the cook keeps this food, so a kept line is never asked about twice. The FIRST food of a line carries the line's
 *     measure and a later food carries none, which is how the editor saves a pasted line (`pastedLines.ts`).
 *     ⚠️ That equality holds only where the editor saves the parse's own measure. Where it saves the measure in the
 *     cook's words instead (`cookMeasureOf` reads `statedMeasure`: "2 tbsp" saves unit `tbsp`, the parse says
 *     `tablespoon`), the keys differ and the save path asks again. ADR-0071 records this as an open gap.
 *  2. **Whether the gate may be asked** ({@link proposalVerificationDecision}). Identity is ALWAYS asked for a paste
 *     proposal: no band and no curated skip (ADR-0071, the exception to earned autonomy D1).
 *  3. **Which candidates the cook sees** ({@link candidatesFor}). At most five, the proposal first, and a default that
 *     applies is never cut off, because whether one applies decides the line's state (`matchState.ts`).
 */
import { ABSENT_QUANTITY, type IngredientQuantity } from '@kitchensink/recipe-core';
import {
    decideVerification,
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

/** What a parsed line contributes to a judgement: its text and the parse's own measure. */
export interface ParsedLineMeasure {
    readonly sourceLine: string;
    readonly quantity: IngredientQuantity;
    /** The parse's canonical unit, or `null` when the line states none. */
    readonly unit: string | null;
}

/**
 * The judgement the proposal for one food of a parsed line asks for, keyed as the save path would key the kept line.
 *
 * @param line - The parsed line: its text and measure.
 * @param foodIndex - Which food of the line. Only the first carries the measure.
 * @param foodRefId - The proposed food's id at its forward end (root or variant).
 * @returns The identity, or `undefined` for a blank line. Pure.
 */
export function matchJudgementOf(
    line: ParsedLineMeasure,
    foodIndex: number,
    foodRefId: string,
): VerifiedLineIdentity | undefined {
    const measured = foodIndex === 0;

    return verifiedLineIdentity(
        {
            sourceLine: line.sourceLine,
            quantity: measured ? line.quantity : ABSENT_QUANTITY,
            unit: measured ? (line.unit ?? '') : '',
            // A parse's `statedMeasure` is the source's WORDS ("a handful"), not a restatement of a historical unit,
            // and the editor saves no restatement for a pasted line.
            statedMeasure: undefined,
        },
        foodRefId,
    );
}

/**
 * Whether the gate may be asked about a paste proposal, and about what.
 *
 * ⚠️ A LOCAL SEAM for recipe-core's `decideProposalVerification` (step 4 of this work, not on this branch's base): the
 * same answer, identity always asked, built here from `decideVerification` with evidence that opens no skip door.
 * Swap the body for that call at merge; every caller already goes through this one function.
 *
 * @param sourceLine - The line as stored.
 * @param boundTo - Whether the proposal is a root or a variant.
 * @returns `verify` (both aspects), `skip` for a blank line, or `reject` for an over-cap one. Pure.
 */
export function proposalVerificationDecision(sourceLine: string, boundTo: FoodRef['kind']): VerificationDecision {
    return decideVerification({
        sourceLine,
        evidence: unattributedEvidence(),
        thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
        bandAuthority: undefined,
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
