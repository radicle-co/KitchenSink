/**
 * Unit tests for the diff-row label and glyph resolvers (`versions/diffLabels.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { ConflictFieldRow } from '../conflictDiff.js';
import {
    conflictFieldKindLabel,
    conflictMarkerGlyph,
    conflictMarkerLabel,
    conflictOptionLabel,
    conflictOptionName,
    conflictRowLabel,
    conflictRowName,
} from '../diffLabels.js';
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

/**
 * Curated U15 (R27): a NAME that includes a variant-bound line includes all its parts, comma-separated for a screen
 * reader, and starts with the visible text (SC 2.5.3). The visible LABEL never carries them: the dotted line under it
 * does (R25).
 */
describe('conflict row and option names carry the variant’s parts (curated U15)', () => {
    const rebindRow: ConflictFieldRow = {
        key: 'ingredients:ing_point',
        fieldKind: 'ingredient',
        marker: 'changed',
        mine: '',
        theirs: '2 lb beef brisket',
        mineChanged: false,
        theirsChanged: true,
        theirsVariantParts: ['point half', 'choice'],
    };
    const titleRow: ConflictFieldRow = {
        key: 'title',
        fieldKind: 'title',
        marker: 'changed',
        mine: 'My Draft Title',
        theirs: 'Latest Saved Title',
        mineChanged: true,
        theirsChanged: false,
    };

    /** An ingredient row with the given sides; no side carries parts unless stated. */
    const ingredientRow = (
        over: Partial<Extract<ConflictFieldRow, { fieldKind: 'ingredient' }>>,
    ): ConflictFieldRow => ({
        key: 'ingredients:ing_1',
        fieldKind: 'ingredient',
        marker: 'changed',
        mine: '',
        theirs: '',
        mineChanged: true,
        theirsChanged: true,
        ...over,
    });

    it.each([
        ['theirs', rebindRow, 'Ingredient: 2 lb beef brisket, point half, choice'],
        [
            'mine',
            ingredientRow({ mine: '3 lb beef brisket', mineVariantParts: ['flat half', 'select'] }),
            'Ingredient: 3 lb beef brisket, flat half, select',
        ],
        [
            'base',
            ingredientRow({ base: '1 lb beef brisket', baseVariantParts: ['flat half'] }),
            'Ingredient: 1 lb beef brisket, flat half',
        ],
    ])('names a row with the parts of the side its label reads (%s)', (_side, row, name) => {
        expect(conflictRowName(row, conflict)).toBe(name);
        expect(conflictRowName(row, conflict).startsWith(conflictRowLabel(row, conflict))).toBe(true);
    });

    it('does not take parts from a side the label does not read', () => {
        const row = ingredientRow({ theirs: '2 lb beef brisket', mineVariantParts: ['flat half'] });

        expect(conflictRowName(row, conflict)).toBe('Ingredient: 2 lb beef brisket');
    });

    it('names a scalar row and a root-bound row by their visible label alone', () => {
        const { theirsVariantParts: _unused, ...rootBound } = rebindRow;

        expect(conflictRowName(titleRow, conflict)).toBe('Title');
        expect(conflictRowName(rootBound, conflict)).toBe('Ingredient: 2 lb beef brisket');
    });

    it('labels an option with its side and value, and never the parts', () => {
        expect(conflictOptionLabel(rebindRow, 'theirs', conflict)).toBe('Latest saved version: 2 lb beef brisket');
        expect(conflictOptionLabel(rebindRow, 'mine', conflict)).toBe('Your version: ');
        expect(conflictOptionLabel(titleRow, 'mine', conflict)).toBe('Your version: My Draft Title');
    });

    it('names an option with its own side’s parts, after its visible label', () => {
        expect(conflictOptionName(rebindRow, 'theirs', conflict)).toBe(
            'Latest saved version: 2 lb beef brisket, point half, choice',
        );
        expect(conflictOptionName(rebindRow, 'mine', conflict)).toBe(conflictOptionLabel(rebindRow, 'mine', conflict));
        expect(conflictOptionName(titleRow, 'theirs', conflict)).toBe('Latest saved version: Latest Saved Title');
    });
});
