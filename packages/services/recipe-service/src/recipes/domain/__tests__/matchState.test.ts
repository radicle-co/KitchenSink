/**
 * `matchStateOf` as a TRUTH TABLE (ADR-0071) — the one place a paste proposal's state is decided, on web and mobile
 * alike, from facts the server holds.
 *
 * Every row is a rule from the owner's rulings of 2026-10-25 or the coordinator's decisions, and the order of the rows
 * is the precedence:
 *
 *  1. A default applies to the phrase: `default`, whatever the gate said, UNLESS a curated mapping or a memo of ANOTHER
 *     food answered: that is a match, and a default shows only when no match was found (owner ruling 5, 2026-11-03). A memo
 *     of the DEFAULT food stays `default`: that memo is how a default is smuggled in as confident (the M2 loop below).
 *  2. Nothing proposed: `noMatch` with no candidates, `needsChoice` with some. A default is shown,
 *     never selected (ruling 2), and a curated or memo answer for a default noun must not smuggle it in as confident.
 *  3. A curated mapping: `confident`. A gate contradiction keeps it confident (a person decided; the model has an
 *     error rate) but adds a review note.
 *  4. A memo, or a lexical proposal the gate CONTRADICTED on identity: `needsChoice`.
 *  5. A memo: `confident`.
 *  6. A lexical proposal: `confident` once the gate verified identity and `needsChoice` when it contradicted,
 *     doubted, hedged or abstained, or when its reply was unreadable. With no verdict, an exact-name rung is `confident` (ruling 3); otherwise `needsChoice` when the gate
 *     could not be asked (refused) or gave up (unchecked), and `checking` while the review is in flight.
 *
 * ⛔ A quantity-only dispute is not a food problem: a joint `contradicted` with an itemized identity `agree` is a
 * confident match.
 */
import { describe, expect, it } from 'vitest';

import { MATCH_STATES, matchStateOf, proposalShownIn, type MatchFacts } from '../matchState.js';

const LEXICAL = { matchedBy: 'lexical', rung: 'head' } as const;

/** The facts of an ordinary lexical proposal that is waiting on the gate. */
const facts = (overrides: Partial<MatchFacts> = {}): MatchFacts => ({
    proposal: LEXICAL,
    candidateCount: 3,
    defaultApplies: false,
    proposalIsDefault: false,
    verdict: undefined,
    review: 'asked',
    ...overrides,
});

/** Both aspects asked, as every paste review asks them. */
const ASKED = ['identity', 'quantity'] as const;
const CONTRADICTED = { band: 'contradicted', certainty: 'high', identityVerdict: 'disagree', aspects: ASKED } as const;
const DOUBTED = { band: 'contradicted', certainty: 'medium', identityVerdict: 'disagree', aspects: ASKED } as const;
const VERIFIED = { band: 'verified', certainty: 'high', identityVerdict: 'agree', aspects: ASKED } as const;
const HEDGED = { band: 'inconclusive', certainty: 'low', identityVerdict: 'agree', aspects: ASKED } as const;
const ABSTAINED = { band: 'inconclusive', certainty: 'high', identityVerdict: 'abstain', aspects: ASKED } as const;
/** The model's reply could not be read: stored as a joint abstain, low, with no itemized identity. */
const UNREADABLE = { band: 'inconclusive', certainty: 'low', identityVerdict: null, aspects: ASKED } as const;
/** A verdict on record under the key that asked QUANTITY only: it says nothing about the food. */
const QUANTITY_ONLY_AGREE = {
    band: 'verified',
    certainty: 'high',
    identityVerdict: null,
    aspects: ['quantity'],
} as const;
const QUANTITY_ONLY_DISAGREE = {
    band: 'contradicted',
    certainty: 'high',
    identityVerdict: null,
    aspects: ['quantity'],
} as const;

/**
 * A SPENT AI BUDGET on a paste job (ADR-0071 §9, ADR-0024 §3; owner ruling 2026-10-26). While the prod ceiling refuses
 * the paste path nothing reviews the parse or the match, so EVERY proposed food goes to the cook: curated, remembered
 * and exact-name matches too. The precedence: a default and a missing proposal keep their states (rows 1 and 2), and
 * the budget outranks every proposal-based row. A review that actually RAN (a verdict that asked identity) outranks the
 * budget, because a real judgement is on record.
 */
describe('matchStateOf: a spent AI budget surfaces every food', () => {
    const SPENT = { review: 'budgetSpent' } as const;

    it.each<[string, MatchFacts, ReturnType<typeof matchStateOf>]>([
        [
            'a curated mapping needs a choice',
            facts({ ...SPENT, proposal: { matchedBy: 'curated', rung: null } }),
            { state: 'needsChoice', reason: 'reviewBudgetSpent' },
        ],
        [
            'a remembered (memo) match needs a choice',
            facts({ ...SPENT, proposal: { matchedBy: 'memo', rung: null } }),
            { state: 'needsChoice', reason: 'reviewBudgetSpent' },
        ],
        [
            'an exact-name match needs a choice',
            facts({ ...SPENT, proposal: { matchedBy: 'lexical', rung: 'exact' } }),
            { state: 'needsChoice', reason: 'reviewBudgetSpent' },
        ],
        [
            'a lexical proposal needs a choice',
            facts({ ...SPENT }),
            { state: 'needsChoice', reason: 'reviewBudgetSpent' },
        ],
        [
            'a curated mapping carries NO review note while the budget is spent',
            facts({ ...SPENT, proposal: { matchedBy: 'curated', rung: null }, verdict: undefined }),
            { state: 'needsChoice', reason: 'reviewBudgetSpent' },
        ],
        [
            'a verdict that asked only quantity says nothing about the food: the budget still surfaces it',
            facts({ ...SPENT, proposal: { matchedBy: 'lexical', rung: 'exact' }, verdict: QUANTITY_ONLY_AGREE }),
            { state: 'needsChoice', reason: 'reviewBudgetSpent' },
        ],
        [
            'a default stays a default',
            facts({ ...SPENT, defaultApplies: true, proposal: { matchedBy: 'lexical', rung: 'default' } }),
            { state: 'default', reason: 'defaultApplies' },
        ],
        [
            'no proposal and no candidates stays noMatch',
            facts({ ...SPENT, proposal: undefined, candidateCount: 0 }),
            { state: 'noMatch', reason: 'noCandidates' },
        ],
        [
            'no proposal with candidates stays needsChoice for its own reason',
            facts({ ...SPENT, proposal: undefined }),
            { state: 'needsChoice', reason: 'noProposal' },
        ],
        [
            '⛔ a review that RAN (identity asked, verified) outranks the budget: a real judgement is on record',
            facts({ ...SPENT, verdict: VERIFIED }),
            { state: 'confident', reason: 'reviewVerified' },
        ],
        [
            'the control: the same exact-name proposal with the budget NOT spent, its review given up on, is confident',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' }, review: 'exhausted' }),
            { state: 'confident', reason: 'exactName' },
        ],
    ])('%s', (_label, input, expected) => {
        expect(matchStateOf(input)).toStrictEqual(expected);
    });

    it('never shows the proposal as the line match: the food stays one of the candidates', () => {
        expect(proposalShownIn(matchStateOf(facts(SPENT)).state)).toBe(false);
    });
});

describe('matchStateOf — the truth table', () => {
    it.each<[string, MatchFacts, ReturnType<typeof matchStateOf>]>([
        // 1. Nothing proposed.
        [
            'no proposal, no candidates',
            facts({ proposal: undefined, candidateCount: 0 }),
            { state: 'noMatch', reason: 'noCandidates' },
        ],
        [
            'no proposal, some candidates',
            facts({ proposal: undefined }),
            { state: 'needsChoice', reason: 'noProposal' },
        ],
        [
            '⛔ no proposal, but a DEFAULT among the candidates — the default is still shown first, never selected',
            facts({ proposal: undefined, defaultApplies: true }),
            { state: 'default', reason: 'defaultApplies' },
        ],
        // 2. A default applies — before every answer and every verdict.
        [
            'a default applies to a lexical proposal',
            facts({ defaultApplies: true }),
            { state: 'default', reason: 'defaultApplies' },
        ],
        [
            'a CURATED mapping is a match, so it wins over the default (owner ruling 5)',
            facts({ proposal: { matchedBy: 'curated', rung: null }, defaultApplies: true }),
            { state: 'confident', reason: 'curatedMapping' },
        ],
        [
            "a CURATED mapping that names the default food is still a person's decision",
            facts({ proposal: { matchedBy: 'curated', rung: null }, defaultApplies: true, proposalIsDefault: true }),
            { state: 'confident', reason: 'curatedMapping' },
        ],
        [
            'a MEMO of another food is a match, so it wins over the default (owner ruling 5)',
            facts({
                proposal: { matchedBy: 'memo', rung: null },
                defaultApplies: true,
                proposalIsDefault: false,
                verdict: VERIFIED,
            }),
            { state: 'confident', reason: 'rememberedMatch' },
        ],
        [
            '⛔ THE M2 LOOP: a memo of the DEFAULT food stays a default, never a confident match',
            facts({ proposal: { matchedBy: 'memo', rung: null }, defaultApplies: true, proposalIsDefault: true }),
            { state: 'default', reason: 'defaultApplies' },
        ],
        [
            'a default applies though the gate VERIFIED it',
            facts({ defaultApplies: true, verdict: VERIFIED }),
            { state: 'default', reason: 'defaultApplies' },
        ],
        [
            'a default proposal the gate CONTRADICTED is still a default',
            facts({ proposal: { matchedBy: 'lexical', rung: 'default' }, defaultApplies: true, verdict: CONTRADICTED }),
            { state: 'default', reason: 'defaultApplies' },
        ],
        // 3. Curated.
        [
            'a curated mapping',
            facts({ proposal: { matchedBy: 'curated', rung: null } }),
            { state: 'confident', reason: 'curatedMapping' },
        ],
        [
            '⛔ a curated mapping the gate CONTRADICTED stays confident, with a review note',
            facts({ proposal: { matchedBy: 'curated', rung: null }, verdict: CONTRADICTED }),
            { state: 'confident', reason: 'curatedMapping', reviewNote: 'reviewDisagreed' },
        ],
        [
            'a curated mapping the gate abstained on stays confident, with no note',
            facts({ proposal: { matchedBy: 'curated', rung: null }, verdict: ABSTAINED }),
            { state: 'confident', reason: 'curatedMapping' },
        ],
        // 4 and 5. Memo.
        [
            'a memo the gate verified',
            facts({ proposal: { matchedBy: 'memo', rung: null }, verdict: VERIFIED }),
            { state: 'confident', reason: 'rememberedMatch' },
        ],
        [
            '⛔ a memo whose review is still owed is CHECKING: the verdict that lands can turn it into a choice (2026-11-08)',
            facts({ proposal: { matchedBy: 'memo', rung: null } }),
            { state: 'checking', reason: 'awaitingReview' },
        ],
        [
            '⛔ a memo the gate CONTRADICTED needs a choice',
            facts({ proposal: { matchedBy: 'memo', rung: null }, verdict: CONTRADICTED }),
            { state: 'needsChoice', reason: 'reviewContradicted' },
        ],
        [
            '⛔ a memo the gate abstained on needs a choice: a saved line would badge AMBIGUOUS (2026-11-08)',
            facts({ proposal: { matchedBy: 'memo', rung: null }, verdict: ABSTAINED }),
            { state: 'needsChoice', reason: 'reviewAbstained' },
        ],
        // 6. Lexical, with a verdict.
        [
            'a lexical proposal the gate verified',
            facts({ verdict: VERIFIED }),
            { state: 'confident', reason: 'reviewVerified' },
        ],
        [
            '⛔ a quantity-only dispute (identity agreed) is confident',
            facts({ verdict: { band: 'contradicted', certainty: 'high', identityVerdict: 'agree', aspects: ASKED } }),
            { state: 'confident', reason: 'reviewVerified' },
        ],
        [
            'a joint verified verdict with no itemized identity is confident',
            facts({ verdict: { band: 'verified', certainty: 'high', identityVerdict: null, aspects: ASKED } }),
            { state: 'confident', reason: 'reviewVerified' },
        ],
        [
            'a lexical proposal the gate contradicted',
            facts({ verdict: CONTRADICTED }),
            { state: 'needsChoice', reason: 'reviewContradicted' },
        ],
        [
            '⛔ a joint contradiction with no itemized identity cannot say the FOOD is wrong: unchecked',
            facts({ verdict: { band: 'contradicted', certainty: 'high', identityVerdict: null, aspects: ASKED } }),
            { state: 'needsChoice', reason: 'reviewUnchecked' },
        ],
        [
            'a lexical proposal the gate abstained on',
            facts({ verdict: ABSTAINED }),
            { state: 'needsChoice', reason: 'reviewAbstained' },
        ],
        [
            '⛔ an unreadable model reply reads as a review that gave up, never `checking` forever',
            facts({ verdict: UNREADABLE }),
            { state: 'needsChoice', reason: 'reviewUnchecked' },
        ],
        [
            'an unreadable reply on an EXACT-name proposal is confident, like any review that gave up (Q)',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' }, verdict: UNREADABLE }),
            { state: 'confident', reason: 'exactName' },
        ],
        [
            'Q: an EXACT-name proposal the gate doubted is overridden: the cook is asked',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' }, verdict: DOUBTED }),
            { state: 'needsChoice', reason: 'reviewContradicted' },
        ],
        [
            'a disagreement short of high certainty asks the cook (asking is cheap)',
            facts({ verdict: DOUBTED }),
            { state: 'needsChoice', reason: 'reviewContradicted' },
        ],
        [
            'a memo with a disagreement short of high certainty asks the cook',
            facts({ proposal: { matchedBy: 'memo', rung: null }, verdict: DOUBTED }),
            { state: 'needsChoice', reason: 'reviewContradicted' },
        ],
        [
            '⛔ a curated mapping with a disagreement short of high certainty carries NO review note',
            facts({ proposal: { matchedBy: 'curated', rung: null }, verdict: DOUBTED }),
            { state: 'confident', reason: 'curatedMapping' },
        ],
        [
            '⛔ a hedged agree (low certainty) is not a confirmation',
            facts({ verdict: HEDGED }),
            { state: 'needsChoice', reason: 'reviewAbstained' },
        ],
        [
            'a memo with a hedged agree stays a remembered match',
            facts({ proposal: { matchedBy: 'memo', rung: null }, verdict: HEDGED }),
            { state: 'confident', reason: 'rememberedMatch' },
        ],
        [
            '⛔ an EXACT-name proposal the gate contradicted needs a choice — the verdict outranks the rung',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' }, verdict: CONTRADICTED }),
            { state: 'needsChoice', reason: 'reviewContradicted' },
        ],
        // 6. Lexical, before any verdict.
        [
            'a lexical proposal the gate could not be asked about',
            facts({ review: 'refused' }),
            { state: 'needsChoice', reason: 'reviewRefused' },
        ],
        [
            'a lexical proposal the gate gave up on',
            facts({ review: 'exhausted' }),
            { state: 'needsChoice', reason: 'reviewUnchecked' },
        ],
        [
            '⛔ an EXACT-name proposal awaiting the gate is CHECKING, not confident (2026-11-08; ruling 3 still holds once the review is refused, gave up or was never sent)',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' } }),
            { state: 'checking', reason: 'awaitingReview' },
        ],
        [
            'Q: an EXACT-name proposal whose review the gate GAVE UP on is still confident (owner: an exact name is)',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' }, review: 'exhausted' }),
            { state: 'confident', reason: 'exactName' },
        ],
        [
            'an EXACT-name proposal the gate could not be asked about is still confident — no verdict demoted it',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' }, review: 'refused' }),
            { state: 'confident', reason: 'exactName' },
        ],
        ['a lexical proposal awaiting the gate is checking', facts(), { state: 'checking', reason: 'awaitingReview' }],
        // A verdict that never asked IDENTITY is not trusted (item 7): it is read as no verdict at all.
        [
            '⛔ an AGREE from a verdict that never asked identity is not trusted — still checking',
            facts({ verdict: QUANTITY_ONLY_AGREE }),
            { state: 'checking', reason: 'awaitingReview' },
        ],
        [
            '⛔ a CONTRADICTION from a verdict that never asked identity does not reject the food',
            facts({ verdict: QUANTITY_ONLY_DISAGREE }),
            { state: 'checking', reason: 'awaitingReview' },
        ],
        [
            'a memo with a verdict that never asked identity stays a remembered match',
            facts({ proposal: { matchedBy: 'memo', rung: null }, verdict: QUANTITY_ONLY_DISAGREE }),
            { state: 'confident', reason: 'rememberedMatch' },
        ],
        [
            'a curated mapping with a contradiction that never asked identity carries no review note',
            facts({ proposal: { matchedBy: 'curated', rung: null }, verdict: QUANTITY_ONLY_DISAGREE }),
            { state: 'confident', reason: 'curatedMapping' },
        ],
        // A contained test principal's review is never sent (ADR-0040; item 12): never `checking` forever.
        [
            '⛔ a contained principal’s lexical proposal, never sent for review, needs a choice',
            facts({ review: 'notAsked' }),
            { state: 'needsChoice', reason: 'reviewNotAsked' },
        ],
        [
            'a contained principal’s EXACT-name proposal is still confident — no review was needed for it',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' }, review: 'notAsked' }),
            { state: 'confident', reason: 'exactName' },
        ],
        [
            'a contained principal’s proposal the gate already judged reads the verdict',
            facts({ review: 'notAsked', verdict: VERIFIED }),
            { state: 'confident', reason: 'reviewVerified' },
        ],
        [
            'a lexical proposal with no rung awaiting the gate is checking',
            facts({ proposal: { matchedBy: 'lexical', rung: null } }),
            { state: 'checking', reason: 'awaitingReview' },
        ],
    ])('%s', (_label, input, expected) => {
        expect(matchStateOf(input)).toStrictEqual(expected);
    });
});

/**
 * Whether the PROPOSAL may be shown as the line's match (ADR-0071 review). Only a proposal the cook may keep as it
 * stands is shown: `checking` (awaiting review, the cook may choose now) and `confident` (bound unless changed). In
 * every other state the proposal was rejected, contradicted, abstained on, or a default that must never be selected,
 * so `proposed` is `null` and the food stays visible only as a candidate.
 */
describe('proposalShownIn — the states that may show the proposal', () => {
    it.each([
        ['checking', true],
        ['confident', true],
        ['default', false],
        ['needsChoice', false],
        ['noMatch', false],
    ] as const)('%s → %s', (state, shown) => {
        expect(proposalShownIn(state)).toBe(shown);
    });

    it('answers for every state the enum holds', () => {
        expect(MATCH_STATES.filter((state) => proposalShownIn(state))).toStrictEqual(['checking', 'confident']);
    });
});
