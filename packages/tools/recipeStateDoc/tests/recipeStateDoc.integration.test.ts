/**
 * The generator over the real document and the real module. The committed files are the golden: regenerating them must
 * change nothing, which is what CI checks. Failing here means the module and the document disagree, and the fix is
 * `npm run recipeState:generate` (or, if the document was edited by hand, to move the edit into the module).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateFiles } from '../src/generate.js';
import { renderBlocks } from '../src/render.js';

const root = resolve(fileURLToPath(import.meta.url), '../../../../..');
const docPath = resolve(root, 'docs/architecture/recipeStateModel.md');
const jsonPath = resolve(root, 'docs/architecture/recipeStateModel.json');
const doc = readFileSync(docPath, 'utf8');
const json = readFileSync(jsonPath, 'utf8');

describe('recipeStateModel.md and .json', () => {
    it('are what the module generates, byte for byte', async () => {
        const next = await generateFiles({ docPath, jsonPath, doc });

        expect(next.doc).toBe(doc);
        expect(next.json).toBe(json);
    });

    it('has a marker pair for every generated block, and no marker pair the generator does not write', () => {
        const ids = [...doc.matchAll(/^<!-- recipeState:begin (\S+) -->$/gm)].map((match) => match[1]);

        expect(ids.sort()).toEqual(Object.keys(renderBlocks()).sort());
    });

    it('keeps the refusal reasons the client shows, which publicRefusalNames.test.ts reads', () => {
        const model = JSON.parse(json) as { refusals: { reason: string; name: string }[] };
        const reasons = model.refusals.map((entry) => entry.reason);

        for (const reason of ['fromPerson', 'policy.webPage', 'policy.book', 'policy.paidSite', 'sourceConflict']) {
            expect(reasons).toContain(reason);
        }
    });

    it('says the earned sentence is not a toast, and keeps the credit line under the Source heading', () => {
        expect(doc).not.toMatch(/earnedToast/);
        expect(doc).toContain('`.earnedSentence`');
        expect(doc).toContain("keeps the source's credit line (such as `source_attribution`) and adds the site link");
    });
});
