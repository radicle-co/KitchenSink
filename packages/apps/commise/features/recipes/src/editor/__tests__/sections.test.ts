/**
 * The editor's section Registry (blueprint A16): the four sections in page order, the one field -> section map, and the
 * hash a deep link carries. The map is the ONLY statement of which section owns which validation field — the section
 * index, the publish gate's landing and the hash all read it.
 */
import { describe, expect, it } from 'vitest';

import type { RecipeFormErrors } from '../../form/validate.js';
import {
    EDITOR_SECTIONS,
    errorsInSection,
    firstSectionWithErrors,
    sectionFromHash,
    sectionOfField,
    type EditorSectionId,
} from '../sections.js';

describe('EDITOR_SECTIONS', () => {
    it('is the four sections in page order (build spec §7)', () => {
        expect(EDITOR_SECTIONS).toEqual(['details', 'ingredients', 'steps', 'photos']);
    });
});

describe('the field -> section map', () => {
    it.each([
        ['title', 'details'],
        ['servings', 'details'],
        ['times', 'details'],
        ['ingredients', 'ingredients'],
        ['steps', 'steps'],
    ] as const)('%s belongs to %s', (field, section) => {
        expect(sectionOfField(field)).toBe(section);
    });

    it('keeps only a section`s own fields, and drops a key present with no code', () => {
        const errors: RecipeFormErrors = { title: 'titleRequired', ingredients: 'ingredientsEmpty', steps: undefined };

        expect(errorsInSection(errors, 'details')).toEqual({ title: 'titleRequired' });
        expect(errorsInSection(errors, 'ingredients')).toEqual({ ingredients: 'ingredientsEmpty' });
        expect(errorsInSection(errors, 'steps')).toEqual({});
        expect(errorsInSection(errors, 'photos')).toEqual({});
    });
});

describe('firstSectionWithErrors', () => {
    it('is the first in PAGE order, not in the order the keys were written', () => {
        const errors: RecipeFormErrors = { steps: 'stepsRequired', ingredients: 'ingredientsEmpty' };

        expect(firstSectionWithErrors(errors)).toBe('ingredients');
        expect(firstSectionWithErrors({ steps: 'stepsRequired', times: 'timesNonNegative' })).toBe('details');
    });

    it('is undefined when nothing was refused', () => {
        expect(firstSectionWithErrors({})).toBeUndefined();
        expect(firstSectionWithErrors({ title: undefined })).toBeUndefined();
    });
});

describe('sectionFromHash (web deep link, A16)', () => {
    it.each<[string, EditorSectionId | undefined]>([
        ['#details', 'details'],
        ['#ingredients', 'ingredients'],
        ['steps', 'steps'],
        ['#photos', 'photos'],
        ['', undefined],
        ['#', undefined],
        ['#Ingredients', undefined],
        ['#nutrition', undefined],
        ['#constructor', undefined],
    ])('%j → %j', (hash, section) => {
        expect(sectionFromHash(hash)).toBe(section);
    });
});
