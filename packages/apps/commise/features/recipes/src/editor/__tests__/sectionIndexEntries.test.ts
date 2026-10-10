/**
 * What the section index draws for the editor's statuses (build spec §7.2): each status as a tone and words, the
 * phone bar's name and count, and guided progress for a first recipe. The words are the editor's copy; the index
 * primitive knows nothing about recipes.
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../messages.js';
import { sectionIndexEntries } from '../sectionIndexEntries.js';
import type { SectionStatuses } from '../sectionStatus.js';

const m = editorMessages.en;

const EMPTY: SectionStatuses = {
    details: { kind: 'notStarted' },
    ingredients: { kind: 'notStarted' },
    steps: { kind: 'notStarted' },
    photos: { kind: 'optional' },
};

function entries(statuses: SectionStatuses, guided = false, current: 'details' | 'ingredients' = 'details') {
    return sectionIndexEntries({ statuses, guided, current, messages: m, locale: 'en' });
}

describe('sectionIndexEntries — items', () => {
    it('labels every section with its heading text, the strip`s short label for Photos & publish', () => {
        expect(entries(EMPTY).items.map((item) => [item.id, item.label, item.shortLabel])).toEqual([
            ['details', 'Details', undefined],
            ['ingredients', 'Ingredients', undefined],
            ['steps', 'Steps', undefined],
            ['photos', 'Photos & publish', 'Photos'],
        ]);
    });

    it.each([
        [
            { kind: 'fix', count: 2 },
            { tone: 'fix', reason: 'Fix 2 things', count: 2 },
        ],
        [
            { kind: 'fix', count: 1 },
            { tone: 'fix', reason: 'Fix 1 thing', count: 1 },
        ],
        [
            { kind: 'attention', reason: 'ingredientsUnresolved', count: 2 },
            { tone: 'attention', reason: '2 need a match', count: 2 },
        ],
        [
            { kind: 'attention', reason: 'ingredientsUnresolved', count: 1 },
            { tone: 'attention', reason: '1 needs a match', count: 1 },
        ],
        [
            { kind: 'attention', reason: 'titleTooLong', count: 1 },
            { tone: 'attention', reason: 'Title too long', count: 1 },
        ],
        [
            { kind: 'inProgress', reason: 'titleRequired' },
            { tone: 'muted', reason: 'Title needed' },
        ],
        [{ kind: 'notStarted' }, { tone: 'muted', reason: 'Not started' }],
        // Quiet: no words shown, but a screen reader hears it (the ✓ alone has no text alternative).
        [{ kind: 'complete' }, { tone: 'complete', spokenStatus: 'Complete' }],
    ] as const)('draws %j as %j', (status, drawn) => {
        const [, ingredients] = entries({ ...EMPTY, ingredients: status }).items;

        expect(ingredients).toEqual({ id: 'ingredients', label: 'Ingredients', ...drawn });
    });

    it('says "Optional" for Photos & publish, and "Ready to publish" once it is complete', () => {
        expect(entries(EMPTY).items[3]).toMatchObject({ tone: 'muted', reason: 'Optional' });
        expect(entries({ ...EMPTY, photos: { kind: 'complete' } }).items[3]).toMatchObject({
            tone: 'complete',
            reason: 'Ready to publish',
        });
    });
});

describe('sectionIndexEntries — the phone bar', () => {
    it('names the current section, and counts what needs action', () => {
        const statuses: SectionStatuses = {
            ...EMPTY,
            ingredients: { kind: 'attention', reason: 'ingredientsUnresolved', count: 2 },
            steps: { kind: 'fix', count: 1 },
        };
        const drawn = entries(statuses, false, 'ingredients');

        expect(drawn.barName).toBe('Sections. Current: Ingredients. 3 need attention.');
        expect(drawn.barCount).toBe('⚠ 3');
        expect(drawn.barSuffix).toBeUndefined();
    });

    it('says nothing about attention when nothing needs it', () => {
        const drawn = entries(EMPTY);

        expect(drawn.barName).toBe('Sections. Current: Details.');
        expect(drawn.barCount).toBeUndefined();
    });
});

describe('sectionIndexEntries — guided progress (a first recipe, D1)', () => {
    it('adds the hints, "Start here" on an untouched Details, and the done count', () => {
        const drawn = entries({ ...EMPTY, steps: { kind: 'complete' } }, true);

        expect(drawn.items.map((item) => item.hint)).toEqual([
            'Name it and say how long it takes',
            'Add what goes in',
            'Say how to make it',
            'Add a photo, then publish',
        ]);
        expect(drawn.items[0]).toMatchObject({ tone: 'muted', reason: 'Start here' });
        expect(drawn.doneText).toBe('1 of 4 done');
        expect(drawn.barSuffix).toBe(' · 1 of 4 done');
        expect(drawn.barName).toBe('Sections. Current: Details. 1 of 4 done.');
    });

    it('shows none of it once the cook has published before', () => {
        const drawn = entries(EMPTY, false);

        expect(drawn.items.every((item) => item.hint === undefined)).toBe(true);
        expect(drawn.items[0]).toMatchObject({ reason: 'Not started' });
        expect(drawn.doneText).toBeUndefined();
    });
});
