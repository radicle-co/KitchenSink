/**
 * `matchStateOf` — the state of one paste proposal, derived at READ time from facts the server holds (ADR-0071).
 *
 * DESIGN PATTERN: **Specification / Policy module**, pure and total, the sibling of `lineVerification.ts`'s status
 * rules. Web and mobile render the state; neither derives it, so the two cannot disagree. A late verdict never replaces
 * a pick the cook already made: that is the client's rule, and this module only derives the state.
 *
 * ## The precedence, from the owner's rulings of 2026-10-25 and the coordinator's decisions
 *
 *  1. **Nothing proposed**: `noMatch` with no candidates, `needsChoice` with some.
 *  2. **A default applies to the phrase**: `default`, whatever answered and whatever the gate said. A default is shown
 *     first, never selected (ruling 2). It outranks a curated or memo answer on purpose: a cook who keeps the default
 *     and saves can teach the memo tier "salt → table salt", and a confident memo would then select it for the next cook.
 *  3. **A curated mapping**: `confident`. A gate contradiction keeps it confident, because a person decided and the model
 *     has an error rate, and adds the review note `reviewDisagreed` so curation can be reviewed.
 *  4. **A memo or lexical proposal the gate contradicted on IDENTITY**: `needsChoice`.
 *  5. **A memo**: `confident`.
 *  6. **A lexical proposal**: `confident` once the gate verified identity, `needsChoice` when it abstained. With no
 *     verdict: an exact-name rung is `confident` (ruling 3); a review the gate could not take (`refused`, an over-cap
 *     line) or gave up on (`exhausted`) is `needsChoice`; otherwise `checking`.
 *
 * ⛔ IDENTITY, not the joint verdict. A joint `contradicted` beside an itemized identity `agree` is a quantity dispute,
 * which a different food cannot fix. The joint band is read only when the verdict carries no itemized identity (the
 * pre-0042 population), as `identityContradictedOf` does.
 *
 * ⛔ `state` is a closed enum on the wire and a ONE-WAY DOOR for installed clients: a new fact becomes a new field or a
 * new `reason` key, never a sixth state. `reason` and `reviewNote` are opaque display keys the clients localize.
 */
import type { MatchProposingTier } from '../../database/schema/parseJobMatches.js';
import type { VerificationBand } from './lineVerification.js';

/** The five states a proposal can be in. */
export const MATCH_STATES = ['checking', 'confident', 'default', 'needsChoice', 'noMatch'] as const;

/** One proposal's state. */
export type MatchState = (typeof MATCH_STATES)[number];

/** Why a proposal is in its state — an opaque key the clients localize. */
export type MatchReason =
    | 'noCandidates'
    | 'noProposal'
    | 'defaultApplies'
    | 'curatedMapping'
    | 'rememberedMatch'
    | 'exactName'
    | 'reviewVerified'
    | 'reviewContradicted'
    | 'reviewAbstained'
    | 'reviewRefused'
    | 'reviewUnchecked'
    | 'awaitingReview';

/** A note that rides beside a state without changing it. */
export type MatchReviewNote = 'reviewDisagreed';

/** What the gate concluded about the proposal, as the verdict table holds it. */
export interface MatchVerdict {
    readonly band: VerificationBand;
    /** The model's itemized identity verdict (0042), or `null` when it gave none. */
    readonly identityVerdict: string | null;
}

/** The facts one proposal's state is derived from. */
export interface MatchFacts {
    /** What was proposed, or `undefined` when nothing usable was (none, or food no longer shows it). */
    readonly proposal: { readonly matchedBy: MatchProposingTier; readonly rung: string | null } | undefined;
    /** How many candidates the cook may choose from. */
    readonly candidateCount: number;
    /** Whether the shortlist holds a candidate on the default rung. */
    readonly defaultApplies: boolean;
    /** The gate's verdict on the proposal, or `undefined` when there is none yet. */
    readonly verdict: MatchVerdict | undefined;
    /**
     * Where the review stands when there is no verdict: `asked` (sent or owed), `refused` (the gate cannot be asked,
     * an over-cap line), or `exhausted` (the gate gave up after its attempts).
     */
    readonly review: 'asked' | 'refused' | 'exhausted';
}

/** A derived state, its reason, and a note when one applies. */
export interface MatchStateAnswer {
    readonly state: MatchState;
    readonly reason: MatchReason;
    readonly reviewNote?: MatchReviewNote;
}

/** The identity the gate concluded, read through the itemized verdict first. Pure. */
function identityOf(verdict: MatchVerdict): 'agree' | 'disagree' | 'abstain' {
    if (verdict.identityVerdict === 'agree' || verdict.identityVerdict === 'disagree') {
        return verdict.identityVerdict;
    }

    if (verdict.identityVerdict === 'abstain') {
        return 'abstain';
    }

    switch (verdict.band) {
        case 'verified':
            return 'agree';
        case 'contradicted':
            return 'disagree';
        case 'inconclusive':
            return 'abstain';
    }
}

/**
 * Derive one proposal's state.
 *
 * @param facts - What was proposed, the shortlist's size and default, and the gate's verdict or review state.
 * @returns The state, its reason, and a note when one applies. Pure and total.
 */
export function matchStateOf(facts: MatchFacts): MatchStateAnswer {
    const { proposal, verdict } = facts;

    if (proposal === undefined) {
        return facts.candidateCount === 0
            ? { state: 'noMatch', reason: 'noCandidates' }
            : { state: 'needsChoice', reason: 'noProposal' };
    }

    if (facts.defaultApplies) {
        return { state: 'default', reason: 'defaultApplies' };
    }

    const identity = verdict === undefined ? undefined : identityOf(verdict);

    if (proposal.matchedBy === 'curated') {
        return identity === 'disagree'
            ? { state: 'confident', reason: 'curatedMapping', reviewNote: 'reviewDisagreed' }
            : { state: 'confident', reason: 'curatedMapping' };
    }

    if (identity === 'disagree') {
        return { state: 'needsChoice', reason: 'reviewContradicted' };
    }

    if (proposal.matchedBy === 'memo') {
        return { state: 'confident', reason: 'rememberedMatch' };
    }

    if (identity === 'agree') {
        return { state: 'confident', reason: 'reviewVerified' };
    }

    if (identity === 'abstain') {
        return { state: 'needsChoice', reason: 'reviewAbstained' };
    }

    if (proposal.rung === 'exact') {
        return { state: 'confident', reason: 'exactName' };
    }

    switch (facts.review) {
        case 'refused':
            return { state: 'needsChoice', reason: 'reviewRefused' };
        case 'exhausted':
            return { state: 'needsChoice', reason: 'reviewUnchecked' };
        case 'asked':
            return { state: 'checking', reason: 'awaitingReview' };
    }
}
