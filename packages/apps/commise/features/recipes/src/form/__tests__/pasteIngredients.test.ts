/**
 * Unit tests for the Paste a list sheet's reading of the pasted text (`form/pasteIngredients.ts`; build spec §7.5.4):
 * how many lines the parse job would store, and why a paste would be refused, before any round trip.
 */
import { MAX_PARSE_JOB_LINES, PARSE_JOB_LINE_MAX_CHARS } from '@kitchensink/recipe-core';
import { describe, expect, it } from 'vitest';

import { pasteIngredientsOf, type PasteRefusalCopy } from '../pasteIngredients.js';

const COPY: PasteRefusalCopy = {
    lineTooLong: 'Line {line} is longer than {max} characters.',
    tooManyLines: 'More than {max} lines.',
};

describe('pasteIngredientsOf', () => {
    it('counts the lines the job would store: blank lines dropped, each line trimmed', () => {
        expect(pasteIngredientsOf('2 cups flour\n\n  1 tsp salt  \r\n3 eggs\n', COPY)).toEqual({
            lineCount: 3,
            refusals: [],
            canSubmit: true,
        });
    });

    it('nothing to add: no submit, and no refusal shown (the disabled button already says it)', () => {
        expect(pasteIngredientsOf('  \n\n', COPY)).toEqual({ lineCount: 0, refusals: [], canSubmit: false });
    });

    it('a line over the bound is named by its 1-based line number', () => {
        const long = 'x'.repeat(PARSE_JOB_LINE_MAX_CHARS + 1);

        expect(pasteIngredientsOf(`flour\n${long}`, COPY)).toEqual({
            lineCount: 2,
            refusals: [`Line 2 is longer than ${String(PARSE_JOB_LINE_MAX_CHARS)} characters.`],
            canSubmit: false,
        });
    });

    it('more lines than a job takes is refused once', () => {
        const many = Array.from({ length: MAX_PARSE_JOB_LINES + 1 }, (_, index) => `line ${String(index)}`).join('\n');
        const model = pasteIngredientsOf(many, COPY);

        expect(model.canSubmit).toBe(false);
        expect(model.refusals).toEqual([`More than ${String(MAX_PARSE_JOB_LINES)} lines.`]);
    });
});
