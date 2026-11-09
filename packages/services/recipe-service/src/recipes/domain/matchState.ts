/**
 * `matchStateOf` — the state of one paste proposal, derived at READ time from facts the server holds (ADR-0071).
 *
 * DESIGN PATTERN: **Specification / Policy module**, pure and total, the sibling of `lineVerification.ts`'s status
 * rules. Web and mobile render the state; neither derives it, so the two cannot disagree. A late verdict never replaces
 * a pick the cook already made: that is the client's rule, and this module only derives the state.
 *
 * ## The precedence, from the owner's rulings of 2026-10-25 and the coordinator's decisions
 *
 *  1. **A default applies to the phrase and no match beat it**: `default`, whatever the gate said. A default is shown
 *     first, never selected (ruling 2). A curated mapping, or a memo of ANOTHER food, is a match and wins (owner ruling 5,
 *     2026-11-03: defaults show when no match was found). A memo of the DEFAULT food stays `default`, on purpose: a cook
 *     who keeps the default and saves can teach the memo tier "salt → table salt", and a confident memo would then select
 *     it for the next cook (the M2 loop, pinned in `matchState.test.ts`).
 *  2. **Nothing proposed**: `noMatch` with no candidates, `needsChoice` with some.
 *  2b. **A spent AI budget** (owner ruling 2026-10-26): `needsChoice` with reason `reviewBudgetSpent`, ahead of
 *     everything below, unless a verdict that asked identity is on record. Curated, remembered and exact-name
 *     proposals included: nothing reviewed the parse or the match.
 *  3. **The saved line's question (owner ruling 2026-11-08, Q1)**: a verdict on record that `savedLineAsks` (a saved line
 *     would badge AMBIGUOUS) is `needsChoice` for EVERY tier, curated included, and a review owed with NO verdict is
 *     `checking` for every tier, because the verdict that lands can turn a shown match into that choice after the cook saw it
 *     matched. So a line the review shows as matched never saves as AMBIGUOUS.
 *  3b. **A curated mapping** otherwise: `confident`. A gate contradiction (`contradict`) adds the review note
 *     `reviewDisagreed` to whatever state the mapping gets, so curation can be reviewed: a person decided and the model has
 *     an error rate.
 *  4. **A memo or lexical proposal the gate contradicted, or doubted, on IDENTITY**: `needsChoice`.
 *  5. **A memo**: `confident`.
 *  6. **A lexical proposal**: `confident` once the gate verified identity, `needsChoice` when it abstained or hedged.
 *     With no readable verdict: an exact-name rung is `confident` (ruling 3, whether the review was refused, gave up,
 *     or was never sent for a contained test principal, or came back unreadable); a review the gate could not take
 *     (`refused`), gave up on (`exhausted`, or an unreadable reply) or was never sent (`notAsked`, ADR-0040) is
 *     `needsChoice`; otherwise `checking`. Only a review that DISAGREES overrides an exact name.
 *
 * ⛔ IDENTITY, not the joint verdict, read through `identityReadingOf`: the ONE classifier a saved line's status also
 * derives from (ADR-0071 §9). This module maps its seven readings to a state, exhaustively. The mapping to a saved
 * line's status (`resolveLineStatus`) differs in one direction, on purpose: asking the cook before a bind is cheap, so
 * `doubt`, `hedged`, `abstain` and `unreadable` all ask here, while badging a line the cook already bound is a
 * warning, so a saved line badges only `contradict` and `abstain`. A quantity dispute (identity `agree`) is no food
 * problem, and a verdict that never ASKED identity (`unasked`) is no verdict about the food at all.
 *
 * ⛔ `state` is a closed enum on the wire and a ONE-WAY DOOR for installed clients: a new fact becomes a new field or a
 * new `reason` key, never a sixth state. `reason` and `reviewNote` are opaque display keys the clients localize.
 */
import type { RankTier } from '@kitchensink/recipe-core/resolution/ranking-tiers';

import type { MatchProposingTier } from '../../database/schema/parseJobMatches.js';
import { parseProposalMatchStateSchema } from '../parseJobs.schema.js';
import { identityReadingOf, savedLineAsks, type VerificationBand } from './lineVerification.js';

/** The rung of a name-exact proposal (ruling 3): a `RankTier` member, so a misspelling is a compile error. */
const EXACT_RUNG: RankTier = 'exact';

/**
 * The five states a proposal can be in: the WIRE's closed enum (`parseProposalMatchStateSchema`), derived from it so the
 * policy and the contract installed clients parse cannot list different states.
 */
export const MATCH_STATES = parseProposalMatchStateSchema.options;

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
    | 'reviewNotAsked'
    | 'awaitingReview';

/**
 * Why a proposal needs a choice because the AI budget is spent (ADR-0071 §9, ADR-0024 §3). The wire key installed
 * clients localize.
 *
 * ⚠️ Kept beside {@link MatchReason} rather than inside it so that code which switches exhaustively over the older
 * reasons (a confident match never carries this one) keeps compiling; the answer's `reason` is the union of the two.
 */
export const REVIEW_BUDGET_SPENT_REASON = 'reviewBudgetSpent';

/** A note that rides beside a state without changing it. */
export type MatchReviewNote = 'reviewDisagreed';

/** What the gate concluded about the proposal, as the verdict table holds it. */
export interface MatchVerdict {
    readonly band: VerificationBand;
    /** The model's certainty in its verdict. */
    readonly certainty: string;
    /** The model's itemized identity verdict (0042), or `null` when it gave none. */
    readonly identityVerdict: string | null;
    /** The aspects the gate asked; a verdict that never asked `identity` says nothing about the food. */
    readonly aspects: readonly string[];
}

/** The facts one proposal's state is derived from. */
export interface MatchFacts {
    /** What was proposed, or `undefined` when nothing usable was (none, or food no longer shows it). */
    readonly proposal: { readonly matchedBy: MatchProposingTier; readonly rung: RankTier | null } | undefined;
    /** How many candidates the cook may choose from. */
    readonly candidateCount: number;
    /** Whether the shortlist holds a candidate on the default rung. */
    readonly defaultApplies: boolean;
    /**
     * Whether the proposed food IS the shortlist's default food. A memo of the default is the M2 loop: a cook who keeps
     * the default and saves teaches the memo tier that default, and the next cook's memo would then select it. `false`
     * when nothing was proposed.
     */
    readonly proposalIsDefault: boolean;
    /** The gate's verdict on the proposal, or `undefined` when there is none yet. */
    readonly verdict: MatchVerdict | undefined;
    /**
     * Where the review stands when there is no verdict: `asked` (sent or owed), `refused` (the gate is never asked:
     * an over-cap line, or a request the queue contract refuses), `exhausted` (the gate gave up after its attempts), or
     * `notAsked` (a contained test principal's review, which is never sent; ADR-0040), or `budgetSpent` (the prod
     * spend ceiling refused the review in a period that is still current: nothing reviewed the parse or the match).
     */
    readonly review: 'asked' | 'refused' | 'exhausted' | 'notAsked' | 'budgetSpent';
}

/** A derived state, its reason, and a note when one applies. */
export interface MatchStateAnswer {
    readonly state: MatchState;
    readonly reason: MatchReason | typeof REVIEW_BUDGET_SPENT_REASON;
    readonly reviewNote?: MatchReviewNote;
}

/**
 * Derive one proposal's state.
 *
 * @param facts - What was proposed, the shortlist's size and default, and the gate's verdict or review state.
 * @returns The state, its reason, and a note when one applies. Pure and total.
 */
export function matchStateOf(facts: MatchFacts): MatchStateAnswer {
    const { proposal, verdict } = facts;

    // A default shows only when no MATCH was found (owner ruling 5, 2026-11-03). A curated mapping is a person's decision
    // and a memo of ANOTHER food is a match, so both win. A memo of the DEFAULT food is not a match: it is the default
    // remembered, and letting it through would let a cook who kept the default teach it as confident to the next cook.
    const matchedBeyondTheDefault =
        proposal !== undefined &&
        (proposal.matchedBy === 'curated' || (proposal.matchedBy === 'memo' && !facts.proposalIsDefault));

    if (facts.defaultApplies && !matchedBeyondTheDefault) {
        return { state: 'default', reason: 'defaultApplies' };
    }

    if (proposal === undefined) {
        return facts.candidateCount === 0
            ? { state: 'noMatch', reason: 'noCandidates' }
            : { state: 'needsChoice', reason: 'noProposal' };
    }

    const reading = verdict === undefined ? 'unasked' : identityReadingOf(verdict);

    // ⛔ A SPENT BUDGET SURFACES EVERY FOOD (owner ruling 2026-10-26), ahead of curated, memo, exact and confident: with
    // no review of the parse or the match, even a curated or exact-name match on a CRF-only phrase can be a confident
    // match to the wrong words. A verdict that ASKED identity outranks it (a real judgement is on record), so only an
    // `unasked` reading falls here. The default and no-proposal rows above are unchanged.
    if (facts.review === 'budgetSpent' && reading === 'unasked') {
        return { state: 'needsChoice', reason: REVIEW_BUDGET_SPENT_REASON };
    }

    // ⛔ THE REVIEW MAY NEVER SHOW A MATCH THAT THE SAVED LINE WOULD BADGE AMBIGUOUS (ADR-0071 §9, owner ruling
    // 2026-11-08). A verdict a saved line asks about asks here for every non-curated tier, memo and exact name included;
    // and while a review is owed with no verdict, no such tier is confident, because the verdict that lands can turn it
    // into the first case after the cook saw it matched.
    // A curated mapping is a person's decision and the model has an error rate, so only its STRONGEST claim adds the
    // review note, on the answer it gets (owner ruling 2026-11-08, Q1: a curated mapping asks like the rest).
    const curatedNote =
        proposal.matchedBy === 'curated' && reading === 'contradict' ? { reviewNote: 'reviewDisagreed' as const } : {};

    if (verdict !== undefined && savedLineAsks(verdict)) {
        return {
            state: 'needsChoice',
            reason: reading === 'contradict' ? 'reviewContradicted' : 'reviewAbstained',
            ...curatedNote,
        };
    }

    if (verdict === undefined && facts.review === 'asked') {
        return { state: 'checking', reason: 'awaitingReview' };
    }

    if (proposal.matchedBy === 'curated') {
        return { state: 'confident', reason: 'curatedMapping', ...curatedNote };
    }

    if (reading === 'contradict' || reading === 'doubt') {
        return { state: 'needsChoice', reason: 'reviewContradicted' };
    }

    if (proposal.matchedBy === 'memo') {
        return { state: 'confident', reason: 'rememberedMatch' };
    }

    switch (reading) {
        case 'agree':
            return { state: 'confident', reason: 'reviewVerified' };
        case 'abstain':
        case 'hedged':
            return { state: 'needsChoice', reason: 'reviewAbstained' };
        case 'unasked':
        case 'unreadable':
            return unjudgedState(proposal, reading === 'unreadable' ? 'exhausted' : facts.review);
    }
}

/**
 * The state of a lexical proposal no readable verdict has judged, given where its review stands.
 *
 * @param proposal - The lexical proposal.
 * @param review - Where the review stands. An unreadable reply is passed as `exhausted`: the gate answered, but said
 *   nothing about the food, which is a review that gave up.
 * @returns The state. Pure and total.
 */
function unjudgedState(proposal: { readonly rung: RankTier | null }, review: MatchFacts['review']): MatchStateAnswer {
    // Owner ruling: an exact name is a confident match, whether the review was refused, exhausted or never asked. Only
    // a review that DISAGREES overrides it, and that was decided above.
    if (proposal.rung === EXACT_RUNG) {
        return { state: 'confident', reason: 'exactName' };
    }

    switch (review) {
        case 'refused':
            return { state: 'needsChoice', reason: 'reviewRefused' };
        case 'exhausted':
            return { state: 'needsChoice', reason: 'reviewUnchecked' };
        case 'notAsked':
            return { state: 'needsChoice', reason: 'reviewNotAsked' };
        case 'asked':
            return { state: 'checking', reason: 'awaitingReview' };
        case 'budgetSpent':
            // Unreachable from `matchStateOf` (it answers a spent budget above, for an unasked reading, and an
            // `unreadable` one is passed as `exhausted`); total for the compiler's sake: the budget is the reason.
            return { state: 'needsChoice', reason: REVIEW_BUDGET_SPENT_REASON };
    }
}

/**
 * Whether a state may SHOW the proposal as the line's match (ADR-0071).
 *
 * ⛔ Only `checking` (the review is in flight; the cook may choose now or keep it) and `confident` (bound unless the cook
 * changes it). In `default`, `needsChoice` and `noMatch` the proposal was a default that must never be selected, or was
 * rejected, contradicted or abstained on, so the wire's `proposed` is `null` and the food stays visible only as a
 * candidate. A client that bound whatever `proposed` held would otherwise select a food the gate refused.
 *
 * @param state - The derived state.
 * @returns Whether `proposed` may carry the proposal. Pure and total.
 */
export function proposalShownIn(state: MatchState): boolean {
    switch (state) {
        case 'checking':
        case 'confident':
            return true;
        case 'default':
        case 'needsChoice':
        case 'noMatch':
            return false;
    }
}
