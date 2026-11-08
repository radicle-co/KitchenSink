/**
 * The recipe card's fixed strings at the largest text size, in the library grid (designer ruling 2026-11-02; ADR-0080 §8;
 * job `preDevice`): at four phone widths and three text scales, the cell the REAL column rule gives is wide enough for
 * the words the real card strings put in it, in every locale and in the pseudo-locale that grows English by 35%.
 *
 * The cell comes from the app's own functions, not from a copy of their numbers: `contentWidthOf` (the container),
 * `columnsOfVariant` (the column rule, including the 320 pt compact rule `compactColumnsOf`) and the card's own
 * spacing (`GRID_GAP` between cells, the body padding of each variant). The text comes from `recipeMessages`, and its
 * width from the app's font file (`measureTextWidth`), at the size the role is drawn at for that scale
 * (`scaledTypeSize`, the same arithmetic the design-system Text uses). jsdom lays nothing out, so a device run calibrates
 * the layout constants below; the arithmetic is the app's.
 *
 * What it checks, by slot (each slot is a place the card draws a string whose room the cell decides):
 *  - the cover's status chip (`caption`), for the draft and private words. The designer's rule (2026-11-03): the chip takes
 *    its content width and its word never truncates; a second chip that does not fit moves whole to the next line; and a
 *    chip wider than the cover less its insets drops the glyph and keeps the word, so the word's room is the cover less the
 *    insets and the chip's padding (`coverChipWordRoom`). It is measured WHOLE, in the shipped and the pseudo locale;
 *  - the unrated line and the servings line of the grid card's body (`meta`, one line, the body's inner width).
 * A one-line text is measured WHOLE (it ellipsizes, it does not break); a text that wraps is measured by its longest
 * word (a word wider than the line breaks inside itself, the defect that set the 320 pt rule). The card's TITLE is data, not
 * a string of the app, so it is not covered here.
 *
 * A small margin covers kerning and hinting. Known gaps, so a pass is not read as more: the title; strings drawn by a
 * design-system badge (difficulty, PRO), whose room is that component's; right-to-left locales (none ships).
 */
import { describe, expect, it } from 'vitest';

import { PSEUDO_LOCALE, pseudoString, resolveMessages, SUPPORTED_LOCALES } from '@commise/i18n';
import { contentWidthOf } from '@commise/ui/container-class';
import { nativeTokens } from '@commise/ui/native';
import { scaledTypeSize } from '@commise/ui/scaled-type';
import { asLoadedFace, measureTextWidth } from '@commise/ui/testing/measure-text';

import { columnsOfVariant, GRID_GAP } from '../../card/cardGridLayout.js';
import { coverChipWordRoom } from '../../card/coverChip.js';
import type { CardVariant } from '../../card/cardVariant.js';
import { recipeMessages } from '../../messages.js';

const WIDTHS = [320, 360, 390, 430] as const;
const SCALES = [1, 1.5, 2] as const;

/** Kerning and hinting: a string must fit with this much to spare. */
const MARGIN = 1.04;

/** The words a template carries: the widest plausible values, so a placeholder never makes a string look short. */
const FILL: Readonly<Record<string, string>> = { count: '99', minutes: '999', time: '45 min ago' };

const fill = (template: string): string => template.replace(/\{(\w+)\}/gu, (_m, name: string) => FILL[name] ?? 'W');

/** The cell a card sits in, from the app's own column rule. */
interface Cell {
    readonly columns: number;
    /** The card's width. */
    readonly card: number;
    /** The room a body line has: the card less the body's padding. */
    readonly body: number;
    /** The room the status chip's text has. */
    readonly chipText: number;
}

/**
 * The cell for a phone width, a text scale and a card variant. `columns` is the real rule's answer unless a case forces
 * a count (the known-bad rows).
 */
function cellOf(variant: CardVariant, width: number, scale: number, forcedColumns?: number): Cell {
    const content = contentWidthOf(width);
    const columns = forcedColumns ?? columnsOfVariant(variant, content, scale);
    // The grid cell pads GRID_GAP / 2 each side when there is more than one column (`RecipeListResults.native.tsx`).
    const card = columns > 1 ? content / columns - GRID_GAP : content;
    const bodyPadding = variant === 'compact' ? nativeTokens.spacing[3] : nativeTokens.spacing[4];

    return { columns, card, body: card - 2 * bodyPadding, chipText: coverChipWordRoom(card) };
}

/** A string that must fit, with the place it is drawn. */
interface Slot {
    readonly name: string;
    readonly role: 'caption' | 'meta';
    readonly text: string;
    /** `line`: the whole string is measured. `word`: its longest word. */
    readonly mode: 'line' | 'word';
    readonly room: (cell: Cell) => number;
}

/**
 * The slots a locale puts in a variant's card. The pseudo-locale grows English by 35% to show what a longer language
 * would do, and a one-line text then ellipsizes rather than breaks, so there it is checked by its longest WORD (a word
 * that does not fit would break inside itself); a shipped locale is checked whole (no ellipsis).
 */
function slotsFor(locale: string, variant: CardVariant): readonly Slot[] {
    const pseudo = locale === PSEUDO_LOCALE;
    const { card } = resolveMessages(recipeMessages, pseudo ? 'en' : locale);
    const say = (text: string): string => (pseudo ? pseudoString(fill(text)) : fill(text));
    const chips: Slot[] = [card.draftBadge, card.visibilityPrivate].map((text) => ({
        name: `status chip "${say(text)}"`,
        role: 'caption' as const,
        text: say(text),
        mode: 'line' as const,
        room: (cell: Cell) => cell.chipText,
    }));

    if (variant === 'compact') {
        return chips;
    }

    return [
        ...chips,
        ...[card.unrated].map((text) => ({
            name: `body line "${say(text)}"`,
            role: 'meta' as const,
            text: say(text),
            mode: pseudo ? ('word' as const) : ('line' as const),
            room: (cell: Cell) => cell.body,
        })),
    ];
}

/** The longest word of a text; a script with no spaces breaks anywhere, so its unit is one character. */
function longestWordOf(text: string): string {
    if (/[぀-ヿ㐀-鿿가-힯]/u.test(text)) {
        return [...text].reduce((widest, char) => (char.length >= widest.length ? char : widest), '');
    }

    return text.split(/\s+/u).reduce((widest, word) => (word.length > widest.length ? word : widest), '');
}

/** Which slots do not fit a cell at a scale. */
function misfits(slots: readonly Slot[], cell: Cell, scale: number): readonly string[] {
    return slots.flatMap((slot): string[] => {
        const { fontSize } = scaledTypeSize(slot.role, scale);
        const face = asLoadedFace(nativeTokens.type[slot.role].fontFamily);
        const measured = measureTextWidth(slot.mode === 'line' ? slot.text : longestWordOf(slot.text), face, fontSize);
        const room = slot.room(cell);

        return measured * MARGIN <= room
            ? []
            : [
                  `${slot.name}: ${(measured * MARGIN).toFixed(1)} pt (with the 4% margin) in ${room.toFixed(1)} pt at ${String(scale)}x`,
              ];
    });
}

const LOCALES = [...SUPPORTED_LOCALES, PSEUDO_LOCALE] as const;
const VARIANTS = ['grid', 'compact'] as const;

describe('the card grid cell holds the card strings at the text cap', () => {
    for (const variant of VARIANTS) {
        for (const locale of LOCALES) {
            describe(`${variant} · ${locale}`, () => {
                const slots = slotsFor(locale, variant);

                it.each(WIDTHS.flatMap((width) => SCALES.map((scale) => [width, scale] as const)))(
                    '%i pt wide, %fx text',
                    (width, scale) => {
                        expect(misfits(slots, cellOf(variant, width, scale), scale)).toEqual([]);
                    },
                );
            });
        }
    }
});

/** The rule the card had before the designer's ruling: half the cover, less the chip's padding, glyph and gap. */
const legacyChipText = (card: number): number =>
    card * 0.5 - (2 * nativeTokens.spacing[2] + 16 + nativeTokens.spacing[1]);

describe('the harness can fail (known-bad inputs)', () => {
    it('the old half-cover cap clips "Private" in the two-column tile at 360 pt and 1x (38 pt of room)', () => {
        const cell = cellOf('compact', 360, 1);
        const slots = slotsFor('en', 'compact');

        expect(cell.columns).toBe(2);
        expect(legacyChipText(cell.card)).toBe(38);
        expect(misfits(slots, { ...cell, chipText: legacyChipText(cell.card) }, 1).join('\n')).toContain('Private');
    });

    it('a too-narrow cell is reported: three columns on a 320 pt phone at 2x, pseudo-locale', () => {
        const slots = slotsFor(PSEUDO_LOCALE, 'grid');
        const cell = cellOf('grid', 320, 2, 3);

        expect(cell.columns).toBe(3);
        expect(misfits(slots, cell, 2).length).toBeGreaterThan(0);
    });

    it('the same shipped strings fit when the real rule picks the columns', () => {
        const slots = slotsFor('en', 'grid');

        expect(misfits(slots, cellOf('grid', 390, 1), 1)).toEqual([]);
    });

    it('a string with a word wider than any phone is reported in word mode', () => {
        const slot: Slot = {
            name: 'a long word',
            role: 'meta',
            text: 'Donaudampfschifffahrtsgesellschaftskapitän ist hier',
            mode: 'word',
            room: (cell) => cell.body,
        };

        expect(misfits([slot], cellOf('grid', 320, 2), 2)).toHaveLength(1);
    });

    it('the 320 pt rule puts a 360 pt phone at 2x on one column, and at 1x on two', () => {
        expect(cellOf('compact', 360, 2).columns).toBe(1);
        expect(cellOf('compact', 360, 1).columns).toBe(2);
    });
});
