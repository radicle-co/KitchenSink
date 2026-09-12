/**
 * Unit tests for the diff-row label and glyph resolvers (`versions/diffLabels.ts`).
 *
 * ⚠️ These 3 describe blocks came from `model.test.ts`, which covered all of
 * `versions/model.ts` before it was split into one module per concern. No assertion was
 * changed, added or dropped in the move — the suite is redistributed, not rewritten.
 */
import { describe, expect, it } from 'vitest';
import type { ConflictFieldRow } from '../conflictDiff.js';
import { conflictFieldKindLabel, conflictMarkerGlyph, conflictMarkerLabel, conflictRowLabel } from '../diffLabels.js';
import { recipeVersionMessages } from '../messages.js';

const conflict = recipeVersionMessages.en.conflict;

describe('conflictFieldKindLabel (W7 Task 1 → Task 3)', () => {
    it('resolves each scalar field kind to its shared field label', () => {
        expect(conflictFieldKindLabel('title', conflict)).toBe('Title');
        expect(conflictFieldKindLabel('description', conflict)).toBe('Description');
        expect(conflictFieldKindLabel('servings', conflict)).toBe('Servings');
        expect(conflictFieldKindLabel('prepTimeMinutes', conflict)).toBe('Prep time');
        expect(conflictFieldKindLabel('cookTimeMinutes', conflict)).toBe('Cook time');
    });

    it('resolves the per-element step/ingredient row kinds to the shared PLURAL field labels', () => {
        expect(conflictFieldKindLabel('step', conflict)).toBe('Steps');
        expect(conflictFieldKindLabel('ingredient', conflict)).toBe('Ingredients');
    });
});

describe('conflictMarkerGlyph / conflictMarkerLabel (W7 Task 4 / X1)', () => {
    it('resolves each marker to its ASCII glyph', () => {
        expect(conflictMarkerGlyph('unchanged', conflict)).toBe('[=]');
        expect(conflictMarkerGlyph('changed', conflict)).toBe('[→]');
        expect(conflictMarkerGlyph('conflict', conflict)).toBe('[!!]');
    });

    it('resolves each marker to a DISTINCT accessible label — never colour alone', () => {
        expect(conflictMarkerLabel('unchanged', conflict)).toBe('unchanged');
        expect(conflictMarkerLabel('changed', conflict)).toBe('changed');
        expect(conflictMarkerLabel('conflict', conflict)).toBe('conflict');
    });
});

describe('conflictRowLabel (W7 Task 4 / X1)', () => {
    const baseRow: ConflictFieldRow = {
        key: 'title',
        fieldKind: 'title',
        marker: 'changed',
        mine: 'My Draft Title',
        theirs: 'Latest Saved Title',
        mineChanged: true,
        theirsChanged: false,
    };

    it('resolves a scalar row to its shared field label (no position/identity to add)', () => {
        expect(conflictRowLabel(baseRow, conflict)).toBe('Title');
        expect(conflictRowLabel({ ...baseRow, key: 'servings', fieldKind: 'servings' }, conflict)).toBe('Servings');
    });

    it('resolves a step row to its 1-based position, decoded from the `steps[N]` key', () => {
        const row: ConflictFieldRow = {
            ...baseRow,
            key: 'steps[2]',
            fieldKind: 'step',
            mine: 'Add spinach and cook until wilted',
            theirs: 'Add kale and cook until wilted',
        };

        expect(conflictRowLabel(row, conflict)).toBe('Step 3');
        expect(conflictRowLabel({ ...row, key: 'steps[0]' }, conflict)).toBe('Step 1');
    });

    it('resolves an ingredient row to its identity — the SERVER-FIRST (X7) non-empty formatted value', () => {
        const row: ConflictFieldRow = {
            ...baseRow,
            key: 'ingredients:ing_1',
            fieldKind: 'ingredient',
            mine: '250g Pasta',
            theirs: '200g Pasta',
        };

        expect(conflictRowLabel(row, conflict)).toBe('Ingredient: 200g Pasta');
    });

    it('falls back to mine’s value for an ingredient row when theirs is empty (removed on their side)', () => {
        const row: ConflictFieldRow = {
            ...baseRow,
            key: 'ingredients:ing_1',
            fieldKind: 'ingredient',
            mine: '250g Pasta',
            theirs: '',
            theirsChanged: true,
        };

        expect(conflictRowLabel(row, conflict)).toBe('Ingredient: 250g Pasta');
    });

    it('falls back to base’s value for an ingredient row when both mine and theirs are empty (removed by both)', () => {
        const row: ConflictFieldRow = {
            ...baseRow,
            key: 'ingredients:ing_1',
            fieldKind: 'ingredient',
            base: '200g Pasta',
            mine: '',
            theirs: '',
        };

        expect(conflictRowLabel(row, conflict)).toBe('Ingredient: 200g Pasta');
    });
});
