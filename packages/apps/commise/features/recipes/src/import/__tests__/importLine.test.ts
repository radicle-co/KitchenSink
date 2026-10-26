/**
 * Unit tests for the import line policy (`importLine.ts`): which lines still need the cook (only default, needsChoice
 * and noMatch with no pick — a checking line resolves first, a confident line is bound), which open line comes next
 * after a choice, and the option list a line offers — its candidates in the server's order, the default tagged and
 * never chosen, "Keep … as written" last — with the round trip from a picked row back to the pick.
 */
import { describe, expect, it } from 'vitest';

import {
    isNothingToFix,
    isOpenLine,
    lineOptionsOf,
    nextOpenLineKey,
    openLineCount,
    optionValueOf,
    pickOfOptionValue,
    type ImportCandidate,
    type ImportLine,
} from '../importLine.js';
import { importMessages } from '../messages.js';
import { makeConfidentLine } from '../__fixtures__/importLines.js';

const m = importMessages.en.line;

const FLOUR: readonly ImportCandidate[] = [
    { id: 'f-ap', name: 'All-purpose flour', isDefault: true },
    { id: 'f-sr', name: 'Self-raising flour', isDefault: false },
    { id: 'f-cake', name: 'Cake flour', isDefault: false },
];

const lines: readonly ImportLine[] = [
    { key: 'butter', text: '225 g butter, softened', state: 'confident', food: 'Butter, unsalted', candidates: [] },
    { key: 'flour', text: '275 g flour', state: 'default', noun: 'flour', candidates: FLOUR },
    { key: 'lemons', text: '2 lemons, zest only', state: 'checking', proposal: 'Lemon peel, raw' },
    { key: 'bread', text: '6 slices bread', state: 'needsChoice', candidates: FLOUR },
    { key: 'syrup', text: '4 tbsp drizzle syrup', state: 'noMatch' },
];

describe('isOpenLine', () => {
    it.each([
        ['flour', true],
        ['bread', true],
        ['syrup', true],
        ['butter', false],
        ['lemons', false],
    ])('%s → %s', (key, open) => {
        expect(isOpenLine(lines.find((line) => line.key === key) as ImportLine)).toBe(open);
    });

    it('a line the cook picked for is no longer open, whether a food or as written', () => {
        expect(
            isOpenLine({
                key: 'flour',
                text: '275 g flour',
                state: 'default',
                noun: 'flour',
                candidates: FLOUR,
                choice: { pick: { kind: 'food', foodId: 'f-sr', name: 'Self-raising flour' } },
            }),
        ).toBe(false);
        expect(isOpenLine({ key: 'syrup', text: 'x', state: 'noMatch', choice: { pick: { kind: 'asWritten' } } })).toBe(
            false,
        );
    });
});

describe('openLineCount', () => {
    it('counts only the lines that need a pick', () => {
        expect(openLineCount(lines)).toBe(3);
        expect(openLineCount([])).toBe(0);
    });
});

describe('nextOpenLineKey', () => {
    it('is the first open line after the given one', () => {
        expect(nextOpenLineKey(lines, 'flour')).toBe('bread');
        expect(nextOpenLineKey(lines, 'bread')).toBe('syrup');
    });

    it('wraps to the first open line before it when none follows', () => {
        expect(nextOpenLineKey(lines, 'syrup')).toBe('flour');
    });

    it('is the first open line when no line is given or the key is unknown', () => {
        expect(nextOpenLineKey(lines, undefined)).toBe('flour');
        expect(nextOpenLineKey(lines, 'gone')).toBe('flour');
    });

    it('never answers the given line itself, and is undefined when no line is open', () => {
        const single = lines.filter((line) => line.key === 'flour' || line.key === 'butter');

        expect(nextOpenLineKey(single, 'flour')).toBeUndefined();
        expect(
            nextOpenLineKey(
                lines.filter((line) => !isOpenLine(line)),
                undefined,
            ),
        ).toBeUndefined();
    });
});

describe('lineOptionsOf', () => {
    it('lists the candidates in the given order, tags only the default, and ends with Keep … as written', () => {
        expect(lineOptionsOf('275 g flour', FLOUR, m)).toEqual([
            { id: 'food:f-ap', label: 'All-purpose flour', tag: 'Default' },
            { id: 'food:f-sr', label: 'Self-raising flour' },
            { id: 'food:f-cake', label: 'Cake flour' },
            { id: 'asWritten', label: 'Keep “275 g flour” as written', hint: 'No nutrition for this line' },
        ]);
    });

    it('⛔ does not move a default to the top: the server orders the list and the client renders it', () => {
        const reordered = [FLOUR[1], FLOUR[0]] as readonly ImportCandidate[];

        expect(lineOptionsOf('275 g flour', reordered, m).map((option) => option.id)).toEqual([
            'food:f-sr',
            'food:f-ap',
            'asWritten',
        ]);
    });

    it('a line with no candidates offers only Keep … as written', () => {
        expect(lineOptionsOf('4 tbsp drizzle syrup', [], m).map((option) => option.id)).toEqual(['asWritten']);
    });
});

describe('optionValueOf / pickOfOptionValue', () => {
    it('round-trips a food pick and the as-written pick', () => {
        expect(pickOfOptionValue(optionValueOf({ kind: 'food', foodId: 'f-sr', name: 'x' }) ?? '', FLOUR)).toEqual({
            kind: 'food',
            foodId: 'f-sr',
            name: 'Self-raising flour',
        });
        expect(pickOfOptionValue(optionValueOf({ kind: 'asWritten' }) ?? '', FLOUR)).toEqual({ kind: 'asWritten' });
    });

    it('answers undefined for no pick, and for a value naming no candidate', () => {
        expect(optionValueOf(undefined)).toBeUndefined();
        expect(pickOfOptionValue('food:missing', FLOUR)).toBeUndefined();
        expect(pickOfOptionValue('nonsense', FLOUR)).toBeUndefined();
    });

    it('⛔ a candidate whose id is literally "asWritten" stays a food, never the keep option', () => {
        const odd: readonly ImportCandidate[] = [{ id: 'asWritten', name: 'Odd food', isDefault: false }];

        const [first] = lineOptionsOf('x', odd, m);

        expect(pickOfOptionValue(first?.id ?? '', odd)).toEqual({
            kind: 'food',
            foodId: 'asWritten',
            name: 'Odd food',
        });
    });
});

describe('isNothingToFix', () => {
    const butter = makeConfidentLine();

    it('is true when every line arrived matched', () => {
        expect(
            isNothingToFix([butter, { ...butter, key: 'sugar', text: '225 g caster sugar', food: 'Caster sugar' }]),
        ).toBe(true);
    });

    it('is false with any open or checking line, and for no lines at all', () => {
        expect(isNothingToFix(lines)).toBe(false);
        expect(isNothingToFix([butter, lines[2] as ImportLine])).toBe(false);
        expect(isNothingToFix([])).toBe(false);
    });

    it('⛔ is false once a matched line was kept as written: that line is no longer matched', () => {
        expect(isNothingToFix([makeConfidentLine({ choice: { pick: { kind: 'asWritten' } } })])).toBe(false);
    });
});
