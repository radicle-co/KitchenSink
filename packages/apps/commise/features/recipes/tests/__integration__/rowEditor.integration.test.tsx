/**
 * Integration: the row editor, composed (plan 002 V1 B7, curated U15). The REAL `useIngredientRowEditor` and the web
 * field group, over TanStack Query, the real `RecipeServiceClient` and `FoodServiceClient` with their zod parsing.
 * Only `fetch` is a double (owner ruling 2026-09-20: integration tests mock their dependencies).
 *
 * What only this tier can show:
 * - a row that names no food: the cook types into the ROW's own field, the settled text is searched through food's ONE
 *   progressive answer (plan 002 S7.8), and a pick reaches recipe's admission route and lands on that row in the draft,
 *   with no recipe write (create form; `docs/design/rowEditorBlueprint.md` decision 7);
 * - Add details from the row's `⋮`: the dialog reads the root over the food wire, a pick goes out as ONE
 *   `by-food-variant` admission and lands on the row as the variant, with its dotted line (decision 7, §S8.9).
 * - Row 6 (REWRITTEN for plan 002 S7.8): the attention line's panel searches the line's own words through the progressive
 *   answer, as row 7 does, so a remote food is offered; picking it is ONE command, food's adopt then recipe's
 *   admission of the root, and it binds THAT line alone (owner rulings 2026-10-02). The pick belongs to the row editor,
 *   not the panel (`docs/design/rowEditorBlueprint.md` decision 1): a panel closed before the answer still lands the
 *   pick, and reopening it cannot send a second one.
 * - Row 7: the attention line's panel searches the line's own words through the progressive answer, and one pick is admitted
 *   onto THAT line alone, through recipe's admission route, with no correction written (SPECIFY.1 row 7; owner ruling
 *   2026-10-02).
 */
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { makeIngredientNutrition, makeLookupRetry, withLineKeys } from '../../src/__fixtures__/index.js';
import { makeFoodResponse } from '../../src/details/__fixtures__/foodResponse.js';
import { BEEF_BRISKET } from '../../src/details/__fixtures__/seedVariants.js';
import type { DraftAction } from '../../src/form/draftAction.js';
import { ingredientCommitFailureId } from '../../src/form/fieldErrorIds.js';
import { recipeFormMessages } from '../../src/form/messages.js';
import { applyDraftAction } from '../../src/form/props.js';
import { RecipeIngredientsFields } from '../../src/form/RecipeIngredientsFields.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../../src/form/values.js';
import { useIngredientRowEditor } from '../../src/hooks/useIngredientRowEditor.js';
import { foodProgressive, foodSearches, ndjson, twoOrigins, json as jsonAnswer } from './twoOrigins.js';

const en = recipeFormMessages.en;

afterEach(cleanup);

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

const CHICKPEA_ID = '00000000-0000-4000-8000-0000000000c1';
const BRISKET_ID = '00000000-0000-4000-8000-0000000000b1';
const KALE_ID = '00000000-0000-4000-8000-0000000000a1';
const CANNED_ID = '00000000-0000-4000-8000-0000000000e2';
const CREATED_AT = '2026-10-02T09:00:00.000Z';

interface Recorded {
    readonly method: string;
    readonly path: string;
    readonly query: string;
    readonly body: unknown;
}

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A recipe client whose `fetch` answers each API request from `route`, and records it. */
function stubbedRecipes(route: (method: string, path: string) => Response | Promise<Response>) {
    const requests: Recorded[] = [];
    const client = new RecipeServiceClient({
        baseUrl: 'https://recipes.test',
        token: 'tok',
        fetch: async (input) => {
            const request = input instanceof Request ? input : new Request(input);
            const url = new URL(request.url);

            // The client's contract-skew probe and the analytics transport: not what this suite is about.
            if (url.pathname === '/health' || url.pathname.startsWith('/ingest/')) {
                return json({});
            }

            const text = await request.text();

            requests.push({
                method: request.method,
                path: url.pathname,
                query: url.search,
                body: text === '' ? undefined : JSON.parse(text),
            });

            return route(request.method, url.pathname);
        },
    });

    return { client, requests };
}

/** A food client answering one root, and recording each read. */
function stubbedFood(rootId: string, body: unknown) {
    const reads: string[] = [];
    const client = new FoodServiceClient({
        baseUrl: 'https://food.test',
        fetch: (input) => {
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

            reads.push(url.pathname);

            return Promise.resolve(
                url.pathname === `/api/v1/foods/${rootId}`
                    ? json(body)
                    : json({ code: 'FOOD_NOT_FOUND', message: 'no such food', details: {} }, 404),
            );
        },
    });

    return { client, reads };
}

/** The create form's host: the draft, the row editor over it, and the field group. */
const CreateHost: FC<{ readonly seed: RecipeFormValues; readonly hasVariants?: boolean }> = ({ seed, hasVariants }) => {
    const [values, setValues] = useState(seed);
    const rowEditor = useIngredientRowEditor({
        surface: {
            kind: 'createForm',
            dispatch: (action: DraftAction) => setValues((current) => applyDraftAction(current, action)),
        },
        lines: values.ingredients,
    });

    return (
        <RecipeIngredientsFields
            values={values}
            onChange={setValues}

            nutrition={makeIngredientNutrition({
                lookup: (ref) =>
                    ref.kind === 'root' && hasVariants === true
                        ? { state: 'found', catalog: { caloriesPer100g: 155 }, hasVariants: true }
                        : { state: 'absent' },
            })}
            lookupRetry={makeLookupRetry()}
            rowEditor={rowEditor}
        />
    );
};

function renderHost(recipes: RecipeServiceClient, food: FoodServiceClient, host: ReactElement): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={recipes}>
                <FoodServiceProvider client={food} subject="user_cook">
                    {host}
                </FoodServiceProvider>
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );
}

const valuesWith = (ingredients: RecipeFormValues['ingredients']): RecipeFormValues => ({
    ...defaultRecipeFormValues(),
    ingredients,
});

describe('the row editor, composed over the real clients (integration)', () => {
    it('a row that names no food: its own field searches food, and a pick is admitted onto THAT row in the draft', async () => {
        const user = userEvent.setup();
        const origins = twoOrigins({
            food: foodSearches({
                catalog: () => json({ results: [{ id: 'food_chickpea', name: 'Chickpeas, canned', score: 0.9 }] }),
                authored: () => json({ results: [] }),
            }),
            recipe: () =>
                json({
                    id: CHICKPEA_ID,
                    name: 'Chickpeas, canned',
                    foodId: 'food_chickpea',
                    foodResolutionStatus: 'RESOLVED',
                    isUserEntered: false,
                    createdAt: CREATED_AT,
                }),
        });

        renderHost(
            origins.recipes,
            origins.food,
            <CreateHost
                seed={valuesWith(
                    withLineKeys([{ ingredientId: null, name: 'chickpea', quantity: 1, isUserEntered: false }]),
                )}
            />,
        );

        // A row with no food reads quietly; its "No match found" line opens its search on its own words (§7.5.1).
        await user.click(screen.getByRole('button', { name: `${en.rowStateNoMatch}: chickpea` }));
        await user.click(screen.getByRole('combobox', { name: 'Ingredient 1 name' }));
        await user.keyboard('s');
        const catalog = await screen.findByRole('group', { name: 'Food catalog' }, { timeout: 3000 });
        await user.click(within(catalog).getByRole('option', { name: 'Chickpeas, canned' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit 1 Chickpeas, canned' })).toBeTruthy());
        expect(origins.sentTo('food').map((each) => [each.path, each.query.get('query')])).toEqual([
            ['/api/v1/foods/search/progressive', 'chickpeas'],
        ]);
        expect(origins.sentTo('recipe').map((each) => [each.method, each.path, each.body])).toEqual([
            ['POST', '/api/v1/ingredients/by-food', { foodId: 'food_chickpea' }],
        ]);
        expect(screen.getByText('Chickpeas, canned is matched. Its nutrition now counts.')).toBeTruthy();
    });

    it('row 7: the panel searches the line’s words, and one pick is admitted onto THAT line alone, writing no correction', async () => {
        const user = userEvent.setup();
        const ambiguous = {
            ingredientId: 'ing_sauce',
            name: 'apple sauce',
            quantity: 1,
            isUserEntered: false,
            resolutionStatus: FoodResolutionStatus.AMBIGUOUS,
        } as const;
        const origins = twoOrigins({
            food: foodSearches({
                catalog: () => json({ results: [{ id: 'food_canned', name: 'Applesauce, canned', score: 0.9 }] }),
                authored: () => json({ results: [] }),
            }),
            recipe: () =>
                json({
                    id: CANNED_ID,
                    name: 'Applesauce, canned',
                    foodId: 'food_canned',
                    foodResolutionStatus: 'RESOLVED',
                    isUserEntered: false,
                    createdAt: CREATED_AT,
                }),
        });

        renderHost(
            origins.recipes,
            origins.food,
            <CreateHost seed={valuesWith(withLineKeys([ambiguous, ambiguous]))} />,
        );

        await user.click(screen.getAllByRole('button', { name: `${en.rowStateChooseMatch}: apple sauce` })[0]!);
        const list = await screen.findByRole('list', { name: 'Which “apple sauce” did you mean?' }, { timeout: 3000 });
        await user.click(within(list).getByRole('button', { name: 'Applesauce, canned' }));

        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit 1 Applesauce, canned' })).toBeTruthy());
        // The second line, which shares the first's words and binding, is untouched: one pick binds one line.
        expect(screen.getByRole('button', { name: 'Edit 1 apple sauce' })).toBeTruthy();
        expect(origins.sentTo('food').map((each) => [each.path, each.query.get('query')])).toEqual([
            ['/api/v1/foods/search/progressive', 'apple sauce'],
        ]);
        expect(origins.sentTo('recipe').map((each) => [each.method, each.path, each.body])).toEqual([
            ['POST', '/api/v1/ingredients/by-food', { foodId: 'food_canned' }],
        ]);
    });

    it('Add details: the dialog reads the root over the food wire, and a pick is ONE by-food-variant admission', async () => {
        const user = userEvent.setup();
        const [first] = BEEF_BRISKET;
        const { client: recipes, requests } = stubbedRecipes(() =>
            json({
                id: BRISKET_ID,
                name: 'beef brisket',
                foodId: 'root_brisket',
                variant: first,
                foodResolutionStatus: 'RESOLVED',
                isUserEntered: false,
                createdAt: CREATED_AT,
            }),
        );
        const { client: food, reads } = stubbedFood(
            'root_brisket',
            makeFoodResponse({ id: 'root_brisket', variants: [...BEEF_BRISKET] }),
        );

        renderHost(
            recipes,
            food,
            <CreateHost
                hasVariants
                seed={valuesWith(
                    withLineKeys([
                        {
                            ingredientId: 'ing_root',
                            name: 'beef brisket',
                            quantity: 2,
                            isUserEntered: false,
                            foodId: 'root_brisket',
                            resolutionStatus: FoodResolutionStatus.RESOLVED,
                        },
                    ]),
                )}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Actions for beef brisket' }));
        await user.click(screen.getByRole('menuitem', { name: 'Add details' }));
        const listbox = await screen.findByRole('listbox');
        const option = within(listbox).getAllByRole('option')[0];

        await user.click(option!);

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await waitFor(() => expect(requests).toHaveLength(1));
        // The client's contract-skew probe (`/health`) and the source register are not a food read.
        expect(reads.filter((path) => path.startsWith('/api/v1/foods/') && path !== '/api/v1/foods/sources')).toEqual([
            '/api/v1/foods/root_brisket',
        ]);
        expect(requests[0]).toMatchObject({ method: 'POST', path: '/api/v1/ingredients/by-food-variant' });
        await waitFor(() => expect(screen.getByText(first!.parts[0]!.text)).toBeTruthy());
    });

    /** Food's answer for Kale: none of ours, and one remote food from USDA, which the adopt makes `food_kale`. */
    const KALE_FOOD = foodProgressive({
        search: () =>
            ndjson(
                {
                    type: 'database',
                    catalog: { outcome: 'answered', results: [] },
                    authored: { outcome: 'answered', results: [] },
                },
                {
                    type: 'source',
                    source: 'usda',
                    outcome: 'answered',
                    items: [{ name: 'Kale, raw', reference: 'sealed.k' }],
                },
                { type: 'complete' },
            ),
        adopt: () => jsonAnswer({ id: 'food_kale' }),
    });
    const KALE = {
        ingredientId: KALE_ID,
        name: 'Kale',
        isUserEntered: false,
        resolutionStatus: FoodResolutionStatus.UNRESOLVED,
    } as const;
    const KALE_SIBLINGS = valuesWith(
        withLineKeys([
            { ...KALE, quantity: 1 },
            { ...KALE, quantity: 2 },
        ]),
    );
    /** Recipe's admission of the root the adopt made. */
    const kaleAdmitted = () =>
        jsonAnswer({
            id: '00000000-0000-4000-8000-0000000000a9',
            name: 'Kale, raw',
            foodId: 'food_kale',
            foodResolutionStatus: 'RESOLVED',
            isUserEntered: false,
            createdAt: CREATED_AT,
        });

    it('row 6: the panel searches the line’s words, a remote food is adopted then admitted, onto THAT line alone', async () => {
        const user = userEvent.setup();
        const origins = twoOrigins({ food: KALE_FOOD, recipe: kaleAdmitted });

        renderHost(origins.recipes, origins.food, <CreateHost seed={KALE_SIBLINGS} />);
        expect(screen.getAllByText(en.rowStateChooseMatch)).toHaveLength(2);

        await user.click(screen.getAllByRole('button', { name: `${en.rowStateChooseMatch}: Kale` })[0]!);
        await user.click(await screen.findByRole('button', { name: 'Kale, raw, from another food database' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await waitFor(() => expect(screen.queryAllByText(en.rowStateChooseMatch)).toHaveLength(1));
        expect(
            origins.requests
                .filter((each) => each.method === 'POST')
                .map((each) => [each.origin, each.path, each.body]),
        ).toEqual([
            ['food', '/api/v1/foods/remote/adopt', { reference: 'sealed.k' }],
            ['recipe', '/api/v1/ingredients/by-food', { foodId: 'food_kale' }],
        ]);
        expect(origins.requests.some((each) => each.path.endsWith('/resolve'))).toBe(false);
    });

    describe('row 6: a pick outlives its panel', () => {
        /** The Kale siblings, whose admission answers only when the test releases it. */
        function renderSiblingsWithHeldAdmission() {
            let release: (() => void) | undefined;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const origins = twoOrigins({
                food: KALE_FOOD,
                recipe: async () => {
                    await held;

                    return kaleAdmitted();
                },
            });

            renderHost(origins.recipes, origins.food, <CreateHost seed={KALE_SIBLINGS} />);

            return {
                release: (): void => release?.(),
                admissions: (): number => origins.sentTo('recipe').filter((each) => each.method === 'POST').length,
            };
        }

        const firstGlyph = (): HTMLElement =>
            screen.getAllByRole('button', { name: `${en.rowStateChooseMatch}: Kale` })[0]!;
        const kaleHit = 'Kale, raw, from another food database';

        it('closed before the answer: the glyph reads busy, then the line takes the food and says so', async () => {
            const user = userEvent.setup();
            const { release, admissions } = renderSiblingsWithHeldAdmission();

            await user.click(firstGlyph());
            await user.click(await screen.findByRole('button', { name: kaleHit }));
            await waitFor(() => expect(admissions()).toBe(1));
            await user.keyboard('{Escape}');
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

            expect(firstGlyph().getAttribute('aria-busy')).toBe('true');
            release();

            await waitFor(() => expect(screen.queryAllByText(en.rowStateChooseMatch)).toHaveLength(1));
            expect(screen.getByText('Kale, raw is matched. Its nutrition now counts.')).toBeTruthy();
            expect(admissions()).toBe(1);
        });

        it('reopened before the answer: the pressed food still reads busy, and a second press sends nothing', async () => {
            const user = userEvent.setup();
            const { release, admissions } = renderSiblingsWithHeldAdmission();

            await user.click(firstGlyph());
            await user.click(await screen.findByRole('button', { name: kaleHit }));
            await waitFor(() => expect(admissions()).toBe(1));
            await user.keyboard('{Escape}');
            await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

            await user.click(firstGlyph());
            const pressed = await screen.findByRole('button', { name: kaleHit });

            expect(pressed.getAttribute('aria-busy')).toBe('true');
            await user.click(pressed);
            expect(admissions()).toBe(1);

            release();
            await waitFor(() => expect(screen.queryAllByText(en.rowStateChooseMatch)).toHaveLength(1));
            expect(admissions()).toBe(1);
        });
    });
});

/**
 * E2 (`docs/design/rowEditorOpenDecisions.md`): the field group mounts and unmounts with its wizard step, and the row
 * editor, its host, does not. A pick that fails while its step is not shown settles into the host; on return the row
 * shows its failure line, which describes the field, and no alert plays, because the failure is now a state.
 */
describe('a pick that fails while its step is away (integration, E2)', () => {
    /** The wizard's host: the draft and the row editor live here, and the field group comes and goes with its step. */
    const StepHost: FC<{ readonly seed: RecipeFormValues }> = ({ seed }) => {
        const [values, setValues] = useState(seed);
        const [shown, setShown] = useState(true);
        const rowEditor = useIngredientRowEditor({
            surface: {
                kind: 'createForm',
                dispatch: (action: DraftAction) => setValues((current) => applyDraftAction(current, action)),
            },
            lines: values.ingredients,
        });

        return (
            <>
                <button type="button" onClick={() => setShown((current) => !current)}>
                    {shown ? 'Previous' : 'Next'}
                </button>
                {/* The test's own window on the host: what last settled, readable while the step is away. */}
                <p>{rowEditor.settled === undefined ? '' : `settled: ${rowEditor.settled.outcome.kind}`}</p>
                {shown ? (
                    <RecipeIngredientsFields
                        values={values}
                        onChange={setValues}
                        nutrition={makeIngredientNutrition()}
                        lookupRetry={makeLookupRetry()}
                        rowEditor={rowEditor}
                    />
                ) : null}
            </>
        );
    };

    it('the row shows its failure line on return, describing the field, and says nothing', async () => {
        const user = userEvent.setup();
        let refuse: (() => void) | undefined;
        const held = new Promise<void>((resolve) => {
            refuse = resolve;
        });
        const origins = twoOrigins({
            food: foodSearches({
                catalog: () => json({ results: [{ id: 'food_chickpea', name: 'Chickpeas, canned', score: 0.9 }] }),
                authored: () => json({ results: [] }),
            }),
            recipe: async () => {
                await held;

                return json({ code: 'INTERNAL', message: 'admission failed' }, 500);
            },
        });
        const seed = valuesWith(
            withLineKeys([{ ingredientId: null, name: 'chickpea', quantity: 1, isUserEntered: false }]),
        );

        renderHost(origins.recipes, origins.food, <StepHost seed={seed} />);
        await user.click(screen.getByRole('button', { name: `${en.rowStateNoMatch}: chickpea` }));
        await user.click(screen.getByRole('combobox', { name: 'Ingredient 1 name' }));
        await user.keyboard('s');
        const catalog = await screen.findByRole('group', { name: 'Food catalog' }, { timeout: 3000 });
        await user.click(within(catalog).getByRole('option', { name: 'Chickpeas, canned' }));
        await waitFor(() => expect(origins.sentTo('recipe')).toHaveLength(1));

        // The cook presses Previous while the pick runs, and it fails while the step is away.
        await user.click(screen.getByRole('button', { name: 'Previous' }));
        expect(screen.queryByRole('combobox', { name: 'Ingredient 1 name' })).toBeNull();
        refuse?.();
        await screen.findByText('settled: failed');

        await user.click(screen.getByRole('button', { name: 'Next' }));
        const field = screen.getByRole('combobox', { name: 'Ingredient 1 name' });
        await user.click(field);
        const line = document.getElementById(ingredientCommitFailureId(seed.ingredients[0]?.key ?? ''));

        expect(line?.textContent).toBe('We couldn’t add “chickpeas”. Try again, or use it as written.');
        expect(field.getAttribute('aria-describedby')).toContain(line?.id);
        expect(screen.queryAllByRole('alert').filter((region) => /couldn’t add/u.test(region.textContent))).toEqual([]);

        // New text moves past it.
        await user.keyboard('!');

        expect(document.getElementById(line?.id ?? '')).toBeNull();
    });
});
