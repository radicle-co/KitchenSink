/**
 * The editor's one polite message (`pageAnnouncementOf`): the settle string counts the INGREDIENTS the paste added, as the
 * paste reports them, and is one string whether or not the same settle completes Ingredients.
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../messages.js';
import { pageAnnouncementOf } from '../pageAnnouncement.js';
import type { SectionStatuses } from '../sectionStatus.js';

const status = (ingredients: SectionStatuses['ingredients']): SectionStatuses => ({
    details: { kind: 'complete' },
    ingredients,
    steps: { kind: 'complete' },
    photos: { kind: 'optional' },
});
const say = (before: SectionStatuses['ingredients'], after: SectionStatuses['ingredients'], count: number) =>
    pageAnnouncementOf({
        previous: status(before),
        next: status(after),
        previousAdded: undefined,
        nextAdded: { count, occurrence: 1 },
        messages: editorMessages.en,
        locale: 'en',
    });

describe('the settle message', () => {
    it('says the ingredients added, with the completion, as one string', () => {
        expect(say({ kind: 'inProgress', reason: 'ingredientsReading' }, { kind: 'complete' }, 6)).toBe(
            'Added 6 ingredients. Ingredients complete.',
        );
    });

    it('says only the ingredients added when the settle does not complete Ingredients', () => {
        expect(
            say(
                { kind: 'inProgress', reason: 'ingredientsReading' },
                { kind: 'attention', reason: 'ingredientsNeedYou', count: 1 },
                5,
            ),
        ).toBe('Added 5 ingredients.');
    });

    it('says one ingredient in the singular', () => {
        expect(say({ kind: 'inProgress', reason: 'ingredientsReading' }, { kind: 'complete' }, 1)).toBe(
            'Added 1 ingredient. Ingredients complete.',
        );
    });
});
