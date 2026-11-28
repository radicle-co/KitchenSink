/**
 * The recipe state model's English strings (docs/architecture/recipeStateModel.md 4.4, 4.5, 4.8). Every key the registry
 * requires has a string, no other key exists, and a string the model says to reuse IS the existing one, not a copy.
 */
import {
    REFUSAL,
    labelKeysOf,
    LABELLED_NAMES,
    noticeWithEarned,
    type LabelledNameKey,
} from '@kitchensink/recipe-core/recipe-state';
import { describe, expect, it } from 'vitest';

import { recipeActionMessages } from '../../actions/messages.js';
import { editorMessages } from '../../editor/messages.js';
import { recipeMessages } from '../../messages.js';
import { RECIPE_STATE_REFUSAL_LINES, recipeStateMessages } from '../messages.js';

const en = recipeStateMessages.en;
const byText = (a: string, b: string): number => a.localeCompare(b);

describe('recipeStateMessages', () => {
    it('has exactly the keys the registry requires', () => {
        const required = (Object.keys(LABELLED_NAMES) as LabelledNameKey[]).flatMap((name) => labelKeysOf(name));

        expect(Object.keys(en.labels).sort(byText)).toEqual([...required].sort(byText));

        for (const [key, text] of Object.entries(en.labels)) {
            expect(text.length, key).toBeGreaterThan(0);
        }
    });

    it('reuses the existing strings the model names, rather than copying them', () => {
        expect(en.labels.LIFECYCLE_DRAFT).toBe(recipeMessages.en.card.draftBadge);
        expect(en.labels.AUDIENCE_PRIVATE).toBe(recipeMessages.en.card.visibilityPrivate);
        expect(en.labels.AUDIENCE_PUBLIC).toBe(recipeMessages.en.card.visibilityPublic);
        expect(en.labels.LABEL_SEPARATOR).toBe(recipeMessages.en.card.separator);
        expect(en.labels.VIEW_CHANGES_ON_DEVICE).toBe(editorMessages.en.status.changesOnDevice);
        expect(en.refusals.REFUSAL_POLICY_WEB_PAGE).toBe(recipeActionMessages.en.publicRefusal.policyWebPage);
        expect(en.refusals.REFUSAL_POLICY_BOOK).toBe(recipeActionMessages.en.publicRefusal.policyBook);
        expect(en.refusals.REFUSAL_POLICY_PAID_SITE).toBe(recipeActionMessages.en.publicRefusal.policyPaidSite);
        expect(en.refusals.REFUSAL_FROM_PERSON).toBe(recipeActionMessages.en.publicRefusal.fromPerson);
        expect(en.refusals.REFUSAL_SOURCE_CONFLICT).toBe(recipeActionMessages.en.publicRefusal.sourceConflict);
        expect(en.refusals.REFUSAL_UNRECOGNISED).toBe(recipeActionMessages.en.publicRefusal.unrecognised);
    });

    it('words the labels and refusals the model words', () => {
        expect(en.labels['ORIGIN_OWN.owner']).toBe('Written by you');
        expect(en.labels['ORIGIN_OWN.reader']).toBe('Written by {cook}');
        expect(en.labels['ORIGIN_WEB_PAGE.withSite']).toBe('From {site}');
        expect(en.labels.ORIGIN_COMMISE_WRITTEN).toBe('Written by Commise');
        expect(en.labels.SOURCE_HEADING).toBe('Source');
        expect(en.labels.VIEW_COPY_OF).toBe('Copied from {name}');
        expect(en.labels.ANSWER_UNSTATED_PRIVATE).toBe('I’m not sure yet');
        expect(en.refusals.REFUSAL_SOURCE_CORRECTED).toBe(
            'This recipe stays private because its source was corrected.',
        );
        expect(en.refusals.REFUSAL_STATEMENT_REQUIRED).toBe('Say where this recipe is from before making it public.');
        expect(en.refusals.REFUSAL_CONTENT_NOT_APPROVED).toBe(
            'This recipe stays private because it wasn’t approved to be public.',
        );
    });

    it('gives a refusal line only to a name that is a refusal, and never to "none"', () => {
        for (const name of RECIPE_STATE_REFUSAL_LINES) {
            expect(Object.keys(REFUSAL)).toContain(name);
            expect(name).not.toBe('REFUSAL_NONE');
        }

        expect(Object.keys(en.refusals).sort(byText)).toEqual([...RECIPE_STATE_REFUSAL_LINES].sort(byText));
    });

    it('never says "Adapted from" or "Cloned", which the model retired', () => {
        const all = [...Object.values(en.labels), ...Object.values(en.refusals)].join('\n');

        expect(all).not.toMatch(/Adapted from\b(?! a)/);
        expect(all).not.toMatch(/Cloned/);
    });
});

describe('the earned sentence (VIEW_ADAPTED_BY_COOK.earnedSentence)', () => {
    const earned = en.labels['VIEW_ADAPTED_BY_COOK.earnedSentence'];

    it('is a second sentence, so the save notice says "Changes saved." once', () => {
        const notice = noticeWithEarned(editorMessages.en.changesSaved, earned);

        expect(notice).toBe(`${editorMessages.en.changesSaved} This recipe is now marked Adapted by you.`);
        expect(notice.split(editorMessages.en.changesSaved).length - 1).toBe(1);
    });

    it('is added after the publish outcome too (AE16: earned at a publish)', () => {
        expect(noticeWithEarned(editorMessages.en.published, earned)).toBe(
            `${editorMessages.en.published} This recipe is now marked Adapted by you.`,
        );
    });

    it('restates no outcome of its own', () => {
        expect(earned).not.toMatch(/saved|published/i);
    });
});
