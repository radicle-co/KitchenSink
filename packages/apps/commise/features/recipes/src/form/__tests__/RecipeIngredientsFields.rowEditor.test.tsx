// @vitest-environment jsdom
/**
 * Component tests for the web field group's ROW EDITOR (plan 002 V1 B7, curated U15): entry mode on rows 1 and 2, the
 * row's `⋮` and Change food, Find a food, the authored-food Sheet and the details dialog
 * (`docs/design/ingredientStatusExplanation.md` §2a to §2d, §3a, §4b, "Busy and disabled";
 * `docs/design/rowEditorOpenDecisions.md` items 1, 4, 6 and 9; `docs/design/ingredientSpecialization.md` §S7, §S8.8).
 *
 * The row editor is the stateful fake (`useFakeRowEditor`) over the entry's real pure model, so Change food, a cancel and
 * typed text move as they do in the app; what a test does not drive is a spy or a fixture.
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import {
    makeAuthoredFoodController,
    makeIngredientNutrition,
    makeIngredientRowEditor,
    makeLookupRetry,
    withLineKeys,
} from '../../__fixtures__/index.js';
import {
    UNAVAILABLE_GROUP,
    answeredGroup,
    makeAuthoredFoodOption,
    makeCatalogFoodOption,
    settledFoodView,
} from '../../__fixtures__/foodSearchViews.js';
import { useFakeRowEditor, type FakeRowEditorOverrides } from '../../__fixtures__/useFakeRowEditor.js';
import type { EntrySearchView } from '../../hooks/foodSuggestions.model.js';
import type { LineCommitTarget } from '../../hooks/lineCommit.js';
import type { SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { recipeMessages } from '../../messages.js';
import {
    ingredientCommitFailureId,
    ingredientPendingTextId,
    trailingCommitFailureId,
    trailingPendingTextId,
} from '../fieldErrorIds.js';
import { recipeFormMessages } from '../messages.js';
import type { IngredientNutrition } from '../nutritionLookup.js';
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.js';
import type { IngredientLineKey } from '../lineKey.js';
import type { RecipeFormErrors } from '../validate.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';
import type { DraftAction } from '../draftAction.js';
import { applyDraftAction } from '../props.js';

afterEach(cleanup);

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

// Rows 6 and 7's panel searches the line's words through the progressive food search, whose own suite drives the
// clients; here it answers one of the cook's own foods, one catalog food, and one remote food from USDA.
const shortlistSearch = vi.hoisted(() => ({ calls: [] as (readonly [string, boolean])[], refetch: vi.fn() }));

vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: (query: string, enabled: boolean) => {
        shortlistSearch.calls.push([query, enabled]);

        return {
            read: {
                kind: 'ended',
                resumed: false,
                answer: {
                    database: {
                        type: 'database',
                        authored: {
                            outcome: 'answered',
                            results: [{ id: 'food_mine', name: 'apple sauce, homemade', score: 0.7 }],
                        },
                        catalog: {
                            outcome: 'answered',
                            results: [{ id: 'food_canned', name: 'Applesauce, canned', score: 0.9 }],
                        },
                    },
                    sources: [
                        {
                            type: 'source',
                            source: 'usda',
                            outcome: 'answered',
                            items: [{ name: 'Apples, stewed', reference: 'sealed.s' }],
                        },
                    ],
                    complete: true,
                },
            },
            refetch: shortlistSearch.refetch,
        };
    },
}));

const en = recipeFormMessages.en;
const shared = recipeMessages.en;
const NUTRITION = makeIngredientNutrition();
const FLAT = {
    id: 'var_flat',
    parts: [
        { attribute: 'cut', text: 'flat half' },
        { attribute: 'grade', text: 'choice' },
    ],
};

const valuesWith = (ingredients: RecipeFormValues['ingredients']): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    ingredients,
});

const NO_FOOD = { ingredientId: null, name: 'Kale', quantity: 1, isUserEntered: false } as const;
const DECLARED = { ingredientId: 'ing_d', name: 'grandma’s mix', quantity: 1, isUserEntered: true } as const;
const BRISKET = {
    ingredientId: 'ing_b',
    name: 'Beef brisket',
    quantity: 2,
    unit: 'lb',
    isUserEntered: false,
    resolutionStatus: FoodResolutionStatus.RESOLVED,
    foodId: 'food_brisket',
} as const;
const LEEK = { ...BRISKET, ingredientId: 'ing_l', name: 'Leek', foodId: 'food_leek' } as const;

interface HarnessProps {
    readonly initial: RecipeFormValues;
    readonly errors?: RecipeFormErrors;
    readonly over?: FakeRowEditorOverrides;
    readonly nutrition?: IngredientNutrition;
    readonly onValues?: (values: RecipeFormValues) => void;
}

const Harness: FC<HarnessProps> = ({ initial, errors, over, nutrition = NUTRITION, onValues }) => {
    const [values, setValues] = useState(initial);
    // The host's draft transition, applied to this harness's own draft, as each host applies it to its own.
    const rowEditor = useFakeRowEditor(values.ingredients, {
        ...over,
        editor: { dispatch: (action) => setValues((current) => applyDraftAction(current, action)), ...over?.editor },
    });

    return (
        <RecipeIngredientsFields
            values={values}
            {...(errors === undefined ? {} : { errors })}
            onChange={(next) => {
                onValues?.(next);
                setValues(next);
            }}
            nutrition={nutrition}
            lookupRetry={makeLookupRetry()}
            rowEditor={rowEditor}
        />
    );
};

const actions = (food: string) => screen.getByRole('button', { name: `Actions for ${food}` });
const menuLabels = (): readonly string[] => screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');

const choose = async (user: ReturnType<typeof userEvent.setup>, food: string, item: string): Promise<void> => {
    await user.click(actions(food));
    await user.click(screen.getByRole('menuitem', { name: item }));
};

/** The key of the seeded line at `index`; a test that names a line it did not seed fails here, not later. */
function keyAt(values: RecipeFormValues, index = 0): IngredientLineKey {
    const line = values.ingredients[index];

    if (line === undefined) {
        throw new Error(`no seeded line at ${String(index)}`);
    }

    return line.key;
}

const lineTarget = (values: RecipeFormValues, index = 0): LineCommitTarget => ({
    kind: 'line',
    key: keyAt(values, index),
});

describe('rows 1 and 2 are entry fields (SPECIFY.1, §2a, §4b)', () => {
    it('a row that names no food shows its text in a combobox with the hint; typing goes to the entry, never the line', async () => {
        const user = userEvent.setup();
        const onValues = vi.fn();
        render(<Harness initial={valuesWith(withLineKeys([NO_FOOD]))} onValues={onValues} />);
        const field = screen.getByRole<HTMLInputElement>('combobox', { name: 'Ingredient 1 name' });

        expect(field.value).toBe('Kale');
        // Its description begins with the hint (3.3.2); the trailing add row's field has its own.
        const [hintId] = (field.getAttribute('aria-describedby') ?? '').split(' ');

        expect(document.getElementById(hintId ?? '')?.textContent).toBe(en.ingredientNameEditableHint);

        await user.click(field);
        await user.keyboard(', curly');

        expect(field.value).toBe('Kale, curly');
        expect(onValues).not.toHaveBeenCalled();
    });

    it('a declared row is an entry field; its ⋮ offers Find a food for this, which puts focus in the field', async () => {
        const user = userEvent.setup();
        const focus = vi.fn();
        const values = valuesWith(withLineKeys([DECLARED]));
        render(<Harness initial={values} over={{ entry: { focus } }} />);

        await user.click(actions('grandma’s mix'));
        expect(menuLabels()).toEqual([en.statusActionFindFood, en.statusActionRemove]);
        await user.click(screen.getByRole('menuitem', { name: en.statusActionFindFood }));

        expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Ingredient 1 name' }));
        expect(focus).toHaveBeenCalledWith(lineTarget(values));
    });
});

describe('Change food (§2c, §2d, item 4)', () => {
    it('turns the name into a combobox on the current name, caret at the end; slot 2 is Remove; the dotted line hides', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([{ ...BRISKET, variant: FLAT }]))} />);

        expect(screen.getByText('flat half')).toBeTruthy();
        await choose(user, 'Beef brisket, flat half, choice', en.statusActionChangeFood);

        const field = screen.getByRole<HTMLInputElement>('combobox', { name: 'Ingredient 1 name' });

        expect(field.value).toBe('Beef brisket');
        expect(document.activeElement).toBe(field);
        expect(field.selectionStart).toBe('Beef brisket'.length);
        expect(screen.queryByText('flat half')).toBeNull();
        expect(screen.getByRole('button', { name: 'Remove ingredient 1' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Actions for / })).toBeNull();
    });

    it('Cancel, named for what it keeps, ends it and returns focus to ⋮', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([BRISKET]))} />);
        await choose(user, 'Beef brisket', en.statusActionChangeFood);

        await user.click(screen.getByRole('button', { name: 'Cancel, keep Beef brisket' }));

        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Beef brisket');
        expect(document.activeElement).toBe(actions('Beef brisket'));
    });

    it('Escape with the list closed ends it too, and returns focus to ⋮ (system change 8)', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([BRISKET]))} />);
        await choose(user, 'Beef brisket', en.statusActionChangeFood);

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('combobox', { name: 'Ingredient 1 name' })).toBeNull();
        expect(document.activeElement).toBe(actions('Beef brisket'));
    });

    it('focus leaving the row with nothing new typed ends it; with new text the row stays in entry mode', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([BRISKET, LEEK]))} />);

        await choose(user, 'Beef brisket', en.statusActionChangeFood);
        await user.click(screen.getByRole('spinbutton', { name: 'Ingredient 2 quantity' }));
        expect(screen.queryByRole('combobox', { name: 'Ingredient 1 name' })).toBeNull();

        await choose(user, 'Beef brisket', en.statusActionChangeFood);
        await user.keyboard(' point');
        await user.click(screen.getByRole('spinbutton', { name: 'Ingredient 2 quantity' }));
        expect(screen.getByRole<HTMLInputElement>('combobox', { name: 'Ingredient 1 name' }).value).toBe(
            'Beef brisket point',
        );
    });

    it('a row with no figures keeps Create my own food behind its ⋮ while it changes (system change 5)', async () => {
        const user = userEvent.setup();
        render(
            <Harness
                initial={valuesWith(withLineKeys([BRISKET]))}
                nutrition={makeIngredientNutrition({ lookup: () => ({ state: 'found', catalog: {} }) })}
            />,
        );

        await choose(user, 'Beef brisket', en.statusActionChangeFood);
        await user.click(actions('Beef brisket'));

        expect(menuLabels()).toEqual([en.createCustomFoodIconLabel, en.statusActionRemove]);
    });
});

describe('the active field’s list (items 1 and 2)', () => {
    it('lists what the entry found, and each choice goes to the entry action it stands for', async () => {
        const user = userEvent.setup();
        const selectFood = vi.fn();
        const findByName = vi.fn();
        const kale = makeCatalogFoodOption({ id: 'food_kale', name: 'Kale, raw' });
        render(
            <Harness
                initial={valuesWith(withLineKeys([NO_FOOD]))}
                over={{
                    entry: {
                        selectFood,
                        findByName,
                        view: settledFoodView(answeredGroup(), answeredGroup(kale)),
                    },
                }}
            />,
        );

        await user.click(screen.getByRole('combobox', { name: 'Ingredient 1 name' }));
        await user.keyboard('{ArrowDown}');
        const list = screen.getByRole('listbox', { name: 'Food suggestions for ingredient 1' });

        expect(within(list).getByRole('group', { name: en.ingredientSuggestionsMoreHeading })).toBeTruthy();
        await user.click(within(list).getByRole('option', { name: 'Kale, raw' }));
        expect(selectFood).toHaveBeenCalledWith(kale);

        await user.keyboard('{ArrowDown}');
        await user.click(screen.getByRole('option', { name: 'Find nutrition for “Kale”' }));
        expect(findByName).toHaveBeenCalledTimes(1);
    });
});

describe('every state of the food list (S5 list contract L1 to L4, §S13 P3 to P9)', () => {
    const MINE = makeAuthoredFoodOption({ id: 'food_mine', name: 'Kale chips' });
    const RAW = makeCatalogFoodOption({ id: 'food_kale', name: 'Kale, raw' });
    const NO_MATCH = en.ingredientNoSuggestions.replace('{query}', 'Kale');
    const READ_OFFLINE = offlineNoticeMessages.en.readOffline;

    /** Open the row's list on `view`, and answer what the popup shows and what the two channels say. */
    async function openOn(view: EntrySearchView) {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([NO_FOOD]))} over={{ entry: { view } }} />);
        await user.click(screen.getByRole('combobox', { name: 'Ingredient 1 name' }));
        await user.keyboard('{ArrowDown}');
        const list = screen.getByRole('listbox', { name: 'Food suggestions for ingredient 1' });

        return {
            groups: within(list)
                .getAllByRole('group')
                .map((group) => group.getAttribute('aria-label')),
            optionNames: (group: string) =>
                within(within(list).getByRole('group', { name: group }))
                    .getAllByRole('option')
                    .map((option) => option.getAttribute('aria-label') ?? option.textContent),
            alerts: screen
                .getAllByRole('alert')
                .map((alert) => alert.textContent)
                .filter((text) => text !== ''),
            politeSays: (text: string) =>
                screen.getAllByText(text).some((el) => el.getAttribute('aria-live') === 'polite'),
        };
    }

    it.each<[string, EntrySearchView, readonly string[]]>([
        [
            'both answered (P4)',
            settledFoodView(answeredGroup(MINE), answeredGroup(RAW)),
            ['Your foods', 'Food catalog'],
        ],
        ['only the cook’s own foods matched', settledFoodView(answeredGroup(MINE), answeredGroup()), ['Your foods']],
        ['only the catalog matched', settledFoodView(answeredGroup(), answeredGroup(RAW)), ['Food catalog']],
        ['both answered with no food (P7)', settledFoodView(answeredGroup(), answeredGroup()), []],
        ['the catalog failed (P6)', settledFoodView(answeredGroup(MINE), UNAVAILABLE_GROUP), ['Your foods']],
        ['the cook’s own search failed', settledFoodView(UNAVAILABLE_GROUP, answeredGroup(RAW)), ['Food catalog']],
        ['both failed (P8)', settledFoodView(UNAVAILABLE_GROUP, UNAVAILABLE_GROUP), []],
        ['offline (P6)', { kind: 'offline' }, []],
    ])('%s: its groups, then `Not listed?` last (item 2)', async (_case, view, foodGroups) => {
        const shown = await openOn(view);

        expect(shown.groups).toEqual([...foodGroups, en.ingredientSuggestionsMoreHeading]);
    });

    it('both answered: the count of both groups, said politely (item 5)', async () => {
        const shown = await openOn(settledFoodView(answeredGroup(MINE), answeredGroup(RAW)));

        expect(shown.politeSays('2 foods found')).toBe(true);
        expect(shown.alerts).toEqual([]);
    });

    // REWRITTEN for plan 002 S7.8 (S7 list contract P2, P3): before the database part only the loader shows, one still
    // line after where the options will land; no placeholder rows and no options, so nothing can move.
    it('searching: the loader alone, after the field, said politely, with no option yet (P2, P3)', async () => {
        const user = userEvent.setup();
        render(
            <Harness
                initial={valuesWith(withLineKeys([NO_FOOD]))}
                over={{ entry: { view: { kind: 'searching', resumed: false } } }}
            />,
        );
        await user.click(screen.getByRole('combobox', { name: 'Ingredient 1 name' }));
        await user.keyboard('{ArrowDown}');

        expect(screen.queryByRole('listbox')).toBeNull();
        expect(
            screen
                .getAllByText(shared.ingredientPickerSearch.searching)
                .some((el) => el.getAttribute('aria-live') === 'polite'),
        ).toBe(true);
    });

    it('no food matched: the note names the way on, said politely (P7)', async () => {
        const shown = await openOn(settledFoodView(answeredGroup(), answeredGroup()));

        expect(screen.getAllByText(NO_MATCH).length).toBeGreaterThan(0);
        expect(shown.politeSays(NO_MATCH)).toBe(true);
    });

    it('the catalog failed: the cook’s foods, the catalog’s sentence, and never “no foods match” (L3)', async () => {
        const shown = await openOn(settledFoodView(answeredGroup(), UNAVAILABLE_GROUP));

        expect(shown.politeSays(en.ingredientCatalogUnavailable)).toBe(true);
        expect(screen.queryByText(NO_MATCH)).toBeNull();
    });

    // `docs/design/v3Evaluation.md` V3-M2a: one DOM order, so reading order is visual order at every size (1.3.2).
    it.each<[string, EntrySearchView, 'before' | 'after']>([
        [
            'with the cook’s own foods, the first option comes before the catalog’s sentence',
            settledFoodView(answeredGroup(MINE), UNAVAILABLE_GROUP),
            'after',
        ],
        [
            'with no food of the cook’s own, the catalog’s sentence comes before the first option',
            settledFoodView(answeredGroup(), UNAVAILABLE_GROUP),
            'before',
        ],
    ])('the catalog failed, %s', async (_case, view, place) => {
        await openOn(view);
        const [first] = within(screen.getByRole('listbox')).getAllByRole('option');
        const shownLines = screen
            .getAllByText(en.ingredientCatalogUnavailable)
            .filter((element) => element.getAttribute('aria-live') === null);

        expect(shownLines).toHaveLength(1);
        const following = (first.compareDocumentPosition(shownLines[0]) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        expect(following ? 'after' : 'before').toBe(place);
    });

    it('the cook’s own search failed: the catalog’s foods, and its own sentence after the count (L3)', async () => {
        const shown = await openOn(settledFoodView(UNAVAILABLE_GROUP, answeredGroup(RAW)));

        expect(shown.optionNames('Food catalog')).toEqual(['Kale, raw']);
        expect(shown.politeSays(`1 food found ${en.ingredientAuthoredUnavailable}`)).toBe(true);
    });

    it('both failed: said as an alert, never politely (P8)', async () => {
        const shown = await openOn(settledFoodView(UNAVAILABLE_GROUP, UNAVAILABLE_GROUP));

        expect(shown.alerts).toEqual([shared.ingredientPickerSearch.failed]);
    });

    // A search the per-minute limit refused is a failed half (`ingredientSuggestionSource.test.tsx`): it reads as its
    // group being unavailable, never as the cook's USDA lookup limit (L3, item 10).
    it('a half the search limit refused reads as that group unavailable, not as the USDA limit', async () => {
        await openOn(settledFoodView(answeredGroup(MINE), UNAVAILABLE_GROUP));

        expect(screen.getAllByText(en.ingredientCatalogUnavailable).length).toBeGreaterThan(0);
        expect(screen.queryByText(/reached your limit/u)).toBeNull();
    });

    it('offline: the parked-read sentence where results land, said politely, with no retry (P9, R2)', async () => {
        const user = userEvent.setup();
        render(
            <Harness initial={valuesWith(withLineKeys([NO_FOOD]))} over={{ entry: { view: { kind: 'offline' } } }} />,
        );
        await user.click(screen.getByRole('combobox', { name: 'Ingredient 1 name' }));
        await user.keyboard('{ArrowDown}');

        expect(screen.getAllByText(READ_OFFLINE).some((el) => el.getAttribute('aria-live') === 'polite')).toBe(true);
        expect(screen.queryByRole('button', { name: /try again/iu })).toBeNull();
    });

    it('a catalog result that names a variant shows its parts, and its name adds them (§S2, L4.1)', async () => {
        const fried = makeCatalogFoodOption({
            id: 'food_breast',
            name: 'boneless skinless chicken breasts',
            variant: { id: 'var_fried', parts: [{ attribute: 'cookingMethod', text: 'fried' }] },
        });
        const shown = await openOn(settledFoodView(answeredGroup(), answeredGroup(fried)));

        expect(shown.optionNames('Food catalog')).toEqual(['boneless skinless chicken breasts, fried']);
        expect(screen.getByText('fried')).toBeTruthy();
    });

    it('the cook’s own food is named as theirs, so it never sounds like the catalog’s (L4.2)', async () => {
        const shown = await openOn(
            settledFoodView(
                answeredGroup(makeAuthoredFoodOption({ id: 'food_b1', name: 'Butter' })),
                answeredGroup(makeCatalogFoodOption({ id: 'food_b2', name: 'Butter' })),
            ),
        );

        expect(shown.optionNames('Your foods')).toEqual(['Butter, your food']);
        expect(shown.optionNames('Food catalog')).toEqual(['Butter']);
    });
});

describe('a pick in flight, and what a settled pick says (§2d, item 1, "Busy and disabled")', () => {
    it('while a pick runs: its caption says what it is doing, ⋮ is unavailable, and Remove does nothing', async () => {
        const user = userEvent.setup();
        const dispatch = vi.fn<(action: DraftAction) => void>();
        const lines = withLineKeys([BRISKET, { ...LEEK, resolutionStatus: FoodResolutionStatus.PENDING }]);
        const keys = new Set(lines.map((line) => line.key));
        render(
            <Harness
                initial={valuesWith(lines)}
                over={{
                    editor: {
                        dispatch,
                        pickInFlight: (target) =>
                            target.kind === 'line' && keys.has(target.key)
                                ? { kind: 'catalogFood', foodId: 'food_x', name: 'x' }
                                : undefined,
                    },
                }}
            />,
        );

        expect(screen.getAllByText(en.ingredientEntryAddingFromCatalog)).toHaveLength(2);
        expect(actions('Beef brisket').getAttribute('aria-disabled')).toBe('true');

        await user.click(screen.getByRole('button', { name: 'Remove ingredient 2' }));
        // Removal goes through the host's draft transition, so that is where a refused Remove must not arrive.
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('a pick that committed is said politely, and focus goes to the row’s glyph', () => {
        const values = valuesWith(withLineKeys([BRISKET]));
        const { rerender } = render(<Harness initial={values} />);
        const settled: SettledRowCommit = {
            origin: { kind: 'entry' },
            pick: { kind: 'catalogFood', foodId: 'food_brisket', name: 'Beef brisket' },
            target: lineTarget(values),
            outcome: {
                kind: 'committed',
                key: keyAt(values),
                binding: { ingredientId: 'ing_b', isUserEntered: false, name: 'Beef brisket' },
            },
        };

        rerender(<Harness initial={values} over={{ editor: { settled } }} />);

        expect(screen.getByText('Beef brisket is matched. Its nutrition now counts.').getAttribute('role')).toBe(
            'status',
        );
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About Beef brisket' }));
    });

    // E2 (`docs/design/rowEditorOpenDecisions.md`): a pick that failed while its step was away. On return the row shows
    // the same line, and the field's description includes it, but no alert holds it: this is now a state, not an event.
    it('on return, a pick that failed while the step was away shows its line, which describes the field, silently', async () => {
        const user = userEvent.setup();
        const values = valuesWith(withLineKeys([NO_FOOD]));
        const failed: SettledRowCommit = {
            origin: { kind: 'entry' },
            pick: { kind: 'name', text: 'kale' },
            target: lineTarget(values),
            outcome: { kind: 'failed' },
        };

        render(<Harness initial={values} over={{ editor: { settled: failed } }} />);
        const field = screen.getByRole('combobox', { name: 'Ingredient 1 name' });
        // The cook is back in the field: an active field is one that would say an alert.
        await user.click(field);
        const line = document.getElementById(ingredientCommitFailureId(values.ingredients[0]?.key ?? ''));

        expect(line?.textContent).toMatch(/^We couldn’t add/u);
        expect(field.getAttribute('aria-describedby')).toContain(line?.id);
        expect(screen.getAllByRole('alert').filter((region) => /couldn’t add/u.test(region.textContent))).toEqual([]);
    });

    it('a Change food pick that failed shows on the row and is said assertively; it goes once the cook types', async () => {
        const user = userEvent.setup();
        const values = valuesWith(withLineKeys([BRISKET]));
        const { rerender } = render(<Harness initial={values} />);
        await choose(user, 'Beef brisket', en.statusActionChangeFood);
        const failed: SettledRowCommit = {
            origin: { kind: 'entry' },
            pick: { kind: 'name', text: 'brisket' },
            target: lineTarget(values),
            outcome: { kind: 'failed' },
        };

        rerender(<Harness initial={values} over={{ editor: { settled: failed } }} />);
        const sentence = 'The change didn’t save. This ingredient still uses Beef brisket.';
        const field = screen.getByRole('combobox', { name: 'Ingredient 1 name' });

        expect(document.getElementById(ingredientCommitFailureId(values.ingredients[0]?.key ?? ''))?.textContent).toBe(
            sentence,
        );
        expect(field.getAttribute('aria-describedby')).toContain(
            ingredientCommitFailureId(values.ingredients[0]?.key ?? ''),
        );
        // The field's alert is two regions that take turns (R8), so it is the one holding the sentence that is checked.
        expect(screen.getAllByRole('alert').filter((region) => region.textContent === sentence)).toHaveLength(1);

        await user.click(field);
        await user.keyboard(' x');

        expect(screen.queryByText(sentence, { selector: 'span' })).toBeNull();
    });

    it('text a save refused is said on its row, in Change food’s own words, and the field reads invalid (§4b)', async () => {
        const user = userEvent.setup();
        const values = valuesWith(withLineKeys([BRISKET]));
        const { rerender } = render(<Harness initial={values} />);
        await choose(user, 'Beef brisket', en.statusActionChangeFood);
        const field = screen.getByRole('combobox', { name: 'Ingredient 1 name' });

        await user.clear(field);
        await user.keyboard('point half');
        rerender(<Harness initial={values} over={{ editor: { pendingRefused: true } }} />);

        const pendingId = ingredientPendingTextId(values.ingredients[0]?.key ?? '');

        expect(document.getElementById(pendingId)?.textContent).toBe(
            '“point half” isn’t in the recipe yet. Choose a food for it, or press Cancel to keep Beef brisket.',
        );
        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(field.getAttribute('aria-describedby')).toContain(pendingId);
    });

    it('text a save refused on a row that names no food is said on its row, and the section says it once (R7)', async () => {
        const user = userEvent.setup();
        const values = valuesWith(withLineKeys([NO_FOOD]));
        const { rerender } = render(<Harness initial={values} />);
        const field = screen.getByRole('combobox', { name: 'Ingredient 1 name' });

        await user.clear(field);
        await user.keyboard('  saffron threads ');
        // A save sets the form's error AND the row editor's level; the section says the form-level sentence once.
        rerender(
            <Harness
                initial={values}
                errors={{ ingredients: 'ingredientsPendingText' }}
                over={{ editor: { pendingRefused: true } }}
            />,
        );

        const pendingId = ingredientPendingTextId(keyAt(values));

        // The row's sentence names the trimmed text, and describes the field (R7: never live).
        expect(document.getElementById(pendingId)?.textContent).toBe(
            '“saffron threads” isn’t in the recipe yet. Choose a food for it, or clear the box.',
        );
        expect(field.getAttribute('aria-describedby')).toContain(pendingId);
        // The form-level sentence names no row (R7 copy).
        expect(
            screen.getByText(
                'An ingredient you typed isn’t in the recipe yet. Choose a food for it, or delete what you typed.',
            ),
        ).toBeTruthy();
    });
});

describe('a refusal for pending text points at its field (`rowEditorOpenDecisions.md` R7 item 2)', () => {
    const typeThenLookAway = async (user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> => {
        const field = screen.getByRole('combobox', { name: 'Ingredient 1 name' });

        await user.clear(field);
        await user.keyboard('saffron');
        act(() => actions('Beef brisket').focus());

        return field;
    };

    it('the raised level puts focus in the pending field, which says it took it', async () => {
        const user = userEvent.setup();
        const handled = vi.fn();
        const values = valuesWith(withLineKeys([NO_FOOD, BRISKET]));
        const { rerender } = render(<Harness initial={values} />);
        const field = await typeThenLookAway(user);

        expect(document.activeElement).not.toBe(field);
        rerender(
            <Harness
                initial={values}
                over={{ editor: { pendingRefused: true, pendingFocusRequested: true, pendingFocusHandled: handled } }}
            />,
        );

        expect(document.activeElement).toBe(field);
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('with no level raised, the refusal shows the sentence and leaves focus where it is', async () => {
        const user = userEvent.setup();
        const values = valuesWith(withLineKeys([NO_FOOD, BRISKET]));
        const { rerender } = render(<Harness initial={values} />);

        await typeThenLookAway(user);
        rerender(<Harness initial={values} over={{ editor: { pendingRefused: true } }} />);

        expect(document.activeElement).toBe(actions('Beef brisket'));
    });
});

describe('the trailing add row (plan 002 V1 B8; §2d, §4b; items 1 and 3)', () => {
    const TRAILING = { kind: 'newLine' } as const;
    const trailing = () => screen.getByRole('combobox', { name: en.addIngredientRowLabel });
    const NOTHING_FOUND = settledFoodView(answeredGroup(), answeredGroup());

    it('a pick it appended is said politely, for the appended row, and focus stays in the emptied field (F1)', () => {
        const values = valuesWith(withLineKeys([BRISKET]));
        const { rerender } = render(<Harness initial={values} />);
        const settled: SettledRowCommit = {
            origin: { kind: 'entry' },
            pick: { kind: 'catalogFood', foodId: 'food_brisket', name: 'Beef brisket' },
            target: TRAILING,
            outcome: {
                kind: 'committed',
                key: keyAt(values),
                binding: { ingredientId: 'ing_b', isUserEntered: false, name: 'Beef brisket' },
            },
        };

        act(() => actions('Beef brisket').focus());
        rerender(<Harness initial={values} over={{ editor: { settled } }} />);

        expect(screen.getByText('Beef brisket is matched. Its nutrition now counts.').getAttribute('role')).toBe(
            'status',
        );
        expect(document.activeElement).toBe(trailing());
    });

    it('a pick that failed shows under it and is said assertively, and its text stays', async () => {
        const user = userEvent.setup();
        const values = valuesWith(withLineKeys([BRISKET]));
        const { rerender } = render(<Harness initial={values} />);

        await user.type(trailing(), 'chickpeas');
        rerender(
            <Harness
                initial={values}
                over={{
                    editor: {
                        settled: {
                            origin: { kind: 'entry' },
                            pick: { kind: 'name', text: 'chickpeas' },
                            target: TRAILING,
                            outcome: { kind: 'failed' },
                        },
                    },
                }}
            />,
        );
        const sentence = 'We couldn’t add “chickpeas”. Try again, or use it as written.';

        expect(document.getElementById(trailingCommitFailureId)?.textContent).toBe(sentence);
        expect(trailing().getAttribute('aria-describedby')).toContain(trailingCommitFailureId);
        expect(screen.getAllByRole('alert').filter((region) => region.textContent === sentence)).toHaveLength(1);
        expect(trailing()).toHaveProperty('value', 'chickpeas');
    });

    it('a refusal that points at it: focus, the list opens, and its own sentence describes it (R7)', async () => {
        const user = userEvent.setup();
        const handled = vi.fn();
        const values = valuesWith(withLineKeys([BRISKET]));
        const { rerender } = render(<Harness initial={values} over={{ entry: { view: NOTHING_FOUND } }} />);

        await user.type(trailing(), 'saffron');
        act(() => actions('Beef brisket').focus());
        rerender(
            <Harness
                initial={values}
                over={{
                    entry: { view: NOTHING_FOUND },
                    editor: { pendingRefused: true, pendingFocusRequested: true, pendingFocusHandled: handled },
                }}
            />,
        );

        expect(document.activeElement).toBe(trailing());
        expect(screen.getByRole('listbox', { name: 'Food suggestions for ingredient 2' })).toBeTruthy();
        expect(document.getElementById(trailingPendingTextId)?.textContent).toBe(
            '“saffron” isn’t in the recipe yet. Choose a food for it, or clear the box.',
        );
        expect(trailing().getAttribute('aria-describedby')).toContain(trailingPendingTextId);
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('its list ends with Create my own food, which opens the form for a new line on the typed text (O3)', async () => {
        const user = userEvent.setup();
        const open = vi.fn();
        render(
            <Harness
                initial={valuesWith([])}
                over={{
                    entry: { view: NOTHING_FOUND },
                    editor: { authoredFood: makeAuthoredFoodController({ open }) },
                }}
            />,
        );

        await user.type(trailing(), 'saffron');
        const options = within(screen.getByRole('listbox', { name: 'Food suggestions for ingredient 1' })).getAllByRole(
            'option',
        );

        expect(options.at(-1)?.textContent).toBe(en.createCustomFoodIconLabel);
        expect(options.at(-1)?.getAttribute('aria-label')).toBe(en.createOwnFoodOptionName);
        await user.click(options.at(-1) ?? trailing());

        expect(open).toHaveBeenCalledWith('saffron', TRAILING);
    });

    it('a row’s list does not offer Create my own food: a line reaches it through its ⋮', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([NO_FOOD]))} over={{ entry: { view: NOTHING_FOUND } }} />);

        await user.click(screen.getByRole('combobox', { name: 'Ingredient 1 name' }));
        await user.keyboard('{ArrowDown}');

        // Named by its accessible name, which says it opens a form (S7 list contract P1, 2.5.3).
        expect(screen.queryByRole('option', { name: en.createOwnFoodOptionName })).toBeNull();
        expect(screen.getByRole('option', { name: /^Use “/ })).toBeTruthy();
    });

    it('Escape with its list closed clears it (item 4)', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith([])} />);

        await user.type(trailing(), 'saffron');
        await user.keyboard('{Escape}');
        await user.keyboard('{Escape}');

        expect(trailing()).toHaveProperty('value', '');
    });
});

describe('Create my own food (item 1)', () => {
    it('⋮ opens the form for the row, on the row’s text', async () => {
        const user = userEvent.setup();
        const open = vi.fn();
        const values = valuesWith(withLineKeys([NO_FOOD]));
        render(<Harness initial={values} over={{ editor: { authoredFood: makeAuthoredFoodController({ open }) } }} />);

        await choose(user, 'Kale', en.createCustomFoodIconLabel);

        expect(open).toHaveBeenCalledWith('Kale', lineTarget(values));
    });

    it('after the food is on the line, focus goes to the row’s glyph once the Sheet has gone', async () => {
        const values = valuesWith(withLineKeys([BRISKET]));
        const openForm = makeAuthoredFoodController({
            state: {
                kind: 'open',
                draft: { name: 'Beef brisket', calories: '', proteinG: '', carbsG: '', fatG: '' },
                fieldErrors: {},
                submitFailed: false,
            },
            target: lineTarget(values),
        });
        const { rerender } = render(<Harness initial={values} over={{ editor: { authoredFood: openForm } }} />);
        expect(screen.getByRole('dialog', { name: 'Create “Beef brisket”' })).toBeTruthy();
        const settled: SettledRowCommit = {
            origin: { kind: 'authoredFood', outcome: 'created' },
            pick: { kind: 'catalogFood', foodId: 'food_mine', name: 'Beef brisket' },
            target: lineTarget(values),
            outcome: {
                kind: 'committed',
                key: keyAt(values),
                binding: { ingredientId: 'ing_b', isUserEntered: false, name: 'Beef brisket' },
            },
        };

        rerender(
            <Harness initial={values} over={{ editor: { settled, authoredFood: makeAuthoredFoodController() } }} />,
        );
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByText(en.statusAuthoredAndLinked).getAttribute('role')).toBe('status');
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About Beef brisket' }));
    });
});

describe('Add details and Edit details (§S7, §S8.8, item 9)', () => {
    const withVariants = makeIngredientNutrition({
        lookup: (ref) =>
            ref.kind === 'root'
                ? { state: 'found', catalog: { caloriesPer100g: 155 }, hasVariants: true }
                : { state: 'found', catalog: { caloriesPer100g: 124 } },
    });

    it('a root known to have variants offers Add details, second, which opens the dialog in add mode for that line', async () => {
        const user = userEvent.setup();
        const open = vi.fn();
        const values = valuesWith(withLineKeys([BRISKET]));
        render(
            <Harness
                initial={values}
                nutrition={withVariants}
                over={{
                    editor: { details: { target: undefined, open, model: makeIngredientRowEditorDetailsModel() } },
                }}
            />,
        );

        await user.click(actions('Beef brisket'));
        expect(menuLabels()).toEqual([
            en.statusActionChangeFood,
            shared.ingredientDetails.actionAdd,
            en.statusActionRemove,
        ]);
        await user.click(screen.getByRole('menuitem', { name: shared.ingredientDetails.actionAdd }));

        expect(open).toHaveBeenCalledWith({
            key: values.ingredients[0]?.key,
            rootId: 'food_brisket',
            foodName: 'Beef brisket',
            entry: { mode: 'add' },
        });
    });

    it('a variant-bound line offers Edit details, on its own binding, named with its parts (item 6)', async () => {
        const user = userEvent.setup();
        const open = vi.fn();
        const values = valuesWith(withLineKeys([{ ...BRISKET, variant: FLAT }]));
        render(
            <Harness
                initial={values}
                over={{
                    editor: { details: { target: undefined, open, model: makeIngredientRowEditorDetailsModel() } },
                }}
            />,
        );

        await choose(user, 'Beef brisket, flat half, choice', shared.ingredientDetails.actionEdit);

        expect(open).toHaveBeenCalledWith(
            expect.objectContaining({ rootId: 'food_brisket', entry: { mode: 'edit', current: FLAT } }),
        );
    });

    it('while the root’s variants are not known, the menu has no Add details', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([BRISKET]))} />);

        await user.click(actions('Beef brisket'));

        expect(menuLabels()).toEqual([en.statusActionChangeFood, en.statusActionRemove]);
    });

    it('the dialog shows for the line whose ⋮ opened it', () => {
        const values = valuesWith(withLineKeys([{ ...BRISKET, variant: FLAT }]));
        render(
            <Harness
                initial={values}
                over={{
                    editor: {
                        details: {
                            target: {
                                key: keyAt(values),
                                rootId: 'food_brisket',
                                foodName: 'Beef brisket',
                                entry: { mode: 'edit', current: FLAT },
                            },
                            open: () => undefined,
                            model: makeIngredientRowEditorDetailsModel('edit'),
                        },
                    },
                }}
            />,
        );

        expect(screen.getByRole('dialog', { name: 'Edit details Beef brisket' })).toBeTruthy();
    });

    it.each([
        [
            'a change that landed is announced',
            { kind: 'committed' } as const,
            'Details changed: flat half, choice.',
            undefined,
        ],
        [
            'a write the server refused shows on the row',
            { kind: 'failed' } as const,
            '',
            shared.ingredientDetails.saveRejected,
        ],
    ])('%s', (_label, result, polite, failure) => {
        const values = valuesWith(withLineKeys([{ ...BRISKET, variant: FLAT }]));
        const key = keyAt(values);
        const { rerender } = render(<Harness initial={values} />);
        const settled: SettledRowCommit = {
            origin: { kind: 'details', mode: 'edit' },
            pick: { kind: 'catalogVariant', foodVariantId: 'var_flat' },
            target: { kind: 'line', key },
            outcome:
                result.kind === 'committed'
                    ? {
                          kind: 'committed',
                          key,
                          binding: { ingredientId: 'ing_b', isUserEntered: false, variant: FLAT },
                      }
                    : result,
        };

        rerender(<Harness initial={values} over={{ editor: { settled } }} />);

        if (polite !== '') {
            expect(screen.getByText(polite).getAttribute('role')).toBe('status');
        }

        expect(document.getElementById(ingredientCommitFailureId(key))?.textContent).toBe(failure);
    });
});

/** A closed details model for these tests, in the mode a target names. */
function makeIngredientRowEditorDetailsModel(mode: 'add' | 'edit' = 'add') {
    return {
        mode,
        state: { name: 'loading' },
        query: '',
        onQueryChange: () => undefined,
        onClearQuery: () => undefined,
        onRetry: () => undefined,
        onPick: () => undefined,
        onRemove: undefined,
        onClose: () => undefined,
        announcedCount: undefined,
    } as const;
}

/**
 * REWRITTEN for plan 002 S7.8: row 6 searches the line's own words through the progressive answer, as row 7 does (owner
 * ruling 2026-10-02: every place a cook picks a food shows remote foods), and one pick binds one line through the row
 * editor's commit port, never by resolving the binding.
 */
describe('row 6: what the food search finds for the line, in the glyph’s panel (SPECIFY.1 row 6, P12)', () => {
    const KALE = {
        ingredientId: 'ing_kale',
        name: 'Kale',
        quantity: 1,
        isUserEntered: false,
        resolutionStatus: FoodResolutionStatus.UNRESOLVED,
    } as const;
    const glyph = () => screen.getByRole('button', { name: 'About Kale' });
    const STEWED_PICK = { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' } as const;

    afterEach(() => {
        shortlistSearch.calls.length = 0;
    });

    it('never opens by itself: no panel and no search until the glyph is pressed', () => {
        render(<Harness initial={valuesWith(withLineKeys([KALE]))} />);

        expect(screen.queryByRole('button', { name: en.statusActionNoneOfThese })).toBeNull();
        expect(shortlistSearch.calls).toEqual([]);
    });

    it('the glyph opens row 6’s explanation, our database’s foods, then a source’s foods under `From {source}`', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([KALE]))} />);

        await user.click(glyph());

        expect(screen.getByText(en.statusExplainUnresolved)).toBeTruthy();
        expect(screen.getByRole('list', { name: 'Which “Kale” did you mean?' })).toBeTruthy();
        expect(
            within(screen.getByRole('list', { name: 'From another food database' })).getByRole('button').textContent,
        ).toBe('Apples, stewed');
        expect(shortlistSearch.calls.at(-1)).toEqual(['Kale', true]);
    });

    it('a press on a remote food puts it on THIS line through the row editor’s pick, and the panel closes', async () => {
        const user = userEvent.setup();
        const initial = valuesWith(withLineKeys([KALE]));
        const pickFromShortlist = vi.fn(() =>
            Promise.resolve({
                kind: 'committed',
                key: keyAt(initial),
                binding: { ingredientId: 'ing_stewed', isUserEntered: false },
            } as const),
        );
        render(<Harness initial={initial} over={{ editor: { pickFromShortlist } }} />);

        await user.click(glyph());
        await user.click(screen.getByRole('button', { name: 'Apples, stewed, from another food database' }));

        expect(pickFromShortlist).toHaveBeenCalledExactlyOnceWith(keyAt(initial), STEWED_PICK);
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await vi.waitFor(() => expect(document.activeElement).toBe(glyph()));
    });

    it('None of these starts Change food, puts focus in the field once the panel has gone, and picks nothing', async () => {
        const user = userEvent.setup();
        const pickFromShortlist = vi.fn();
        render(<Harness initial={valuesWith(withLineKeys([KALE]))} over={{ editor: { pickFromShortlist } }} />);

        await user.click(glyph());
        await user.click(screen.getByRole('button', { name: en.statusActionNoneOfThese }));
        const field = await screen.findByRole('combobox', { name: 'Ingredient 1 name' });

        await vi.waitFor(() => expect(document.activeElement).toBe(field));
        expect(screen.getByRole('button', { name: /^Cancel/ })).toBeTruthy();
        expect(pickFromShortlist).not.toHaveBeenCalled();
    });

    // P8's "Adopting" row: the caption names the source the food is coming from.
    it('a remote pick in flight on the row reads busy on the glyph, and says where it is adding from (P8)', () => {
        render(
            <Harness
                initial={valuesWith(withLineKeys([KALE]))}
                over={{
                    editor: {
                        // The source register as the rows read it (P5): USDA by its name, never its id.
                        naming: {
                            ...makeIngredientRowEditor().naming,
                            sourceName: (source) => (source === 'usda' ? 'USDA' : undefined),
                        },
                        pickInFlight: (target) => (target.kind === 'line' ? STEWED_PICK : undefined),
                    },
                }}
            />,
        );

        expect(glyph().getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText(en.ingredientEntryAddingFromSource.replace('{source}', 'USDA'))).toBeTruthy();
    });
});

describe('row 7: the line’s re-derived shortlist in the glyph’s panel (SPECIFY.1 row 7)', () => {
    const SAUCE = {
        ingredientId: 'ing_sauce',
        name: 'apple sauce',
        quantity: 1,
        unit: 'cup',
        isUserEntered: false,
        resolutionStatus: FoodResolutionStatus.AMBIGUOUS,
    } as const;
    const glyph = () => screen.getByRole('button', { name: 'About apple sauce' });
    const CANNED_PICK = { kind: 'catalogFood', foodId: 'food_canned', name: 'Applesauce, canned' } as const;

    afterEach(() => {
        shortlistSearch.calls.length = 0;
        shortlistSearch.refetch.mockReset();
    });

    it('never opens by itself: no panel and no search until the glyph is pressed', () => {
        render(<Harness initial={valuesWith(withLineKeys([SAUCE]))} />);

        expect(screen.queryByRole('button', { name: en.statusActionNoneOfThese })).toBeNull();
        expect(shortlistSearch.calls).toEqual([]);
    });

    it('the glyph opens row 7’s explanation and the shortlist the food search finds for the line’s own words', async () => {
        const user = userEvent.setup();
        render(<Harness initial={valuesWith(withLineKeys([SAUCE]))} />);

        await user.click(glyph());
        const list = screen.getByRole('list', { name: 'Which “apple sauce” did you mean?' });

        expect(screen.getByText(en.statusExplainAmbiguous)).toBeTruthy();
        expect(screen.queryByText(en.statusExplainUnresolved)).toBeNull();
        expect(
            within(list)
                .getAllByRole('button')
                .map((button) => button.textContent),
        ).toEqual(['apple sauce, homemade', 'Applesauce, canned']);
        expect(shortlistSearch.calls.at(-1)).toEqual(['apple sauce', true]);
    });

    it('a press puts that food on THIS line through the row editor’s pick; the panel closes and focus returns to the glyph', async () => {
        const user = userEvent.setup();
        const initial = valuesWith(withLineKeys([SAUCE]));
        const pickFromShortlist = vi.fn(() =>
            Promise.resolve({
                kind: 'committed',
                key: keyAt(initial),
                binding: { ingredientId: 'ing_canned', isUserEntered: false },
            } as const),
        );
        render(<Harness initial={initial} over={{ editor: { pickFromShortlist } }} />);

        await user.click(glyph());
        await user.click(screen.getByRole('button', { name: 'Applesauce, canned' }));

        expect(pickFromShortlist).toHaveBeenCalledExactlyOnceWith(keyAt(initial), CANNED_PICK);
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await vi.waitFor(() => expect(document.activeElement).toBe(glyph()));
    });

    it('a pick that failed is said in the panel, reopened, with the list to choose again', async () => {
        const user = userEvent.setup();
        const initial = valuesWith(withLineKeys([SAUCE]));
        const settled: SettledRowCommit = {
            origin: { kind: 'shortlist' },
            pick: CANNED_PICK,
            target: lineTarget(initial),
            outcome: { kind: 'failed' },
        };
        render(<Harness initial={initial} over={{ editor: { settled } }} />);

        await user.click(glyph());

        expect(
            screen.getAllByRole('alert').filter((region) => region.textContent === en.candidatePickFailed),
        ).toHaveLength(1);
        expect(screen.getByRole('list', { name: 'Which “apple sauce” did you mean?' })).toBeTruthy();
    });

    it('the glyph reads busy while this row’s pick runs, with or without its panel open', () => {
        render(
            <Harness
                initial={valuesWith(withLineKeys([SAUCE]))}
                over={{ editor: { pickInFlight: (target) => (target.kind === 'line' ? CANNED_PICK : undefined) } }}
            />,
        );

        expect(glyph().getAttribute('aria-busy')).toBe('true');
    });

    it('None of these starts Change food, puts focus in the field once the panel has gone, and picks nothing', async () => {
        const user = userEvent.setup();
        const pickFromShortlist = vi.fn();
        render(<Harness initial={valuesWith(withLineKeys([SAUCE]))} over={{ editor: { pickFromShortlist } }} />);

        await user.click(glyph());
        await user.click(screen.getByRole('button', { name: en.statusActionNoneOfThese }));
        const field = await screen.findByRole('combobox', { name: 'Ingredient 1 name' });

        await vi.waitFor(() => expect(document.activeElement).toBe(field));
        expect(pickFromShortlist).not.toHaveBeenCalled();
    });

    it('Remove is the row’s one action, direct: no Change food, no ⋮ (SPECIFY.1 row 7)', () => {
        render(<Harness initial={valuesWith(withLineKeys([SAUCE]))} />);

        expect(screen.queryByRole('button', { name: 'Actions for apple sauce' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Remove ingredient 1' })).toBeTruthy();
    });
});
