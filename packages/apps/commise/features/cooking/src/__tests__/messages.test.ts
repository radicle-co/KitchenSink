import { resolveMessages } from '@commise/i18n';
import { describe, expect, it } from 'vitest';

import { cookingMessages } from '../messages.js';

/** The path of every value in a message set that is not a non-empty string. */
function badLeaves(value: unknown, path: string): string[] {
    if (typeof value === 'string') {
        return value.trim().length === 0 ? [path] : [];
    }

    if (typeof value === 'object' && value !== null) {
        return Object.entries(value).flatMap(([key, child]) => badLeaves(child, `${path}.${key}`));
    }

    return [path];
}

/** The placeholder names a message uses, in order. */
const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '');

describe('cookingMessages', () => {
    const en = resolveMessages(cookingMessages, 'en');

    it('has no empty string and nothing but strings in the English set', () => {
        expect(badLeaves(en, 'cooking')).toEqual([]);
    });

    it('says the place and the step announcement, with and without a focus line', () => {
        expect(en.top.place).toBe('Step\u00a0{current} of {total}');
        expect(en.step.announce).toBe('Step {current} of {total}. {line}');
        // Every line ticked leaves no focus line to read, so the announcement is the place alone.
        expect(en.step.announceNoLine).toBe('Step {current} of {total}.');
        expect(placeholdersOf(en.top.place)).toEqual(['current', 'total']);
        expect(placeholdersOf(en.step.announce)).toEqual(['current', 'total', 'line']);
        expect(placeholdersOf(en.step.announceNoLine)).toEqual(['current', 'total']);
    });

    it('keeps the ticked summary as a singular and a plural, each with its words', () => {
        expect(en.step.tickedSummary.one).toBe('You ticked 1 line');
        expect(en.step.tickedSummary.other).toBe('You ticked {count} lines');
    });

    // The ingredients copy is the designer's, as the boards draw it. One test pins the words, so a reword is a
    // decision here and never a silent edit; every behaviour test reads the text through `cookingMessages.en`.
    it('says the ingredients list and the scale note as the designer decided', () => {
        expect(en.top.ingredients).toBe('Ingredients');
        expect(en.ingredients.title.one).toBe('Ingredients for {servings} \u00b7 1 item');
        expect(en.ingredients.title.other).toBe('Ingredients for {servings} \u00b7 {count} items');
        expect(en.ingredients.close).toBe('Close ingredients');
        expect(en.ingredients.clear).toBe('Clear ticks');
        expect(en.ingredients.cleared).toBe('Ticks cleared');
        expect(en.step.scaleNote).toBe(
            'The steps give amounts for {base}. You\u2019re making {servings}, so use the amounts in Ingredients.',
        );
        expect(en.step.scaleNoteOpen).toBe('Open ingredients');
        expect(placeholdersOf(en.step.scaleNote)).toEqual(['base', 'servings']);
        expect(placeholdersOf(en.ingredients.title.other)).toEqual(['servings', 'count']);
    });

    it('joins each visible word and its number with a no-break space, never a plain space', () => {
        const visible = [en.top.place, en.nav.startStep, en.nav.nextPreview, en.next.upNext, en.step.lineOf];

        for (const text of visible) {
            expect(text).toMatch(/(?:step|Step|Line)\u00a0\{(?:n|current)\}/);
            expect(text).not.toMatch(/(?:step|Step|Line) \{(?:n|current)\}/);
            expect(text.split('\u00a0')).toHaveLength(2);
        }

        expect(en.step.announce).not.toContain('\u00a0');
        expect(en.step.announceNoLine).not.toContain('\u00a0');
    });

    it('uses the placeholders the design lists, and no others', () => {
        expect(placeholdersOf(en.nav.backA11y)).toEqual(['n']);
        expect(placeholdersOf(en.nav.nextA11y)).toEqual(['n']);
        expect(placeholdersOf(en.nav.nextPreview)).toEqual(['n']);
        expect(placeholdersOf(en.nav.startStep)).toEqual(['n']);
        expect(placeholdersOf(en.next.upNext)).toEqual(['n']);
        expect(placeholdersOf(en.step.lineOf)).toEqual(['current', 'total']);
        expect(placeholdersOf(en.done.title.one)).toEqual([]);
        expect(placeholdersOf(en.done.title.other)).toEqual(['count']);
        expect(placeholdersOf(en.done.enjoy)).toEqual(['recipe']);
    });
});
