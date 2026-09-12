/**
 * Unit tests for `rowEntryField.ts` — an editor row's name as an entry field: the combobox props both leaves render for
 * rows 1 and 2 and for a row in Change food (`docs/design/ingredientStatusExplanation.md` §2a, §2d, §4b;
 * `docs/design/rowEditorOpenDecisions.md` items 1, 4 and 5).
 *
 * The entry is a stub with spies, so each test pins which of its actions a field event reaches. Its list is built from
 * the progressive answer by the real model (`foodSearchViews.ts`); the live search went in plan 002 S7.9.
 */
import { describe, expect, it, vi } from 'vitest';

import { progressiveFoodView } from '../../__fixtures__/foodSearchViews.js';
import { makeIngredientEntry } from '../../__fixtures__/index.js';
import {
    COMPLETE_FRAME,
    catalogResult,
    databaseFrame,
    remoteItem,
    sourceAnswered,
} from '../../__fixtures__/progressiveFrames.js';
import type { CatalogFoodOption, EntrySearchView } from '../../hooks/foodSuggestions.model.js';
import type { LineCommitTarget } from '../../hooks/lineCommit.js';
import { recipeMessages } from '../../messages.js';
import { seedLineKey } from '../lineKey.js';
import { recipeFormMessages } from '../messages.js';
import { rowEntryFieldOf, type RowEntryFieldCopy, type RowEntryFieldInput } from '../rowEntryField.js';

const form = recipeFormMessages.en;
const shared = recipeMessages.en;
const COPY: RowEntryFieldCopy = {
    form,
    search: shared.ingredientSearch,
    pickerSearch: shared.ingredientPickerSearch,
    remote: shared.ingredientRemoteSearch,
    details: shared.ingredientDetails,
    readOffline: 'Waiting for a connection. This loads on its own.',
};

const KEY = seedLineKey(1, 2);
const TARGET: LineCommitTarget = { kind: 'line', key: KEY };
const KALE: CatalogFoodOption = { group: 'catalog', hit: { id: 'food_kale', name: 'Kale, raw', score: 0.5 } };
const KALE_LISTED: EntrySearchView = progressiveFoodView(
    [databaseFrame({ catalog: [catalogResult('food_kale', 'Kale, raw')] }), COMPLETE_FRAME],
    { text: 'kale' },
);
const NAMING = {
    sourceName: (source: string) => (source === 'usda' ? 'USDA' : undefined),
    formatTime: () => '3:05 PM',
    formatList: (items: readonly string[]) => items.join(', '),
};

const input = (over: Partial<RowEntryFieldInput> = {}): RowEntryFieldInput => ({
    target: TARGET,
    number: 3,
    entry: makeIngredientEntry({
        textOf: () => 'kale',
        isActive: () => true,
        view: KALE_LISTED,
    }),
    changing: false,
    food: 'Kale',
    pickFailure: undefined,
    refusal: undefined,
    invalid: false,
    describedBy: undefined,
    focusRequested: false,
    listRequested: false,
    refusalOccurrence: 0,
    onFocusRequestHandled: () => undefined,
    onCancel: () => undefined,
    onAbandon: () => undefined,
    onTextChange: () => undefined,
    naming: NAMING,
    limitRefusals: 0,
    ...over,
});

describe('rowEntryFieldOf', () => {
    it('names the field and its list for the row, and gives the hint (§3b, SPECIFY.2, WCAG 3.3.2)', () => {
        const props = rowEntryFieldOf(input(), COPY);

        expect(props).toMatchObject({
            label: 'Ingredient 3 name',
            listLabel: 'Food suggestions for ingredient 3',
            hint: form.ingredientNameEditableHint,
            value: 'kale',
        });
    });

    it('typing sets the field’s text on the entry, and tells the row', () => {
        const setText = vi.fn();
        const onTextChange = vi.fn();
        const props = rowEntryFieldOf(input({ entry: makeIngredientEntry({ setText }), onTextChange }), COPY);

        props.onValueChange('kale, curly');

        expect(setText).toHaveBeenCalledWith(TARGET, 'kale, curly');
        expect(onTextChange).toHaveBeenCalledTimes(1);
    });

    it('focus makes the field the entry’s active one (blueprint decision 1)', () => {
        const focus = vi.fn();

        rowEntryFieldOf(input({ entry: makeIngredientEntry({ focus }) }), COPY).onFocus?.();

        expect(focus).toHaveBeenCalledWith(TARGET);
    });

    it('lists and announces for the active field only', () => {
        const active = rowEntryFieldOf(input(), COPY);
        const inactive = rowEntryFieldOf(
            input({ entry: makeIngredientEntry({ textOf: () => 'kale', isActive: () => false }) }),
            COPY,
        );

        expect(active.groups.length).toBeGreaterThan(0);
        expect(active.countAnnouncement).toBe('1 food found');
        expect(inactive.groups).toEqual([]);
        expect(inactive.countAnnouncement).toBe('');
    });

    it('carries each choice to the entry action it stands for, and only that one', () => {
        const actions = {
            selectFood: vi.fn(),
            selectRemoteFood: vi.fn(),
            findByName: vi.fn(),
            declareAsWritten: vi.fn(),
        };
        const entry = makeIngredientEntry({
            ...actions,
            textOf: () => 'kale',
            isActive: () => true,
            view: progressiveFoodView(
                [
                    databaseFrame({ catalog: [catalogResult('food_kale', 'Kale, raw')] }),
                    sourceAnswered('usda', remoteItem('Kale, frozen', 'sealed.k')),
                    COMPLETE_FRAME,
                ],
                { text: 'kale' },
            ),
        });
        const props = rowEntryFieldOf(input({ entry }), COPY);
        const keys = props.groups.flatMap((group) => group.options.map((option) => option.key));

        for (const key of keys) {
            props.onSelect(key);
        }

        expect(actions.selectFood).toHaveBeenCalledWith(KALE);
        expect(actions.selectRemoteFood).toHaveBeenCalledWith({
            group: 'remote',
            source: 'usda',
            hit: { name: 'Kale, frozen', reference: 'sealed.k' },
        });
        expect(actions.findByName).toHaveBeenCalledTimes(1);
        expect(actions.declareAsWritten).toHaveBeenCalledTimes(1);
    });

    it('a choice with a key the field did not list does nothing', () => {
        const findByName = vi.fn();

        rowEntryFieldOf(input({ entry: makeIngredientEntry({ findByName }) }), COPY).onSelect('more:findByName');

        expect(findByName).not.toHaveBeenCalled();
    });

    it('a row in Change food has Cancel, named for what it keeps, and no clear (item 4)', () => {
        const onCancel = vi.fn();
        const props = rowEntryFieldOf(input({ changing: true, food: 'Kale, raw', onCancel }), COPY);

        expect(props.cancel).toMatchObject({ text: 'Cancel', name: 'Cancel, keep Kale, raw' });
        props.cancel?.onPress();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('a row that names no food, or a declared one, has no Cancel: its own name is what Escape restores', () => {
        const onAbandon = vi.fn();
        const props = rowEntryFieldOf(input({ onAbandon }), COPY);

        expect(props.cancel).toBeUndefined();
        props.onAbandon?.();
        expect(onAbandon).toHaveBeenCalledTimes(1);
    });

    it('passes the row’s invalid mark, its description and its focus request through', () => {
        const onFocusRequestHandled = vi.fn();
        const props = rowEntryFieldOf(
            input({ invalid: true, describedBy: 'note-1', focusRequested: true, onFocusRequestHandled }),
            COPY,
        );

        expect(props).toMatchObject({ invalid: true, describedBy: 'note-1', focusRequested: true });
        props.onFocusRequestHandled?.();
        expect(onFocusRequestHandled).toHaveBeenCalledTimes(1);
    });

    it('says a refusal’s row sentence assertively, after the alerts the entry already has (R7, native)', () => {
        const sentence = '“kale x” isn’t in the recipe yet. Choose a food for it, or clear the box.';

        expect(rowEntryFieldOf(input({ refusal: sentence }), COPY).alertAnnouncement).toBe(sentence);
        expect(
            rowEntryFieldOf(input({ pickFailure: 'The change didn’t save.', refusal: sentence }), COPY)
                .alertAnnouncement,
        ).toBe(`The change didn’t save. ${sentence}`);
    });

    it('asks for the list with the focus when a refusal points at the row (R7)', () => {
        expect(rowEntryFieldOf(input({ focusRequested: true, listRequested: true }), COPY)).toMatchObject({
            focusRequested: true,
            listRequested: true,
        });
        expect(rowEntryFieldOf(input(), COPY).listRequested).toBe(false);
    });

    it('counts the alert’s occurrences: the limit’s refused presses and the refusals that pointed here (R8)', () => {
        expect(rowEntryFieldOf(input({ limitRefusals: 2, refusalOccurrence: 1 }), COPY).alertOccurrence).toBe(3);
        expect(rowEntryFieldOf(input({ refusalOccurrence: 4 }), COPY).alertOccurrence).toBe(4);
    });

    it('says a failed pick assertively (R3)', () => {
        expect(rowEntryFieldOf(input({ pickFailure: 'The change didn’t save.' }), COPY).alertAnnouncement).toBe(
            'The change didn’t save.',
        );
    });
});
