/**
 * Component tests for the native field group's ROW EDITOR (plan 002 V1 B7, curated U15): the web leaf's row editor
 * with native's own mechanisms (`docs/design/rowEditorOpenDecisions.md` items 4, 7 and 8; §S14; §S8.8).
 *
 * - An entry field that is not in Change food has a clear button; one in Change food has Cancel instead (item 4).
 * - Android back cancels Change food, before the wizard's own guard (item 4).
 * - The keyboard closing ends Change food when nothing new was typed (item 4).
 * - A press on live search closes the keyboard (§S14).
 * - The reading cursor returns to the row's `⋮` once a sheet it opened has gone, and to its glyph after a created food
 *   is on the line (items 1 and 8, §S8.8): React Native cannot read where the cursor was.
 *
 * The row editor is the stateful fake (`useFakeRowEditor`) over the entry's real pure model. ⚠️ Every render goes
 * through a real `BackInterceptProvider`: the Change food guard throws without one, deliberately.
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { installHardwareBackHandler, type HardwareBackHandle } from '@commise/ui/testing/hardware-back';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type FC } from 'react';
import { AccessibilityInfo, Keyboard } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    progressiveFoodView,
    settledFoodView,
} from '../../__fixtures__/foodSearchViews.js';
import {
    COMPLETE_FRAME,
    catalogResult,
    databaseFrame,
    remoteItem,
    sourceAnswered,
    sourceBusy,
    sourceLimited,
    sourceUnavailable,
} from '../../__fixtures__/progressiveFrames.js';
import { useFakeRowEditor, type FakeRowEditorOverrides } from '../../__fixtures__/useFakeRowEditor.js';
import type { EntrySearchView } from '../../hooks/foodSuggestions.model.js';
import { recipeMessages } from '../../messages.js';
import type { IngredientRowEditor, SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { recipeFormMessages } from '../messages.js';
import { RecipeIngredientsFields } from '../RecipeIngredientsFields.native.js';
import type { IngredientLineKey } from '../lineKey.js';
import type { IngredientNutrition } from '../nutritionLookup.js';
import type { SourceNaming } from '../progressiveNotes.js';
import type { RecipeFormErrors } from '../validate.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../values.js';
import { applyDraftAction } from '../props.js';

// `Platform.OS` is react-native-web's `'web'` unless a case sets `'ios'` to hear iOS's announcement channel.
const platform = vi.hoisted(() => ({ os: undefined as 'ios' | undefined }));
// react-native-web's `Keyboard` never emits; a case closes the keyboard through these listeners.
const keyboardListeners = vi.hoisted(() => new Map<string, Set<() => void>>());

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os ?? actual.Platform.OS;
            },
        },
        AccessibilityInfo: {
            ...actual.AccessibilityInfo,
            sendAccessibilityEvent: vi.fn(),
            announceForAccessibilityWithOptions: vi.fn(),
        },
        Keyboard: {
            ...actual.Keyboard,
            dismiss: vi.fn(),
            addListener: (event: string, listener: () => void) => {
                const listeners = keyboardListeners.get(event) ?? new Set();
                listeners.add(listener);
                keyboardListeners.set(event, listeners);

                return { remove: () => listeners.delete(listener) };
            },
        },
    };
});

let back: HardwareBackHandle;

beforeEach(() => {
    back = installHardwareBackHandler();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    vi.mocked(Keyboard.dismiss).mockClear();
});

afterEach(() => {
    cleanup();
    back.restore();
    platform.os = undefined;
    vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mockClear();
});

// Rows 6 and 7's panel searches the line's words through the progressive food search, whose own suite drives the
// clients; here it answers one of the cook's own foods, one catalog food, and one remote food from USDA.
const shortlistSearch = vi.hoisted(() => ({ calls: [] as (readonly [string, boolean])[] }));

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
            refetch: () => undefined,
        };
    },
}));

const en = recipeFormMessages.en;

/** The key of the seeded line at `index`; a test that names a line it did not seed fails here, not later. */
function keyAt(values: RecipeFormValues, index = 0): IngredientLineKey {
    const line = values.ingredients[index];

    if (line === undefined) {
        throw new Error(`no seeded line at ${String(index)}`);
    }

    return line.key;
}

const NUTRITION = makeIngredientNutrition();
const SOURCE_NAMES = new Map([
    ['usda', 'USDA'],
    ['fdc', 'FDC Branded'],
]);
/** The source register as the rows read it (`useSourceNaming`, S7 list contract P5): a source by its name, never its id. */
const NAMED_SOURCES: SourceNaming = {
    sourceName: (source) => SOURCE_NAMES.get(source),
    // UTC hours and minutes, so a test reads the minute item 10 rounds a limit's end up to.
    formatTime: (epochMs) => new Date(epochMs).toISOString().slice(11, 16),
    formatList: (items) => new Intl.ListFormat('en', { type: 'conjunction' }).format(items),
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

const Harness: FC<{
    readonly initial: RecipeFormValues;
    readonly over?: FakeRowEditorOverrides;
    readonly errors?: RecipeFormErrors;
    readonly nutrition?: IngredientNutrition;
}> = ({ initial, over, errors, nutrition = NUTRITION }) => {
    const [values, setValues] = useState(initial);
    // The host's draft transition, applied to this harness's own draft, as each host applies it to its own.
    const rowEditor = useFakeRowEditor(values.ingredients, {
        ...over,
        editor: { dispatch: (action) => setValues((current) => applyDraftAction(current, action)), ...over?.editor },
    });

    return (
        <BackInterceptProvider onUnhandled={() => false}>
            <RecipeIngredientsFields
                values={values}
                {...(errors === undefined ? {} : { errors })}
                onChange={setValues}
                nutrition={nutrition}
                lookupRetry={makeLookupRetry()}
                rowEditor={rowEditor}
            />
        </BackInterceptProvider>
    );
};

const actions = (food: string): HTMLElement => screen.getByRole('button', { name: `Actions for ${food}` });

const choose = (food: string, item: string): void => {
    fireEvent.click(actions(food));
    fireEvent.click(screen.getByRole('menuitem', { name: item }));
};

/** The on-screen keyboard closes, as the platform reports it. */
const keyboardCloses = (): void => {
    act(() => {
        keyboardListeners.get('keyboardDidHide')?.forEach((listener) => {
            listener();
        });
    });
};

const cursorWentTo = (node: HTMLElement): boolean =>
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.some(([target]) => (target as unknown) === node);

describe('entry fields (native)', () => {
    it('a row that names no food shows its text in an editable field, with a clear button and no Cancel', () => {
        render(<Harness initial={valuesWith(withLineKeys([NO_FOOD]))} />);

        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').value).toBe('Kale');
        expect(screen.getByRole('button', { name: en.ingredientEntryClear })).toBeTruthy();
        expect(screen.queryByRole('button', { name: /^Cancel, keep / })).toBeNull();
    });

    it('Change food: the field shows the current name, with Cancel instead of a clear button (item 4)', () => {
        render(<Harness initial={valuesWith(withLineKeys([BRISKET]))} />);

        choose('Beef brisket', en.statusActionChangeFood);

        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').readOnly).toBe(false);
        expect(screen.getByRole('button', { name: 'Cancel, keep Beef brisket' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: en.ingredientEntryClear })).toBeNull();
    });

    it('Cancel ends Change food and returns the reading cursor to ⋮', () => {
        render(<Harness initial={valuesWith(withLineKeys([BRISKET]))} />);
        choose('Beef brisket', en.statusActionChangeFood);
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel, keep Beef brisket' }));

        // Back in record mode, the name is text again (§3b), no longer a field.
        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Beef brisket');
        expect(screen.queryByRole('combobox', { name: 'Ingredient 1 name' })).toBeNull();
        expect(cursorWentTo(actions('Beef brisket'))).toBe(true);
    });

    it('Android back ends Change food, before anything else on the screen hears it (item 4)', () => {
        render(<Harness initial={valuesWith(withLineKeys([BRISKET]))} />);
        choose('Beef brisket', en.statusActionChangeFood);

        expect(back.press()).toBe(true);

        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Beef brisket');
        expect(screen.queryByRole('combobox', { name: 'Ingredient 1 name' })).toBeNull();
        // With nothing in Change food, back goes on to the host.
        expect(back.press()).toBe(false);
    });

    it('the keyboard closing with nothing new typed ends Change food (item 4)', () => {
        render(<Harness initial={valuesWith(withLineKeys([BRISKET]))} />);
        choose('Beef brisket', en.statusActionChangeFood);

        keyboardCloses();

        expect(screen.getByRole('group', { name: 'Ingredient 1 name' }).textContent).toBe('Beef brisket');
        expect(screen.queryByRole('combobox', { name: 'Ingredient 1 name' })).toBeNull();
    });

    it('the keyboard closing after new text keeps the row in Change food, with the text (item 4)', () => {
        render(<Harness initial={valuesWith(withLineKeys([BRISKET]))} />);
        choose('Beef brisket', en.statusActionChangeFood);
        fireEvent.change(screen.getByLabelText('Ingredient 1 name'), { target: { value: 'Beef brisket point' } });

        keyboardCloses();

        expect(screen.getByLabelText<HTMLInputElement>('Ingredient 1 name').value).toBe('Beef brisket point');
        expect(screen.getByRole('button', { name: 'Cancel, keep Beef brisket' })).toBeTruthy();
    });

    // SPECIFY.1 row 1 (`ingredientStatusExplanation.md` §3a): a line in the cook's own words offers its remedy first.
    it('a declared row is an entry field; its ⋮ offers Find a food for this, which moves the cursor into the field', () => {
        const focus = vi.fn();
        const values = valuesWith(withLineKeys([DECLARED]));
        render(<Harness initial={values} over={{ entry: { focus } }} />);

        fireEvent.click(actions('grandma’s mix'));
        expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
            en.statusActionFindFood,
            en.statusActionRemove,
        ]);
        // The sheet took the cursor to its title as it opened; only where the item sends it is under test.
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
        fireEvent.click(screen.getByRole('menuitem', { name: en.statusActionFindFood }));
        const field = screen.getByLabelText('Ingredient 1 name');

        expect(document.activeElement).toBe(field);
        expect(cursorWentTo(field)).toBe(true);
        expect(focus).toHaveBeenCalledWith({ kind: 'line', key: keyAt(values) });
    });

    // REWRITTEN for plan 002 S7.9: the live search's press is gone; a remote food is one more option in the list (P8).
    it('a remote food in the list goes to the entry as a remote pick', () => {
        const selectRemoteFood = vi.fn();
        render(
            <Harness
                initial={valuesWith(withLineKeys([NO_FOOD]))}
                over={{
                    entry: {
                        view: progressiveFoodView(
                            [
                                databaseFrame(),
                                sourceAnswered('usda', remoteItem('Kale, lacinato', 'sealed.l')),
                                COMPLETE_FRAME,
                            ],
                            { text: 'Kale!' },
                        ),
                        selectRemoteFood,
                    },
                }}
            />,
        );
        const field = screen.getByLabelText('Ingredient 1 name');

        fireEvent.focus(field);
        fireEvent.change(field, { target: { value: 'Kale!' } });
        fireEvent.click(screen.getByRole('button', { name: 'Kale, lacinato, from another food database' }));

        expect(selectRemoteFood).toHaveBeenCalledWith({
            group: 'remote',
            source: 'usda',
            hit: { name: 'Kale, lacinato', reference: 'sealed.l' },
        });
    });
});

describe('the active field’s list, native (items 1 and 2)', () => {
    // Item 2: the ways to fill a name are options in the list; native's options are buttons in the same order.
    it('Find nutrition for “…” goes to the entry as a pick by the field’s words, and picks no food', () => {
        const findByName = vi.fn();
        const selectFood = vi.fn();
        const declareAsWritten = vi.fn();
        const kale = makeCatalogFoodOption({ id: 'food_kale', name: 'Kale, raw' });
        render(
            <Harness
                initial={valuesWith(withLineKeys([NO_FOOD]))}
                over={{
                    entry: {
                        view: settledFoodView(answeredGroup(), answeredGroup(kale)),
                        findByName,
                        selectFood,
                        declareAsWritten,
                    },
                }}
            />,
        );
        const field = screen.getByLabelText('Ingredient 1 name');

        fireEvent.focus(field);
        fireEvent.change(field, { target: { value: 'Kale, curly' } });
        fireEvent.click(
            screen.getByRole('button', { name: en.ingredientEntryFindByName.replace('{query}', 'Kale, curly') }),
        );

        expect(findByName).toHaveBeenCalledTimes(1);
        expect(selectFood).not.toHaveBeenCalled();
        expect(declareAsWritten).not.toHaveBeenCalled();
    });
});

describe('every state of the food list, native (S5 list contract L1 to L4, §S13 P3 to P9)', () => {
    const shared = recipeMessages.en;
    const MINE = makeAuthoredFoodOption({ id: 'food_mine', name: 'Kale chips' });
    const RAW = makeCatalogFoodOption({ id: 'food_kale', name: 'Kale, raw' });
    const NO_MATCH = en.ingredientNoSuggestions.replace('{query}', 'Kales');

    /** Open the row's in-flow list on `view` (native opens it on a text change), and answer what it shows and says. */
    function openOn(view: EntrySearchView, selectFood = vi.fn()) {
        render(<Harness initial={valuesWith(withLineKeys([NO_FOOD]))} over={{ entry: { view, selectFood } }} />);
        const field = screen.getByLabelText('Ingredient 1 name');

        fireEvent.focus(field);
        fireEvent.change(field, { target: { value: 'Kales' } });

        return {
            headers: within(screen.getByLabelText('Food suggestions for ingredient 1'))
                .getAllByRole('heading')
                .map((heading) => heading.textContent),
            alerts: screen
                .queryAllByRole('alert')
                .map((alert) => alert.textContent)
                .filter((text) => text !== ''),
            politeSays: (text: string) =>
                screen.getAllByText(text).some((el) => el.getAttribute('aria-live') === 'polite'),
            selectFood,
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
    ])('%s: its group headers, then `Not listed?` last (item 2)', (_case, view, foodGroups) => {
        expect(openOn(view).headers).toEqual([...foodGroups, en.ingredientSuggestionsMoreHeading]);
    });

    it('both answered: the count of both groups, said politely (item 5)', () => {
        const shown = openOn(settledFoodView(answeredGroup(MINE), answeredGroup(RAW)));

        expect(shown.politeSays('2 foods found')).toBe(true);
        expect(shown.alerts).toEqual([]);
    });

    // REWRITTEN for plan 002 S7.8 (P2, P3): before the database part only the loader shows: no header, no option.
    it('searching: the loader alone, said politely, with no option yet (P2, P3)', () => {
        render(
            <Harness
                initial={valuesWith(withLineKeys([NO_FOOD]))}
                over={{ entry: { view: { kind: 'searching', resumed: false } } }}
            />,
        );
        const field = screen.getByLabelText('Ingredient 1 name');

        fireEvent.focus(field);
        fireEvent.change(field, { target: { value: 'Kales' } });

        expect(within(screen.getByLabelText('Food suggestions for ingredient 1')).queryAllByRole('button')).toEqual([]);
        expect(
            screen
                .getAllByText(shared.ingredientPickerSearch.searching)
                .some((el) => el.getAttribute('aria-live') === 'polite'),
        ).toBe(true);
    });

    it('no food matched: the note names the way on, said politely (P7)', () => {
        expect(openOn(settledFoodView(answeredGroup(), answeredGroup())).politeSays(NO_MATCH)).toBe(true);
    });

    it('the catalog failed with no food of the cook’s own: its sentence alone, never “no foods match” (L3)', () => {
        const shown = openOn(settledFoodView(answeredGroup(), UNAVAILABLE_GROUP));

        expect(shown.politeSays(en.ingredientCatalogUnavailable)).toBe(true);
        expect(screen.queryByText(NO_MATCH)).toBeNull();
    });

    // `docs/design/v3Evaluation.md` V3-M2a: the leaves share one model, so native keeps web's order (P10).
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
    ])('the catalog failed, %s', (_case, view, place) => {
        openOn(view);
        const list = screen.getByLabelText('Food suggestions for ingredient 1');
        const [first] = within(list).getAllByRole('button');
        const line = within(list).getByText(en.ingredientCatalogUnavailable);
        const following = (first.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

        expect(following ? 'after' : 'before').toBe(place);
    });

    it('the cook’s own search failed: its sentence after the count (L3)', () => {
        expect(
            openOn(settledFoodView(UNAVAILABLE_GROUP, answeredGroup(RAW))).politeSays(
                `1 food found ${en.ingredientAuthoredUnavailable}`,
            ),
        ).toBe(true);
    });

    it('both failed: said as an alert, never politely (P8)', () => {
        expect(openOn(settledFoodView(UNAVAILABLE_GROUP, UNAVAILABLE_GROUP)).alerts).toEqual([
            shared.ingredientPickerSearch.failed,
        ]);
    });

    it('a half the search limit refused reads as that group unavailable, not as the USDA limit', () => {
        openOn(settledFoodView(answeredGroup(MINE), UNAVAILABLE_GROUP));

        expect(screen.getAllByText(en.ingredientCatalogUnavailable).length).toBeGreaterThan(0);
        expect(screen.queryByText(/reached your limit/u)).toBeNull();
    });

    it('offline: the parked-read sentence, said politely, with no retry (P9, R2)', () => {
        const shown = openOn({ kind: 'offline' });

        expect(shown.politeSays(offlineNoticeMessages.en.readOffline)).toBe(true);
        expect(screen.queryByRole('button', { name: /try again/iu })).toBeNull();
    });

    /** Open the row's list on the progressive answer `frames` fold to, with the sources named as the register names them. */
    function openOnFrames(frames: Parameters<typeof progressiveFoodView>[0]): HTMLElement {
        render(
            <Harness
                initial={valuesWith(withLineKeys([NO_FOOD]))}
                over={{
                    entry: { view: progressiveFoodView(frames, { text: 'Kales' }) },
                    editor: { naming: NAMED_SOURCES },
                }}
            />,
        );
        const field = screen.getByLabelText('Ingredient 1 name');

        fireEvent.focus(field);
        fireEvent.change(field, { target: { value: 'Kales' } });

        return screen.getByLabelText('Food suggestions for ingredient 1');
    }

    // P5 and P6: each source the search could not reach leaves its own trailing note, in arrival order, by its name.
    it('a source that could not be searched says so by name, after the foods that did arrive (P5, P6)', () => {
        const list = openOnFrames([
            databaseFrame({ catalog: [catalogResult('food_kale', 'Kale, raw')] }),
            sourceBusy('fdc', 60_000),
            sourceUnavailable('usda'),
            COMPLETE_FRAME,
        ]);
        const food = within(list).getByRole('button', { name: 'Kale, raw' });
        const busy = within(list).getByText(
            shared.ingredientRemoteSearch.sourceBusy.replace('{source}', 'FDC Branded'),
        );
        const unavailable = within(list).getByText(
            shared.ingredientRemoteSearch.sourceUnavailable.replace('{source}', 'USDA'),
        );

        expect(food.compareDocumentPosition(busy) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
        expect(busy.compareDocumentPosition(unavailable) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    });

    // P6 and item 10: one budget covers every source, so one note names them all, with the minute its end rounds up to.
    it('the cook’s own limit is one note for every source it skipped, and says until when (P6, item 10)', () => {
        // Each source skipped until 00:01:30 UTC, so the note names 00:02.
        const list = openOnFrames([
            databaseFrame({ catalog: [catalogResult('food_kale', 'Kale, raw')] }),
            sourceLimited('usda', 90_000),
            sourceLimited('fdc', 90_000),
            COMPLETE_FRAME,
        ]);

        expect(
            within(list).getAllByText(
                shared.ingredientRemoteSearch.sourceLimited
                    .replace('{time}', '00:02')
                    .replace('{sources}', 'USDA and FDC Branded'),
            ),
        ).toHaveLength(1);
    });

    it('a catalog result that names a variant shows its parts, and its name adds them (§S2, L4.1)', () => {
        const fried = makeCatalogFoodOption({
            id: 'food_breast',
            name: 'boneless skinless chicken breasts',
            variant: { id: 'var_fried', parts: [{ attribute: 'cookingMethod', text: 'fried' }] },
        });
        const shown = openOn(settledFoodView(answeredGroup(), answeredGroup(fried)));

        expect(screen.getByText('fried')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'boneless skinless chicken breasts, fried' }));
        expect(shown.selectFood).toHaveBeenCalledWith(fried);
    });

    it('the cook’s own food is named as theirs, so it never sounds like the catalog’s (L4.2)', () => {
        openOn(
            settledFoodView(
                answeredGroup(makeAuthoredFoodOption({ id: 'food_b1', name: 'Butter' })),
                answeredGroup(makeCatalogFoodOption({ id: 'food_b2', name: 'Butter' })),
            ),
        );

        expect(screen.getByRole('button', { name: 'Butter, your food' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Butter' })).toBeTruthy();
    });
});

describe('the trailing add row, native (plan 002 V1 B8; §2d, §4b; items 1, 3 and 4)', () => {
    const TRAILING = { kind: 'newLine' } as const;
    const trailing = (): HTMLInputElement => screen.getByLabelText<HTMLInputElement>(en.addIngredientRowLabel);
    const NOTHING_FOUND = settledFoodView(answeredGroup(), answeredGroup());

    it('a pick it appended is said politely, and the cursor stays in the emptied field (F1)', () => {
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

        rerender(<Harness initial={values} over={{ editor: { settled } }} />);

        expect(
            screen
                .getAllByText('Beef brisket is matched. Its nutrition now counts.')
                .some((el) => el.getAttribute('aria-live') === 'polite'),
        ).toBe(true);
        expect(cursorWentTo(trailing())).toBe(true);
    });

    it('a pick that failed shows under it and is said assertively, and its text stays', () => {
        const values = valuesWith(withLineKeys([BRISKET]));
        const { rerender } = render(<Harness initial={values} />);

        fireEvent.change(trailing(), { target: { value: 'chickpeas' } });
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

        expect(screen.getAllByText(sentence).some((el) => el.getAttribute('role') === 'alert')).toBe(true);
        expect(screen.getAllByText(sentence).some((el) => el.getAttribute('aria-live') === null)).toBe(true);
        expect(trailing().value).toBe('chickpeas');
    });

    it('a refusal that points at it: focus, the list opens, and its alert says the trailing row’s sentence (R7)', () => {
        const handled = vi.fn();
        const values = valuesWith(withLineKeys([BRISKET]));
        const { rerender } = render(<Harness initial={values} over={{ entry: { view: NOTHING_FOUND } }} />);

        fireEvent.change(trailing(), { target: { value: 'saffron' } });
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
        const sentence = '“saffron” isn’t in the recipe yet. Choose a food for it, or clear the box.';

        expect(document.activeElement).toBe(trailing());
        expect(screen.getByLabelText('Food suggestions for ingredient 2')).toBeTruthy();
        // Once under the field (never live), once in the field's assertive channel.
        expect(screen.getAllByText(sentence)).toHaveLength(2);
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('its list ends with Create my own food, which opens the form for a new line on the typed text (O3)', () => {
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

        fireEvent.focus(trailing());
        fireEvent.change(trailing(), { target: { value: 'saffron' } });
        const list = screen.getByLabelText('Food suggestions for ingredient 1');
        const buttons = within(list).getAllByRole('button');

        expect(buttons.at(-1)?.textContent).toBe(en.createCustomFoodIconLabel);
        // Its name says it opens a form, starting with its visible text (S7 list contract P1, 2.5.3).
        fireEvent.click(screen.getByRole('button', { name: en.createOwnFoodOptionName }));

        expect(open).toHaveBeenCalledWith('saffron', TRAILING);
    });

    it('its clear button empties it, and the cook can start again', () => {
        render(<Harness initial={valuesWith([])} />);

        fireEvent.change(trailing(), { target: { value: 'saffron' } });
        fireEvent.click(screen.getByRole('button', { name: en.ingredientEntryClear }));

        expect(trailing().value).toBe('');
    });
});

describe('busy, and what a settled pick says (native)', () => {
    it('while a pick runs: its caption says what it is doing, and ⋮ is unavailable', () => {
        render(
            <Harness
                initial={valuesWith(withLineKeys([BRISKET]))}
                over={{
                    editor: {
                        pickInFlight: (target) =>
                            target.kind === 'line' ? { kind: 'name', text: 'brisket' } : undefined,
                    },
                }}
            />,
        );

        expect(screen.getByText(en.ingredientEntryAddingByName)).toBeTruthy();
        expect(actions('Beef brisket').getAttribute('aria-disabled')).toBe('true');
    });

    it('a Change food pick that failed shows on the row', () => {
        const values = valuesWith(withLineKeys([BRISKET]));
        const { rerender } = render(<Harness initial={values} />);
        choose('Beef brisket', en.statusActionChangeFood);
        const failed: SettledRowCommit = {
            origin: { kind: 'entry' },
            pick: { kind: 'name', text: 'brisket' },
            target: { kind: 'line', key: values.ingredients[0]?.key ?? 'missing' },
            outcome: { kind: 'failed' },
        };

        rerender(<Harness initial={values} over={{ editor: { settled: failed } }} />);

        expect(
            screen.getAllByText('The change didn’t save. This ingredient still uses Beef brisket.').length,
        ).toBeGreaterThan(0);
    });
});

/**
 * E2 (`docs/design/rowEditorOpenDecisions.md`): a pick that failed while its step was away. On return the row shows its
 * failure line, the same line a failure on the step shows, right after the field in reading order, and no alert plays:
 * an alert reports an event, and this is a state. iOS's live region announces any message present at mount, so the
 * spy on iOS's channel is what can hear one.
 */
describe('a failed pick across the step’s lifetime, native (E2)', () => {
    /** A pick that failed on a row that names no food, whose name is always its entry field. */
    const failedOn = (values: RecipeFormValues): SettledRowCommit => ({
        origin: { kind: 'entry' },
        pick: { kind: 'name', text: 'brisket point' },
        target: { kind: 'line', key: keyAt(values) },
        outcome: { kind: 'failed' },
    });
    /** What iOS was asked to announce that says a pick failed. */
    const failureAnnouncements = () =>
        vi
            .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
            .mock.calls.filter(([text]) => /We couldn’t add/u.test(text));

    it('on return, the row shows its failure line right after its field, and nothing is announced', () => {
        platform.os = 'ios';
        const values = valuesWith(withLineKeys([NO_FOOD]));

        render(<Harness initial={values} over={{ editor: { settled: failedOn(values) } }} />);
        // The cook is back in the field: an active field is one that would say an alert.
        fireEvent.focus(screen.getByLabelText(/^Ingredient 1 name/u));

        const line = screen.getByText(/^We couldn’t add/u);

        expect(
            screen.getByLabelText(/^Ingredient 1 name/u).compareDocumentPosition(line) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(failureAnnouncements()).toEqual([]);
    });

    it('a failure that settles while the step shows is said once, assertively', () => {
        platform.os = 'ios';
        const values = valuesWith(withLineKeys([NO_FOOD]));
        const { rerender } = render(<Harness initial={values} />);
        fireEvent.focus(screen.getByLabelText(/^Ingredient 1 name/u));

        rerender(<Harness initial={values} over={{ editor: { settled: failedOn(values) } }} />);

        expect(failureAnnouncements()).toEqual([[expect.stringMatching(/^We couldn’t add/u), { queue: false }]]);
    });
});

describe('a refusal for pending text points at its field, and says why (`rowEditorOpenDecisions.md` R7)', () => {
    const SENTENCE = '“saffron” isn’t in the recipe yet. Choose a food for it, or clear the box.';

    const typed = (): HTMLElement => {
        const field = screen.getByLabelText('Ingredient 1 name');

        fireEvent.change(field, { target: { value: 'saffron' } });
        act(() => actions('Beef brisket').focus());

        return field;
    };

    it('the raised level focuses the pending field, and only then does its own alert speak the row sentence', () => {
        const handled = vi.fn();
        const values = valuesWith(withLineKeys([NO_FOOD, BRISKET]));
        const { rerender } = render(<Harness initial={values} />);
        const field = typed();

        rerender(
            <Harness
                initial={values}
                over={{ editor: { pendingRefused: true, pendingFocusRequested: true, pendingFocusHandled: handled } }}
            />,
        );

        expect(document.activeElement).toBe(field);
        expect(handled).toHaveBeenCalledTimes(1);
        // Once under the field (never live), once in the field's assertive channel.
        expect(screen.getAllByText(SENTENCE)).toHaveLength(2);
    });

    it('typing after the refusal takes the sentence out of the alert; the visible one follows the text', () => {
        const values = valuesWith(withLineKeys([NO_FOOD, BRISKET]));
        const { rerender } = render(<Harness initial={values} />);
        const field = typed();

        rerender(<Harness initial={values} over={{ editor: { pendingRefused: true, pendingFocusRequested: true } }} />);
        fireEvent.change(field, { target: { value: 'saffron threads' } });

        expect(screen.queryAllByText(SENTENCE)).toHaveLength(0);
        expect(
            screen.getAllByText('“saffron threads” isn’t in the recipe yet. Choose a food for it, or clear the box.'),
        ).toHaveLength(1);
    });

    it('a later refusal says the sentence again, and only once the field has taken focus, so the move does not cut it off (R8)', () => {
        const values = valuesWith(withLineKeys([NO_FOOD, BRISKET]));
        const { container, rerender } = render(<Harness initial={values} />);
        const assertive = (): readonly string[] =>
            Array.from(container.querySelectorAll('[aria-live="assertive"]'))
                .map((node) => node.textContent ?? '')
                .filter((text) => text === '' || text === SENTENCE);

        // The row editor's level as it moves: raised at a refusal, lowered once the field has taken focus.
        const at = (pendingFocusRequested: boolean, pendingRefusals: number): readonly string[] => {
            rerender(
                <Harness
                    initial={values}
                    over={{ editor: { pendingRefused: true, pendingFocusRequested, pendingRefusals } }}
                />,
            );

            return assertive();
        };

        typed();
        const first = at(true, 1);
        const taken = at(false, 1);
        // The second refusal is counted before the field has taken focus again: nothing is said yet.
        const counted = at(false, 2);
        const again = at(true, 2);

        expect(first).toContain(SENTENCE);
        expect(taken).toEqual(first);
        expect(counted).toEqual(first);
        expect(again).toContain(SENTENCE);
        expect(again.indexOf(SENTENCE)).not.toBe(first.indexOf(SENTENCE));
    });

    it('with no level raised, the sentence shows under the field and is not spoken', () => {
        const values = valuesWith(withLineKeys([NO_FOOD, BRISKET]));
        const { rerender } = render(<Harness initial={values} />);

        typed();
        rerender(<Harness initial={values} over={{ editor: { pendingRefused: true } }} />);

        expect(screen.getAllByText(SENTENCE)).toHaveLength(1);
        expect(document.activeElement).toBe(actions('Beef brisket'));
    });
});

/**
 * `docs/design/rowEditorOpenDecisions.md` item 9 and `ingredientSpecialization.md` §S7: Add details on a root-bound line
 * whose root is known to have variants, and Edit details on a variant-bound line, which needs no read. Web and native
 * keep the same rule.
 */
describe('Add details and Edit details, native (§S7, §S8.8, items 6, 8 and 9)', () => {
    const shared = recipeMessages.en;
    const FLAT = { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat half' }] };
    const WITH_VARIANTS = makeIngredientNutrition({
        lookup: (ref) =>
            ref.kind === 'root'
                ? { state: 'found', catalog: { caloriesPer100g: 155 }, hasVariants: true }
                : { state: 'found', catalog: { caloriesPer100g: 124 } },
    });
    const NOT_YET_READ = makeIngredientNutrition({ read: 'loading', lookup: () => ({ state: 'pending' }) });
    const READ_FAILED = makeIngredientNutrition({ read: 'failed', lookup: () => ({ state: 'failed' }) });
    /** The row editor's details controller, closed, whose `open` is the test's spy. */
    const detailsOpenedBy = (open: IngredientRowEditor['details']['open']): IngredientRowEditor['details'] => ({
        ...makeIngredientRowEditor().details,
        open,
    });
    const menuLabels = (): readonly (string | null)[] =>
        screen.getAllByRole('menuitem').map((item) => item.textContent);

    it('a root known to have variants offers Add details, second, which opens the sheet in add mode for that line', () => {
        const open = vi.fn();
        const values = valuesWith(withLineKeys([BRISKET]));
        render(
            <Harness
                initial={values}
                nutrition={WITH_VARIANTS}
                over={{ editor: { details: detailsOpenedBy(open) } }}
            />,
        );

        fireEvent.click(actions('Beef brisket'));
        expect(menuLabels()).toEqual([
            en.statusActionChangeFood,
            shared.ingredientDetails.actionAdd,
            en.statusActionRemove,
        ]);
        fireEvent.click(screen.getByRole('menuitem', { name: shared.ingredientDetails.actionAdd }));

        expect(open).toHaveBeenCalledWith({
            key: keyAt(values),
            rootId: 'food_brisket',
            foodName: 'Beef brisket',
            entry: { mode: 'add' },
        });
    });

    it('a variant-bound line offers Edit details on its own binding, before its root’s variants are read (items 6 and 9)', () => {
        const open = vi.fn();
        const values = valuesWith(withLineKeys([{ ...BRISKET, variant: FLAT }]));
        render(
            <Harness initial={values} nutrition={NOT_YET_READ} over={{ editor: { details: detailsOpenedBy(open) } }} />,
        );

        choose('Beef brisket, flat half', shared.ingredientDetails.actionEdit);

        expect(open).toHaveBeenCalledWith(
            expect.objectContaining({
                key: keyAt(values),
                rootId: 'food_brisket',
                entry: { mode: 'edit', current: FLAT },
            }),
        );
    });

    it.each([
        ['still loading', NOT_YET_READ],
        ['failed', READ_FAILED],
    ])('while the read of the root’s variants is %s, the menu has no Add details (item 9)', (_case, nutrition) => {
        render(<Harness initial={valuesWith(withLineKeys([BRISKET]))} nutrition={nutrition} />);

        fireEvent.click(actions('Beef brisket'));

        expect(menuLabels()).toEqual([en.statusActionChangeFood, en.statusActionRemove]);
    });
});

describe('the sheets the ⋮ opens (items 1 and 8, §S8.8)', () => {
    const OPEN_FORM = {
        kind: 'open',
        draft: { name: 'Beef brisket', calories: '', proteinG: '', carbsG: '', fatG: '' },
        fieldErrors: {},
        submitFailed: false,
    } as const;

    it('after the authored-food form is cancelled, the cursor returns to the row’s ⋮ once it has gone', () => {
        const values = valuesWith(withLineKeys([BRISKET]));
        const target = { kind: 'line', key: values.ingredients[0]?.key ?? 'missing' } as const;
        const { rerender } = render(
            <Harness
                initial={values}
                over={{ editor: { authoredFood: makeAuthoredFoodController({ state: OPEN_FORM, target }) } }}
            />,
        );
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        act(() => rerender(<Harness initial={values} />));

        expect(cursorWentTo(actions('Beef brisket'))).toBe(true);
    });

    it('after a created food is on the line, the cursor goes to the row’s glyph once the form has gone', () => {
        const values = valuesWith(withLineKeys([BRISKET]));
        const key = values.ingredients[0]?.key ?? 'missing';
        const target = { kind: 'line', key } as const;
        const { rerender } = render(
            <Harness
                initial={values}
                over={{ editor: { authoredFood: makeAuthoredFoodController({ state: OPEN_FORM, target }) } }}
            />,
        );
        const settled: SettledRowCommit = {
            origin: { kind: 'authoredFood', outcome: 'created' },
            pick: { kind: 'catalogFood', foodId: 'food_mine', name: 'Beef brisket' },
            target,
            outcome: { kind: 'committed', key, binding: { ingredientId: 'ing_b', isUserEntered: false } },
        };
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        act(() => rerender(<Harness initial={values} over={{ editor: { settled } }} />));

        expect(cursorWentTo(screen.getByRole('button', { name: 'About Beef brisket' }))).toBe(true);
        expect(cursorWentTo(actions('Beef brisket'))).toBe(false);
    });

    it('when the details dialog closes, the cursor returns to the row’s ⋮ once it has gone (§S8.8)', () => {
        const flat = { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat half' }] };
        const values = valuesWith(withLineKeys([{ ...BRISKET, variant: flat }]));
        const closedModel = {
            mode: 'edit',
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
        const details = (open: boolean) => ({
            target: open
                ? {
                      key: values.ingredients[0]?.key ?? 'missing',
                      rootId: 'food_brisket',
                      foodName: 'Beef brisket',
                      entry: { mode: 'edit', current: flat } as const,
                  }
                : undefined,
            open: () => undefined,
            model: closedModel,
        });
        const { rerender } = render(<Harness initial={values} over={{ editor: { details: details(true) } }} />);
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        act(() => rerender(<Harness initial={values} over={{ editor: { details: details(false) } }} />));

        expect(cursorWentTo(actions('Beef brisket, flat half'))).toBe(true);
    });
});

/**
 * REWRITTEN for plan 002 S7.8: row 6 searches the line's own words through the progressive answer, as row 7 does (owner
 * ruling 2026-10-02), and one pick binds one line through the row editor's commit port.
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

    it('the glyph opens row 6’s explanation, our database’s foods, then a source’s under its header', () => {
        render(<Harness initial={valuesWith(withLineKeys([KALE]))} />);

        fireEvent.click(glyph());

        expect(screen.getByText(en.statusExplainUnresolved)).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'From another food database' })).toBeTruthy();
        expect(shortlistSearch.calls.at(-1)).toEqual(['Kale', true]);
    });

    it('a press on a remote food puts it on THIS line through the row editor’s pick, and the sheet closes', async () => {
        const initial = valuesWith(withLineKeys([KALE]));
        const pickFromShortlist = vi.fn(() =>
            Promise.resolve({
                kind: 'committed',
                key: keyAt(initial),
                binding: { ingredientId: 'ing_stewed', isUserEntered: false },
            } as const),
        );
        render(<Harness initial={initial} over={{ editor: { pickFromShortlist } }} />);

        fireEvent.click(glyph());
        fireEvent.click(screen.getByRole('button', { name: 'Apples, stewed, from another food database' }));

        expect(pickFromShortlist).toHaveBeenCalledExactlyOnceWith(keyAt(initial), STEWED_PICK);
        await vi.waitFor(() => expect(screen.queryByRole('button', { name: en.statusActionNoneOfThese })).toBeNull());
    });

    it('None of these starts Change food, puts focus in the field once the sheet has gone, and picks nothing', () => {
        const pickFromShortlist = vi.fn();
        render(<Harness initial={valuesWith(withLineKeys([KALE]))} over={{ editor: { pickFromShortlist } }} />);

        fireEvent.click(glyph());
        fireEvent.click(screen.getByRole('button', { name: en.statusActionNoneOfThese }));

        expect(document.activeElement).toBe(screen.getByLabelText('Ingredient 1 name'));
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByLabelText('Ingredient 1 name'),
            'focus',
        );
        expect(pickFromShortlist).not.toHaveBeenCalled();
    });

    // P8's "Adopting" row: the caption names the source the food is coming from.
    it('a remote pick in flight on the row reads busy on the glyph, and says where it is adding from (P8)', () => {
        render(
            <Harness
                initial={valuesWith(withLineKeys([KALE]))}
                over={{
                    editor: {
                        naming: NAMED_SOURCES,
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
    });

    it('never opens by itself: no panel and no search until the glyph is pressed', () => {
        render(<Harness initial={valuesWith(withLineKeys([SAUCE]))} />);

        expect(screen.queryByRole('button', { name: en.statusActionNoneOfThese })).toBeNull();
        expect(shortlistSearch.calls).toEqual([]);
    });

    it('the glyph opens row 7’s explanation and the shortlist the food search finds for the line’s own words', () => {
        render(<Harness initial={valuesWith(withLineKeys([SAUCE]))} />);

        fireEvent.click(glyph());
        const list = screen.getByLabelText('Which “apple sauce” did you mean?');

        expect(screen.getByText(en.statusExplainAmbiguous)).toBeTruthy();
        expect(screen.queryByText(en.statusExplainUnresolved)).toBeNull();
        expect(
            within(list)
                .getAllByRole('button')
                .map((button) => button.textContent),
        ).toEqual(['apple sauce, homemade', 'Applesauce, canned']);
        expect(shortlistSearch.calls.at(-1)).toEqual(['apple sauce', true]);
    });

    it('a press puts that food on THIS line through the row editor’s pick, and the sheet closes', async () => {
        const initial = valuesWith(withLineKeys([SAUCE]));
        const pickFromShortlist = vi.fn(() =>
            Promise.resolve({
                kind: 'committed',
                key: keyAt(initial),
                binding: { ingredientId: 'ing_canned', isUserEntered: false },
            } as const),
        );
        render(<Harness initial={initial} over={{ editor: { pickFromShortlist } }} />);

        fireEvent.click(glyph());
        fireEvent.click(screen.getByRole('button', { name: 'Applesauce, canned' }));

        expect(pickFromShortlist).toHaveBeenCalledExactlyOnceWith(keyAt(initial), CANNED_PICK);
        await vi.waitFor(() => expect(screen.queryByRole('button', { name: en.statusActionNoneOfThese })).toBeNull());
    });

    it('a pick that failed is said in the panel, reopened, with the list to choose again', () => {
        const initial = valuesWith(withLineKeys([SAUCE]));
        const settled: SettledRowCommit = {
            origin: { kind: 'shortlist' },
            pick: CANNED_PICK,
            target: { kind: 'line', key: keyAt(initial) },
            outcome: { kind: 'failed' },
        };
        render(<Harness initial={initial} over={{ editor: { settled } }} />);

        fireEvent.click(glyph());

        expect(
            Array.from(document.querySelectorAll('[aria-live="assertive"]')).filter(
                (region) => region.textContent === en.candidatePickFailed,
            ),
        ).toHaveLength(1);
        expect(screen.getByLabelText('Which “apple sauce” did you mean?')).toBeTruthy();
    });

    it('the glyph reads busy while this row’s pick runs, with or without its sheet open', () => {
        render(
            <Harness
                initial={valuesWith(withLineKeys([SAUCE]))}
                over={{ editor: { pickInFlight: (target) => (target.kind === 'line' ? CANNED_PICK : undefined) } }}
            />,
        );

        expect(glyph().getAttribute('aria-busy')).toBe('true');
    });

    it('None of these starts Change food, puts focus in the field once the sheet has gone, and picks nothing', () => {
        const pickFromShortlist = vi.fn();
        render(<Harness initial={valuesWith(withLineKeys([SAUCE]))} over={{ editor: { pickFromShortlist } }} />);

        fireEvent.click(glyph());
        fireEvent.click(screen.getByRole('button', { name: en.statusActionNoneOfThese }));

        expect(document.activeElement).toBe(screen.getByLabelText('Ingredient 1 name'));
        expect(pickFromShortlist).not.toHaveBeenCalled();
    });

    it('Remove is the row’s one action, direct: no Change food, no ⋮ (SPECIFY.1 row 7)', () => {
        render(<Harness initial={valuesWith(withLineKeys([SAUCE]))} />);

        expect(screen.queryByRole('button', { name: 'Actions for apple sauce' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Remove ingredient 1' })).toBeTruthy();
    });
});
