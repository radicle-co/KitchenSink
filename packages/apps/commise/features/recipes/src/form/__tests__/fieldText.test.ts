/**
 * Unit tests for the editor's text-field rules (`docs/design/uiOverhaul/buildSpec.md` §7.4): a soft limit counted on
 * the TRIMMED text, as `validateRecipeForm` counts it, and a title that holds no line break however it arrives.
 */
import { describe, expect, it } from 'vitest';

import { readLimit, singleLine } from '../fieldText.js';
import { DESCRIPTION_COUNTER_FROM, DESCRIPTION_MAX_LENGTH, TITLE_COUNTER_FROM, TITLE_MAX_LENGTH } from '../limits.js';
import { validateRecipeForm } from '../validate.js';
import { makeRecipeFormValues } from '../../__fixtures__/index.js';

describe('readLimit', () => {
    it('hides the counter below its threshold', () => {
        expect(readLimit('a'.repeat(TITLE_COUNTER_FROM - 1), TITLE_MAX_LENGTH, TITLE_COUNTER_FROM)).toEqual({
            count: TITLE_COUNTER_FROM - 1,
            shown: false,
            over: false,
        });
    });

    it('shows the counter from its threshold', () => {
        expect(readLimit('a'.repeat(TITLE_COUNTER_FROM), TITLE_MAX_LENGTH, TITLE_COUNTER_FROM)).toEqual({
            count: TITLE_COUNTER_FROM,
            shown: true,
            over: false,
        });
    });

    it('is not over AT the limit', () => {
        expect(readLimit('a'.repeat(TITLE_MAX_LENGTH), TITLE_MAX_LENGTH, TITLE_COUNTER_FROM).over).toBe(false);
    });

    it('is over one past the limit', () => {
        expect(readLimit('a'.repeat(TITLE_MAX_LENGTH + 1), TITLE_MAX_LENGTH, TITLE_COUNTER_FROM)).toEqual({
            count: TITLE_MAX_LENGTH + 1,
            shown: true,
            over: true,
        });
    });

    it('counts the trimmed text, so padding never trips the limit', () => {
        expect(readLimit(`  ${'a'.repeat(TITLE_MAX_LENGTH)}  `, TITLE_MAX_LENGTH, TITLE_COUNTER_FROM)).toEqual({
            count: TITLE_MAX_LENGTH,
            shown: true,
            over: false,
        });
    });

    it.each([TITLE_MAX_LENGTH, TITLE_MAX_LENGTH + 1])('agrees with the publish validator at %i characters', (n) => {
        const title = ` ${'a'.repeat(n)} `;

        expect(readLimit(title, TITLE_MAX_LENGTH, TITLE_COUNTER_FROM).over).toBe(
            validateRecipeForm(makeRecipeFormValues({ title }), '').title === 'titleTooLong',
        );
    });
});

describe('singleLine', () => {
    it.each<[string, string, string]>([
        ['no break', 'Herb risotto', 'Herb risotto'],
        ['an Enter at the end', 'Herb risotto\n', 'Herb risotto '],
        ['a pasted break', 'Herb\nrisotto', 'Herb risotto'],
        ['a Windows break', 'Herb\r\nrisotto', 'Herb risotto'],
        ['a lone carriage return', 'Herb\rrisotto', 'Herb risotto'],
    ])('%s', (_case, text, expected) => {
        expect(singleLine(text)).toBe(expected);
    });
});

describe('the description counter threshold', () => {
    it('is 80% of the description cap', () => {
        expect(DESCRIPTION_COUNTER_FROM).toBe(205);
        expect(DESCRIPTION_COUNTER_FROM / DESCRIPTION_MAX_LENGTH).toBeGreaterThanOrEqual(0.8);
    });
});
