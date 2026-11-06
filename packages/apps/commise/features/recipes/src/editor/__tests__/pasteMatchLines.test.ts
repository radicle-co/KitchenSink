/**
 * Unit tests for `pasteMatchLines.ts`: the Adapter from the wire (the job view's per-food `match`, ADR-0071) plus the
 * paste overlay onto the view shape both flows draw (`MatchLine`). Written from `matchLine.ts`'s header (where the five
 * `boundBy` reasons fold, what a late review result belongs to) and the blueprint, seen red first.
 *
 * What is pinned: every wire state maps to its line state; NOTHING is bound for the cook except a confident line (ADR-0070
 * section 5: defaults serve imports, never the cook); the cook's binding wins over a late verdict and only that binding
 * carries a review note; and only foods that joined the draft are drawn.
 */
import { describe, expect, it } from 'vitest';

import type { ParseJobResponse } from '@kitchensink/schema-recipe';

import type { LineBinding, MatchLine } from '../../ingredientMatching/matchLine.js';
import { pasteMatchLinesOf, type PasteMatchLinesInput } from '../pasteMatchLines.js';
import { emptyPasteMatchSession, reducePasteMatchSession, type PasteMatchEvent } from '../pasteMatchSession.js';

interface WireMatch {
    state: 'checking' | 'confident' | 'default' | 'needsChoice' | 'noMatch';
    reason: string;
    proposed: { kind: 'root' | 'variant'; id: string; name: string } | null;
    candidates: { kind: 'root' | 'variant'; id: string; name: string; isDefault: boolean }[];
    reviewResetsAt?: string;
}

const WHOLE = { kind: 'root', id: 'whole', name: 'Whole milk', isDefault: true } as const;
const SKIM = { kind: 'root', id: 'skim', name: 'Skim milk', isDefault: false } as const;
const OAT = { kind: 'root', id: 'oat', name: 'Oat milk', isDefault: false } as const;

const confident = (reason = 'exactName', proposed: WireMatch['proposed'] = WHOLE): WireMatch => ({
    state: 'confident',
    reason,
    proposed,
    candidates: [WHOLE, SKIM],
});

/** A one-line job whose single food carries `match` (`undefined` = absent on the wire). */
const jobWith = (
    match: WireMatch | null | undefined,
    raw = '2 cups milk',
    statedMeasure: string | null = '2 cups',
): ParseJobResponse =>
    ({
        id: 'job-1',
        status: 'complete',
        lines: [
            {
                lineIndex: 0,
                sourceLine: raw,
                status: 'parsed',
                progress: null,
                proposal: {
                    raw,
                    statedMeasure,
                    foods: [{ name: 'milk', prep: null, ...(match === undefined ? {} : { match }) }],
                },
            },
        ],
    }) as unknown as ParseJobResponse;

const sessionOf = (...events: PasteMatchEvent[]) =>
    [
        { type: 'jobAccepted', jobId: 'job-1' } as const,
        { type: 'lineJoined', key: '0:0', draftKey: 'd-1' } as const,
        ...events,
    ].reduce(reducePasteMatchSession, emptyPasteMatchSession);

const COOK_OAT: LineBinding = {
    boundBy: 'cook',
    pick: { kind: 'food', foodId: 'oat', name: 'Oat milk' },
    reviewNote: undefined,
};

const linesOf = (job: ParseJobResponse, overrides: Partial<PasteMatchLinesInput> = {}): readonly MatchLine[] =>
    pasteMatchLinesOf({
        job,
        session: sessionOf(),
        optionsFailed: new Set(),
        reviewReasonOf: (reason) => `because ${reason}`,
        ...overrides,
    });

const only = (lines: readonly MatchLine[]): MatchLine => {
    expect(lines).toHaveLength(1);

    return lines[0] as MatchLine;
};

describe('pasteMatchLinesOf - the line itself', () => {
    it('keys the line lineIndex:foodIndex and splits the measure from the words', () => {
        const line = only(linesOf(jobWith(confident())));

        expect(line.key).toBe('0:0');
        expect(line.line).toEqual({ measure: '2 cups', words: 'milk' });
    });

    it('a line stating no measure has an empty measure and all its words', () => {
        expect(only(linesOf(jobWith(confident(), 'eggs', null))).line).toEqual({ measure: '', words: 'eggs' });
    });

    it('a stated measure that is not the start of the line is not drawn twice', () => {
        expect(only(linesOf(jobWith(confident(), 'milk, about a handful', 'a handful'))).line).toEqual({
            measure: '',
            words: 'milk, about a handful',
        });
    });

    /**
     * A measure that ends inside a word of the line is not the line's measure: drawn split, `2-3 cup` against
     * `2-3 cups chicken stock` read `2-3 cup s chicken stock`, on screen and to a screen reader (PR 132 device pass).
     */
    it('a stated measure that ends inside a word of the line is not split out of it', () => {
        expect(only(linesOf(jobWith(confident(), '2-3 cups chicken stock', '2-3 cup'))).line).toEqual({
            measure: '',
            words: '2-3 cups chicken stock',
        });
    });

    it('a stated measure that ends on a word of the line is split out of it', () => {
        expect(only(linesOf(jobWith(confident(), '2-3 cups chicken stock', '2-3 cups'))).line).toEqual({
            measure: '2-3 cups',
            words: 'chicken stock',
        });
    });

    /**
     * The measure ends before a `,` or `;` as well as before a space (the same boundary `promoteCrfReading` cuts at), so
     * `2 cups, sifted flour` keeps its measure emphasis.
     * The separator stays attached to the measure (designer ruling 2026-11-06), so the row shows the line as pasted.
     */
    it.each([
        ['2 cups, sifted flour', '2 cups,', 'sifted flour'],
        ['3 tablespoons, plus 1 tablespoon, butter', '3 tablespoons,', 'plus 1 tablespoon, butter'],
        ['2 cups; sifted flour', '2 cups;', 'sifted flour'],
    ])('a stated measure that ends before a separator is split out of %s', (raw, shownMeasure, words) => {
        const stated = shownMeasure.slice(0, -1);

        expect(only(linesOf(jobWith(confident(), raw, stated))).line).toEqual({ measure: shownMeasure, words });
    });

    it('a stated measure that ends inside a word is still not split when a separator follows the word', () => {
        expect(only(linesOf(jobWith(confident(), '2-3 cups, chicken stock', '2-3 cup'))).line).toEqual({
            measure: '',
            words: '2-3 cups, chicken stock',
        });
    });

    it('a stated measure that is the whole line is split out of it', () => {
        expect(only(linesOf(jobWith(confident(), '2 cups', '2 cups'))).line).toEqual({ measure: '2 cups', words: '' });
    });

    it('draws only foods that joined the draft, in paste order', () => {
        expect(linesOf(jobWith(confident()), { session: emptyPasteMatchSession })).toEqual([]);
        expect(
            linesOf(jobWith(confident()), {
                session: sessionOf({ type: 'draftLineRemoved', draftKey: 'd-1' }),
            }),
        ).toEqual([]);
    });

    it('draws each food of a multi-food line and each line, in order', () => {
        const job = jobWith(confident());
        const two = {
            ...job,
            lines: [
                ...job.lines,
                {
                    ...job.lines[0],
                    lineIndex: 1,
                    proposal: {
                        ...job.lines[0]?.proposal,
                        foods: [
                            {
                                name: 'salt',
                                prep: null,
                                match: confident('exactName', { ...WHOLE, id: 's', name: 'Salt' }),
                            },
                            { name: 'pepper', prep: null, match: { ...confident(), state: 'noMatch', proposed: null } },
                        ],
                    },
                },
            ],
        } as unknown as ParseJobResponse;
        const session = [
            { type: 'jobAccepted', jobId: 'job-1' },
            { type: 'lineJoined', key: '1:1', draftKey: 'd-3' },
            { type: 'lineJoined', key: '0:0', draftKey: 'd-1' },
            { type: 'lineJoined', key: '1:0', draftKey: 'd-2' },
        ].reduce((s, e) => reducePasteMatchSession(s, e as PasteMatchEvent), emptyPasteMatchSession);

        expect(linesOf(two, { session }).map((line) => line.key)).toEqual(['0:0', '1:0', '1:1']);
    });
});

describe('pasteMatchLinesOf - every wire state', () => {
    it('confident arrives BOUND to the proposed food, with the candidates', () => {
        const line = only(linesOf(jobWith(confident())));

        expect(line).toMatchObject({
            state: 'confident',
            binding: { boundBy: 'server', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } },
            candidates: [
                { id: 'whole', name: 'Whole milk', isDefault: true },
                { id: 'skim', name: 'Skim milk', isDefault: false },
            ],
        });
    });

    it('checking shows the proposed food as the proposal and binds nothing', () => {
        const checking: WireMatch = { state: 'checking', reason: 'awaitingReview', proposed: SKIM, candidates: [SKIM] };

        expect(only(linesOf(jobWith(checking)))).toMatchObject({
            state: 'checking',
            proposal: 'Skim milk',
            binding: undefined,
        });
    });

    it('default carries the food noun and its candidates, and is NEVER selected for the cook (ADR-0070 section 5)', () => {
        const wire: WireMatch = {
            state: 'default',
            reason: 'defaultApplies',
            proposed: null,
            candidates: [WHOLE, SKIM],
        };
        const line = only(linesOf(jobWith(wire)));

        expect(line).toMatchObject({ state: 'default', noun: 'milk', binding: undefined });
        expect((line as Extract<MatchLine, { state: 'default' }>).candidates[0]).toEqual({
            id: 'whole',
            name: 'Whole milk',
            isDefault: true,
        });
    });

    /**
     * ADDED for the AI budget spent (owner ruling 2026-10-26): reason `reviewBudgetSpent` rides a `needsChoice` match, and
     * `reviewResetsAt` says when the check comes back. The line keeps the proposal first among its candidates and binds
     * nothing; it carries the fact so the view can word it.
     */
    it('⛔ a needsChoice spent for want of the AI budget carries when the check returns, and binds nothing', () => {
        const wire: WireMatch = {
            state: 'needsChoice',
            reason: 'reviewBudgetSpent',
            proposed: null,
            candidates: [WHOLE, SKIM],
            reviewResetsAt: '2026-11-01T00:00:00.000Z',
        };

        expect(only(linesOf(jobWith(wire)))).toMatchObject({
            state: 'needsChoice',
            binding: undefined,
            budgetSpent: { resetsAt: '2026-11-01T00:00:00.000Z' },
            candidates: [{ id: 'whole' }, { id: 'skim' }],
        });
    });

    it('a budget-spent line from a server that sent no date still says the check did not run', () => {
        const wire: WireMatch = {
            state: 'needsChoice',
            reason: 'reviewBudgetSpent',
            proposed: null,
            candidates: [SKIM],
        };

        expect(only(linesOf(jobWith(wire)))).toMatchObject({
            state: 'needsChoice',
            budgetSpent: { resetsAt: undefined },
        });
    });

    it('any other needsChoice carries no budget fact', () => {
        const wire: WireMatch = { state: 'needsChoice', reason: 'noProposal', proposed: null, candidates: [SKIM, OAT] };

        expect(only(linesOf(jobWith(wire)))).not.toHaveProperty('budgetSpent');
    });

    it('needsChoice carries its candidates, unbound', () => {
        const wire: WireMatch = { state: 'needsChoice', reason: 'noProposal', proposed: null, candidates: [SKIM, OAT] };

        expect(only(linesOf(jobWith(wire)))).toMatchObject({
            state: 'needsChoice',
            binding: undefined,
            candidates: [{ id: 'skim' }, { id: 'oat' }],
        });
    });

    it('noMatch is unbound and has no candidates', () => {
        const wire: WireMatch = { state: 'noMatch', reason: 'noCandidates', proposed: null, candidates: [] };

        expect(only(linesOf(jobWith(wire)))).toMatchObject({ state: 'noMatch', binding: undefined });
    });

    it('optionsFailed when the match request failed and the food has no match', () => {
        expect(only(linesOf(jobWith(null)))).toMatchObject({ state: 'checking' });
        expect(only(linesOf(jobWith(null), { optionsFailed: new Set(['0:0']) }))).toMatchObject({
            state: 'optionsFailed',
            binding: undefined,
        });
    });

    it('a match that arrives later wins over a failed request', () => {
        expect(only(linesOf(jobWith(confident()), { optionsFailed: new Set(['0:0']) })).state).toBe('confident');
    });

    it('a joined food with no match yet and no failure reads as still checking, unbound', () => {
        expect(only(linesOf(jobWith(undefined)))).toMatchObject({
            state: 'checking',
            proposal: 'milk',
            binding: undefined,
        });
    });

    it('a confident match naming no proposed food cannot be bound: it falls back to a choice', () => {
        expect(only(linesOf(jobWith(confident('exactName', null))))).toMatchObject({
            state: 'needsChoice',
            binding: undefined,
        });
        expect(only(linesOf(jobWith({ ...confident('exactName', null), candidates: [] })))).toMatchObject({
            state: 'noMatch',
        });
    });
});

describe('pasteMatchLinesOf - who bound it (reason folds into three)', () => {
    it.each([
        ['exactName', 'server'],
        ['curatedMapping', 'server'],
        ['rememberedMatch', 'review'],
        ['reviewVerified', 'review'],
        ['someFutureReason', 'server'],
    ] as const)('a confident line with reason %s is bound by %s', (reason, boundBy) => {
        expect(only(linesOf(jobWith(confident(reason)))).binding?.boundBy).toBe(boundBy);
    });
});

describe('pasteMatchLinesOf - the cook’s binding and the overlay', () => {
    it('the overlay’s binding wins over the server’s on a confident line', () => {
        const session = sessionOf({ type: 'bindingSet', key: '0:0', binding: COOK_OAT });
        const line = only(linesOf(jobWith(confident()), { session }));

        expect(line.binding).toMatchObject({ boundBy: 'cook', pick: { foodId: 'oat' } });
    });

    it('a cook pick is carried on open and checking lines too', () => {
        const session = sessionOf({ type: 'bindingSet', key: '0:0', binding: COOK_OAT });
        const needs: WireMatch = {
            state: 'needsChoice',
            reason: 'noProposal',
            proposed: null,
            candidates: [SKIM, OAT],
        };
        const checking: WireMatch = { state: 'checking', reason: 'awaitingReview', proposed: SKIM, candidates: [SKIM] };

        expect(only(linesOf(jobWith(needs), { session })).binding).toMatchObject({ boundBy: 'cook' });
        expect(only(linesOf(jobWith(checking), { session })).binding).toMatchObject({ boundBy: 'cook' });
    });

    it('a review-bound overlay binding (a checking line that later read confident) is kept as it is', () => {
        const review: LineBinding = { boundBy: 'review', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } };
        const session = sessionOf({ type: 'bindingSet', key: '0:0', binding: review });

        expect(only(linesOf(jobWith(confident('reviewVerified')), { session })).binding).toEqual(review);
    });

    it('the cook’s pick of a food outside the candidates is passed through; the view shows it first', () => {
        const found: LineBinding = {
            boundBy: 'cook',
            pick: { kind: 'food', foodId: 'soy', name: 'Soy milk' },
            reviewNote: undefined,
        };
        const session = sessionOf({ type: 'bindingSet', key: '0:0', binding: found });
        const line = only(linesOf(jobWith(confident()), { session }));

        expect(line.binding).toMatchObject({ pick: { foodId: 'soy' } });
    });
});

describe('pasteMatchLinesOf - the late review note', () => {
    const picked = (binding: LineBinding) => sessionOf({ type: 'bindingSet', key: '0:0', binding });

    it('a cook pick that differs from a confident proposal carries the suggestion and its reason', () => {
        const line = only(linesOf(jobWith(confident('reviewVerified')), { session: picked(COOK_OAT) }));

        expect(line.binding).toEqual({
            boundBy: 'cook',
            pick: { kind: 'food', foodId: 'oat', name: 'Oat milk' },
            reviewNote: { suggestedFood: 'Whole milk', reason: 'because reviewVerified' },
        });
    });

    it('no note when the cook picked the very food the verdict proposes', () => {
        const same: LineBinding = {
            boundBy: 'cook',
            pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' },
            reviewNote: undefined,
        };

        expect(only(linesOf(jobWith(confident()), { session: picked(same) })).binding).toMatchObject({
            reviewNote: undefined,
        });
    });

    it('⛔ no note on a line the cook kept as written: the note is "Our check suggested {food}", for a FOOD pick', () => {
        const asWritten: LineBinding = { boundBy: 'cook', pick: { kind: 'asWritten' }, reviewNote: undefined };

        expect(only(linesOf(jobWith(confident()), { session: picked(asWritten) })).binding).toEqual({
            boundBy: 'cook',
            pick: { kind: 'asWritten' },
            reviewNote: undefined,
        });
    });

    it('no note while the line is still checking, or when the verdict is not confident', () => {
        const checking: WireMatch = { state: 'checking', reason: 'awaitingReview', proposed: SKIM, candidates: [SKIM] };
        const needs: WireMatch = {
            state: 'needsChoice',
            reason: 'reviewContradicted',
            proposed: null,
            candidates: [SKIM],
        };

        expect(only(linesOf(jobWith(checking), { session: picked(COOK_OAT) })).binding).toMatchObject({
            reviewNote: undefined,
        });
        expect(only(linesOf(jobWith(needs), { session: picked(COOK_OAT) })).binding).toMatchObject({
            reviewNote: undefined,
        });
    });

    it('a stale note held in the overlay is recomputed, never trusted', () => {
        const stale: LineBinding = { ...COOK_OAT, reviewNote: { suggestedFood: 'Old', reason: 'old' } };
        const needs: WireMatch = {
            state: 'needsChoice',
            reason: 'noProposal',
            proposed: null,
            candidates: [SKIM, OAT],
        };

        expect(only(linesOf(jobWith(needs), { session: picked(stale) })).binding).toMatchObject({
            reviewNote: undefined,
        });
    });

    it('a server or review binding never carries a note', () => {
        const review: LineBinding = { boundBy: 'review', pick: { kind: 'food', foodId: 'skim', name: 'Skim milk' } };

        expect(only(linesOf(jobWith(confident()), { session: picked(review) })).binding).toEqual(review);
    });
});
