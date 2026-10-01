/**
 * Unit tests for the version-history list model (`versions/history.ts`).
 */
import { describe, expect, it } from 'vitest';
import { VersionConflictError, VersionLineUnrestorableError } from '@kitchensink/recipe-service-client';

import { makeRecipeVersion, makeSnapshot } from '../__fixtures__/index.js';
import { recipeVersionMessages } from '../messages.js';
import {
    changeSummaryForVersion,
    classifyRestoreError,
    findPriorVersion,
    formatChangedFieldNames,
    formatVersionAttribution,
    previewRestoreErrorMessage,
    restoreErrorMessage,
    sortVersionsDescending,
    unrestorablePositionsFor,
} from '../history.js';

const conflict = recipeVersionMessages.en.conflict;
const versionList = recipeVersionMessages.en.versionList;
const previewMessages = recipeVersionMessages.en.preview;

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
 * REWRITTEN for the 2026-08-26 owner ruling on device attribution (no `deviceLabel`). The rendering is
 * editor-only, and it is asserted as a WHOLE string on purpose — nothing else pins the `by @` prefix and
 * the handle's position, so asserting merely "contains clara" here would let the format rot unnoticed.
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

/**
 * A failed restore, classified once for both apps (plan 002 R52; `namelessLineCopy.md` §5). A restore the server
 * refuses because a line has no binding and no saved name carries WHICH lines, so the preview can mark them.
 */
describe('classifyRestoreError', () => {
    it('is undefined while nothing failed', () => {
        expect(classifyRestoreError(null, 2)).toBeUndefined();
        expect(classifyRestoreError(undefined, 2)).toBeUndefined();
    });

    it('carries the refused positions and the version they belong to', () => {
        expect(classifyRestoreError(new VersionLineUnrestorableError([0, 3]), 2)).toStrictEqual({
            kind: 'unrestorable',
            versionNumber: 2,
            positions: [0, 3],
        });
    });

    it('keeps the conflict and generic codes, now tied to their version', () => {
        expect(classifyRestoreError(new VersionConflictError(5), 2)).toStrictEqual({
            kind: 'conflict',
            versionNumber: 2,
        });
        expect(classifyRestoreError(new Error('boom'), 2)).toStrictEqual({ kind: 'generic', versionNumber: 2 });
    });

    it('is undefined when it cannot say which version failed', () => {
        expect(classifyRestoreError(new Error('boom'), undefined)).toBeUndefined();
    });
});

describe('restoreErrorMessage (the version list)', () => {
    it('uses the singular refusal for one line and counts two or more', () => {
        expect(restoreErrorMessage({ kind: 'unrestorable', versionNumber: 2, positions: [1] }, versionList)).toBe(
            versionList.restoreUnrestorableErrorOne,
        );
        expect(restoreErrorMessage({ kind: 'unrestorable', versionNumber: 2, positions: [0, 1, 4] }, versionList)).toBe(
            versionList.restoreUnrestorableErrorMany.replace('{count}', '3'),
        );
    });

    it('⛔ the list refusal says nothing changed and sends the cook to the preview, where the lines are marked', () => {
        for (const copy of [versionList.restoreUnrestorableErrorOne, versionList.restoreUnrestorableErrorMany]) {
            expect(copy).toMatch(/Nothing was changed/u);
            expect(copy).toMatch(/Preview the version/u);
        }
    });

    it('keeps the conflict and generic copy', () => {
        expect(restoreErrorMessage({ kind: 'conflict', versionNumber: 2 }, versionList)).toBe(
            versionList.restoreConflictError,
        );
        expect(restoreErrorMessage({ kind: 'generic', versionNumber: 2 }, versionList)).toBe(
            versionList.restoreGenericError,
        );
    });
});

describe('previewRestoreErrorMessage (inside the preview)', () => {
    it('speaks only about the version being previewed', () => {
        const refused = { kind: 'unrestorable' as const, versionNumber: 2, positions: [1] };

        expect(previewRestoreErrorMessage(refused, 2, versionList, previewMessages)).toBe(
            previewMessages.restoreUnrestorableErrorOne,
        );
        expect(previewRestoreErrorMessage(refused, 3, versionList, previewMessages)).toBeUndefined();
        expect(previewRestoreErrorMessage(undefined, 2, versionList, previewMessages)).toBeUndefined();
    });

    it('points DOWN at the marked lines, and counts two or more', () => {
        expect(previewMessages.restoreUnrestorableErrorOne).toMatch(/marked below/u);
        expect(
            previewRestoreErrorMessage(
                { kind: 'unrestorable', versionNumber: 2, positions: [0, 2] },
                2,
                versionList,
                previewMessages,
            ),
        ).toBe(previewMessages.restoreUnrestorableErrorMany.replace('{count}', '2'));
    });

    it('⛔ shows a conflict or a generic failure inside the preview too, not only behind it', () => {
        expect(
            previewRestoreErrorMessage({ kind: 'conflict', versionNumber: 2 }, 2, versionList, previewMessages),
        ).toBe(versionList.restoreConflictError);
        expect(previewRestoreErrorMessage({ kind: 'generic', versionNumber: 2 }, 2, versionList, previewMessages)).toBe(
            versionList.restoreGenericError,
        );
    });
});

describe('unrestorablePositionsFor', () => {
    it('gives the refused positions for the previewed version only', () => {
        const refused = { kind: 'unrestorable' as const, versionNumber: 2, positions: [1, 3] };

        expect(unrestorablePositionsFor(refused, 2)).toStrictEqual([1, 3]);
        expect(unrestorablePositionsFor(refused, 3)).toStrictEqual([]);
        expect(unrestorablePositionsFor({ kind: 'generic', versionNumber: 2 }, 2)).toStrictEqual([]);
        expect(unrestorablePositionsFor(undefined, 2)).toStrictEqual([]);
    });
});
