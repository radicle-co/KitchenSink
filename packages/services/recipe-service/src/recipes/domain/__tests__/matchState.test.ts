/**
 * `matchStateOf` as a TRUTH TABLE (ADR-0071) — the one place a paste proposal's state is decided, on web and mobile
 * alike, from facts the server holds.
 *
 * Every row is a rule from the owner's rulings of 2026-10-25 or the coordinator's decisions, and the order of the rows
 * is the precedence:
 *
 *  1. Nothing proposed: `noMatch` with no candidates, `needsChoice` with some.
 *  2. A default applies to the phrase: `default`, WHATEVER answered and whatever the gate said. A default is shown,
 *     never selected (ruling 2), and a curated or memo answer for a default noun must not smuggle it in as confident.
 *  3. A curated mapping: `confident`. A gate contradiction keeps it confident (a person decided; the model has an
 *     error rate) but adds a review note.
 *  4. A memo, or a lexical proposal the gate CONTRADICTED on identity: `needsChoice`.
 *  5. A memo: `confident`.
 *  6. A lexical proposal: `confident` once the gate verified identity and `needsChoice` when it contradicted or
 *     abstained. With no verdict, an exact-name rung is `confident` (ruling 3); otherwise `needsChoice` when the gate
 *     could not be asked (refused) or gave up (unchecked), and `checking` while the review is in flight.
 *
 * ⛔ A quantity-only dispute is not a food problem: a joint `contradicted` with an itemized identity `agree` is a
 * confident match.
 */
import { describe, expect, it } from 'vitest';

import { matchStateOf, type MatchFacts } from '../matchState.js';

const LEXICAL = { matchedBy: 'lexical', rung: 'head' } as const;

/** The facts of an ordinary lexical proposal that is waiting on the gate. */
const facts = (overrides: Partial<MatchFacts> = {}): MatchFacts => ({
    proposal: LEXICAL,
    candidateCount: 3,
    defaultApplies: false,
    verdict: undefined,
    review: 'asked',
    ...overrides,
});

const CONTRADICTED = { band: 'contradicted', identityVerdict: 'disagree' } as const;
const VERIFIED = { band: 'verified', identityVerdict: 'agree' } as const;
const ABSTAINED = { band: 'inconclusive', identityVerdict: 'abstain' } as const;

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
        // 2. A default applies — before every answer and every verdict.
        [
            'a default applies to a lexical proposal',
            facts({ defaultApplies: true }),
            { state: 'default', reason: 'defaultApplies' },
        ],
        [
            '⛔ a default applies though a CURATED mapping answered',
            facts({ proposal: { matchedBy: 'curated', rung: null }, defaultApplies: true }),
            { state: 'default', reason: 'defaultApplies' },
        ],
        [
            '⛔ a default applies though a MEMO answered',
            facts({ proposal: { matchedBy: 'memo', rung: null }, defaultApplies: true }),
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
            'a memo',
            facts({ proposal: { matchedBy: 'memo', rung: null } }),
            { state: 'confident', reason: 'rememberedMatch' },
        ],
        [
            '⛔ a memo the gate CONTRADICTED needs a choice',
            facts({ proposal: { matchedBy: 'memo', rung: null }, verdict: CONTRADICTED }),
            { state: 'needsChoice', reason: 'reviewContradicted' },
        ],
        [
            'a memo the gate abstained on stays confident',
            facts({ proposal: { matchedBy: 'memo', rung: null }, verdict: ABSTAINED }),
            { state: 'confident', reason: 'rememberedMatch' },
        ],
        // 6. Lexical, with a verdict.
        [
            'a lexical proposal the gate verified',
            facts({ verdict: VERIFIED }),
            { state: 'confident', reason: 'reviewVerified' },
        ],
        [
            '⛔ a quantity-only dispute (identity agreed) is confident',
            facts({ verdict: { band: 'contradicted', identityVerdict: 'agree' } }),
            { state: 'confident', reason: 'reviewVerified' },
        ],
        [
            'a joint verified verdict with no itemized identity is confident',
            facts({ verdict: { band: 'verified', identityVerdict: null } }),
            { state: 'confident', reason: 'reviewVerified' },
        ],
        [
            'a lexical proposal the gate contradicted',
            facts({ verdict: CONTRADICTED }),
            { state: 'needsChoice', reason: 'reviewContradicted' },
        ],
        [
            'a joint contradiction with no itemized identity needs a choice',
            facts({ verdict: { band: 'contradicted', identityVerdict: null } }),
            { state: 'needsChoice', reason: 'reviewContradicted' },
        ],
        [
            'a lexical proposal the gate abstained on',
            facts({ verdict: ABSTAINED }),
            { state: 'needsChoice', reason: 'reviewAbstained' },
        ],
        [
            'a joint inconclusive verdict with no itemized identity needs a choice',
            facts({ verdict: { band: 'inconclusive', identityVerdict: null } }),
            { state: 'needsChoice', reason: 'reviewAbstained' },
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
            'an EXACT-name proposal awaiting the gate is confident (ruling 3)',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' } }),
            { state: 'confident', reason: 'exactName' },
        ],
        [
            'an EXACT-name proposal the gate could not be asked about is still confident — no verdict demoted it',
            facts({ proposal: { matchedBy: 'lexical', rung: 'exact' }, review: 'refused' }),
            { state: 'confident', reason: 'exactName' },
        ],
        ['a lexical proposal awaiting the gate is checking', facts(), { state: 'checking', reason: 'awaitingReview' }],
        [
            'a lexical proposal with no rung awaiting the gate is checking',
            facts({ proposal: { matchedBy: 'lexical', rung: null } }),
            { state: 'checking', reason: 'awaitingReview' },
        ],
    ])('%s', (_label, input, expected) => {
        expect(matchStateOf(input)).toStrictEqual(expected);
    });
});
