/**
 * The Cuisine field's list, as a pure function of its text (`docs/design/uiOverhaul/cuisineField.md` §3.1, S2–S7):
 * which groups show, when the cook's own words are offered as "Use “…”", the no-match note, and the polite count.
 */
import { describe, expect, it } from 'vitest';

import { CUISINES } from '@kitchensink/recipe-core';

import { CUISINE_USE_OWN_KEY, cuisineCommitOf, cuisineFieldView } from '../cuisineField.js';
import { recipeFormMessages } from '../messages.js';

const messages = recipeFormMessages.en;

const view = (text: string, filtering = true) => cuisineFieldView({ text, filtering, messages, locale: 'en' });

/** Every option key, group by group. */
const keysOf = (text: string, filtering = true) =>
    view(text, filtering).groups.map((group) => group.options.map((option) => option.key));

describe('cuisineFieldView', () => {
    it('S2 — an empty field lists all 90, nothing else, and says so', () => {
        const shown = view('');

        expect(keysOf('')).toEqual([[...CUISINES]]);
        expect(shown.status).toBeUndefined();
        expect(shown.announcement).toBe('90 cuisines');
    });

    it('S6/S7 — a committed value the cook has not edited since focus still lists all 90 (filter text is not the value)', () => {
        expect(keysOf('Thai', false)).toEqual([[...CUISINES]]);
        expect(view('Nyonya', false).announcement).toBe('90 cuisines');
    });

    it('S3 — matches, then a "Not listed?" group offering the canonical form of the text', () => {
        const shown = view('ind');
        const [matches, own] = shown.groups;

        expect(matches?.options.map((option) => option.label)).toEqual(['Indian', 'Indonesian']);
        expect(matches?.label).toBeUndefined();
        expect(own?.label).toBe('Not listed?');
        expect(own?.options).toEqual([
            { key: CUISINE_USE_OWN_KEY, label: 'Use “Ind”', accessibleName: 'Use “Ind” as the cuisine' },
        ]);
        expect(shown.status).toBeUndefined();
        expect(shown.announcement).toBe('2 cuisines');
    });

    it('S4 — an exact match (or an alias of one) offers no Use option: the entry IS the value', () => {
        expect(keysOf('thai')).toEqual([['Thai']]);
        expect(view('thai').announcement).toBe('1 cuisine');
        expect(keysOf('Iranian')).toEqual([['Persian']]);
    });

    it('S5 — no match: the note first, then one Use option with no heading, and the note is what is spoken', () => {
        const shown = view('nyonya');

        expect(shown.status).toEqual({
            kind: 'note',
            text: 'No cuisines match “Nyonya”. You can use it as your own.',
        });
        expect(shown.groups).toEqual([
            {
                key: 'own',
                options: [
                    { key: CUISINE_USE_OWN_KEY, label: 'Use “Nyonya”', accessibleName: 'Use “Nyonya” as the cuisine' },
                ],
            },
        ]);
        expect(shown.announcement).toBe('No cuisines match “Nyonya”. You can use it as your own.');
    });

    it('S9 — the Use option carries the whole text, however long: the text is the value', () => {
        const long = `a${'b'.repeat(119)}`;

        expect(view(long).groups[0]?.options[0]?.label).toBe(`Use “A${'b'.repeat(119)}”`);
    });

    it('treats blank text as empty: all 90, no Use option', () => {
        expect(keysOf('   ')).toEqual([[...CUISINES]]);
    });

    it('no list entry is the Use key, so a pick can never be mistaken for the cook’s own words', () => {
        expect(CUISINES as readonly string[]).not.toContain(CUISINE_USE_OWN_KEY);
    });
});

describe('cuisineCommitOf', () => {
    it('commits an entry as it is spelled in the list', () => {
        expect(cuisineCommitOf('Thai', 'th')).toBe('Thai');
    });

    it('commits the cook’s own words, canonical, for the Use option', () => {
        expect(cuisineCommitOf(CUISINE_USE_OWN_KEY, '  nyonya ')).toBe('Nyonya');
        expect(cuisineCommitOf(CUISINE_USE_OWN_KEY, 'szechuan')).toBe('Sichuan');
    });
});
