/**
 * Unit tests for `pasteJoin.ts`: WHICH pasted line joins the draft next, and how each of its rows joins (ADR-0071; owner
 * rulings 2026-10-25). Written from the blueprint's A2 and the rulings, seen red first.
 *
 * What is pinned: lines join IN PASTE ORDER and whole; a line waits for its foods' matches (a join that ran before the
 * match arrived would join as written what the server was about to bind); ONLY a confident match with a proposed food
 * binds, every other state joins as written (a default is NEVER selected for the cook, ADR-0070 section 5); a food whose
 * request failed, or whose job can no longer match, does not hold its line; a reader row has no match and joins as written.
 */
import { describe, expect, it } from 'vitest';

import {
    makeParseCandidate,
    makeParseJob,
    makeParseJobLine,
    makeParseMatch,
    makeParseProposal,
    makeParseProposalFood,
} from '../../__fixtures__/parseJobs.js';
import { nextJoinOf, type NextJoin, type PasteJoinInput } from '../pasteJoin.js';
import { pastedLinesOf } from '../pastedLines.js';

const parsedLine = (lineIndex: number, ...foods: ReturnType<typeof makeParseProposalFood>[]) =>
    makeParseJobLine({
        lineIndex,
        sourceLine: `line ${String(lineIndex)}`,
        status: 'parsed',
        proposal: makeParseProposal({ raw: `line ${String(lineIndex)}`, foods }),
    });

const inputOf = (over: Partial<PasteJoinInput> & Pick<PasteJoinInput, 'job'>): PasteJoinInput => ({
    lines: pastedLinesOf({ job: over.job, jobFailed: false, now: 0, typedByCook: new Set() }),
    joined: new Set(),
    optionsFailed: new Set(),
    matchesGone: false,
    failedAt: undefined,
    ...over,
});

const stepOf = (next: NextJoin | undefined) => {
    expect(next).toBeDefined();

    return next as NextJoin;
};

describe('nextJoinOf - order', () => {
    it('joins the first line not yet joined, whole', () => {
        const job = makeParseJob({
            lines: [
                parsedLine(
                    0,
                    makeParseProposalFood({ name: 'salt', match: makeParseMatch() }),
                    makeParseProposalFood({ name: 'pepper', match: makeParseMatch() }),
                ),
                parsedLine(1, makeParseProposalFood({ match: makeParseMatch() })),
            ],
        });
        const next = stepOf(nextJoinOf(inputOf({ job })));

        expect(next.lineIndex).toBe(0);
        expect(next.rows.map((row) => row.row.name)).toEqual(['salt', 'pepper']);
    });

    it('moves on to the next line once the first has joined', () => {
        const job = makeParseJob({
            lines: [
                parsedLine(0, makeParseProposalFood({ match: makeParseMatch() })),
                parsedLine(1, makeParseProposalFood({ name: 'milk', match: makeParseMatch() })),
            ],
        });

        expect(stepOf(nextJoinOf(inputOf({ job, joined: new Set([0]) }))).lineIndex).toBe(1);
    });

    it('⛔ never joins a later line past one that is still reading: paste order holds', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({ lineIndex: 0 }),
                parsedLine(1, makeParseProposalFood({ match: makeParseMatch() })),
            ],
        });

        expect(nextJoinOf(inputOf({ job }))).toBeUndefined();
    });

    it('⛔ never joins a later line past one that waits on the cook', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({ lineIndex: 0, progress: { phase: 'stalled' } }),
                parsedLine(1, makeParseProposalFood({ match: makeParseMatch() })),
            ],
        });

        expect(nextJoinOf(inputOf({ job }))).toBeUndefined();
    });

    it('holds the line whose join failed, and the lines after it, until Try again', () => {
        const job = makeParseJob({ lines: [parsedLine(0, makeParseProposalFood({ match: makeParseMatch() }))] });

        expect(nextJoinOf(inputOf({ job, failedAt: 0 }))).toBeUndefined();
    });

    it('answers nothing when every line has joined', () => {
        const job = makeParseJob({ lines: [parsedLine(0, makeParseProposalFood({ match: makeParseMatch() }))] });

        expect(nextJoinOf(inputOf({ job, joined: new Set([0]) }))).toBeUndefined();
    });
});

describe('nextJoinOf - how a row joins', () => {
    const joinOf = (
        match: ReturnType<typeof makeParseMatch> | null | undefined,
        over: Partial<PasteJoinInput> = {},
    ) => {
        const job = makeParseJob({ lines: [parsedLine(0, makeParseProposalFood({ name: 'milk', match }))] });

        return nextJoinOf(inputOf({ job, ...over }))?.rows[0];
    };

    it('⛔ a confident match binds the food it proposes, by the server when the reason is an exact name', () => {
        expect(joinOf(makeParseMatch())).toMatchObject({
            kind: 'bound',
            key: '0:0',
            food: { id: 'whole', name: 'Whole milk', variant: false },
            boundBy: 'server',
        });
    });

    it('a remembered or verified match binds as the review’s', () => {
        expect(joinOf(makeParseMatch({ reason: 'reviewVerified' }))).toMatchObject({
            kind: 'bound',
            boundBy: 'review',
        });
        expect(joinOf(makeParseMatch({ reason: 'rememberedMatch' }))).toMatchObject({
            kind: 'bound',
            boundBy: 'review',
        });
    });

    it('a proposed VARIANT binds through the variant admission', () => {
        const match = makeParseMatch({ proposed: { kind: 'variant', id: 'v-1', name: 'Oat milk, unsweetened' } });

        expect(joinOf(match)).toMatchObject({ kind: 'bound', food: { id: 'v-1', variant: true } });
    });

    it.each(['default', 'needsChoice', 'noMatch', 'checking'] as const)(
        '⛔ a %s match joins as written: nothing is chosen for the cook (ADR-0070 section 5)',
        (state) => {
            const match = makeParseMatch({
                state,
                proposed: state === 'checking' ? { kind: 'root', id: 'whole', name: 'Whole milk' } : null,
                candidates: [makeParseCandidate({ isDefault: true })],
            });

            expect(joinOf(match)).toMatchObject({ kind: 'asWritten', key: '0:0' });
        },
    );

    it('a confident match that names no food cannot bind: it joins as written', () => {
        expect(joinOf(makeParseMatch({ proposed: null }))).toMatchObject({ kind: 'asWritten' });
    });

    it('a reader row (no proposal food) has no match and joins as written with no key', () => {
        const job = makeParseJob({
            lines: [makeParseJobLine({ lineIndex: 0, sourceLine: '2 tbsp olive oil', status: 'unparseable' })],
        });
        const row = nextJoinOf(inputOf({ job }))?.rows[0];

        expect(row).toMatchObject({ kind: 'asWritten' });
        expect(row).not.toHaveProperty('key');
    });
});

describe('nextJoinOf - waiting for a match', () => {
    const unmatched = () => {
        const job = makeParseJob({ lines: [parsedLine(0, makeParseProposalFood({ name: 'milk' }))] });

        return job;
    };

    it('⛔ holds a line whose food has no match yet: joining it now would join as written what is about to bind', () => {
        expect(nextJoinOf(inputOf({ job: unmatched() }))).toBeUndefined();
    });

    it('holds the whole line when ONE of its foods has no match yet', () => {
        const job = makeParseJob({
            lines: [
                parsedLine(
                    0,
                    makeParseProposalFood({ name: 'salt', match: makeParseMatch() }),
                    makeParseProposalFood({ name: 'pepper' }),
                ),
            ],
        });

        expect(nextJoinOf(inputOf({ job }))).toBeUndefined();
    });

    it('a food whose request failed does not hold its line: it joins as written and says so', () => {
        const next = nextJoinOf(inputOf({ job: unmatched(), optionsFailed: new Set(['0:0']) }));

        expect(next?.rows[0]).toMatchObject({ kind: 'asWritten', key: '0:0' });
    });

    it('when the job can no longer match (expired, unreadable) a food with no match joins as written', () => {
        const next = nextJoinOf(inputOf({ job: unmatched(), matchesGone: true }));

        expect(next?.rows[0]).toMatchObject({ kind: 'asWritten', key: '0:0' });
    });

    it('a heading joins as no rows, at once', () => {
        const job = makeParseJob({
            lines: [
                makeParseJobLine({
                    lineIndex: 0,
                    sourceLine: 'For the sauce:',
                    status: 'parsed',
                    proposal: makeParseProposal({ foods: [] }),
                }),
            ],
        });
        const next = nextJoinOf(inputOf({ job }));

        expect(next).toMatchObject({ lineIndex: 0, rows: [] });
    });
});
