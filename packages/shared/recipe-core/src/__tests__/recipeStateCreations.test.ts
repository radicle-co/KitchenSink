import { describe, expect, it } from 'vitest';

import { CREATIONS } from '../recipeState/creations.js';

describe('CREATIONS (5.7)', () => {
    it('names every way a recipe comes into being, once', () => {
        expect(CREATIONS.map((row) => row.id)).toEqual([
            'CREATE_DRAFT',
            'CREATE_PUBLISHED',
            'IMPORT_SAVE',
            'CURATOR_IMPORT',
            'CLONE',
            'CLONE_OF_PUBLIC_VERSION',
            'PUBLIC_VERSION_PUBLISH',
        ]);
    });

    it('creates a draft private and unstated, and only the 003B publish creates Commise-written', () => {
        const draft = CREATIONS.find((row) => row.id === 'CREATE_DRAFT');
        const writers = CREATIONS.filter((row) => row.origin === 'ORIGIN_COMMISE_WRITTEN').map((row) => row.id);

        expect(draft).toMatchObject({ states: ['DPr'], origin: 'ORIGIN_UNSTATED', confirmation: 'unconfirmed' });
        expect(writers).toEqual(['PUBLIC_VERSION_PUBLISH']);
    });

    it('lets only a clone copy the correction hold, and only a clone carry a clone link', () => {
        expect(CREATIONS.filter((row) => row.copiesSourceCorrectedHold).map((row) => row.id)).toEqual([
            'CLONE',
            'CLONE_OF_PUBLIC_VERSION',
        ]);
        expect(CREATIONS.filter((row) => row.cloneLink).map((row) => row.id)).toEqual([
            'CLONE',
            'CLONE_OF_PUBLIC_VERSION',
        ]);
    });
});
