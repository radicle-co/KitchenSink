/**
 * @module @commise/features-recipes/format — how a recipe amount reads, and how a screen reader says it (UI Designer
 * ruling Q5, 2026-11-06).
 *
 * The rules:
 *  1. A cook reads one fraction character joined to the whole number, with no space ("1½", "¾").
 *  2. Only the nine fractions in {@link COOK_FRACTIONS}. A value snaps to one only within {@link SNAP_TOLERANCE}
 *     (0.333 is ⅓, 0.3 stays "0.3"). Anything else is a decimal with at most two places. A scaled amount follows the same rule.
 *  3. Metric units stay decimal. Spoons, cups, ounces, pounds and counts use fractions. No unit is a count.
 *  4. Every `en-*` locale uses fractions. Every other locale uses a decimal with its own mark, through `Intl`.
 *  5. The spoken form uses localized words, never the character ("1 and a half").
 *
 * ⛔ The table is closed and has nine rows, so it is a lookup, not a library. `format-quantity` was checked
 * (3.2.0, MIT, maintained): it matches sixteenths, fifths and sixths, so its output would need filtering back to this
 * set, and the decimal branch and the spoken form are ours anyway. Wrapping it costs more than the table.
 *
 * Display only. A field the cook edits keeps what they typed.
 *
 * Pure and platform-agnostic: it uses `Intl.NumberFormat` only, which both platforms carry.
 */
import { normalizeUnit } from '@kitchensink/recipe-core';

import type { AmountWordMessages } from '../messages.js';
import { fillTemplate } from './fillTemplate.js';

/** The word key of each fraction. */
type FractionWord = Exclude<keyof AmountWordMessages, 'mixed' | 'range'>;

/** One fraction a cook reads: its value, its character, and the word a screen reader says. */
interface CookFraction {
    readonly value: number;
    readonly glyph: string;
    readonly word: FractionWord;
}

/** The nine fractions, and nothing else (rule 2). */
const COOK_FRACTIONS: readonly CookFraction[] = [
    { value: 1 / 8, glyph: '⅛', word: 'eighth' },
    { value: 1 / 4, glyph: '¼', word: 'quarter' },
    { value: 1 / 3, glyph: '⅓', word: 'third' },
    { value: 3 / 8, glyph: '⅜', word: 'threeEighths' },
    { value: 1 / 2, glyph: '½', word: 'half' },
    { value: 5 / 8, glyph: '⅝', word: 'fiveEighths' },
    { value: 2 / 3, glyph: '⅔', word: 'twoThirds' },
    { value: 3 / 4, glyph: '¾', word: 'threeQuarters' },
    { value: 7 / 8, glyph: '⅞', word: 'sevenEighths' },
];

/** How close a value must be to a fraction, or to a whole number, to read as it (rule 2). */
const SNAP_TOLERANCE = 0.01;

/** The metric units that stay decimal, as `normalizeUnit` spells them (rule 3). */
const DECIMAL_UNITS: ReadonlySet<string> = new Set(['g', 'kg', 'mg', 'milliliter', 'liter', 'cl', 'dl']);

/** Whether an amount in this locale and unit reads as a fraction (rules 3 and 4). Pure. */
const readsAsFraction = (locale: string, unit: string | undefined): boolean => {
    const language = locale.toLowerCase();
    const english = language === 'en' || language.startsWith('en-');

    return english && !DECIMAL_UNITS.has(normalizeUnit(unit ?? ''));
};

/**
 * The amount as a cook reads it.
 *
 * @param value - A positive amount.
 * @param locale - The active BCP-47 locale.
 * @param unit - The unit it is stated in, as the cook wrote it, or none for a count.
 * @returns "1½", "⅓", "0.3", "1.5", or "1,5" outside English; a positive amount is never "0". Pure.
 */
export const formatAmountNumber = (value: number, locale: string, unit: string | undefined): string => {
    const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

    // A positive amount (⅛ tsp scaled down) never reads as nothing: it floors at the smallest step shown.
    if (value > 0 && value <= SNAP_TOLERANCE) {
        return decimal.format(SNAP_TOLERANCE);
    }

    if (!readsAsFraction(locale, unit)) {
        return decimal.format(value);
    }

    const nearestWhole = Math.round(value);

    if (Math.abs(value - nearestWhole) <= SNAP_TOLERANCE) {
        return decimal.format(nearestWhole);
    }

    const whole = Math.floor(value);
    const fraction = COOK_FRACTIONS.find((candidate) => Math.abs(value - whole - candidate.value) <= SNAP_TOLERANCE);

    if (fraction === undefined) {
        return decimal.format(value);
    }

    return whole === 0 ? fraction.glyph : `${decimal.format(whole)}${fraction.glyph}`;
};

/** A regex class of the nine fraction characters. */
const GLYPHS = `[${COOK_FRACTIONS.map((fraction) => fraction.glyph).join('')}]`;

/** A fraction character, with the whole number joined to it when there is one. */
const FRACTION_AMOUNT = new RegExp(`(\\d[\\d,]*)?(${GLYPHS})`, 'gu');

/** One amount, as {@link formatAmountNumber} writes it: digits with an optional fraction, or a fraction alone. */
const AMOUNT = `(?:\\d[\\d,.]*${GLYPHS}?|${GLYPHS})`;

/** Two amounts joined by the range dash (`detail/model.ts`' `RANGE_SEPARATOR`). */
const AMOUNT_RANGE = new RegExp(`(${AMOUNT})–(${AMOUNT})`, 'gu');

/** The words for one fraction character. */
const wordsFor = (glyph: string, words: AmountWordMessages): string => {
    const fraction = COOK_FRACTIONS.find((candidate) => candidate.glyph === glyph);

    return fraction === undefined ? glyph : words[fraction.word];
};

/** Every fraction in `text`, in words: "1½" → "1 and a half", "¾" → "three quarters". Pure. */
const speakFractions = (text: string, words: AmountWordMessages): string =>
    text.replace(FRACTION_AMOUNT, (_match, whole: string | undefined, glyph: string) =>
        whole === undefined
            ? wordsFor(glyph, words)
            : fillTemplate(words.mixed, { whole, fraction: wordsFor(glyph, words) }),
    );

/**
 * The spoken copy a surface must add for a text, or `undefined` when the text already says itself: when the two
 * differ only by the no-break space before a unit, which every screen reader reads as a space. A surface that labels
 * a node only when this answers keeps its text said once (`nativeContainerNames.md` N1).
 *
 * @param text - What a surface shows.
 * @param words - The localized words.
 * @returns The spoken text, or `undefined`. Pure.
 */
export const spokenAmountsLabel = (text: string, words: AmountWordMessages): string | undefined => {
    const spoken = speakAmounts(text, words);

    return spoken === text.replace(/\u00A0/gu, ' ') ? undefined : spoken;
};

/**
 * A text that shows amounts, as a screen reader should say it: every fraction in words, every range with the range
 * pattern, and the no-break space before a unit as a plain space. Text with neither is returned as it was.
 *
 * @param text - What a surface shows, or the accessible name built from it.
 * @param words - The localized words.
 * @returns The spoken text. Pure.
 */
export const speakAmounts = (text: string, words: AmountWordMessages): string =>
    speakFractions(
        text.replace(AMOUNT_RANGE, (_match, low: string, high: string) => fillTemplate(words.range, { low, high })),
        words,
    ).replace(/\u00A0/gu, ' ');
