/**
 * Unit tests for the version-history list model (`versions/history.ts`).
 *
 * ⚠️ These 5 describe blocks came from `model.test.ts`, which covered all of
 * `versions/model.ts` before it was split into one module per concern. No assertion was
 * changed, added or dropped in the move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';
import { makeRecipeVersion, makeSnapshot } from '../__fixtures__/index.js';
import { recipeVersionMessages } from '../messages.js';
import {
    changeSummaryForVersion,
    findPriorVersion,
    formatChangedFieldNames,
    formatVersionAttribution,
    sortVersionsDescending,
} from '../history.js';

const conflict = recipeVersionMessages.en.conflict;
const versionList = recipeVersionMessages.en.versionList;

describe('sortVersionsDescending', () => {
    it('orders versions newest-first by version number', () => {
        const ordered = sortVersionsDescending([
            makeRecipeVersion({ versionNumber: 1 }),
            makeRecipeVersion({ versionNumber: 3 }),
            makeRecipeVersion({ versionNumber: 2 }),
        ]);

        expect(ordered.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
    });

    it('does not mutate the input array', () => {
        const input = [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 2 })];

        sortVersionsDescending(input);

        expect(input.map((version) => version.versionNumber)).toEqual([1, 2]);
    });
});

describe('findPriorVersion (W6 Task 2)', () => {
    it('returns undefined for the earliest version in the set', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 2 })];

        expect(findPriorVersion(versions, 1)).toBeUndefined();
    });

    it('returns the immediately-prior version (greatest versionNumber strictly less than the target)', () => {
        const versions = [
            makeRecipeVersion({ versionNumber: 1 }),
            makeRecipeVersion({ versionNumber: 2 }),
            makeRecipeVersion({ versionNumber: 3 }),
        ];

        expect(findPriorVersion(versions, 3)?.versionNumber).toBe(2);
    });

    it('degrades gracefully across a gap in the given set (not versionNumber - 1 arithmetic)', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 5 })];

        expect(findPriorVersion(versions, 5)?.versionNumber).toBe(1);
    });

    it('does not mutate the input array', () => {
        const versions = [makeRecipeVersion({ versionNumber: 1 }), makeRecipeVersion({ versionNumber: 2 })];
        const snapshot = [...versions];

        findPriorVersion(versions, 2);

        expect(versions).toEqual(snapshot);
    });
});

describe('changeSummaryForVersion (W6 Task 2)', () => {
    it('reports no prior for the earliest version, with no changed fields', () => {
        const v1 = makeRecipeVersion({ versionNumber: 1, snapshot: makeSnapshot() });

        expect(changeSummaryForVersion([v1], v1)).toEqual({ hasPrior: false, changedFields: [] });
    });

    it('reports the changed fields versus the immediately-prior version', () => {
        const v1 = makeRecipeVersion({ versionNumber: 1, snapshot: makeSnapshot({ version: 1 }) });
        const v2 = makeRecipeVersion({
            versionNumber: 2,
            snapshot: makeSnapshot({ version: 2, title: 'Weeknight Pasta, Revised' }),
        });

        expect(changeSummaryForVersion([v1, v2], v2)).toEqual({ hasPrior: true, changedFields: ['title'] });
    });

    it('reports hasPrior true with no changed fields when the prior snapshot is identical', () => {
        const v1 = makeRecipeVersion({ versionNumber: 1, snapshot: makeSnapshot({ version: 1 }) });
        const v2 = makeRecipeVersion({ versionNumber: 2, snapshot: makeSnapshot({ version: 2 }) });

        expect(changeSummaryForVersion([v1, v2], v2)).toEqual({ hasPrior: true, changedFields: [] });
    });
});

describe('formatChangedFieldNames (W6 Task 2)', () => {
    it('localizes and joins the changed field names, preserving declared order', () => {
        expect(formatChangedFieldNames(['title', 'steps'], conflict)).toBe('Title, Steps');
    });

    it('renders a single field with no separator', () => {
        expect(formatChangedFieldNames(['ingredients'], conflict)).toBe('Ingredients');
    });

    it('renders an empty string for no changed fields', () => {
        expect(formatChangedFieldNames([], conflict)).toBe('');
    });
});

/**
 * REWRITTEN for the 2026-08-26 owner ruling that deleted device attribution (`deviceLabel`). The function
 * used to take a device label and branch on it; two of the four cases here existed only to pin that branch.
 * What survives is the editor-only rendering, and it is asserted as a WHOLE string on purpose — the two
 * deleted cases were the only ones that pinned the `by @` prefix and the handle's position, so asserting
 * merely "contains clara" here would let the surviving format rot unnoticed.
 */
describe('formatVersionAttribution (W6 Task 2)', () => {
    it('renders exactly "by @{handle}" — the prefix, the sigil and the handle, with no suffix', () => {
        expect(formatVersionAttribution('clara', versionList)).toBe('by @clara');
    });

    it('renders undefined when the editor is unknown (never "by @undefined")', () => {
        expect(formatVersionAttribution(undefined, versionList)).toBeUndefined();
    });

    it('attributes to the handle it was GIVEN, not to a fixed one', () => {
        // Guards the template's `{handle}` substitution: a formatter that ignored its argument and returned
        // a constant would pass the case above and fail here.
        expect(formatVersionAttribution('devon', versionList)).toBe('by @devon');
    });
});
