/**
 * Unit tests for the entry's pure half (`../ingredientEntry.model.ts`): text per target, the rows in Change food, which
 * target is active, and what counts as PENDING text (§4b, and the "Rulings after B6a" R4: unchanged text never is). The
 * live search's view went with the live search (plan 002 S7.9).
 */
import { describe, expect, it } from 'vitest';

import { mintedLineKey, seedLineKey } from '../../form/lineKey.js';
import {
    EMPTY_ENTRY,
    activeTargetOf,
    commitTargetOf,
    isPendingAt,
    changingOf,
    entryTextOf,
    pendingEntryOf,
    placementOf,
    searchTextOf,
    withActiveTarget,
    withChangeBegun,
    withEntryAbandoned,
    withEntryCommitted,
    withEntryLeft,
    withEntryText,
    withPlacement,
    type EntryLine,
} from '../ingredientEntry.model.js';
import type { LineCommitTarget } from '../lineCommit.js';

const OIL: EntryLine = { key: seedLineKey(3, 0), name: 'Olive oil' };
const CHICK: EntryLine = { key: seedLineKey(3, 1), name: 'chick' };
const NAMELESS: EntryLine = { key: mintedLineKey('nameless') };
const LINES = [OIL, CHICK, NAMELESS];

const at = (line: EntryLine): LineCommitTarget => ({ kind: 'line', key: line.key });
const TRAILING: LineCommitTarget = { kind: 'newLine' };

describe('the text in each field', () => {
    it('a field nobody typed in shows what its line holds; the trailing row shows nothing', () => {
        expect(entryTextOf(EMPTY_ENTRY, at(CHICK), LINES)).toBe('chick');
        expect(entryTextOf(EMPTY_ENTRY, at(NAMELESS), LINES)).toBe('');
        expect(entryTextOf(EMPTY_ENTRY, TRAILING, LINES)).toBe('');
    });

    it('each target keeps its own text', () => {
        const state = withEntryText(
            withEntryText(EMPTY_ENTRY, TRAILING, 'flour', LINES),
            at(CHICK),
            'chickpeas',
            LINES,
        );

        expect(entryTextOf(state, TRAILING, LINES)).toBe('flour');
        expect(entryTextOf(state, at(CHICK), LINES)).toBe('chickpeas');
        expect(entryTextOf(state, at(OIL), LINES)).toBe('Olive oil');
    });

    it('typing makes the field the active target', () => {
        expect(withEntryText(EMPTY_ENTRY, at(CHICK), 'chickp', LINES).active).toEqual(at(CHICK));
    });
});

describe('the active target', () => {
    it('is the one focused last', () => {
        expect(activeTargetOf(withActiveTarget(EMPTY_ENTRY, at(OIL)), LINES)).toEqual(at(OIL));
        expect(activeTargetOf(withActiveTarget(EMPTY_ENTRY, TRAILING), [])).toEqual(TRAILING);
    });

    it('is none once its row is gone', () => {
        expect(activeTargetOf(withActiveTarget(EMPTY_ENTRY, at(OIL)), [CHICK])).toBeUndefined();
    });
});

describe('pending text (§4b)', () => {
    it('is text that differs from what the field started with', () => {
        expect(pendingEntryOf(withEntryText(EMPTY_ENTRY, TRAILING, 'flour', LINES), LINES)).toEqual({
            target: TRAILING,
            text: 'flour',
        });
        expect(pendingEntryOf(withEntryText(EMPTY_ENTRY, at(CHICK), 'chickpeas', LINES), LINES)).toEqual({
            target: at(CHICK),
            text: 'chickpeas',
        });
    });

    it.each([
        { case: 'whitespace', state: withEntryText(EMPTY_ENTRY, TRAILING, '   ', LINES) },
        { case: 'a line’s own name, untouched', state: withEntryText(EMPTY_ENTRY, at(CHICK), 'chick', LINES) },
        { case: 'a line’s own name, padded', state: withEntryText(EMPTY_ENTRY, at(CHICK), ' chick ', LINES) },
        { case: 'Change food, before a keystroke (R4)', state: withChangeBegun(EMPTY_ENTRY, OIL) },
        {
            case: 'text on a row that is gone',
            state: withEntryText(EMPTY_ENTRY, { kind: 'line', key: mintedLineKey('removed') }, 'kale', LINES),
        },
    ])('is not $case', ({ state }) => {
        expect(pendingEntryOf(state, LINES)).toBeUndefined();
    });

    it('names the first pending row in the list, and the trailing row only after every row', () => {
        const state = [
            (s: typeof EMPTY_ENTRY) => withEntryText(s, TRAILING, 'flour', LINES),
            (s: typeof EMPTY_ENTRY) => withEntryText(s, at(NAMELESS), 'kale', LINES),
            (s: typeof EMPTY_ENTRY) => withEntryText(s, at(CHICK), 'chickpeas', LINES),
        ].reduce((current, step) => step(current), EMPTY_ENTRY);

        expect(pendingEntryOf(state, LINES)).toEqual({ target: at(CHICK), text: 'chickpeas' });
    });
});

describe('isPendingAt', () => {
    it('is each field’s own pending state; a field whose row is gone holds none', () => {
        const state = withEntryText(
            withEntryText(EMPTY_ENTRY, at(CHICK), 'chickpeas', LINES),
            { kind: 'line', key: mintedLineKey('removed') },
            'kale',
            LINES,
        );

        expect(isPendingAt(state, at(CHICK), LINES)).toBe(true);
        expect(isPendingAt(state, at(OIL), LINES)).toBe(false);
        expect(isPendingAt(state, { kind: 'line', key: mintedLineKey('removed') }, LINES)).toBe(false);
    });
});

describe('Change food (item 4)', () => {
    it('puts the row in entry mode, the field on its current name, and the row active', () => {
        const state = withChangeBegun(EMPTY_ENTRY, OIL);

        expect(changingOf(state, LINES)).toEqual(new Set([OIL.key]));
        expect(entryTextOf(state, at(OIL), LINES)).toBe('Olive oil');
        expect(state.active).toEqual(at(OIL));
    });

    it('ends when the cook leaves with nothing new typed, and stays when they leave with new text', () => {
        const begun = withChangeBegun(EMPTY_ENTRY, OIL);

        expect(changingOf(withEntryLeft(begun, at(OIL)), LINES).size).toBe(0);

        const typed = withEntryText(begun, at(OIL), 'canola oil', LINES);
        expect(changingOf(withEntryLeft(typed, at(OIL)), LINES)).toEqual(new Set([OIL.key]));
        expect(entryTextOf(withEntryLeft(typed, at(OIL)), at(OIL), LINES)).toBe('canola oil');
    });

    it('Cancel ends it and puts back what the line holds', () => {
        const state = withEntryAbandoned(
            withEntryText(withChangeBegun(EMPTY_ENTRY, OIL), at(OIL), 'canola', LINES),
            at(OIL),
        );

        expect(changingOf(state, LINES).size).toBe(0);
        expect(entryTextOf(state, at(OIL), LINES)).toBe('Olive oil');
    });

    it('a commit ends it and empties the trailing row', () => {
        const state = withEntryText(
            withEntryText(withChangeBegun(EMPTY_ENTRY, OIL), at(OIL), 'canola', LINES),
            TRAILING,
            'flour',
            LINES,
        );

        const committed = withEntryCommitted(withEntryCommitted(state, at(OIL), 'canola'), TRAILING, 'flour');

        expect(changingOf(committed, LINES).size).toBe(0);
        expect(entryTextOf(committed, TRAILING, LINES)).toBe('');
        expect(pendingEntryOf(committed, LINES)).toBeUndefined();
    });

    it('a commit keeps what the cook typed on while it ran', () => {
        const state = withEntryText(EMPTY_ENTRY, TRAILING, 'flour, bread', LINES);

        expect(entryTextOf(withEntryCommitted(state, TRAILING, 'flour'), TRAILING, LINES)).toBe('flour, bread');
    });

    it('a row that is gone is not in Change food', () => {
        expect(changingOf(withChangeBegun(EMPTY_ENTRY, OIL), [CHICK]).size).toBe(0);
    });
});

/**
 * §7.5.5: the trailing field sits in one group at a time, and an appended line joins it. The placement is the FIELD's
 * state, like its text: it survives a commit (the cook keeps adding to the same group) and never reaches a row's target.
 */
describe('the unit a pick commits (§7.5.3)', () => {
    it('is the unit as the cook typed it, never normalizeUnit\u2019s spelling', () => {
        expect(commitTargetOf(TRAILING, '2 tbsp olive oil', undefined)).toMatchObject({
            measure: { unit: 'tbsp', preparation: '' },
        });
        expect(commitTargetOf(TRAILING, '1 handful parsley, diced', undefined)).toMatchObject({
            measure: { unit: 'handful', preparation: 'diced' },
        });
    });

    it('commits a size word as the unit and searches the food alone ("1 large onion")', () => {
        expect(commitTargetOf(TRAILING, '1 large onion', undefined)).toMatchObject({
            measure: { quantity: { kind: 'exact', value: 1 }, unit: 'large', preparation: '' },
        });
        expect(searchTextOf(TRAILING, '1 large onion')).toBe('onion');
    });

    it('commits no unit when the cook typed none', () => {
        expect(commitTargetOf(TRAILING, '3 eggs', undefined)).toMatchObject({ measure: { unit: '' } });
    });
});

describe('the trailing field\u2019s group (§7.5.5)', () => {
    const SAUCE_LINES: readonly EntryLine[] = [{ ...OIL, groupLabel: 'Sauce' }];

    it('starts with no placement: the field follows the group being built', () => {
        expect(EMPTY_ENTRY.placement).toBeUndefined();
        expect(commitTargetOf(TRAILING, 'flour', EMPTY_ENTRY.placement)).toEqual({ kind: 'newLine' });
    });

    it('a placed field commits into its group, with or without a measure', () => {
        const state = withPlacement(EMPTY_ENTRY, { group: 'Sauce', madeByCook: false });

        expect(commitTargetOf(TRAILING, 'garlic', placementOf(state, SAUCE_LINES))).toEqual({
            kind: 'newLine',
            placement: { group: 'Sauce' },
        });
        expect(commitTargetOf(TRAILING, '2 tbsp oil', placementOf(state, SAUCE_LINES))).toMatchObject({
            kind: 'newLine',
            placement: { group: 'Sauce' },
            // Rewritten for spec §7.5.3 (D20/D21 batch): the committed unit is the cook's own word, not `normalizeUnit`'s.
            measure: { unit: 'tbsp' },
        });
    });

    it('a row\u2019s own target never carries a placement', () => {
        expect(commitTargetOf(at(CHICK), 'chickpeas', { group: 'Sauce' })).toEqual(at(CHICK));
    });

    it('survives a commit, so the cook keeps adding to the same group', () => {
        const placed = withPlacement(withEntryText(EMPTY_ENTRY, TRAILING, 'garlic', LINES), {
            group: 'Sauce',
            madeByCook: false,
        });

        expect(withEntryCommitted(placed, TRAILING, 'garlic').placement).toEqual({ group: 'Sauce', madeByCook: false });
    });

    /**
     * 2026-10-09 review, Medium 3: the field's label came from a validated group while a pick committed the raw one, so
     * once a group's last line moved out the field read "Add to Wet" and the line landed in a recreated "Dry". Where
     * the field adds is ONE derivation, which the label and every commit read.
     */
    it.each([
        { why: 'no placement follows the group being built', placed: undefined, lines: [OIL], answer: undefined },
        {
            why: 'a group a line is in holds the field',
            placed: { group: 'Dry', madeByCook: false },
            lines: [{ ...OIL, groupLabel: 'Dry' }],
            answer: { group: 'Dry' },
        },
        {
            why: 'a group whose last line left lets go of the field',
            placed: { group: 'Dry', madeByCook: false },
            lines: [{ ...OIL, groupLabel: 'Wet' }],
            answer: undefined,
        },
        {
            why: 'a group the cook made holds the field before any line is in it',
            placed: { group: 'Herbs', madeByCook: true },
            lines: [{ ...OIL, groupLabel: 'Wet' }],
            answer: { group: 'Herbs' },
        },
        {
            why: 'a blank label is no group',
            placed: { group: 'Dry', madeByCook: false },
            lines: [{ ...OIL, groupLabel: ' Dry ' }],
            answer: { group: 'Dry' },
        },
        {
            why: 'No group holds the field while an ungrouped line exists',
            placed: { group: undefined, madeByCook: false },
            lines: [OIL, { ...CHICK, groupLabel: 'Wet' }],
            answer: { group: undefined },
        },
        {
            why: 'No group lets go of the field once every line is grouped',
            placed: { group: undefined, madeByCook: false },
            lines: [{ ...CHICK, groupLabel: 'Wet' }],
            answer: undefined,
        },
    ])('placementOf: $why', ({ placed, lines, answer }) => {
        expect(placementOf(withPlacement(EMPTY_ENTRY, placed), lines)).toEqual(answer);
    });

    it('can be cleared back to following the group being built', () => {
        expect(
            withPlacement(withPlacement(EMPTY_ENTRY, { group: 'Sauce', madeByCook: false }), undefined).placement,
        ).toBeUndefined();
    });
});
