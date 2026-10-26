/**
 * Unit tests for `openChoicesCopy.ts`: the words of the sheet that asks before a recipe is published with lines that have
 * no food yet (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, R23). Publishing stays allowed;
 * the sheet names the open lines as a list, says they are saved as written and do not count toward nutrition, names the
 * lines still being checked, and says how many lines count.
 */
import { describe, expect, it } from 'vitest';

import { editorMessages } from '../messages.js';
import { openChoicesCopyOf } from '../openChoicesCopy.js';

const m = editorMessages.en;
const list = (names: readonly string[]): string => new Intl.ListFormat('en', { type: 'conjunction' }).format(names);

describe('openChoicesCopyOf', () => {
    const OPEN = ['Milk', 'day-old bread', 'salt', 'Grandma’s spice mix'];

    it('counts the open lines in the title', () => {
        const copy = openChoicesCopyOf(
            { openNames: OPEN, checkingNames: ['Heavy cream'], counted: 4, total: 9 },
            m,
            'en',
        );

        expect(copy.title).toBe('4 ingredients have no food yet');
    });

    it('names the open lines as the locale writes a list, and says they do not count toward nutrition', () => {
        const copy = openChoicesCopyOf({ openNames: OPEN, checkingNames: [], counted: 4, total: 9 }, m, 'en');

        expect(copy.body).toBe(
            `${list(OPEN)} are saved as written. They don’t count toward nutrition until you choose a food.`,
        );
    });

    it('names a line still being checked, and says it is saved as written too', () => {
        const copy = openChoicesCopyOf(
            { openNames: OPEN, checkingNames: ['Heavy cream'], counted: 4, total: 9 },
            m,
            'en',
        );

        expect(copy.checking).toBe(
            'Heavy cream is still being checked. If you publish now, it is saved as written too.',
        );
    });

    it('two lines being checked are plural', () => {
        const copy = openChoicesCopyOf(
            { openNames: OPEN, checkingNames: ['Heavy cream', 'butter'], counted: 3, total: 9 },
            m,
            'en',
        );

        expect(copy.checking).toBe(
            `${list(['Heavy cream', 'butter'])} are still being checked. If you publish now, they are saved as written too.`,
        );
    });

    it('with nothing being checked there is no checking sentence', () => {
        expect(openChoicesCopyOf({ openNames: OPEN, checkingNames: [], counted: 4, total: 9 }, m, 'en').checking).toBe(
            undefined,
        );
    });

    it('says how many of the lines count toward nutrition', () => {
        const copy = openChoicesCopyOf({ openNames: OPEN, checkingNames: [], counted: 4, total: 9 }, m, 'en');

        expect(copy.later).toBe('You can choose later from each ingredient’s menu. Nutrition reads “4 of 9 counted”.');
    });

    it('one open line is singular', () => {
        const copy = openChoicesCopyOf({ openNames: ['Salt'], checkingNames: [], counted: 8, total: 9 }, m, 'en');

        expect(copy.title).toBe('1 ingredient has no food yet');
        expect(copy.body).toBe('Salt is saved as written. It doesn’t count toward nutrition until you choose a food.');
    });

    it('the actions keep their words', () => {
        const copy = openChoicesCopyOf({ openNames: ['Salt'], checkingNames: [], counted: 8, total: 9 }, m, 'en');

        expect([copy.chooseNow, copy.publishAnyway, copy.close]).toEqual(['Choose now', 'Publish anyway', 'Close']);
    });
});
