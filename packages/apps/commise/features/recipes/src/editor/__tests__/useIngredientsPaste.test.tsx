/**
 * Tests for {@link useIngredientsPaste} — the one composition of Paste a list both editor containers call (build spec
 * §7.5.4; D10; ADR-0071): what the field group draws, whether the heading offers it, the sheet, the hold, and what the
 * publish action reads. The paste session and the matching Mediator are doubles (their own suites drive them); the
 * sheet's state, the reading rows and the match view are the real ones.
 *
 * REWRITTEN for A2: the reading rows and the progress block are derived HERE from the session's lines (they depend on
 * work the Mediator does, so the session cannot own them), and the Facade now also hands the field group the matched
 * lines and the publish sheet its facts.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makePasteIntoIngredients, makePasteMatching } from '../../__fixtures__/pasteMatching.js';
import { makeIngredientRowEditor } from '../../__fixtures__/index.js';
import { makeConfidentLine, makeNeedsChoiceLine } from '../../ingredientMatching/__fixtures__/matchLines.js';
import {
    makeParseJob,
    makeParseJobLine,
    makeParseProposal,
    makeParseProposalFood,
} from '../../__fixtures__/parseJobs.js';
import { pastedLinesOf, readerLinesOf, type PastedLine } from '../pastedLines.js';
import type { PasteIntoIngredients } from '../usePasteIntoIngredients.js';
import type { PasteMatching, UsePasteMatchingOptions } from '../usePasteMatching.js';

const doubles = vi.hoisted(() => ({
    paste: undefined as PasteIntoIngredients | undefined,
    matching: undefined as PasteMatching | undefined,
    matchingOptions: undefined as UsePasteMatchingOptions | undefined,
}));

vi.mock('../usePasteIntoIngredients.js', () => ({
    usePasteIntoIngredients: () => doubles.paste,
}));
vi.mock('../usePasteMatching.js', () => ({
    usePasteMatching: (options: UsePasteMatchingOptions) => {
        doubles.matchingOptions = options;

        return doubles.matching;
    },
}));

import { createPasteHold, type PasteHold } from '../pasteHold.js';
import { useIngredientsPaste } from '../useIngredientsPaste.js';

const READING: PastedLine = { kind: 'reading', lineIndex: 0, sourceLine: '2 cups flour', phase: 'reading' };
const keys = (count: number): string[] => Array.from({ length: count }, (_, index) => `n:line${String(index)}`);

const render = (
    over: Partial<PasteIntoIngredients>,
    lines: number,
    initiallyOpen = false,
    hold: PasteHold = createPasteHold(),
    matching: Partial<PasteMatching> = {},
) => {
    doubles.paste = makePasteIntoIngredients({ sessionKey: 'job-1', ...over });
    doubles.matching = makePasteMatching(matching);
    const rowEditor = makeIngredientRowEditor();

    return {
        rowEditor,
        ...renderHook(() =>
            useIngredientsPaste({
                offered: true,
                keepsSource: true,
                dispatch: vi.fn(),
                lineKeys: keys(lines),
                initiallyOpen,
                hold,
                rowEditor,
                keep: 'tabSession',
                autoBind: true,
                onSource: vi.fn(),
            }),
        ),
    };
};

describe('useIngredientsPaste', () => {
    it('an empty section offers paste beside the add field, not in its heading', () => {
        const { result } = render({}, 0);

        expect(result.current.inHeading).toBe(false);
        expect(result.current.view.onOpen).toBeDefined();
    });

    it('a section with lines offers it in its heading, and not beside the add field', () => {
        const { result } = render({}, 2);

        expect(result.current.inHeading).toBe(true);
        expect(result.current.view.onOpen).toBeUndefined();
    });

    it('⛔ once paste is not offered (D10: after the first publish), nothing offers it', () => {
        const { result } = render({ available: false }, 2);

        expect(result.current.inHeading).toBe(false);
        expect(result.current.view.onOpen).toBeUndefined();
    });

    it('opening it from the section opens the sheet', () => {
        const { result } = render({}, 0);

        act(() => result.current.view.onOpen?.());

        expect(result.current.sheet.open).toBe(true);
    });

    it('Home’s first-run Paste ingredients opens the sheet at once', () => {
        expect(render({}, 0, true).result.current.sheet.open).toBe(true);
    });
});

describe('useIngredientsPaste — Publish waits only for work in flight', () => {
    it('waits while the paste is sent, while a line is still reading, while a line is joining, and while a pick is sent', () => {
        expect(render({}, 0).result.current.pending).toBe(false);
        expect(render({ submitting: true }, 0).result.current.pending).toBe(true);
        expect(render({ lines: [READING] }, 0).result.current.pending).toBe(true);
        expect(render({}, 0, false, createPasteHold(), { joining: true }).result.current.pending).toBe(true);
        expect(
            render({}, 0, false, createPasteHold(), {
                pending: new Map([['0:0', { kind: 'useProposal' as const }]]),
            }).result.current.pending,
        ).toBe(true);
    });

    it('⛔ does NOT wait for a line that is only being checked: the cook may publish, and the sheet says what is open', () => {
        const checking = { ...makeNeedsChoiceLine(), state: 'checking' as const, proposal: 'milk' };
        const { result } = render({}, 3, false, createPasteHold(), { lines: [checking], drawn: [checking] });

        expect(result.current.pending).toBe(false);
    });
});

describe('useIngredientsPaste — what it hands the field group', () => {
    it('derives the reading rows and the progress block from the session’s lines that have not joined', () => {
        const { result } = render(
            {
                lines: [{ kind: 'settled', lineIndex: 0, sourceLine: '1 tsp salt', rows: [] }, READING].map(
                    (line, index) => ({ ...line, lineIndex: index }),
                ) as PastedLine[],
                joined: new Set([0]),
            },
            1,
        );

        expect(result.current.view.reading).toEqual([
            { key: 'job-1:1', lineIndex: 1, sourceLine: '2 cups flour', state: 'reading' },
        ]);
        expect(result.current.view.progress).toMatchObject({ done: 1, count: 2 });
    });

    it('says the rows are waiting when the work is parked for a connection', () => {
        const { result } = render({ lines: [READING] }, 0, false, createPasteHold(), { paused: true });

        expect(result.current.view.reading.map((row) => row.state)).toEqual(['waiting']);
    });

    it('hands over every action, the focus state and what was added', () => {
        const retryLookup = vi.fn();
        const retryParse = vi.fn();
        const addAsWritten = vi.fn();
        const addRestAsWritten = vi.fn();
        const { result } = render(
            {
                retryLookup,
                retryParse,
                addAsWritten,
                addRestAsWritten,
                focusSignal: 4,
                added: { count: 3, occurrence: 2 },
            },
            1,
        );

        expect(result.current.view).toMatchObject({
            onRetryLookup: retryLookup,
            onRetryParse: retryParse,
            onAddAsWritten: addAsWritten,
            onAddRestAsWritten: addRestAsWritten,
            focusSignal: 4,
        });
        // What a finished paste added is the EDITOR's to say (one message with the section's completion), not the section's.
        expect(result.current.added).toEqual({ count: 3, occurrence: 2 });
        expect(result.current.view).not.toHaveProperty('added');
    });

    it('⛔ hands the matched lines the paste list draws, and the draft keys the ordinary rows must leave out', () => {
        const line = makeConfidentLine();
        const { result } = render({}, 1, false, createPasteHold(), {
            lines: [line],
            drawn: [line],
            ownedKeys: new Set(['n:line0']),
        });
        const { matching } = result.current.view;

        expect(matching?.ownedKeys).toEqual(new Set(['n:line0']));
        expect(matching?.summary?.added).toBe('Added 1 line');
        expect(matching?.layoutFor(false)?.list.lines).toEqual([line]);
        expect(matching?.layoutFor(false)?.pane).toBeUndefined();
        expect(matching?.layoutFor(true)?.pane).toBeUndefined();
    });

    it('the Mediator is handed the row editor’s one commit port, its food picker, and the draft’s keys', () => {
        const { rowEditor } = render({}, 2);

        expect(doubles.matchingOptions?.pickOnLine).toBe(rowEditor.pickFromPaste);
        expect(doubles.matchingOptions?.beginSearch).toBe(rowEditor.entry.beginChange);
        expect(doubles.matchingOptions?.lineKeys).toEqual(keys(2));
        expect(doubles.matchingOptions?.autoBind).toBe(true);
    });

    it('⛔ the daily limit shows its notice, with the time zone the host resolved', () => {
        const { result } = render({ quota: { resetsAt: '2026-10-27T08:00:00.000Z' } }, 2);

        expect(result.current.view.matching?.notice).toMatchObject({
            kind: 'quota',
            resetsAt: '2026-10-27T08:00:00.000Z',
        });
        expect(result.current.view.matching?.notice).toHaveProperty('timeZone');
    });

    it('offline with lines on the list shows the offline notice naming where the draft is kept', () => {
        const line = makeConfidentLine();
        const { result } = render({ pollPaused: true }, 1, false, createPasteHold(), { lines: [line], drawn: [line] });

        expect(result.current.view.matching?.notice).toEqual({ kind: 'offline', keep: 'tabSession' });
    });
});

describe('useIngredientsPaste — the publish sheet (R23)', () => {
    it('is not asked for while no line needs a pick', () => {
        const line = makeConfidentLine();
        const { result } = render({}, 1, false, createPasteHold(), { lines: [line], drawn: [line] });

        expect(result.current.openChoices.facts).toBeUndefined();
    });

    it('names the lines that need a pick, and counts the draft', () => {
        const open = makeNeedsChoiceLine({ line: { measure: '', words: 'bread' } });
        const { result } = render({}, 4, false, createPasteHold(), { lines: [open], drawn: [open] });

        expect(result.current.openChoices.facts).toEqual({
            openNames: ['bread'],
            checkingNames: [],
            counted: 3,
            total: 4,
        });
    });

    it('Choose now opens the first open line in the list and in the pane, and asks for focus', () => {
        const expandTo = vi.fn();
        const moveTo = vi.fn();
        const open = makeNeedsChoiceLine();
        const { result } = render({}, 1, false, createPasteHold(), { lines: [open], drawn: [open], expandTo, moveTo });

        act(() => result.current.openChoices.chooseNow());

        expect(expandTo).toHaveBeenCalledWith(open.key);
        expect(moveTo).toHaveBeenCalledWith(open.key);
        expect(result.current.view.matching?.layoutFor(false)?.list.focus.requested).toBe(true);
    });
});

describe('useIngredientsPaste — the hold', () => {
    /**
     * The hold the editor reads before its server create (A1's `pasteHold.ts`): this paste is its one writer. It holds
     * while the paste is sent or its lines are reading, lets go when they have joined, and lets go if the paste unmounts.
     */
    it('⛔ holds the shared paste hold while pending, and lets go when done or unmounted', () => {
        const hold = createPasteHold();
        const view = render({ submitting: true }, 0, false, hold);
        expect(hold.get()).toBe(true);

        doubles.paste = makePasteIntoIngredients({ sessionKey: 'job-1' });
        view.rerender();
        expect(hold.get()).toBe(false);

        doubles.paste = makePasteIntoIngredients({ sessionKey: 'job-1', lines: [READING] });
        view.rerender();
        expect(hold.get()).toBe(true);

        view.unmount();
        expect(hold.get()).toBe(false);
    });

    it('⛔ tells the editor the hold was released once its lines have joined, and not when the paste unmounts', () => {
        const hold = createPasteHold();
        const released = vi.fn();
        hold.onReleased(released);
        const view = render({ submitting: true }, 0, false, hold);

        doubles.paste = makePasteIntoIngredients({ sessionKey: 'job-1' });
        view.rerender();
        expect(released).toHaveBeenCalledTimes(1);

        doubles.paste = makePasteIntoIngredients({ sessionKey: 'job-1', lines: [READING] });
        view.rerender();
        view.unmount();
        expect(released).toHaveBeenCalledTimes(1);
    });
});

/**
 * Every way a paste ends, and what `pending` (Publish waits) and `reading` (Ingredients says "Reading…") then read. The
 * lines are the REAL projection (`pastedLinesOf`, `readerLinesOf`); the Mediator joins every line that settled (its own
 * suite proves that), so a settled line is joined here. A path that leaves either flag true would leave Ingredients on
 * "Reading…" for good (designer condition 3).
 */
describe('useIngredientsPaste — every end of a paste clears pending and reading', () => {
    const NOW = Date.parse('2026-10-09T10:05:00.000Z');
    const pendingLine = (lineIndex: number) =>
        makeParseJobLine({ lineIndex, sourceLine: `${String(lineIndex)} cup rice` });
    const parsedLine = (lineIndex: number) =>
        makeParseJobLine({
            lineIndex,
            status: 'parsed',
            proposal: makeParseProposal({ foods: [makeParseProposalFood({ name: 'rice' })] }),
        });

    /** A paste over `lines`, with every settled line joined, as the Mediator does. */
    const pasteOf = (lines: readonly PastedLine[], over: Partial<PasteIntoIngredients> = {}) =>
        makePasteIntoIngredients({
            sessionKey: 'job-1',
            lines,
            joined: new Set(lines.filter((line) => line.kind === 'settled').map((line) => line.lineIndex)),
            ...over,
        });

    const flagsOf = (paste: PasteIntoIngredients) => {
        const { result } = render(paste, 0);

        return {
            pending: result.current.pending,
            reading: result.current.reading,
            needYou: result.current.needYou,
        };
    };

    const projected = (job = makeParseJob(), over: { jobFailed?: boolean; now?: number } = {}) =>
        pastedLinesOf({ job, jobFailed: over.jobFailed ?? false, now: over.now ?? NOW, typedByCook: new Set() });

    it.each([
        [
            'every line parsed (success)',
            () => pasteOf(projected(makeParseJob({ lines: [parsedLine(0), parsedLine(1)] }))),
        ],
        ['the create failed for a reason that is not the limit', () => makePasteIntoIngredients({ failed: true })],
        [
            'the job is gone or refused (a terminal read failure)',
            () => pasteOf(projected(makeParseJob({ lines: [pendingLine(0), pendingLine(1)] }), { jobFailed: true })),
        ],
        [
            'the service says the job expired',
            () => pasteOf(projected(makeParseJob({ status: 'expired', lines: [pendingLine(0), pendingLine(1)] }))),
        ],
        [
            'the job passes its deadline on the clock',
            () =>
                pasteOf(
                    projected(makeParseJob({ lines: [pendingLine(0)] }), {
                        now: Date.parse('2026-10-10T10:00:01.000Z'),
                    }),
                ),
        ],
        [
            'the daily limit refused the paste (every line lands as written)',
            () => pasteOf(readerLinesOf(['2 cups flour', '1 tsp salt'])),
        ],
        [
            'the spend ceiling denied the model (the line keeps the engine answer, or none)',
            () =>
                pasteOf(
                    projected(
                        makeParseJob({
                            lines: [
                                makeParseJobLine({ lineIndex: 0, status: 'parsed', proposal: null }),
                                makeParseJobLine({ lineIndex: 1, status: 'unparseable' }),
                            ],
                        }),
                    ),
                ),
        ],
        [
            'the cook withdrew a line (Add as written)',
            () => pasteOf(projected(makeParseJob({ lines: [makeParseJobLine({ status: 'withdrawn' })] }))),
        ],
    ])('%s', (_path, paste) => {
        expect(flagsOf(paste())).toEqual({ pending: false, reading: false, needYou: 0 });
    });

    it('a closed sheet cancels nothing it does not hold: after a refused create, closing the sheet leaves both false', () => {
        const { result } = render({ failed: true }, 0);

        act(() => result.current.sheet.setOpen(true));
        act(() => result.current.sheet.setOpen(false));

        expect({ pending: result.current.pending, reading: result.current.reading }).toEqual({
            pending: false,
            reading: false,
        });
        expect(result.current.needYou).toBe(0);
    });

    it('unmounting releases the hold and the flags are not read again', () => {
        const hold = createPasteHold();
        const view = render({ lines: [READING] }, 0, false, hold);

        expect(hold.get()).toBe(true);
        view.unmount();
        expect(hold.get()).toBe(false);
    });

    it('a line that FAILED and waits on the cook still holds Publish, but is no longer "Reading…"', () => {
        const retryable = projected(
            makeParseJob({ lines: [makeParseJobLine({ lineIndex: 0, status: 'failed_retryable', progress: null })] }),
        );
        const flags = flagsOf(pasteOf(retryable));

        expect(retryable[0]?.kind).toBe('awaitingCook');
        expect(flags).toEqual({ pending: true, reading: false, needYou: 1 });
    });

    it('a failed lookup waits on the cook too: not "Reading…"', () => {
        const settled = projected(makeParseJob({ lines: [parsedLine(0)] }));

        expect(flagsOf(makePasteIntoIngredients({ sessionKey: 'job-1', lines: settled, failedAt: 0 }))).toEqual({
            pending: true,
            reading: false,
            needYou: 1,
        });
    });

    it('one line failed while another is still read: still "Reading…"', () => {
        const mixed = projected(
            makeParseJob({
                lines: [makeParseJobLine({ lineIndex: 0, status: 'failed_retryable', progress: null }), pendingLine(1)],
            }),
        );

        expect(flagsOf(pasteOf(mixed))).toEqual({ pending: true, reading: true, needYou: 0 });
    });

    it('a stalled line, and work parked for a connection, are not failures: still "Reading…"', () => {
        const stalled = projected(
            makeParseJob({ lines: [makeParseJobLine({ lineIndex: 0, progress: { phase: 'stalled' } })] }),
        );

        expect(flagsOf(pasteOf(stalled)).reading).toBe(true);
        expect(flagsOf(pasteOf(projected(), { pollPaused: true })).reading).toBe(true);
    });

    it('the paste being sent is "Reading…", and so is a pick being sent or a line joining', () => {
        expect(flagsOf(makePasteIntoIngredients({ submitting: true })).reading).toBe(true);
        expect(render({}, 0, false, createPasteHold(), { joining: true }).result.current.reading).toBe(true);
    });
});
