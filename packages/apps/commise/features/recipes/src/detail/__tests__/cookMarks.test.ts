/**
 * The cook-marks reducer and its stored form (blueprint A13, build spec §6.3). A cook's marks on one recipe are the
 * lines they have checked and, separately, the ONE step they are on. The stored form holds only line keys and a step
 * number — never recipe content — so the "no recipe bodies at rest in a browser" ruling holds, and an unreadable stored
 * value reads as no marks rather than as a crash.
 */
import { describe, expect, it } from 'vitest';

import {
    EMPTY_COOK_MARKS,
    applyCookMark,
    cookMarksKey,
    hasCookMarks,
    isCookMarksKeyOf,
    parseCookMarks,
    serializeCookMarks,
    type CookMarks,
} from '../cookMarks.js';
import { tickKeyOf } from '../__fixtures__/tickKeys.js';
import type { IngredientTickKey } from '../../common/ingredientTickKey.js';

const [ING_A, ING_B, ING_SALT, ING_BUTTER, ING_LEMON] = [1, 2, 3, 4, 5].map(tickKeyOf);

const marks = (lines: readonly IngredientTickKey[], currentStep?: number): CookMarks => ({
    lines: new Set(lines),
    currentStep,
});

describe('applyCookMark', () => {
    it('checks an unchecked line and unchecks a checked one', () => {
        const once = applyCookMark(EMPTY_COOK_MARKS, { kind: 'toggleLine', line: ING_A });
        expect([...once.lines]).toEqual([ING_A]);

        const twice = applyCookMark(once, { kind: 'toggleLine', line: ING_A });
        expect([...twice.lines]).toEqual([]);
    });

    it('tells two lines of one digest apart: their ordinals are two keys (mutant: compare by digest)', () => {
        const [first, second] = [tickKeyOf(9, 0), tickKeyOf(9, 1)];
        const both = applyCookMark(marks([second]), { kind: 'toggleLine', line: first });

        expect([...both.lines].sort()).toEqual([first, second]);
        expect([...applyCookMark(marks([first, second]), { kind: 'toggleLine', line: first }).lines]).toEqual([second]);
    });

    it('never mutates the state it was given', () => {
        const before = marks([ING_A]);

        applyCookMark(before, { kind: 'toggleLine', line: ING_B });

        expect([...before.lines]).toEqual([ING_A]);
    });

    it('makes a step current, and a second tap on it clears it', () => {
        const on = applyCookMark(EMPTY_COOK_MARKS, { kind: 'toggleStep', step: 3 });
        expect(on.currentStep).toBe(3);

        const off = applyCookMark(on, { kind: 'toggleStep', step: 3 });
        expect(off.currentStep).toBeUndefined();
    });

    it('keeps ONE current step: a tap on another step moves the marker', () => {
        const third = applyCookMark(EMPTY_COOK_MARKS, { kind: 'toggleStep', step: 3 });

        expect(applyCookMark(third, { kind: 'toggleStep', step: 5 }).currentStep).toBe(5);
    });

    it('a step tap leaves the checked lines alone, and a line tap leaves the step alone', () => {
        const both = applyCookMark(applyCookMark(EMPTY_COOK_MARKS, { kind: 'toggleLine', line: ING_A }), {
            kind: 'toggleStep',
            step: 2,
        });

        expect([...both.lines]).toEqual([ING_A]);
        expect(both.currentStep).toBe(2);
    });

    it('clear drops the checks AND the current step', () => {
        expect(applyCookMark(marks([ING_A, ING_B], 4), { kind: 'clear' })).toBe(EMPTY_COOK_MARKS);
    });
});

describe('hasCookMarks', () => {
    it.each([
        { state: EMPTY_COOK_MARKS, expected: false },
        { state: marks([ING_A]), expected: true },
        { state: marks([], 1), expected: true },
    ])('$expected for lines=$state.lines.size step=$state.currentStep', ({ state, expected }) => {
        expect(hasCookMarks(state)).toBe(expected);
    });
});

describe('the stored form', () => {
    it('round-trips the line keys and the step', () => {
        const state = marks([ING_A, ING_B], 2);

        const read = parseCookMarks(serializeCookMarks(state));

        expect([...read.lines]).toEqual([ING_A, ING_B]);
        expect(read.currentStep).toBe(2);
    });

    it('holds only keys and a number — nothing else of the recipe', () => {
        expect(JSON.parse(serializeCookMarks(marks([ING_A], 2)))).toEqual({ lines: [ING_A], step: 2 });
        expect(JSON.parse(serializeCookMarks(marks([ING_A])))).toEqual({ lines: [ING_A], step: null });
    });

    it('drops a stored binding id and keeps every key, a newer version too (mutant: no filter, or l1 only)', () => {
        const raw = `{"lines":["01JINGREDIENT0000000000000A","${ING_A}","l2:deadbeef#0"],"step":2}`;

        const read = parseCookMarks(raw);

        expect([...read.lines]).toEqual([ING_A, 'l2:deadbeef#0']);
        expect(read.currentStep).toBe(2);
    });

    it("keeps a newer client's key through a toggle and a write, byte for byte", () => {
        const [newer] = parseCookMarks('{"lines":["l2:deadbeef#0"],"step":null}').lines;
        const after = applyCookMark(marks(newer === undefined ? [] : [newer]), { kind: 'toggleLine', line: ING_A });

        expect(JSON.parse(serializeCookMarks(after))).toEqual({ lines: ['l2:deadbeef#0', ING_A], step: null });
    });

    it('tells a tick key from the old binding id at the boundary: an id reads as no tick, not as an error', () => {
        expect(parseCookMarks('{"lines":["01JINGREDIENT0000000000000A"],"step":null}').lines.size).toBe(0);
    });

    it.each([
        null,
        '',
        'not json',
        '{"lines":"ing_a","step":1}',
        '{"lines":[1],"step":1}',
        '{"lines":[],"step":0}',
        '{"lines":[],"step":1.5}',
        '[]',
    ])('reads %j as no marks', (raw) => {
        expect(parseCookMarks(raw)).toBe(EMPTY_COOK_MARKS);
    });
});

describe('keys', () => {
    it('namespaces by version, cook and recipe', () => {
        expect(cookMarksKey('user_1', 'rec_9')).toBe('cook.v1.user_1.rec_9');
    });

    it("leaves the kept record's namespace alone: a `cook.v2.` key is not cook marks (N3)", () => {
        expect(isCookMarksKeyOf('cook.v2.user_1.rec_9')).toBe(false);
        expect(isCookMarksKeyOf('cook.v2.user_1')).toBe(false);
    });

    it('tells one cook’s keys from another’s, even when one id prefixes the other', () => {
        expect(isCookMarksKeyOf('cook.v1.user_1.rec_9', 'user_1')).toBe(true);
        expect(isCookMarksKeyOf('cook.v1.user_10.rec_9', 'user_1')).toBe(false);
        expect(isCookMarksKeyOf('editor.draft.v1.user_1', 'user_1')).toBe(false);
    });
});

describe("applyCookMark — clearIngredientTicks (cooking mode's Clear ticks)", () => {
    it('removes every ingredient tick and keeps the current-step marker', () => {
        const after = applyCookMark(marks([ING_A, ING_B], 3), { kind: 'clearIngredientTicks' });

        expect([...after.lines]).toEqual([]);
        expect(after.currentStep).toBe(3);
    });

    it("is not `clear`: the recipe page's Clear checks still drops the marker too", () => {
        expect(applyCookMark(marks([ING_A], 3), { kind: 'clear' })).toBe(EMPTY_COOK_MARKS);
    });

    it('returns the very same state when no ingredient is ticked, so the store writes nothing', () => {
        const state = marks([], 3);

        expect(applyCookMark(state, { kind: 'clearIngredientTicks' })).toBe(state);
    });

    it('never mutates the state it was given', () => {
        const before = marks([ING_A], 2);

        applyCookMark(before, { kind: 'clearIngredientTicks' });

        expect([...before.lines]).toEqual([ING_A]);
    });
});

describe('applyCookMark — restoreIngredientTicks (Undo of Clear ticks)', () => {
    it('adds the cleared keys back and removes none: a union with the ticks made since', () => {
        const after = applyCookMark(marks([ING_SALT], 2), {
            kind: 'restoreIngredientTicks',
            lines: [ING_BUTTER, ING_LEMON],
        });

        expect([...after.lines].sort()).toEqual([ING_BUTTER, ING_LEMON, ING_SALT].sort());
        expect(after.currentStep).toBe(2);
    });

    it('restores a key that is already ticked once, not twice', () => {
        const after = applyCookMark(marks([ING_A]), { kind: 'restoreIngredientTicks', lines: [ING_A, ING_B] });

        expect([...after.lines].sort()).toEqual([ING_A, ING_B]);
    });

    it('returns the very same state when there is nothing new to add', () => {
        const state = marks([ING_A, ING_B]);

        expect(applyCookMark(state, { kind: 'restoreIngredientTicks', lines: [ING_A] })).toBe(state);
        expect(applyCookMark(state, { kind: 'restoreIngredientTicks', lines: [] })).toBe(state);
    });

    it('never mutates the state it was given', () => {
        const before = marks([ING_A]);

        applyCookMark(before, { kind: 'restoreIngredientTicks', lines: [ING_B] });

        expect([...before.lines]).toEqual([ING_A]);
    });
});
