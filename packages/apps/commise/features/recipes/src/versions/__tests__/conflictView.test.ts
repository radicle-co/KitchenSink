/**
 * Unit tests for the conflict view's cards, staleness gate and choice summary (`versions/conflictView.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { VersionConflictSide } from '@kitchensink/recipe-core';
import { makeVersionConflictSide } from '../__fixtures__/index.js';
import {
    conflictCopyOf,
    countMergeSelections,
    formatMergeSummary,
    formatTheirsCardSavedLine,
    formatYoursCardStatus,
    isConflictBaseStale,
} from '../conflictView.js';
import type { RecipeMergeSelections } from '../merge.js';
import { recipeVersionMessages } from '../messages.js';

const conflict = recipeVersionMessages.en.conflict;

describe('the two side cards (wireframe gap #2; slice 7 wording: Saved elsewhere / Your changes)', () => {
    const server = makeVersionConflictSide({
        versionNumber: 6,
        updatedAt: '2026-05-09T14:30:00.000Z',
    });

    it('the card headings carry no version number', () => {
        expect(conflict.theirsCardHeading).toBe('Saved elsewhere');
        expect(conflict.yoursCardHeading).toBe('Your changes');
    });

    it('formatTheirsCardSavedLine renders the ABSOLUTE date alone, no "Saved:" prefix and no version', () => {
        expect(formatTheirsCardSavedLine(server, 'en', conflict)).toBe('May 9, 2026, 2:30 PM');
    });

    // The card shows the version the cook's draft was edited FROM; it never claims the draft was saved.
    it('formatYoursCardStatus says "Not saved yet. Started from {time}" when base is known', () => {
        const base = makeVersionConflictSide({ versionNumber: 5, updatedAt: '2026-05-08T10:00:00.000Z' });

        expect(formatYoursCardStatus(base, 'en', conflict)).toBe('Not saved yet. Started from May 8, 2026, 10:00 AM');
    });

    it('formatYoursCardStatus falls back to "Not saved yet" when base is undefined (evicted)', () => {
        expect(formatYoursCardStatus(undefined, 'en', conflict)).toBe('Not saved yet');
    });
});

describe('isConflictBaseStale (W7 Task 5 / X6)', () => {
    const base: VersionConflictSide = makeVersionConflictSide({ versionNumber: 5 });

    it('is false when a base is present and within the 10-version threshold', () => {
        expect(isConflictBaseStale(base, 10)).toBe(false);
        expect(isConflictBaseStale(base, 1)).toBe(false);
    });

    it('is true when the server is more than 10 versions ahead of the base', () => {
        expect(isConflictBaseStale(base, 11)).toBe(true);
    });

    it('is true when the base is absent, REGARDLESS of what versionsBehind reads (unreliable without a base)', () => {
        expect(isConflictBaseStale(undefined, 1)).toBe(true);
        expect(isConflictBaseStale(undefined, 0)).toBe(true);
    });
});

describe('countMergeSelections / formatMergeSummary (W7 Task 5 — running "Summary of choices")', () => {
    it('counts zero of both sides for empty selections', () => {
        expect(countMergeSelections({})).toEqual({ server: 0, mine: 0 });
        expect(formatMergeSummary({}, conflict, 'en')).toBe('Picked: 0 from theirs, 0 from yours');
    });

    it('tallies each side’s explicit picks, correctly pluralized', () => {
        const selections: RecipeMergeSelections = {
            title: 'theirs',
            servings: 'theirs',
            'steps[1]': 'mine',
        };

        expect(countMergeSelections(selections)).toEqual({ server: 2, mine: 1 });
        expect(formatMergeSummary(selections, conflict, 'en')).toBe('Picked: 2 from theirs, 1 from yours');
    });

    it('does not count an absent key — only EXPLICIT selections, not the implied default', () => {
        // `composeMergedRecipe`/`composeConflictMerge` still default an absent key to "mine", but the running
        // summary reports what the user actively picked, not the composed result.
        expect(countMergeSelections({ title: 'theirs' })).toEqual({ server: 1, mine: 0 });
    });
});

/**
 * A never-published draft has no versions (ADR-0058), so its 409 never carries a `base` — and must not be told it was
 * "evicted from history", shown version numbers, or held behind the stale-base gate. The other writer is the same cook,
 * in another tab or on another device (`staff-ux-engineer`, slice 7).
 */
describe('a never-published draft`s conflict', () => {
    const messages = recipeVersionMessages.en.conflict;

    it('speaks of a draft saved elsewhere, with no version numbers', () => {
        const copy = conflictCopyOf(messages, true);

        expect(copy.heading).toBe('This draft changed somewhere else');
        expect(copy.explanation).toBe(
            'You saved this draft in another tab or on another device while you were editing here. Choose which one to keep.',
        );
        expect(copy.theirsCardHeading).toBe('Saved elsewhere');
        expect(copy.yoursCardHeading).toBe('Your changes');
    });

    it('leaves a published recipe`s copy as it is', () => {
        expect(conflictCopyOf(messages, false)).toBe(messages);
    });

    it('is never held behind the stale-base gate', () => {
        expect(isConflictBaseStale(undefined, 9, true)).toBe(false);
        expect(isConflictBaseStale(undefined, 9, false)).toBe(true);
    });
});
