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

const marks = (lines: readonly string[], currentStep?: number): CookMarks => ({
    lines: new Set(lines),
    currentStep,
});

describe('applyCookMark', () => {
    it('checks an unchecked line and unchecks a checked one', () => {
        const once = applyCookMark(EMPTY_COOK_MARKS, { kind: 'toggleLine', line: 'ing_a' });
        expect([...once.lines]).toEqual(['ing_a']);

        const twice = applyCookMark(once, { kind: 'toggleLine', line: 'ing_a' });
        expect([...twice.lines]).toEqual([]);
    });

    it('never mutates the state it was given', () => {
        const before = marks(['ing_a']);

        applyCookMark(before, { kind: 'toggleLine', line: 'ing_b' });

        expect([...before.lines]).toEqual(['ing_a']);
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
        const both = applyCookMark(applyCookMark(EMPTY_COOK_MARKS, { kind: 'toggleLine', line: 'ing_a' }), {
            kind: 'toggleStep',
            step: 2,
        });

        expect([...both.lines]).toEqual(['ing_a']);
        expect(both.currentStep).toBe(2);
    });

    it('clear drops the checks AND the current step', () => {
        expect(applyCookMark(marks(['ing_a', 'ing_b'], 4), { kind: 'clear' })).toBe(EMPTY_COOK_MARKS);
    });
});

describe('hasCookMarks', () => {
    it.each([
        { state: EMPTY_COOK_MARKS, expected: false },
        { state: marks(['ing_a']), expected: true },
        { state: marks([], 1), expected: true },
    ])('$expected for lines=$state.lines.size step=$state.currentStep', ({ state, expected }) => {
        expect(hasCookMarks(state)).toBe(expected);
    });
});

describe('the stored form', () => {
    it('round-trips the line keys and the step', () => {
        const state = marks(['ing_a', 'ing_b'], 2);

        const read = parseCookMarks(serializeCookMarks(state));

        expect([...read.lines]).toEqual(['ing_a', 'ing_b']);
        expect(read.currentStep).toBe(2);
    });

    it('holds only keys and a number — nothing else of the recipe', () => {
        expect(JSON.parse(serializeCookMarks(marks(['ing_a'], 2)))).toEqual({ lines: ['ing_a'], step: 2 });
        expect(JSON.parse(serializeCookMarks(marks(['ing_a'])))).toEqual({ lines: ['ing_a'], step: null });
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

    it('tells one cook’s keys from another’s, even when one id prefixes the other', () => {
        expect(isCookMarksKeyOf('cook.v1.user_1.rec_9', 'user_1')).toBe(true);
        expect(isCookMarksKeyOf('cook.v1.user_10.rec_9', 'user_1')).toBe(false);
        expect(isCookMarksKeyOf('editor.draft.v1.user_1', 'user_1')).toBe(false);
    });
});

describe("applyCookMark — clearIngredientTicks (cooking mode's Clear ticks)", () => {
    it('removes every ingredient tick and keeps the current-step marker', () => {
        const after = applyCookMark(marks(['ing_a', 'ing_b'], 3), { kind: 'clearIngredientTicks' });

        expect([...after.lines]).toEqual([]);
        expect(after.currentStep).toBe(3);
    });

    it("is not `clear`: the recipe page's Clear checks still drops the marker too", () => {
        expect(applyCookMark(marks(['ing_a'], 3), { kind: 'clear' })).toBe(EMPTY_COOK_MARKS);
    });

    it('returns the very same state when no ingredient is ticked, so the store writes nothing', () => {
        const state = marks([], 3);

        expect(applyCookMark(state, { kind: 'clearIngredientTicks' })).toBe(state);
    });

    it('never mutates the state it was given', () => {
        const before = marks(['ing_a'], 2);

        applyCookMark(before, { kind: 'clearIngredientTicks' });

        expect([...before.lines]).toEqual(['ing_a']);
    });
});

describe('applyCookMark — restoreIngredientTicks (Undo of Clear ticks)', () => {
    it('adds the cleared keys back and removes none: a union with the ticks made since', () => {
        const after = applyCookMark(marks(['ing_salt'], 2), {
            kind: 'restoreIngredientTicks',
            lines: ['ing_butter', 'ing_lemon'],
        });

        expect([...after.lines].sort()).toEqual(['ing_butter', 'ing_lemon', 'ing_salt']);
        expect(after.currentStep).toBe(2);
    });

    it('restores a key that is already ticked once, not twice', () => {
        const after = applyCookMark(marks(['ing_a']), { kind: 'restoreIngredientTicks', lines: ['ing_a', 'ing_b'] });

        expect([...after.lines].sort()).toEqual(['ing_a', 'ing_b']);
    });

    it('returns the very same state when there is nothing new to add', () => {
        const state = marks(['ing_a', 'ing_b']);

        expect(applyCookMark(state, { kind: 'restoreIngredientTicks', lines: ['ing_a'] })).toBe(state);
        expect(applyCookMark(state, { kind: 'restoreIngredientTicks', lines: [] })).toBe(state);
    });

    it('never mutates the state it was given', () => {
        const before = marks(['ing_a']);

        applyCookMark(before, { kind: 'restoreIngredientTicks', lines: ['ing_b'] });

        expect([...before.lines]).toEqual(['ing_a']);
    });
});
