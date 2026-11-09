/**
 * The pure rules the paste matcher applies to one (line, food) of a paste job before it stores or sends anything
 * (ADR-0071). The impure half is `MatchProposalService`.
 *
 * DESIGN PATTERN: **Specification / Policy module**, the pure `decide` of the decide/evaluate split
 * `verificationRequests.ts` uses for the save path. Three questions, answered from inputs alone:
 *
 *  1. **Which judgement a proposal asks for** ({@link matchJudgementOf}). The key must equal what the save path computes
 *     if the cook keeps this food, so a kept line is never asked about twice. The measure is recipe-core's
 *     `pastedLineRowOf`, the rule the editor saves a pasted row with: the cook's own words (`2 tbsp` keys unit
 *     `tbsp`, not the parse's `tablespoon`), and only the FIRST food of a line carries an amount.
 *     The request itself ({@link proposalMessageOf}) is built from that judgement, and the key the row stores is the
 *     key of that MESSAGE ({@link proposalKeyOf}), the derivation the worker writes the verdict under.
 *  2. **Whether the gate may be asked** ({@link proposalVerificationDecision}). Identity is ALWAYS asked for a paste
 *     proposal: no band and no curated skip (ADR-0071, the exception to earned autonomy D1).
 *  3. **Which candidates the cook sees** ({@link candidatesFor}). At most five, the proposal first, and a default that
 *     applies is never cut off, because whether one applies decides the line's state (`matchState.ts`).
 */
import type { IngredientQuantity } from '@kitchensink/recipe-core';
import type { LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';
import { pastedLineRowOf } from '@kitchensink/recipe-core/parsing/pasted-line-measure';
import { RANK_TIERS, type RankTier } from '@kitchensink/recipe-core/resolution/ranking-tiers';
import {
    decideProposalVerification,
    PROVISIONAL_VERIFICATION_THRESHOLDS,
    unattributedEvidence,
    type VerificationDecision,
} from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import {
    verificationKey,
    type HexDigest,
    type VerifiedLineIdentity,
} from '@kitchensink/recipe-core/resolution/verification-key';
import {
    verificationFoodFieldsOf,
    verifiedLineIdentityOfMessage,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';

import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { RankedCandidate } from '../../ingredients/resolution/resolutionCascade.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { variantDisplayName, verifiedLineIdentity } from './lineVerification.js';
import type { MatchCandidate, MatchSlot } from './parseJobMatch.js';

/** How many candidates a match keeps. The column's CHECK holds the same bound. */
export const MAX_MATCH_CANDIDATES = 5;

/** The rung food publishes for a seeded default (salt → table salt, owner ruling 1, ADR-0070's ladder). */
const DEFAULT_RUNG: RankTier = 'default';

/**
 * A rung as this build knows it: one of recipe-core's `RANK_TIERS`, or `null`. Food owns the vocabulary and may publish a
 * rung this build does not know yet; that reads as NO rung, never as a string a later comparison silently misses.
 *
 * @param rung - A rung as food published it or the store holds it, or none.
 * @returns The tier, or `null`. Pure.
 */
export function rankTierOf(rung: string | null | undefined): RankTier | null {
    return (RANK_TIERS as readonly string[]).includes(rung ?? '') ? (rung as RankTier) : null;
}

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
 * @param foodIndex - Which food of the line. Only the first carries an amount (`pastedLineRowOf`).
 * @param phrase - That food's phrase, whose leading size word the editor saves as the unit.
 * @param foodRefId - The proposed food's id at its forward end (root or variant).
 * @returns The identity, or `undefined` for a blank line. Pure.
 */
export function matchJudgementOf(
    line: ParsedLineMeasure,
    foodIndex: number,
    phrase: string,
    foodRefId: string,
): VerifiedLineIdentity | undefined {
    // `display` only decides `displayText`; the key covers the quantity and unit, which it never changes.
    const saved = pastedLineRowOf({ ...line, display: null }, foodIndex, phrase);

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
 * The generation of {@link matchJudgementDigestOf}'s preimage. ⛔ Bump it whenever what the digest covers changes: every
 * stored row then reads stale and is matched afresh, instead of keeping a key a newer derivation no longer produces.
 */
export const MATCH_JUDGEMENT_VERSION = 'j1';

/** The low and high bound of a quantity in a digest's spelling. Pure. */
function boundsOf(quantity: IngredientQuantity): readonly [number | null, number | null] {
    switch (quantity.kind) {
        case 'exact':
            return [quantity.value, null];
        case 'range':
            return [quantity.low, quantity.high];
        case 'absent':
            return [null, null];
    }
}

/**
 * What a stored match for one food of a parsed line was COMPUTED FROM: the line's digest, the food's phrase (what the
 * chain was asked), and the measure the editor saves for that food (what the verdict key covers).
 *
 * ⛔ A row is current only while the CURRENT parse yields the same digest (`isCurrentMatch`). The line digest alone
 * cannot see a reparse of the same text that reads another food or another measure, and such a row would keep a
 * proposal and a key the line no longer asks for.
 *
 * @param slot - The line's stored digest, its parse, which food, and that food's phrase.
 * @param digest - The hex digest (`sha256Hex` in the service).
 * @returns `{version}:{digest}`. Pure, given a pure digest.
 */
export function matchJudgementDigestOf(
    slot: {
        readonly lineDigest: LineDigest;
        readonly line: ParsedLineMeasure;
        readonly foodIndex: number;
        readonly phrase: string;
    },
    digest: HexDigest,
): string {
    const measure = pastedLineRowOf({ ...slot.line, display: null }, slot.foodIndex, slot.phrase);
    const [low, high] = boundsOf(measure.quantity);

    return `${MATCH_JUDGEMENT_VERSION}:${digest(
        JSON.stringify([
            MATCH_JUDGEMENT_VERSION,
            slot.lineDigest,
            slot.foodIndex,
            slot.phrase,
            low,
            high,
            measure.unit,
        ]),
    )}`;
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
 * The verification request for one proposal: the gate's question about the proposed food, as the worker will read it.
 *
 * ⛔ No `ingredientPhrase` is sent: the worker writes no memo for a paste origin, and a memo of a default would bind it
 * for the next cook. Identity is always asked (`unattributed` evidence, no shortlist).
 *
 * @param input - The job and slot, the parsed line with each food's phrase, the proposal at its live end, food's answer
 *     about it, and when.
 * @returns The message, or `undefined` when nothing can be asked: a blank or over-cap line, a slot the line names no
 *     food for, or a food food cannot name now. Pure.
 */
export function proposalMessageOf(input: {
    readonly jobId: string;
    readonly slot: MatchSlot;
    readonly line: ParsedLineMeasure & { readonly phrases: readonly string[] };
    readonly food: FoodRef;
    readonly answer: FoodRefAnswer;
    readonly requestedAt: string;
}): VerifyIngredientLineMessage | undefined {
    const { jobId, slot, line, food, answer } = input;

    if (answer.outcome !== 'found' || answer.name === undefined) {
        return undefined;
    }

    if (proposalVerificationDecision(line.sourceLine, food.kind).kind !== 'verify') {
        return undefined;
    }

    const phrase = line.phrases[slot.foodIndex];
    const judgement = phrase === undefined ? undefined : matchJudgementOf(line, slot.foodIndex, phrase, food.id);

    if (judgement === undefined) {
        return undefined;
    }

    return {
        origin: { kind: 'parseJob', jobId, lineIndex: slot.lineIndex, foodIndex: slot.foodIndex },
        sourceLine: line.sourceLine,
        ...verificationFoodFieldsOf(food),
        candidateFoodName: variantDisplayName(answer.name, answer.variant?.parts),
        quantityLow: judgement.quantityLow,
        quantityHigh: judgement.quantityHigh,
        unit: judgement.unit,
        evidenceKind: 'unattributed',
        shortlist: [],
        requestedAt: input.requestedAt,
        ...(answer.isPrivate ? { privateFood: true } : {}),
    };
}

/**
 * The key the gate's verdict for a request lands under: the WORKER's derivation, from the message alone.
 *
 * ⛔ The row stores this, never a key derived separately from the line, so the key the job view reads a verdict back
 * through is the key the worker wrote it under.
 *
 * @param message - The request.
 * @param digest - The hex digest (`sha256Hex` in the service).
 * @returns The verification key. Pure, given a pure digest.
 */
export function proposalKeyOf(message: VerifyIngredientLineMessage, digest: HexDigest): string {
    return verificationKey(verifiedLineIdentityOfMessage(message), digest);
}

/**
 * Whether a rung marks a seeded default.
 *
 * @param rung - A rung as this build knows it ({@link rankTierOf}), or none.
 * @returns `true` only for the default rung. Pure.
 */
export function isDefaultRung(rung: RankTier | null): boolean {
    return rung === DEFAULT_RUNG;
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
        rung: rankTierOf(candidate.rung),
    });
    const head: MatchCandidate[] = [];

    if (proposal !== undefined) {
        const ranking = ranked.find((candidate) => sameFood(candidate.food, proposal));

        head.push(ranking === undefined ? { kind: proposal.kind, id: proposal.id, rung: null } : toCandidate(ranking));
    }

    const rest = ranked.filter((candidate) => proposal === undefined || !sameFood(candidate.food, proposal));
    const fallbackDefault = rest.find((candidate) => isDefaultRung(rankTierOf(candidate.rung)));
    const listed = [...head, ...rest.map(toCandidate)].slice(0, MAX_MATCH_CANDIDATES);

    if (fallbackDefault !== undefined && !listed.some((candidate) => isDefaultRung(candidate.rung))) {
        return [...listed.slice(0, MAX_MATCH_CANDIDATES - 1), toCandidate(fallbackDefault)];
    }

    return listed;
}
