/**
 * Unit tests for `trailingEntryField.ts` — the trailing add row as an entry field: the combobox props both leaves render
 * after the last line (plan 002 V1 B8; `docs/design/rowEditorOpenDecisions.md` items 1 and 3;
 * `docs/design/ingredientStatusExplanation.md` §4 and §4b).
 *
 * The entry is a stub with spies, so each test pins which of its actions a field event reaches. Its list is built from
 * the progressive answer by the real model (`foodSearchViews.ts`).
 */
import { describe, expect, it, vi } from 'vitest';

import { makeIngredientEntry } from '../../__fixtures__/index.js';
import { editorMessages } from '../../editor/messages.js';
import { makeCatalogFoodOption, progressiveFoodView } from '../../__fixtures__/foodSearchViews.js';
import { COMPLETE_FRAME, catalogResult, databaseFrame } from '../../__fixtures__/progressiveFrames.js';
import type { LineCommitTarget } from '../../hooks/lineCommit.js';
import { recipeMessages } from '../../messages.js';
import { recipeFormMessages } from '../messages.js';
import {
    trailingEntryFieldOf,
    type TrailingEntryFieldCopy,
    type TrailingEntryFieldInput,
} from '../trailingEntryField.js';

const form = recipeFormMessages.en;
const shared = recipeMessages.en;
const COPY: TrailingEntryFieldCopy = {
    form,
    add: editorMessages.en.ingredients,
    search: shared.ingredientSearch,
    pickerSearch: shared.ingredientPickerSearch,
    remote: shared.ingredientRemoteSearch,
    details: shared.ingredientDetails,
    readOffline: 'Waiting for a connection. This loads on its own.',
};

const TRAILING: LineCommitTarget = { kind: 'newLine' };
const KALE = makeCatalogFoodOption({ id: 'food_kale', name: 'Kale, raw', score: 0.5 });
const KALE_LISTED = progressiveFoodView(
    [databaseFrame({ catalog: [catalogResult('food_kale', 'Kale, raw')] }), COMPLETE_FRAME],
    {
        text: 'kale',
    },
);

const input = (over: Partial<TrailingEntryFieldInput> = {}): TrailingEntryFieldInput => ({
    entry: makeIngredientEntry({
        textOf: () => '  kale ',
        isActive: (target) => target.kind === 'newLine',
        view: KALE_LISTED,
    }),
    nextNumber: 4,
    invalid: false,
    pickFailure: undefined,
    refusal: undefined,
    describedBy: undefined,
    focusRequested: false,
    listRequested: false,
    refusalOccurrence: 0,
    onFocusRequestHandled: () => undefined,
    onTextChange: () => undefined,
    onCreateOwnFood: () => undefined,
    onSubmitWithoutChoice: () => undefined,
    naming: {
        sourceName: () => undefined,
        formatTime: () => '3:05 PM',
        formatList: (items) => items.join(', '),
    },
    limitRefusals: 0,
    ...over,
});

describe('trailingEntryFieldOf', () => {
    it('is named “Add an ingredient”, shows that as its placeholder, and names its list for the next line (item 3)', () => {
        expect(trailingEntryFieldOf(input(), COPY)).toMatchObject({
            label: 'Add an ingredient',
            placeholder: 'Add an ingredient',
            listLabel: 'Food suggestions for ingredient 4',
            hint: 'Type the amount first, then pick the food. For example: 2 tbsp olive oil.',
            value: '  kale ',
        });
    });

    it('Enter with no option chosen reaches the host, which says to pick a food (build spec §7.5.3)', () => {
        const onSubmitWithoutChoice = vi.fn();

        trailingEntryFieldOf(input({ onSubmitWithoutChoice }), COPY).onSubmitWithoutChoice?.();

        expect(onSubmitWithoutChoice).toHaveBeenCalledTimes(1);
    });

    it('typing sets the trailing field’s text on the entry, and tells the host', () => {
        const setText = vi.fn();
        const onTextChange = vi.fn();

        trailingEntryFieldOf(input({ entry: makeIngredientEntry({ setText }), onTextChange }), COPY).onValueChange(
            'kale',
        );

        expect(setText).toHaveBeenCalledWith(TRAILING, 'kale');
        expect(onTextChange).toHaveBeenCalledTimes(1);
    });

    it('focus makes the trailing field the entry’s active one (blueprint decision 1)', () => {
        const focus = vi.fn();

        trailingEntryFieldOf(input({ entry: makeIngredientEntry({ focus }) }), COPY).onFocus?.();

        expect(focus).toHaveBeenCalledWith(TRAILING);
    });

    it('its list ends with Create my own food, and choosing it opens the form on the trimmed text (O3 ruling)', () => {
        const onCreateOwnFood = vi.fn();
        const props = trailingEntryFieldOf(input({ onCreateOwnFood }), COPY);
        const last = props.groups.at(-1)?.options.at(-1);

        expect(last?.label).toBe(form.createCustomFoodIconLabel);
        props.onSelect(last?.key ?? '');
        expect(onCreateOwnFood).toHaveBeenCalledWith('kale');
    });

    it('a food choice goes to the entry for the trailing row', () => {
        const selectFood = vi.fn();
        const props = trailingEntryFieldOf(
            input({
                entry: makeIngredientEntry({
                    selectFood,
                    textOf: () => 'kale',
                    isActive: () => true,
                    view: KALE_LISTED,
                }),
            }),
            COPY,
        );

        props.onSelect('catalog:food_kale');

        expect(selectFood).toHaveBeenCalledWith(KALE);
    });

    it('Escape on a closed list clears the text: nothing is pending, and the host hears of it (item 4)', () => {
        const abandon = vi.fn();
        const onTextChange = vi.fn();

        trailingEntryFieldOf(input({ entry: makeIngredientEntry({ abandon }), onTextChange }), COPY).onAbandon?.();

        expect(abandon).toHaveBeenCalledWith(TRAILING);
        expect(onTextChange).toHaveBeenCalledTimes(1);
    });

    it('never has Cancel: it is not in Change food', () => {
        expect(trailingEntryFieldOf(input(), COPY).cancel).toBeUndefined();
    });

    it('passes its invalid mark, description and focus and list requests through (R7)', () => {
        const onFocusRequestHandled = vi.fn();
        const props = trailingEntryFieldOf(
            input({
                invalid: true,
                describedBy: 'pending-1',
                focusRequested: true,
                listRequested: true,
                onFocusRequestHandled,
            }),
            COPY,
        );

        expect(props).toMatchObject({
            invalid: true,
            describedBy: 'pending-1',
            focusRequested: true,
            listRequested: true,
        });
        props.onFocusRequestHandled?.();
        expect(onFocusRequestHandled).toHaveBeenCalledTimes(1);
    });

    it('says a failed pick, then a refusal’s sentence, assertively (R3, R7)', () => {
        const props = trailingEntryFieldOf(
            input({ pickFailure: 'We couldn’t add “kale”.', refusal: '“kale” isn’t in the recipe yet.' }),
            COPY,
        );

        expect(props.alertAnnouncement).toBe('We couldn’t add “kale”. “kale” isn’t in the recipe yet.');
    });

    it('counts the alert’s occurrences: the limit’s refused presses and the refusals said here (R8)', () => {
        expect(trailingEntryFieldOf(input({ refusalOccurrence: 2 }), COPY).alertOccurrence).toBe(2);
        expect(trailingEntryFieldOf(input({ refusalOccurrence: 2, limitRefusals: 3 }), COPY).alertOccurrence).toBe(5);
    });
});
