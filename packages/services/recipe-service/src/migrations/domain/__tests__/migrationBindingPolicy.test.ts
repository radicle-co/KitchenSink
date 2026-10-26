/**
 * Truth table for what a migration binds: every mode x review state x line state, with the owner rulings
 * (defaults for imports only; a cook's pick or "keep as written" is never replaced) as named cases.
 */
import { describe, expect, it } from 'vitest';

import {
    bindingOf,
    isOpenLine,
    ITEM_REVIEWS,
    MATCH_MODES,
    type BindingInput,
    type ItemReview,
    type LineBinding,
    type LineFacts,
    type MatchMode,
} from '../migrationBindingPolicy.js';

const cand = (foodId: string, isDefault = false) => ({ foodId, isDefault });

const LINES = {
    exact: { state: 'confident', reason: 'exactName', proposedFoodId: 'p', candidates: [cand('p')] },
    curated: { state: 'confident', reason: 'curatedMapping', proposedFoodId: 'p', candidates: [cand('p')] },
    memo: { state: 'confident', reason: 'rememberedMatch', proposedFoodId: 'p', candidates: [cand('p')] },
    verified: { state: 'confident', reason: 'reviewVerified', proposedFoodId: 'p', candidates: [cand('p')] },
    default: {
        state: 'default',
        reason: 'defaultApplies',
        proposedFoodId: undefined,
        candidates: [cand('top'), cand('salt', true)],
    },
    needsChoice: {
        state: 'needsChoice',
        reason: 'noProposal',
        proposedFoodId: undefined,
        candidates: [cand('c1'), cand('c2')],
    },
    checking: {
        state: 'checking',
        reason: 'awaitingReview',
        proposedFoodId: 'p',
        candidates: [cand('p'), cand('other')],
    },
    noMatch: { state: 'noMatch', reason: 'noCandidates', proposedFoodId: undefined, candidates: [] },
} satisfies Record<string, Omit<LineFacts, 'cookChoice'>>;

type LineName = keyof typeof LINES;

const facts = (name: LineName, cookChoice: LineFacts['cookChoice'] = undefined): LineFacts => ({
    ...LINES[name],
    cookChoice,
});

const bind = (
    foodId: string,
    boundBy: LineBinding extends infer B ? (B extends { boundBy: infer X } ? X : never) : never,
) => ({ kind: 'bind', foodId, boundBy }) as const;
const AS_WRITTEN = { kind: 'asWritten' } as const;

/** What a line becomes where the item is OPEN: only the confident lines bind. */
const OPEN: Record<LineName, LineBinding> = {
    exact: bind('p', 'exact'),
    curated: bind('p', 'curated'),
    memo: bind('p', 'review'),
    verified: bind('p', 'review'),
    default: AS_WRITTEN,
    needsChoice: AS_WRITTEN,
    checking: AS_WRITTEN,
    noMatch: AS_WRITTEN,
};

/** "Save lines as written": defaults and confident matches bind, every other line stays as written. */
const KEEP: Record<LineName, LineBinding> = { ...OPEN, default: bind('salt', 'default') };

/** "Pick the best match for me": every top match binds. */
const BEST: Record<LineName, LineBinding> = {
    ...OPEN,
    default: bind('top', 'autoBest'),
    needsChoice: bind('c1', 'autoBest'),
    checking: bind('p', 'autoBest'),
};

interface Regime {
    readonly label: string;
    readonly inputs: readonly { mode: MatchMode; itemReview: ItemReview; reviewClosed: boolean }[];
    readonly expected: Record<LineName, LineBinding>;
}

const every = <T>(xs: readonly T[]) => xs;

const REGIMES: readonly Regime[] = [
    {
        label: 'keepAsWritten (any review mark but skipped, closed flag ignored)',
        inputs: every(['pending', 'reviewed'] as const).flatMap((itemReview) =>
            [true, false].map((reviewClosed) => ({ mode: 'keepAsWritten' as const, itemReview, reviewClosed })),
        ),
        expected: KEEP,
    },
    {
        label: 'bindBest (any review mark but skipped, closed flag ignored)',
        inputs: every(['pending', 'reviewed'] as const).flatMap((itemReview) =>
            [true, false].map((reviewClosed) => ({ mode: 'bindBest' as const, itemReview, reviewClosed })),
        ),
        expected: BEST,
    },
    {
        label: 'review, still open, item pending',
        inputs: [{ mode: 'review', itemReview: 'pending', reviewClosed: false }],
        expected: OPEN,
    },
    {
        label: 'review closed (Save and leave), item pending: works like keepAsWritten',
        inputs: [{ mode: 'review', itemReview: 'pending', reviewClosed: true }],
        expected: KEEP,
    },
    {
        label: 'review, item already reviewed: the cook saw it, defaults do not bind afterwards',
        inputs: [
            { mode: 'review', itemReview: 'reviewed', reviewClosed: false },
            { mode: 'review', itemReview: 'reviewed', reviewClosed: true },
        ],
        expected: OPEN,
    },
    {
        label: 'skipped item, every mode: open lines stay as written, confident lines still bind',
        inputs: MATCH_MODES.flatMap((mode) =>
            [true, false].map((reviewClosed) => ({ mode, itemReview: 'skipped' as const, reviewClosed })),
        ),
        expected: OPEN,
    },
];

describe('bindingOf truth table', () => {
    it('covers every mode and every review mark', () => {
        const seen = new Set(REGIMES.flatMap((r) => r.inputs.map((i) => `${i.mode}/${i.itemReview}`)));

        for (const mode of MATCH_MODES) {
            for (const review of ITEM_REVIEWS) {
                expect(seen.has(`${mode}/${review}`), `${mode}/${review}`).toBe(true);
            }
        }
    });

    for (const regime of REGIMES) {
        describe(regime.label, () => {
            for (const name of Object.keys(LINES) as LineName[]) {
                it(`${name} -> ${JSON.stringify(regime.expected[name])}`, () => {
                    for (const input of regime.inputs) {
                        const full: BindingInput = { ...input, line: facts(name) };
                        expect(bindingOf(full), JSON.stringify(input)).toEqual(regime.expected[name]);
                    }
                });
            }
        });
    }
});

describe('a cook decision comes first, in every regime', () => {
    const all = REGIMES.flatMap((r) => r.inputs);

    it('a cook pick binds as cook, even over a confident or default line', () => {
        for (const input of all) {
            for (const name of ['exact', 'default', 'noMatch', 'checking'] as const) {
                expect(bindingOf({ ...input, line: facts(name, { kind: 'food', foodId: 'mine' }) })).toEqual(
                    bind('mine', 'cook'),
                );
            }
        }
    });

    it('"keep as written" by the cook is never replaced by a confident match or a default', () => {
        for (const input of all) {
            for (const name of ['exact', 'default', 'checking', 'needsChoice'] as const) {
                expect(bindingOf({ ...input, line: facts(name, { kind: 'asWritten' }) })).toEqual(AS_WRITTEN);
            }
        }
    });
});

describe('pinned readings (owner may flip these)', () => {
    it('PIN: in bindBest a default line binds the TOP candidate as autoBest, not the default candidate', () => {
        expect(
            bindingOf({ mode: 'bindBest', itemReview: 'pending', reviewClosed: false, line: facts('default') }),
        ).toEqual(bind('top', 'autoBest'));
    });

    it('a confident state with no proposal (should not happen) stays as written rather than binding nothing', () => {
        const line: LineFacts = { ...facts('exact'), proposedFoodId: undefined };
        expect(bindingOf({ mode: 'keepAsWritten', itemReview: 'pending', reviewClosed: false, line })).toEqual(
            AS_WRITTEN,
        );
    });

    it('keepAsWritten with a default state but no default candidate stays as written', () => {
        const line: LineFacts = { ...facts('default'), candidates: [cand('top')] };
        expect(bindingOf({ mode: 'keepAsWritten', itemReview: 'pending', reviewClosed: false, line })).toEqual(
            AS_WRITTEN,
        );
    });

    it('bindBest prefers the shown proposal over the first candidate', () => {
        const line: LineFacts = { ...facts('checking'), candidates: [cand('first'), cand('p')] };
        expect(bindingOf({ mode: 'bindBest', itemReview: 'pending', reviewClosed: false, line })).toEqual(
            bind('p', 'autoBest'),
        );
    });
});

describe('isOpenLine', () => {
    it('is open when nothing is decided and the line is not confident', () => {
        for (const name of ['default', 'needsChoice', 'checking', 'noMatch'] as const) {
            expect(isOpenLine(facts(name)), name).toBe(true);
        }
    });

    it('is closed for a confident line and for any cook decision', () => {
        expect(isOpenLine(facts('exact'))).toBe(false);
        expect(isOpenLine(facts('needsChoice', { kind: 'food', foodId: 'x' }))).toBe(false);
        expect(isOpenLine(facts('needsChoice', { kind: 'asWritten' }))).toBe(false);
    });
});
