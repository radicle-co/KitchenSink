/**
 * `ParseJobMatchView` — the job view's match projection (ADR-0071), against fakes for the match store, the verdict
 * table and food's refs.
 *
 * What it guards:
 *
 *  - **Names at READ time, as the caller** (ADR-0045). The store holds ids; food names them on this read, and a food
 *    food no longer shows is not offered. A food that could not be asked shows no match rather than a wrong one.
 *  - **The state comes from `matchStateOf`**, fed the stored proposal, the shortlist's default, the gate's verdict and
 *    the review state (refused for an over-cap line, unchecked when the gate gave up).
 *  - **Candidates**: at most five, a default first and flagged, then food's order, at the live end food answered.
 *  - **A stale row is ignored**: a line edited since it was matched shows no match until it is matched again.
 *  - **The view stays total**: an unreadable match store degrades every food to `match: null`, never a failed poll.
 */
import { describe, expect, it, vi } from 'vitest';

import { lineDigest, parseStoredLineDigest, type LineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { CallerToken } from '../../auth/CallerToken.js';
import { sha256Hex } from '../../common/sha256.js';
import type { FoodRef } from '../../database/schema/foodLookupArm.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { canonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { FoodRefsGateway } from '../../ingredients/foodRefs.gateway.js';
import type { LineVerdictRow } from '../dal/lineVerifications.dal.js';
import { matchJudgementDigestOf } from '../domain/matchProposal.js';
import type { ParseJobMatch } from '../domain/parseJobMatch.js';
import { ParseJobMatchView } from '../parseJobMatchView.js';
import type { ParseJobResponse } from '../parseJobs.schema.js';

const OWNER = '01JMATCHVIEWOWNER000000001';
/** The cook, as the controller hands the acting principal over. */
const COOK = { userId: OWNER, principalKind: 'real', containment: 'enforce' } as const;
/** A contained test principal (ADR-0040): its reviews are never sent. */
const CONTAINED = { userId: OWNER, principalKind: 'test', containment: 'enforce' } as const;
const JOB = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');
const LINE = '2 cups milk';
const DIGEST = lineDigest(LINE, sha256Hex);

/** A job view with one parsed line naming the given foods. */
function viewOf(foods: readonly string[] = ['milk'], sourceLine = LINE): ParseJobResponse {
    return {
        id: JOB,
        status: 'complete',
        createdAt: '2026-10-25T10:00:00.000Z',
        expiresAt: '2026-10-26T10:00:00.000Z',
        lines: [
            {
                lineIndex: 0,
                sourceLine,
                status: 'parsed',
                proposal: {
                    raw: sourceLine,
                    quantity: { kind: 'exact', value: 2 },
                    unit: 'cup',
                    statedMeasure: '2 cups',
                    foods: foods.map((name) => ({ name, prep: null })),
                    reviewReasons: [],
                },
                progress: null,
            },
        ],
    };
}

/** The judgement digest {@link viewOf}'s line yields for `milk`, under the given stored line digest. */
function judgementOf(digest: LineDigest = DIGEST, sourceLine = LINE): string {
    return matchJudgementDigestOf(
        {
            lineDigest: digest,
            line: { sourceLine, quantity: { kind: 'exact', value: 2 }, unit: 'cup', statedMeasure: '2 cups' },
            foodIndex: 0,
            phrase: 'milk',
        },
        sha256Hex,
    );
}

/** A stored, current match for food 0 of line 0: a lexical proposal of F-whole with two candidates, review owed. */
function matchOf(overrides: Partial<ParseJobMatch> = {}): ParseJobMatch {
    return {
        lineIndex: 0,
        foodIndex: 0,
        lineDigest: DIGEST,
        judgementDigest: judgementOf(),
        lineDigestNow: DIGEST,
        review: 'owed',
        proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.2 },
        candidates: [
            { kind: 'root', id: 'F-whole', rung: 'head' },
            { kind: 'root', id: 'F-crackers', rung: 'tokenSet' },
        ],
        verificationKey: 'v2:milk',
        enqueuedAt: new Date(),
        ...overrides,
    };
}

function found(name: string, rootId: string, variantId?: string): FoodRefAnswer {
    return {
        outcome: 'found',
        name: canonicalIngredientName(name),
        status: 'RESOLVED',
        isPrivate: false,
        rootId,
        ...(variantId === undefined ? {} : { variant: { id: variantId, parts: [{ attribute: 'cut', text: 'flat' }] } }),
    };
}

const NAMED: Record<string, FoodRefAnswer> = {
    'root:F-whole': found('Milk, whole', 'F-whole'),
    'root:F-crackers': found('Milk crackers', 'F-crackers'),
    'root:F-default': found('Milk, whole, 3.25%', 'F-default'),
};

interface Setup {
    readonly matches?: readonly ParseJobMatch[] | Error;
    readonly answers?: Record<string, FoodRefAnswer>;
    readonly verdicts?: ReadonlyMap<string, LineVerdictRow>;
    readonly exhausted?: ReadonlySet<string>;
}

function setup(options: Setup = {}) {
    const findForJob = vi.fn(async () => {
        if (options.matches instanceof Error) {
            throw options.matches;
        }

        return options.matches ?? [matchOf()];
    });
    const answers = options.answers ?? NAMED;
    const resolve = vi.fn(async (_caller: unknown, refs: readonly FoodRef[]) => ({
        answers: new Map(
            refs.map((ref) => [`${ref.kind}:${ref.id}`, answers[`${ref.kind}:${ref.id}`] ?? { outcome: 'absent' }]),
        ),
        degraded: false,
    }));
    const verdicts = options.verdicts ?? new Map();
    const findBandsByKeys = vi.fn(
        async (keys: readonly string[]) => new Map([...verdicts].filter(([k]) => keys.includes(k))),
    );
    const findExhaustedKeys = vi.fn(
        async (keys: readonly string[]) => new Set(keys.filter((key) => options.exhausted?.has(key) === true)),
    );
    const metric = vi.fn();
    const view = new ParseJobMatchView(
        { findForJob },
        { findBandsByKeys, findExhaustedKeys },
        { resolve } as unknown as FoodRefsGateway,
        metric,
    );

    return { view, findForJob, resolve, metric };
}

/** The match on food 0 of line 0 of a decorated view. */
const firstMatch = (decorated: ParseJobResponse) => decorated.lines[0]?.proposal?.foods[0]?.match;

describe('ParseJobMatchView.decorate', () => {
    it('gives every proposed food `match: null` when nothing is matched yet, and asks food nothing', async () => {
        const { view, resolve } = setup({ matches: [] });

        const decorated = await view.decorate(COOK, CALLER, viewOf(['salt', 'pepper']));

        expect(decorated.lines[0]?.proposal?.foods.map((food) => food.match)).toStrictEqual([null, null]);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('names the proposal and candidates at READ time, as the caller, and reads `checking` before a verdict', async () => {
        const { view, resolve } = setup();

        const decorated = await view.decorate(COOK, CALLER, viewOf());

        expect(resolve).toHaveBeenCalledWith(CALLER, expect.any(Array), 'read');
        expect(firstMatch(decorated)).toStrictEqual({
            state: 'checking',
            reason: 'awaitingReview',
            proposed: { kind: 'root', id: 'F-whole', name: 'Milk, whole' },
            candidates: [
                { kind: 'root', id: 'F-whole', name: 'Milk, whole', isDefault: false },
                { kind: 'root', id: 'F-crackers', name: 'Milk crackers', isDefault: false },
            ],
        });
    });

    it('⛔ reads `default` when a default applies, and lists it FIRST and flagged — selecting nothing', async () => {
        const { view } = setup({
            matches: [
                matchOf({
                    candidates: [
                        { kind: 'root', id: 'F-whole', rung: 'head' },
                        { kind: 'root', id: 'F-default', rung: 'default' },
                    ],
                }),
            ],
        });

        const match = firstMatch(await view.decorate(COOK, CALLER, viewOf()));

        expect(match?.state).toBe('default');
        expect(match?.candidates.map((candidate) => [candidate.id, candidate.isDefault])).toStrictEqual([
            ['F-default', true],
            ['F-whole', false],
        ]);
    });

    it('reads `confident` once the gate verified identity', async () => {
        const { view } = setup({
            verdicts: new Map([['v2:milk', { band: 'verified', certainty: 'high', identityVerdict: 'agree', aspects: ['identity', 'quantity'] }]]),
        });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))?.state).toBe('confident');
    });

    it('⛔ keeps a CURATED proposal the gate contradicted confident, notes it, and counts it for curation review', async () => {
        const { view, metric } = setup({
            matches: [
                matchOf({
                    proposal: { matchedBy: 'curated', food: { kind: 'root', id: 'F-whole' }, rung: null, margin: null },
                }),
            ],
            verdicts: new Map([['v2:milk', { band: 'contradicted', certainty: 'high', identityVerdict: 'disagree', aspects: ['identity', 'quantity'] }]]),
        });

        const match = firstMatch(await view.decorate(COOK, CALLER, viewOf()));

        expect(match).toMatchObject({ state: 'confident', reason: 'curatedMapping', reviewNote: 'reviewDisagreed' });
        expect(metric).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['the gate contradicted it', { verdicts: new Map([['v2:milk', { band: 'contradicted', certainty: 'high', identityVerdict: 'disagree', aspects: ['identity', 'quantity'] }]]) }],
        ['the gate abstained', { verdicts: new Map([['v2:milk', { band: 'inconclusive', certainty: 'high', identityVerdict: 'abstain', aspects: ['identity', 'quantity'] }]]) }],
        ['the gate gave up', { exhausted: new Set(['v2:milk']) }],
    ] as const)('⛔ shows NO proposal in `needsChoice` (%s) — the food stays a candidate', async (_label, options) => {
        const { view } = setup(options as Setup);

        const match = firstMatch(await view.decorate(COOK, CALLER, viewOf()));

        expect(match?.state).toBe('needsChoice');
        expect(match?.proposed).toBeNull();
        expect(match?.candidates.map((candidate) => candidate.id)).toContain('F-whole');
    });

    it('⛔ shows NO proposal in `default` — a default is listed, never selected', async () => {
        const { view } = setup({
            matches: [
                matchOf({
                    candidates: [
                        { kind: 'root', id: 'F-whole', rung: 'head' },
                        { kind: 'root', id: 'F-default', rung: 'default' },
                    ],
                }),
            ],
        });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))?.proposed).toBeNull();
    });

    it('shows the proposal once it is `confident`', async () => {
        const { view } = setup({
            verdicts: new Map([['v2:milk', { band: 'verified', certainty: 'high', identityVerdict: 'agree', aspects: ['identity', 'quantity'] }]]),
        });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))?.proposed).toStrictEqual({
            kind: 'root',
            id: 'F-whole',
            name: 'Milk, whole',
        });
    });

    it('⛔ drops a candidate food names with an EMPTY name, rather than failing the whole view', async () => {
        const { view } = setup({
            answers: {
                ...NAMED,
                'root:F-crackers': { ...(found('x', 'F-crackers') as Extract<FoodRefAnswer, { outcome: 'found' }>), name: '' as never },
            },
        });

        const match = firstMatch(await view.decorate(COOK, CALLER, viewOf()));

        expect(match?.candidates.map((candidate) => candidate.id)).toStrictEqual(['F-whole']);
        expect(match?.candidates.every((candidate) => candidate.name.length > 0)).toBe(true);
    });

    it('⛔ does not trust an AGREE from a verdict that never asked identity — the proposal still reads `checking`', async () => {
        const { view } = setup({
            verdicts: new Map([['v2:milk', { band: 'verified', certainty: 'high', identityVerdict: null, aspects: ['quantity'] }]]),
        });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))?.state).toBe('checking');
    });

    it('⛔ reads `needsChoice` (reviewNotAsked) for a CONTAINED principal, whose review is never sent — never `checking`', async () => {
        const { view } = setup();

        expect(firstMatch(await view.decorate(CONTAINED, CALLER, viewOf()))).toMatchObject({
            state: 'needsChoice',
            reason: 'reviewNotAsked',
            proposed: null,
        });
    });

    it('reads `needsChoice` when the gate gave up on the key', async () => {
        const { view } = setup({ exhausted: new Set(['v2:milk']) });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))).toMatchObject({
            state: 'needsChoice',
            reason: 'reviewUnchecked',
        });
    });

    it('⛔ reads `needsChoice` for a row whose review was REFUSED — the persisted disposition, never a policy re-run', async () => {
        // F10: the line here is SHORT, so re-running the gate policy would say "ask"; only the stored `refused` (an
        // over-cap line, or a request the queue contract refused) can put it here.
        const { view } = setup({ matches: [matchOf({ verificationKey: null, review: 'refused' })] });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))).toMatchObject({
            state: 'needsChoice',
            reason: 'reviewRefused',
        });
    });

    it('⛔ ignores a STALE row — a line edited since it was matched shows no match', async () => {
        const { view } = setup({ matches: [matchOf({ lineDigest: parseStoredLineDigest('v1:old') })] });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))).toBeNull();
    });

    it('⛔ ignores a row whose judgement the current parse no longer gives — the same text reparsed', async () => {
        const { view } = setup({ matches: [matchOf({ judgementDigest: 'j1:another-parse' })] });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))).toBeNull();
    });

    it('⛔ compares the line’s STORED digest, never one recomputed from the text it shows', async () => {
        // One digest authority (item 8): the store returns the line's digest with the row; the view never re-derives it.
        const stored = parseStoredLineDigest('v2:as-stored');
        const { view } = setup({
            matches: [matchOf({ lineDigest: stored, lineDigestNow: stored, judgementDigest: judgementOf(stored) })],
        });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))?.state).toBe('checking');
    });

    it('⛔ shows NO match for a food whose names food could not be asked for — never a nameless one', async () => {
        const { view } = setup({ answers: { ...NAMED, 'root:F-whole': { outcome: 'unreachable' } } });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))).toBeNull();
    });

    it('drops a proposal food no longer shows the cook, and asks for a choice among the rest', async () => {
        const { view } = setup({ answers: { 'root:F-crackers': found('Milk crackers', 'F-crackers') } });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))).toStrictEqual({
            state: 'needsChoice',
            reason: 'noProposal',
            proposed: null,
            candidates: [{ kind: 'root', id: 'F-crackers', name: 'Milk crackers', isDefault: false }],
        });
    });

    it('shows a forwarded food at its LIVE end, a variant by its parts', async () => {
        const { view } = setup({ answers: { ...NAMED, 'root:F-whole': found('Beef brisket', 'R-brisket', 'V-flat') } });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))?.proposed).toStrictEqual({
            kind: 'variant',
            id: 'V-flat',
            name: 'Beef brisket (flat)',
        });
    });

    it('⛔ stays TOTAL when the match store cannot be read: every food reads `match: null`', async () => {
        const { view } = setup({ matches: new Error('connection reset') });

        expect(firstMatch(await view.decorate(COOK, CALLER, viewOf()))).toBeNull();
    });
});
