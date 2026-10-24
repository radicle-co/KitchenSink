/**
 * Unit tests for `rowSecondLine.ts` — what a read row's second line says in each state (build spec §7.5.1's row-state
 * table, owner "Adopted": healthy rows stay quiet).
 *
 * ⛔ A FIXTURE TABLE OVER EVERY `FoodResolutionStatus` and the two unbound rows, so a rule that moves one state's answer
 * fails exactly that state. Two properties are then stated over the whole table: a quiet state never opens anything,
 * and only an attention line is a control.
 */
import { describe, expect, it } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { RowPolicyLine } from '../ingredientRowPolicy.js';
import { rowSecondLineOf, type RowSecondLine } from '../rowSecondLine.js';

const bound = (status: FoodResolutionStatus | undefined): RowPolicyLine => ({
    ingredientId: 'ing_1',
    name: 'Kale',
    isUserEntered: false,
    ...(status === undefined ? {} : { resolutionStatus: status }),
});

interface Case {
    readonly state: string;
    readonly line: RowPolicyLine;
    readonly retrying?: boolean;
    readonly expected: RowSecondLine;
}

const NONE: RowSecondLine = { kind: 'none' };
const LOOKING_UP: RowSecondLine = { kind: 'working', text: 'rowStateLookingUp' };

const CASES: readonly Case[] = [
    { state: 'resolved', line: bound(FoodResolutionStatus.RESOLVED), expected: NONE },
    { state: 'resolved by default (no status read)', line: bound(undefined), expected: NONE },
    { state: 'private food', line: bound(FoodResolutionStatus.RESOLVED_UNAVAILABLE), expected: NONE },
    { state: 'food unreachable (an outage)', line: bound(FoodResolutionStatus.FOOD_UNREACHABLE), expected: NONE },
    { state: 'own wording', line: { ...bound(undefined), isUserEntered: true }, expected: NONE },
    { state: 'pending', line: bound(FoodResolutionStatus.PENDING), expected: LOOKING_UP },
    { state: 'pending verification', line: bound(FoodResolutionStatus.PENDING_VERIFICATION), expected: LOOKING_UP },
    {
        state: 'unresolved',
        line: bound(FoodResolutionStatus.UNRESOLVED),
        expected: { kind: 'attention', text: 'rowStateChooseMatch', opens: 'panel' },
    },
    {
        state: 'ambiguous',
        line: bound(FoodResolutionStatus.AMBIGUOUS),
        expected: { kind: 'attention', text: 'rowStateChooseMatch', opens: 'panel' },
    },
    {
        state: 'needs review',
        line: bound(FoodResolutionStatus.NEEDS_REVIEW),
        expected: { kind: 'attention', text: 'statusNeedsReview', opens: 'panel' },
    },
    {
        state: 'not found',
        line: bound(FoodResolutionStatus.NOT_FOUND),
        expected: { kind: 'attention', text: 'rowStateNoMatch', opens: 'panel' },
    },
    {
        state: 'lookup failed',
        line: bound(FoodResolutionStatus.FAILED),
        expected: { kind: 'attention', text: 'rowStateLookupFailed', opens: 'panel' },
    },
    {
        state: 'lookup failed, Try again running',
        line: bound(FoodResolutionStatus.FAILED),
        retrying: true,
        expected: LOOKING_UP,
    },
    {
        state: 'food removed',
        line: bound(FoodResolutionStatus.FOOD_REMOVED),
        expected: { kind: 'attention', text: 'rowStateFoodRemoved', opens: 'panel' },
    },
    {
        state: 'no food (a restored or pasted line)',
        line: { ingredientId: null, name: 'kale', isUserEntered: false },
        expected: { kind: 'attention', text: 'rowStateNoMatch', opens: 'entry' },
    },
    {
        state: 'no food, empty-string id (the validator refuses it too)',
        line: { ingredientId: '', name: 'kale', isUserEntered: false },
        expected: { kind: 'attention', text: 'rowStateNoMatch', opens: 'entry' },
    },
];

describe('rowSecondLineOf', () => {
    it.each(CASES)('$state', ({ line, retrying = false, expected }) => {
        expect(rowSecondLineOf(line, retrying)).toEqual(expected);
    });

    it('covers every resolution status', () => {
        const covered = new Set(CASES.map((each) => each.line.resolutionStatus).filter((s) => s !== undefined));

        expect([...covered].sort()).toEqual(Object.values(FoodResolutionStatus).sort());
    });

    it('a retry only quiets a FAILED row: every other state reads the same while one runs', () => {
        for (const { line, expected } of CASES.filter((each) => each.retrying !== true)) {
            if (line.resolutionStatus !== FoodResolutionStatus.FAILED) {
                expect(rowSecondLineOf(line, true)).toEqual(expected);
            }
        }
    });
});
