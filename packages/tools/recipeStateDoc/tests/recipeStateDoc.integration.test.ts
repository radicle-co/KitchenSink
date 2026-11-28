/**
 * The generator over the real document and the real module. The byte-for-byte check (regenerating changes nothing) is
 * CI's `npm run recipeState:verify` step and is not repeated here. These cases hold what the generated files must say.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC_REFUSALS } from '@commise/features-recipes/public-refusal';
import { describe, expect, it } from 'vitest';

import { renderBlocks } from '../src/render.js';

const byText = (a: string, b: string): number => a.localeCompare(b);
const root = resolve(fileURLToPath(import.meta.url), '../../../../..');
const docPath = resolve(root, 'docs/architecture/recipeStateModel.md');
const jsonPath = resolve(root, 'docs/architecture/recipeStateModel.json');
const doc = await readFile(docPath, 'utf8');
const json = await readFile(jsonPath, 'utf8');

describe('recipeStateModel.md and .json', () => {
    it('has a marker pair for every generated block, and no marker pair the generator does not write', () => {
        const ids = [...doc.matchAll(/^<!-- recipeState:begin (\S+) -->$/gm)].map((match) => match[1]);

        const written = Object.keys(renderBlocks());

        expect([...ids].sort(byText)).toEqual([...written].sort(byText));
    });

    it('keeps the refusal reasons the client shows, which publicRefusalNames.test.ts reads', () => {
        const model = JSON.parse(json) as { refusals: { reason: string; name: string }[] };
        const reasons = model.refusals.map((entry) => entry.reason);

        expect(PUBLIC_REFUSALS.filter((reason) => !reasons.includes(reason))).toEqual([]);
    });

    it('says the earned sentence is not a toast, and keeps the credit line under the Source heading', () => {
        expect(doc).not.toMatch(/earnedToast/);
        expect(doc).toContain('`.earnedSentence`');
        expect(doc).toContain("keeps the source's credit line (such as `source_attribution`) and adds the site link");
    });
});

describe('the committed model document (ADR-0105)', () => {
    it('names no FORCE_PRIVATE and no forcesPrivate', () => {
        expect(doc).not.toMatch(/FORCE_PRIVATE|forcesPrivate/);
    });

    it('lists the six chips in precedence order, in the sentence and in the table', () => {
        expect(doc).toContain('Draft, Hidden, In review, Checking, Public or Private');

        const table = doc.slice(doc.indexOf('| Chip '), doc.indexOf('Until 020 ships'));
        const names = [...table.matchAll(/^\| (\w[\w ]*?)\s+\|/gm)].map((m) => m[1]).slice(1);

        expect(names).toEqual(['Draft', 'Hidden', 'In review', 'Checking', 'Public', 'Private']);
    });
});
