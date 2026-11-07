/**
 * Unit tests for `matchLine.ts`, the ONE line model both ingredient-matching flows (paste in the editor, bulk import)
 * read (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25). The cases were
 * ported from the import builder's `importLine.test.ts` (open lines, the next open line, nothing to fix, the option id
 * round trip) when the two builds were reconciled, and rewritten onto the explicit `binding`: a line is open only when
 * its state needs a pick AND nothing is bound, whoever bound it. New cases pin what the reconciliation adds:
 *
 * - A default bound by the server (bulk "Save lines as written") is NOT open, and is not the cook's choice.
 * - The counts every summary and progress line states come from the same predicates: "to choose" is default,
 *   needsChoice and noMatch with nothing bound; a checking line is counted on its own.
 * - Where focus goes after a pick: the next open line, or "done" when none is left; a line whose pick is still being
 *   sent is never the next line (M1).
 */
import { describe, expect, it } from 'vitest';

import {
    cookPicked,
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNeedsChoiceLine,
    makeNoMatchLine,
    makeOptionsFailedLine,
    MILKS,
} from '../__fixtures__/matchLines.js';
import {
    candidatesOf,
    isNothingToFix,
    isOpenLine,
    lineTextOf,
    matchCountsOf,
    nextOpenLineKey,
    optionIdOf,
    pickFocusOf,
    type MatchLine,
} from '../matchLine.js';

const WHOLE = MILKS[1] ?? MILKS[0];

/** The board's lemon drizzle cake, one line per state, in recipe order. */
const lines: readonly MatchLine[] = [
    makeConfidentLine({ key: 'butter' }),
    makeDefaultLine({ key: 'flour' }),
    makeCheckingLine({ key: 'lemons' }),
    makeNeedsChoiceLine({ key: 'bread' }),
    makeNoMatchLine({ key: 'syrup' }),
];

describe('lineTextOf', () => {
    it('joins the measure and the words with one space', () => {
        expect(lineTextOf({ measure: '2 cups', words: 'milk' })).toBe('2 cups milk');
    });

    it('a line with no measure is its words alone, with no leading space', () => {
        expect(lineTextOf({ measure: '', words: 'eggs' })).toBe('eggs');
    });
});

describe('isOpenLine', () => {
    it.each([
        ['flour', true],
        ['bread', true],
        ['syrup', true],
        ['butter', false],
        ['lemons', false],
    ])('%s → %s', (key, open) => {
        const line = lines.find((each) => each.key === key);

        expect(line === undefined ? undefined : isOpenLine(line)).toBe(open);
    });

    it('a line the cook picked for is no longer open, whether a food or as written', () => {
        expect(isOpenLine(makeDefaultLine({ binding: cookPicked(WHOLE) }))).toBe(false);
        expect(
            isOpenLine(
                makeNoMatchLine({ binding: { boundBy: 'cook', pick: { kind: 'asWritten' }, reviewNote: undefined } }),
            ),
        ).toBe(false);
    });

    it('⛔ a default the server bound (bulk "Save lines as written") is not open either', () => {
        const bound = makeDefaultLine({
            binding: { boundBy: 'server', pick: { kind: 'food', foodId: 'whole', name: 'Whole milk' } },
        });

        expect(isOpenLine(bound)).toBe(false);
    });

    it('a line whose options failed is not open: it has nothing to expand', () => {
        expect(isOpenLine(makeOptionsFailedLine())).toBe(false);
    });
});

describe('matchCountsOf', () => {
    it('counts to choose, being checked and matched from the same predicates', () => {
        expect(matchCountsOf(lines)).toEqual({ choose: 3, checking: 1, matched: 1 });
    });

    it('a checking line the cook already picked for counts as matched, not as being checked', () => {
        expect(matchCountsOf([makeCheckingLine({ binding: cookPicked(WHOLE) })])).toEqual({
            choose: 0,
            checking: 0,
            matched: 1,
        });
    });

    it('a line kept as written counts as neither to choose nor matched', () => {
        const kept = makeNoMatchLine({ binding: { boundBy: 'server', pick: { kind: 'asWritten' } } });

        expect(matchCountsOf([kept])).toEqual({ choose: 0, checking: 0, matched: 0 });
    });

    it('no lines, no counts', () => {
        expect(matchCountsOf([])).toEqual({ choose: 0, checking: 0, matched: 0 });
    });
});

const NONE_SENDING: ReadonlySet<string> = new Set();

describe('nextOpenLineKey', () => {
    it('is the first open line after the given one', () => {
        expect(nextOpenLineKey(lines, 'flour', NONE_SENDING)).toBe('bread');
        expect(nextOpenLineKey(lines, 'bread', NONE_SENDING)).toBe('syrup');
    });

    // L3: the restart from the top is the rule, not an accident: "choosing a food expands the next open line", and an
    // open line above the one just picked is still the next one the cook has to choose for.
    it('wraps, restarting from the top, to the first open line before it when none follows', () => {
        expect(nextOpenLineKey(lines, 'syrup', NONE_SENDING)).toBe('flour');
    });

    it('is the first open line when no line is given or the key is unknown', () => {
        expect(nextOpenLineKey(lines, undefined, NONE_SENDING)).toBe('flour');
        expect(nextOpenLineKey(lines, 'gone', NONE_SENDING)).toBe('flour');
    });

    it('never answers the given line itself, and is undefined when no line is open', () => {
        const single = lines.filter((line) => line.key === 'flour' || line.key === 'butter');

        expect(nextOpenLineKey(single, 'flour', NONE_SENDING)).toBeUndefined();
        expect(
            nextOpenLineKey(
                lines.filter((line) => !isOpenLine(line)),
                undefined,
                NONE_SENDING,
            ),
        ).toBeUndefined();
    });

    // M1: a line whose pick is still being sent is unbound, so it is still open; it must not be expanded again, or a
    // second pick could be sent for it while the first is in flight.
    it('⛔ skips a line whose pick is still being sent, after it and on the wrap alike', () => {
        expect(nextOpenLineKey(lines, 'flour', new Set(['bread']))).toBe('syrup');
        expect(nextOpenLineKey(lines, 'syrup', new Set(['flour']))).toBe('bread');
        expect(nextOpenLineKey(lines, 'syrup', new Set(['flour', 'bread']))).toBeUndefined();
    });
});

describe('pickFocusOf', () => {
    it('after a pick, focus goes to the next open line', () => {
        const afterPick = lines.map((line) =>
            line.key === 'flour' ? makeDefaultLine({ key: 'flour', binding: cookPicked(WHOLE) }) : line,
        );

        expect(pickFocusOf(afterPick, 'flour', NONE_SENDING)).toEqual({ kind: 'line', key: 'bread' });
    });

    it('when nothing is left open, focus is done (the host sends it to its own destination)', () => {
        const settled = [makeConfidentLine(), makeDefaultLine({ binding: cookPicked(WHOLE) })];

        expect(pickFocusOf(settled, 'milk', NONE_SENDING)).toEqual({ kind: 'done' });
    });

    it('⛔ two picks in flight at once: focus never goes back to a line still being sent', () => {
        // The cook picked flour, then bread, before either answer landed: both are still unbound.
        expect(pickFocusOf(lines, 'bread', new Set(['flour', 'bread']))).toEqual({ kind: 'line', key: 'syrup' });
        expect(pickFocusOf(lines, 'syrup', new Set(['flour', 'bread', 'syrup']))).toEqual({ kind: 'done' });
    });
});

describe('isNothingToFix', () => {
    it('is true when every line arrived matched', () => {
        expect(isNothingToFix([makeConfidentLine(), makeConfidentLine({ key: 'sugar' })])).toBe(true);
    });

    it('stays true when the cook changed a matched line to another food', () => {
        expect(isNothingToFix([makeConfidentLine({ binding: cookPicked(WHOLE) })])).toBe(true);
    });

    it('is false with any open or checking line, and for no lines at all', () => {
        expect(isNothingToFix(lines)).toBe(false);
        expect(isNothingToFix([makeConfidentLine(), makeCheckingLine()])).toBe(false);
        expect(isNothingToFix([])).toBe(false);
    });

    it('⛔ is false once a matched line was kept as written: that line is no longer matched', () => {
        const kept = makeConfidentLine({
            binding: { boundBy: 'cook', pick: { kind: 'asWritten' }, reviewNote: undefined },
        });

        expect(isNothingToFix([kept])).toBe(false);
    });

    it('⛔ a recipe whose open lines the cook has all picked is still not "nothing to fix"', () => {
        expect(isNothingToFix([makeDefaultLine({ binding: cookPicked(WHOLE) })])).toBe(false);
    });
});

describe('optionIdOf', () => {
    it('gives a food pick and the keep pick different ids', () => {
        expect(optionIdOf({ kind: 'food', foodId: 'whole', name: 'Whole milk' })).not.toBe(
            optionIdOf({ kind: 'asWritten' }),
        );
    });

    it('⛔ a food whose id is literally "asWritten" never collides with the keep option', () => {
        expect(optionIdOf({ kind: 'food', foodId: 'asWritten', name: 'Odd food' })).not.toBe(
            optionIdOf({ kind: 'asWritten' }),
        );
    });

    it('two foods differ by their ids, whatever their names', () => {
        expect(optionIdOf({ kind: 'food', foodId: 'a', name: 'Same' })).not.toBe(
            optionIdOf({ kind: 'food', foodId: 'b', name: 'Same' }),
        );
    });
});

describe('candidatesOf', () => {
    it('is the line’s candidates, in the server’s order', () => {
        expect(candidatesOf(makeDefaultLine()).map((food) => food.id)).toEqual(['skim', 'whole', 'oat']);
    });

    it('is none for a line that has no options', () => {
        expect(candidatesOf(makeNoMatchLine())).toEqual([]);
        expect(candidatesOf(makeCheckingLine())).toEqual([]);
        expect(candidatesOf(makeOptionsFailedLine())).toEqual([]);
    });
});
