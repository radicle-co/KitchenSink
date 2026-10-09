/**
 * Integration: a FAILED row's Try again, end to end inside the package (plan 002 V1, orchestrator slice 2).
 *
 * Composes the REAL leaf, `useLookupRetry`, `settleIngredientLine`, TanStack Query and the real `RecipeServiceClient`
 * (its request and its zod parsing), with only `fetch` mocked. What it proves that no unit test can: Try again issues
 * `GET /api/v1/ingredients/{id}/status` for THIS binding — a read, never a recipe write — and the server's answer
 * reaches the row through the host's own settle, so the row's status word changes in place and focus stays on the
 * row's open control (the attention line that opened the panel gives way while the ask runs).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeIngredientRowEditor } from '../../src/__fixtures__/index.js';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';

import { RecipeIngredientsFields } from '../../src/form/RecipeIngredientsFields.js';
import { settleIngredientLines, type SettledAnswer } from '../../src/form/ingredientStatus.js';
import { recipeFormMessages } from '../../src/form/messages.js';
import { toRecipeFormValues } from '../../src/form/wire.js';
import { useLineNutrition } from '../../src/hooks/useLineNutrition.js';
import { useLookupRetry } from '../../src/hooks/useLookupRetry.js';

const ROW_EDITOR = makeIngredientRowEditor();
afterEach(cleanup);

const en = recipeFormMessages.en;
const BINDING = '00000000-0000-4000-8000-000000000009';

const seeded = toRecipeFormValues(
    makeRecipeDetail({
        ingredients: [
            {
                ingredientId: BINDING,
                name: 'Saffron',
                quantity: { kind: 'exact', value: 1 },
                unit: 'pinch',
                isUserEntered: false,
                resolutionStatus: 'FAILED',
                unresolvedReason: 'sources_errored',
            },
        ],
    }),
);

/** The editor as a host composes it: its own draft, the poller's settle, the read and the retry. */
const Editor: FC = () => {
    const [values, setValues] = useState(seeded);
    const applyLineStatuses = useCallback((answers: readonly SettledAnswer[]) => {
        setValues((current) => settleIngredientLines(current, answers));
    }, []);
    const nutrition = useLineNutrition(values);
    const lookupRetry = useLookupRetry(applyLineStatuses);

    return (
        <RecipeIngredientsFields
            values={values}
            onChange={setValues}

            nutrition={nutrition}
            lookupRetry={lookupRetry}
            rowEditor={ROW_EDITOR}
        />
    );
};

describe('Try again on a FAILED row (integration)', () => {
    it('reads the binding’s status — no recipe write — and the answer changes the row in place', async () => {
        const user = userEvent.setup();
        const requests: { method: string; url: string }[] = [];
        const fetchDouble = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
            if (input instanceof Request) {
                requests.push({ method: input.method, url: input.url });
            }

            return new Response(
                JSON.stringify({
                    id: BINDING,
                    name: 'Saffron',
                    isUserEntered: false,
                    foodResolutionStatus: 'NOT_FOUND',
                    createdAt: '2026-10-01T00:00:00.000Z',
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        });
        const client = new RecipeServiceClient({
            baseUrl: 'https://recipes.test',
            token: 'tok',
            fetch: (input, init) => fetchDouble(input, init),
        });
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <RecipeServiceProvider client={client}>
                    <Editor />
                </RecipeServiceProvider>
            </QueryClientProvider>,
        );
        const attention = screen.getByRole('button', { name: `${en.rowStateLookupFailed}: Saffron` });

        await user.click(attention);
        await user.click(
            within(screen.getByRole('dialog', { name: 'Saffron' })).getByRole('button', {
                name: en.statusActionRetryLookupLabel.replace('{food}', 'Saffron'),
            }),
        );

        await waitFor(() => expect(screen.getByText(en.rowStateNoMatch)).toBeTruthy());
        expect(screen.queryByText(en.rowStateLookupFailed)).toBeNull();
        expect(requests).toEqual([{ method: 'GET', url: `https://recipes.test/api/v1/ingredients/${BINDING}/status` }]);
        // The attention line gave way while the ask ran: focus is on the row's open control, never the page.
        expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Edit .*Saffron$/u }));
    });
});

/**
 * Staff-architect REVIEW F1, the case it traced: a host whose setter takes a VALUE (the web edit host and mobile), two
 * FAILED bindings both retried. Applied one answer at a time from one snapshot, the second write erased the first.
 */
describe('two retried bindings on a host that sets by value (integration)', () => {
    const SECOND = '00000000-0000-4000-8000-000000000008';
    const twoFailed = toRecipeFormValues(
        makeRecipeDetail({
            ingredients: [
                {
                    ingredientId: BINDING,
                    name: 'Saffron',
                    quantity: { kind: 'exact', value: 1 },
                    isUserEntered: false,
                    resolutionStatus: 'FAILED',
                    unresolvedReason: 'sources_errored',
                },
                {
                    ingredientId: SECOND,
                    name: 'Sumac',
                    quantity: { kind: 'exact', value: 1 },
                    isUserEntered: false,
                    resolutionStatus: 'FAILED',
                    unresolvedReason: 'sources_errored',
                },
            ],
        }),
    );

    /** As the web edit host does it: the latest draft in the closure, a setter that takes a value. */
    const ValueHost: FC = () => {
        const [values, setValues] = useState(twoFailed);
        const applyLineStatuses = useCallback(
            (answers: readonly SettledAnswer[]) => {
                const next = settleIngredientLines(values, answers);

                if (next !== values) {
                    setValues(next);
                }
            },
            [values],
        );
        const nutrition = useLineNutrition(values);
        const lookupRetry = useLookupRetry(applyLineStatuses);

        return (
            <RecipeIngredientsFields
                values={values}
                onChange={setValues}
                nutrition={nutrition}
                lookupRetry={lookupRetry}
                rowEditor={ROW_EDITOR}
            />
        );
    };

    it('both rows settle, and stay settled', async () => {
        const user = userEvent.setup();
        const answer = (id: string) =>
            new Response(
                JSON.stringify({
                    id,
                    name: id,
                    isUserEntered: false,
                    foodResolutionStatus: 'NOT_FOUND',
                    createdAt: '2026-10-01T00:00:00.000Z',
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        const client = new RecipeServiceClient({
            baseUrl: 'https://recipes.test',
            token: 'tok',
            fetch: async (input) => answer(input instanceof Request && input.url.includes(SECOND) ? SECOND : BINDING),
        });
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <RecipeServiceProvider client={client}>
                    <ValueHost />
                </RecipeServiceProvider>
            </QueryClientProvider>,
        );

        for (const food of ['Saffron', 'Sumac']) {
            await user.click(screen.getByRole('button', { name: `${en.rowStateLookupFailed}: ${food}` }));
            await user.click(
                within(screen.getByRole('dialog', { name: food })).getByRole('button', {
                    name: en.statusActionRetryLookupLabel.replace('{food}', food),
                }),
            );
        }

        await waitFor(() => expect(screen.getAllByText(en.rowStateNoMatch)).toHaveLength(2));
        expect(screen.queryByText(en.rowStateLookupFailed)).toBeNull();
    });
});

/**
 * Findings #5 and #6 (plan 002 V1): the success the announcement exists for. When food has since resolved the open
 * failure, the server settles it and answers with the BOUND binding — a DIFFERENT id, carrying the food it names. The
 * line must follow the binding AND gain that food, or the panel says "No nutritional data available" and the total
 * leaves the line out; and the announcement must follow the ROW, which a settle never re-keys.
 */
describe('Try again that resolves under another binding (integration)', () => {
    const BOUND = '00000000-0000-4000-8000-000000000010';
    const failedSaffron = toRecipeFormValues(
        makeRecipeDetail({
            servings: 1,
            ingredients: [
                {
                    ingredientId: BINDING,
                    name: 'Saffron',
                    quantity: { kind: 'exact', value: 10 },
                    unit: 'g',
                    isUserEntered: false,
                    resolutionStatus: 'FAILED',
                    unresolvedReason: 'sources_errored',
                },
            ],
        }),
    );

    const SeededEditor: FC = () => {
        const [values, setValues] = useState(failedSaffron);
        const applyLineStatuses = useCallback((answers: readonly SettledAnswer[]) => {
            setValues((current) => settleIngredientLines(current, answers));
        }, []);
        const nutrition = useLineNutrition(values);
        const lookupRetry = useLookupRetry(applyLineStatuses);

        return (
            <RecipeIngredientsFields
                values={values}
                onChange={setValues}
                nutrition={nutrition}
                lookupRetry={lookupRetry}
                rowEditor={ROW_EDITOR}
            />
        );
    };

    const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

    const renderWith = (fetchDouble: (request: Request) => Promise<Response>) => {
        const client = new RecipeServiceClient({
            baseUrl: 'https://recipes.test',
            token: 'tok',
            fetch: async (input, init) => fetchDouble(new Request(input, init)),
        });
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <RecipeServiceProvider client={client}>
                    <SeededEditor />
                </RecipeServiceProvider>
            </QueryClientProvider>,
        );
    };

    /**
     * The polite region the settled retry speaks through: the ingredient list's first status region. The leaf renders
     * alone here; the editor's frame owns the section and its heading (slice 7), so the leaf is the whole page.
     */
    const announcement = (): HTMLElement => {
        const [region] = screen.getAllByRole('status');

        if (region === undefined) {
            throw new Error('the ingredient list has no status region');
        }

        return region;
    };

    const tryAgain = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
        await user.click(screen.getByRole('button', { name: `${en.rowStateLookupFailed}: Saffron` }));
        await user.click(
            within(screen.getByRole('dialog', { name: 'Saffron' })).getByRole('button', {
                name: en.statusActionRetryLookupLabel.replace('{food}', 'Saffron'),
            }),
        );
    };

    it('the resolved line gains its food: the panel shows figures, the total counts it, and the match is announced', async () => {
        const user = userEvent.setup();
        const nutritionAsked: unknown[] = [];
        renderWith(async (request) => {
            if (request.url.endsWith(`/api/v1/ingredients/${BINDING}/status`)) {
                return json({
                    id: BOUND,
                    name: 'Saffron',
                    isUserEntered: false,
                    foodResolutionStatus: 'RESOLVED',
                    foodId: 'food_saffron',
                    createdAt: '2026-10-01T00:00:00.000Z',
                });
            }

            if (request.url.endsWith('/api/v1/ingredients/food-nutrition')) {
                nutritionAsked.push(await request.json());

                return json({
                    entries: [
                        {
                            outcome: 'found',
                            ref: { kind: 'root', id: 'food_saffron' },
                            freshness: 'fresh',
                            caloriesPer100g: 310,
                            proteinGPer100g: 11.4,
                            portions: [],
                        },
                    ],
                });
            }

            throw new Error(`unexpected request ${request.method} ${request.url}`);
        });

        await tryAgain(user);

        // 10 g at 310 kcal / 100 g, one serving — and nothing left uncounted.
        // Build spec §7.5.6: the one line names the total and that every line is counted.
        await waitFor(() => expect(screen.getByText('31 cal per serving · 1 of 1 counted')).toBeTruthy());
        expect(nutritionAsked).toEqual([{ refs: [{ kind: 'root', id: 'food_saffron' }] }]);
        expect(announcement().textContent).toBe(en.statusResolvedConfirmation.replace('{food}', 'Saffron'));

        // Matched now, the row is quiet: its panel opens from ⋯ Food details (build spec §7.5.1).
        await user.click(screen.getByRole('button', { name: 'Actions for Saffron' }));
        await user.click(screen.getByRole('menuitem', { name: en.rowFoodDetails }));
        const panel = await screen.findByRole('dialog', { name: 'Saffron' });
        expect(within(panel).getByText(en.nutritionProteinLabel).nextElementSibling?.textContent).toBe('11.4 g');
        expect(within(panel).queryByText(en.nutritionNoneAvailable)).toBeNull();
    });

    it('the same outcome twice is announced twice: the region empties while the second ask runs', async () => {
        const user = userEvent.setup();
        const answers: ((response: Response) => void)[] = [];
        renderWith(
            () =>
                new Promise<Response>((resolve) => {
                    answers.push(resolve);
                }),
        );
        const stillFailed = (): Response =>
            json({
                id: BINDING,
                name: 'Saffron',
                isUserEntered: false,
                foodResolutionStatus: 'FAILED',
                createdAt: '2026-10-01T00:00:00.000Z',
            });
        const sentence = en.statusLookupSettled.replace('{food}', 'Saffron').replace('{status}', en.statusFailed);
        const region = announcement();

        await tryAgain(user);
        await waitFor(() => expect(answers).toHaveLength(1));
        answers[0]?.(stillFailed());
        await waitFor(() => expect(region.textContent).toBe(sentence));

        await tryAgain(user);
        await waitFor(() => expect(answers).toHaveLength(2));
        expect(region.textContent).toBe('');
        answers[1]?.(stillFailed());

        await waitFor(() => expect(region.textContent).toBe(sentence));
        // The same node throughout: a live region must exist before its text changes, or the change is not spoken.
        expect(announcement()).toBe(region);
    });
});
