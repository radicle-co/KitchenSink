/**
 * Compare a version with the CURRENT one (build spec §6.6): per row, against the current version, through the existing
 * pure `computeConflictDiff` over the two snapshots — the version is the base and "mine", the current version is
 * "theirs", so every row is a change the current version made, with the version's value as "was" and the current
 * value as "now". No new server API.
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { recipeVersionMessages } from '../messages.js';
import { compareRowsOf, compareWithCurrent } from '../compare.js';
import { makeRecipeVersion, makeSnapshot } from '../__fixtures__/index.js';

const { conflict } = recipeVersionMessages.en;
const lineNames = recipeMessages.en.ingredientLineName;

describe('compareWithCurrent', () => {
    it('reports only what differs, each as the version’s value and the current one', () => {
        const old = makeRecipeVersion({ versionNumber: 3, snapshot: makeSnapshot({ title: 'Lamb', servings: 4 }) });
        const current = makeRecipeVersion({ versionNumber: 5, snapshot: { ...old.snapshot, title: 'Slow lamb' } });

        const rows = compareRowsOf(compareWithCurrent(old, current, 'en', lineNames), conflict);

        expect(rows).toEqual([{ key: 'title', label: 'Title', was: 'Lamb', now: 'Slow lamb' }]);
    });

    it('is empty when the version matches the current one', () => {
        const old = makeRecipeVersion({ versionNumber: 3 });
        const current = makeRecipeVersion({ versionNumber: 5, snapshot: old.snapshot });

        expect(compareWithCurrent(old, current, 'en', lineNames).isEmpty).toBe(true);
    });

    it('labels a changed step by its position', () => {
        const old = makeRecipeVersion({
            versionNumber: 1,
            snapshot: makeSnapshot({
                steps: [{ id: 'step_1', recipeId: 'rec_1', stepNumber: 1, instruction: 'Mix.' }],
            }),
        });
        const current = makeRecipeVersion({
            versionNumber: 2,
            snapshot: makeSnapshot({
                steps: [{ id: 'step_1', recipeId: 'rec_1', stepNumber: 1, instruction: 'Mix well.' }],
            }),
        });

        const [row] = compareRowsOf(compareWithCurrent(old, current, 'en', lineNames), conflict);

        expect(row).toMatchObject({ label: 'Step 1', was: 'Mix.', now: 'Mix well.' });
    });
});
