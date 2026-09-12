/**
 * Unit tests for the conflict view's banner, cards, staleness gate and choice summary (`versions/conflictView.ts`).
 *
 * ⚠️ These 4 describe blocks came from `model.test.ts`, which covered all of
 * `versions/model.ts` before it was split into one module per concern. No assertion was
 * changed, added or dropped in the move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';
import type { VersionConflictSide } from '@kitchensink/recipe-core';
import { makeVersionConflictSide } from '../__fixtures__/index.js';
import {
    countMergeSelections,
    formatMergeSummary,
    formatServerBanner,
    formatServerCardHeading,
    formatVersionCardSavedLine,
    formatYourCardHeading,
    isConflictBaseStale,
} from '../conflictView.js';
import type { RecipeMergeSelections } from '../merge.js';
import { recipeVersionMessages } from '../messages.js';

const conflict = recipeVersionMessages.en.conflict;

/**
 * REWRITTEN for the 2026-08-26 owner ruling that deleted device attribution (`deviceLabel`). The banner
 * used to have two branches — with and without a device suffix — and the pair of cases below it existed to
 * pin both. There is now ONE rendering, so the surviving case asserts the WHOLE string (never `toContain`),
 * which is what makes it fail if the version number, the relative time, or the template wording moves.
 */
describe('formatServerBanner (W7 Task 3 / X3)', () => {
    it('renders "Server version (vN): Saved {time} ago" — version and relative time, and nothing else', () => {
        const server = makeVersionConflictSide({
            versionNumber: 6,
            updatedAt: '2026-05-09T14:30:00.000Z',
        });

        expect(formatServerBanner(server, new Date('2026-05-09T14:32:00.000Z'), conflict, 'en')).toBe(
            'Server version (v6): Saved 2 minutes ago',
        );
    });

    it('carries no device clause even when the caller hands it a stray deviceLabel-shaped property', () => {
        // The field is gone from `VersionConflictSide`, but an OLD server (or a stale cache) can still put
        // the key on the wire. The banner must ignore it rather than resurrect the deleted suffix.
        const server = { ...makeVersionConflictSide({ versionNumber: 6, updatedAt: '2026-05-09T14:30:00.000Z' }) };

        expect(
            formatServerBanner(
                { ...server, deviceLabel: 'iPhone' } as typeof server,
                new Date('2026-05-09T14:32:00.000Z'),
                conflict,
                'en',
            ),
        ).toBe('Server version (v6): Saved 2 minutes ago');
    });
});

describe('two-column per-side summary cards (wireframe gap #2)', () => {
    const server = makeVersionConflictSide({
        versionNumber: 6,
        updatedAt: '2026-05-09T14:30:00.000Z',
    });

    it('formatServerCardHeading renders "Server version (v{n})"', () => {
        expect(formatServerCardHeading(server, conflict)).toBe('Server version (v6)');
    });

    it('formatYourCardHeading renders "Your version (v{n})" when base is known', () => {
        const base = makeVersionConflictSide({ versionNumber: 5 });

        expect(formatYourCardHeading(base, conflict)).toBe('Your version (v5)');
    });

    it('formatYourCardHeading falls back to the version-less heading when base is undefined (evicted)', () => {
        expect(formatYourCardHeading(undefined, conflict)).toBe('Your version');
    });

    it('formatVersionCardSavedLine renders an ABSOLUTE date, distinct from the banner’s relative time', () => {
        expect(formatVersionCardSavedLine(server, 'en', conflict)).toContain('Saved: May 9, 2026');
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
        expect(formatMergeSummary({}, conflict, 'en')).toBe(
            'Summary: 0 choices from server, 0 choices from your version',
        );
    });

    it('tallies each side’s explicit picks, correctly pluralized', () => {
        const selections: RecipeMergeSelections = {
            title: 'theirs',
            servings: 'theirs',
            'steps[1]': 'mine',
        };

        expect(countMergeSelections(selections)).toEqual({ server: 2, mine: 1 });
        expect(formatMergeSummary(selections, conflict, 'en')).toBe(
            'Summary: 2 choices from server, 1 choice from your version',
        );
    });

    it('does not count an absent key — only EXPLICIT selections, not the implied default', () => {
        // `composeMergedRecipe`/`composeConflictMerge` still default an absent key to "mine", but the running
        // summary reports what the user actively picked, not the composed result.
        expect(countMergeSelections({ title: 'theirs' })).toEqual({ server: 1, mine: 0 });
    });
});
