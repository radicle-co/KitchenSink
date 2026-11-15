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

    it('says the words the design names for the first cooking states', () => {
        expect(en.top.exit).toBe('Exit');
        expect(en.top.exitA11y).toBe('Exit cooking mode');
        expect(en.nav.back).toBe('Back');
        expect(en.nav.backA11yRecipe).toBe('Back to the recipe');
        expect(en.nav.next).toBe('Next step');
        expect(en.nav.finish).toBe('Finish');
        expect(en.nav.startStep).toBe('Start step\u00a0{n}');
        expect(en.nav.nextPreview).toBe('Next · step\u00a0{n}');
        expect(en.next.upNext).toBe('Up next · step\u00a0{n}');
        expect(en.step.lineOf).toBe('Line\u00a0{current} of {total}');
        expect(en.step.show).toBe('Show');
        expect(en.done.title.one).toBe('All done');
        expect(en.done.title.other).toBe('All {count} steps done');
        expect(en.done.screenOff).toBe('The screen can turn off again.');
        expect(en.done.backToRecipe).toBe('Back to the recipe');
        expect(en.done.cookAgain).toBe('Cook it again');
        expect(en.loading.label).toBe('Opening the recipe…');
        expect(en.error.title).toBe('We couldn’t open this recipe');
        expect(en.empty.title).toBe('This recipe has no steps yet');
        expect(en.gone.title).toBe('This recipe isn’t available any more');
        expect(en.gone.home).toBe('Go to Home');
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
        expect(placeholdersOf(en.step.lineOf)).toEqual(['current', 'total']);
        expect(placeholdersOf(en.done.title.one)).toEqual([]);
        expect(placeholdersOf(en.done.title.other)).toEqual(['count']);
        expect(placeholdersOf(en.done.enjoy)).toEqual(['recipe']);
    });
});
