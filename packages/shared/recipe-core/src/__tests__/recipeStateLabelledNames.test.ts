import { describe, expect, expectTypeOf, it } from 'vitest';

import { LABELLED_NAMES, labelKeysOf, type LabelKey } from '../recipeState/labelledNames.js';
import { RETIRED_NAMES } from '../recipeState/retiredNames.js';
import type { SaveRefusalCause } from '../recipeState/refusalOf.js';
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

describe('LABELLED_NAMES: held means hidden (ADR-0105, AE10)', () => {
    const keys = (name: keyof typeof LABELLED_NAMES): readonly string[] => LABELLED_NAMES[name].shapes;

    it('holds exactly the shape list of each new name', () => {
        expect(keys('VIEW_HIDDEN')).toEqual(['']);
        expect(keys('VIEW_HIDDEN_REASON')).toEqual([
            '.heldSource',
            '.tooClose',
            '.afterCheck',
            '.notApproved',
            '.sourceCorrected',
        ]);
        expect(keys('VIEW_SAVE_REFUSED')).toEqual([
            '.title',
            '.why.heldSource',
            '.why.tooClose',
            '.why.notApproved',
            '.wayRewrite',
            '.wayRewriteAction',
            '.wayDiscard',
            '.wayHide',
            '.wayHideAction',
        ]);
        expect(keys('VIEW_CARD_CANNOT_STAY_PUBLIC')).toEqual(['.heldSource', '.tooClose', '.sourceCorrected']);
        expect(keys('VIEW_SAVE_REFUSED_LATE')).toEqual(['']);
        expect(keys('VIEW_DRAFT_DOOR')).toEqual(['.title', '.publishPrivateOnly']);
    });

    it('puts no slots-full, Pro or Close line under a way, and copies no existing key', () => {
        const all = Object.keys(LABELLED_NAMES).flatMap((name) => labelKeysOf(name as keyof typeof LABELLED_NAMES));

        expect(all.filter((key) => /\.way/.test(key) && /slot|pro|premium|close|back|upsell/i.test(key))).toEqual([]);
        expect(all.filter((key) => /wayPrivateSave|savePrivate|changesKept|waysHeading|draftKept/.test(key))).toEqual(
            [],
        );
        expect(all.filter((key) => key.endsWith('.publishPrivate'))).toEqual([]);
    });

    it('keeps the cause a plain string union, equal to the why shapes of the refused-save sheet', () => {
        type CauseOf<K> = K extends `VIEW_SAVE_REFUSED.why.${infer C}` ? C : never;

        expectTypeOf<SaveRefusalCause>().toEqualTypeOf<'heldSource' | 'tooClose' | 'notApproved'>();
        expectTypeOf<CauseOf<LabelKey>>().toEqualTypeOf<SaveRefusalCause>();
    });

    it('drops the names that said a recipe was made private, and lists each as retired with a replacement', () => {
        const retired = [
            'VIEW_NOT_APPROVED',
            'VIEW_TOO_CLOSE_SAVED_PRIVATE',
            'VIEW_TOO_CLOSE_NO_SLOT',
            'VIEW_TOO_CLOSE_AFTER_REVIEW',
            'VIEW_SOURCE_HOLD_SAVED_PRIVATE',
            'VIEW_SOURCE_HOLD_AFTER_CHECK',
            'REFUSAL_DETECTED_NO_PRIVATE_SLOT',
        ];

        for (const name of retired) {
            expect(Object.keys(LABELLED_NAMES), name).not.toContain(name);
            expect(
                RETIRED_NAMES.filter((entry) => entry.old.includes(name)),
                name,
            ).not.toEqual([]);
        }

        for (const title of ['"Not approved to be public."', '"Saved as private"', '"Made private after a check"']) {
            expect(
                RETIRED_NAMES.some((entry) => entry.old.includes(title)),
                title,
            ).toBe(true);
        }

        expect(RETIRED_NAMES.find((entry) => entry.old === '"Not approved" (bare, as a chip)')?.replacement).toContain(
            'VIEW_HIDDEN_REASON.notApproved',
        );
    });
});
