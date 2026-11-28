import { describe, expect, it } from 'vitest';

import { LABELLED_NAMES, labelKeysOf, type LabelKey } from '../recipeState/labelledNames.js';
import { RETIRED_NAMES } from '../recipeState/retiredNames.js';
import { Audience, Lifecycle, Origin } from '../recipeState/recipeStateValues.js';

describe('LABELLED_NAMES', () => {
    it('has a key for every stored value the model labels, and none for a value it deliberately does not', () => {
        for (const name of [
            'LIFECYCLE_DRAFT',
            ...Object.keys(Audience),
            ...Object.keys(Origin).filter((n) => n !== 'ORIGIN_UNSTATED'),
        ]) {
            expect(Object.keys(LABELLED_NAMES)).toContain(name);
        }

        expect(Object.keys(LABELLED_NAMES)).not.toContain('LIFECYCLE_PUBLISHED');
        expect(Object.keys(LABELLED_NAMES)).not.toContain('ORIGIN_UNSTATED');
        expect(Object.keys(Lifecycle)).toContain('LIFECYCLE_PUBLISHED');
    });

    it('writes a key as the name plus its shape, and a bare name for the empty shape', () => {
        expect(labelKeysOf('ORIGIN_WEB_PAGE')).toEqual(['ORIGIN_WEB_PAGE', 'ORIGIN_WEB_PAGE.withSite']);
        expect(labelKeysOf('ORIGIN_OWN')).toEqual(['ORIGIN_OWN.owner', 'ORIGIN_OWN.reader']);
        expect(labelKeysOf('AUDIENCE_PUBLIC')).toEqual(['AUDIENCE_PUBLIC']);

        expect(labelKeysOf('REPORT_SIGN_IN')).toContain('REPORT_SIGN_IN.body' satisfies LabelKey);
    });

    it('keeps every key unique across the registry', () => {
        const keys = Object.keys(LABELLED_NAMES).flatMap((name) => labelKeysOf(name as keyof typeof LABELLED_NAMES));

        expect(new Set(keys).size).toBe(keys.length);
    });

    it('never gives the reserved FOOD_ prefix to a recipe name', () => {
        expect(Object.keys(LABELLED_NAMES).filter((name) => name.startsWith('FOOD_'))).toEqual([]);
    });
});

describe('RETIRED_NAMES', () => {
    it('keeps the three groups of the document and never an empty replacement', () => {
        expect(new Set(RETIRED_NAMES.map((entry) => entry.group))).toEqual(
            new Set(['audience', 'originAndCopies', 'checkAndRefusals']),
        );
        expect(RETIRED_NAMES.filter((entry) => entry.replacement === '')).toEqual([]);
    });
});
