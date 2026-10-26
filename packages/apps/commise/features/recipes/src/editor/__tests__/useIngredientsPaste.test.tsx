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
import type { PastedLine } from '../pastedLines.js';
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
            added: { count: 3, occurrence: 2 },
        });
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
