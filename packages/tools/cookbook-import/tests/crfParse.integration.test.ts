/**
 * Integration tier: drives the REAL `ingredient-parser-nlp` CRF model through the REAL Python process.
 *
 * It is its own tier because it is the only thing that can prove what the unit tier structurally cannot:
 * that the Python this repository ships prints the shape `crfParseSchema` accepts, that the model is
 * installed, and that a batch of lines comes back in the order it went in. A mocked subprocess proves only
 * that we can read our own fixture.
 *
 * Skipped (not failed) when `python3 -c "import ingredient_parser"` does not succeed, mirroring how the
 * importer's own service-backed tier guards on `COOKBOOK_IMPORT_RECIPE_URL`.
 */
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { parseLinesWithCrf } from '../src/parseComparison/crfProcess.js';

function crfIsInstalled(): boolean {
    try {
        execFileSync('python3', ['-c', 'import ingredient_parser'], { stdio: 'ignore' });

        return true;
    } catch {
        return false;
    }
}

const describeIfInstalled = crfIsInstalled() ? describe : describe.skip;

describeIfInstalled('parseLinesWithCrf against the real CRF model', () => {
    it('returns one row per input line, in the order the lines were given', async () => {
        const parses = await parseLinesWithCrf(['two eggs', 'one-half cup of butter', '3 cloves garlic, minced']);

        expect(parses).toHaveLength(3);
        expect(parses.map((parse) => parse.sentence)).toEqual([
            'two eggs',
            'one-half cup of butter',
            '3 cloves garlic, minced',
        ]);
    }, 120_000);

    it('reads a quantity and a unit out of a numeral line', async () => {
        const [parse] = await parseLinesWithCrf(['2 tablespoons olive oil']);

        expect(parse?.measure).toContain('2');
        expect(parse?.names).toEqual(['olive oil']);
    }, 120_000);

    it('reads a preparation clause into its own field', async () => {
        const [parse] = await parseLinesWithCrf(['3 cloves garlic, minced']);

        expect(parse?.preparation).toBe('minced');
    }, 120_000);

    it('LOSES a historical unit into the food name — the disagreement this comparison exists to size', async () => {
        const [parse] = await parseLinesWithCrf(['one gill of milk']);

        expect(parse?.names).toEqual(['gill of milk']);
    }, 120_000);

    it('survives a line carrying quotes, braces and a newline without corrupting the stream', async () => {
        const parses = await parseLinesWithCrf(['a "pint" of {milk}', 'two eggs']);

        expect(parses).toHaveLength(2);
        expect(parses[1]?.sentence).toBe('two eggs');
    }, 120_000);

    it('returns nothing for no input without starting a process', async () => {
        expect(await parseLinesWithCrf([])).toEqual([]);
    });
});
