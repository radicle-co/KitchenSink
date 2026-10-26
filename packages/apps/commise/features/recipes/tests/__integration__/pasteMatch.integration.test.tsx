/**
 * Integration: Paste a list, matched (ADR-0071; owner rulings 2026-10-25; blueprint A2). REPLACES
 * `pasteList.integration.test.tsx`, whose assertions were about the BY-NAME join: each read line looked up through
 * `POST /ingredients/by-name`, which bound a ranked guess (milk crackers for milk, salt cod for salt). That path is gone,
 * so those assertions were deleted with it, and the cases that outlive it (a refused create offline, a stalled line the
 * cook adds as written, a connection that drops mid-paste) are rewritten here against the new flow.
 *
 * Composes the REAL `useIngredientsPaste` (the session, the matching Mediator, the Facade), the real row editor, the web
 * `RecipeIngredientsFields` and `PasteListSheet`, TanStack Query and the real `RecipeServiceClient` and
 * `FoodServiceClient` (request building and zod parsing) over a draft held by the real `applyDraftAction`, with only
 * `fetch` doubled. What it proves that no unit test can:
 *
 * - `POST /matches` is made once per growth of the unmatched set, and a confident match binds through `by-food`;
 * - ⛔ NO request goes to `by-name`, and no `by-food` carries a default's id before the cook picks it: a default is shown
 *   with its tag and nothing is selected for the cook;
 * - a line the review confirms later binds by itself — and a late verdict NEVER replaces a pick the cook made;
 * - the daily limit's refusal lands every line as written, with its notice, and no sheet error;
 * - no line is drawn twice (not as a match line and an ordinary row), and a remount shows ordinary rows only (ADR-0057).
 */
import { RecipeStatus } from '@kitchensink/recipe-core';
import { createRecipeRequestSchema } from '@kitchensink/schema-recipe';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { makeIngredientNutrition, makeLookupRetry } from '../../src/__fixtures__/index.js';
import { createPasteHold } from '../../src/editor/pasteHold.js';
import { useIngredientsPaste } from '../../src/editor/useIngredientsPaste.js';
import { PublishOpenChoicesSheet } from '../../src/editor/PublishOpenChoicesSheet.js';
import type { DraftAction } from '../../src/form/draftAction.js';
import { PasteListSheet } from '../../src/form/PasteListSheet.js';
import { applyDraftAction } from '../../src/form/props.js';
import { RecipeIngredientsFields } from '../../src/form/RecipeIngredientsFields.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../../src/form/values.js';
import { toCreateRecipeInput } from '../../src/form/wire.js';
import { useIngredientRowEditor } from '../../src/hooks/useIngredientRowEditor.js';
import { foodSearches, json, twoOrigins, type RecordedRequest, type Route } from './twoOrigins.js';

if (typeof Element !== 'undefined') {
    // jsdom implements neither pointer capture nor scrollIntoView, which Radix's menu calls on open.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
});

const JOB_ID = '00000000-0000-4000-8000-00000000e301';
const CREATED_AT = '2026-10-26T10:00:00.000Z';

const WHOLE = { kind: 'root', id: 'food_whole', name: 'Whole milk' } as const;
const SKIM = { kind: 'root', id: 'food_skim', name: 'Skim milk' } as const;
const OAT = { kind: 'root', id: 'food_oat', name: 'Oat milk' } as const;

interface Candidate {
    readonly kind: 'root' | 'variant';
    readonly id: string;
    readonly name: string;
}
interface Match {
    readonly state: 'checking' | 'confident' | 'default' | 'needsChoice' | 'noMatch';
    readonly reason: string;
    readonly proposed: { kind: 'root' | 'variant'; id: string; name: string } | null;
    readonly candidates: readonly (Candidate & { isDefault: boolean })[];
}

const candidates = (...foods: readonly (Candidate & { isDefault?: boolean })[]) =>
    foods.map((food) => ({ ...food, isDefault: food.isDefault ?? false }));

const CONFIDENT: Match = {
    state: 'confident',
    reason: 'exactName',
    proposed: WHOLE,
    candidates: candidates(WHOLE, SKIM),
};
const DEFAULT: Match = {
    state: 'default',
    reason: 'defaultApplies',
    proposed: null,
    candidates: candidates({ ...WHOLE, isDefault: true }, SKIM, OAT),
};
const CHECKING: Match = {
    state: 'checking',
    reason: 'awaitingReview',
    proposed: OAT,
    candidates: candidates(OAT, WHOLE),
};

/** The parse job as the service reads it: one line, `2 cups milk`, parsed into one food with `match`. */
const jobWith = (match: Match | null, status: 'running' | 'complete' = 'complete') => ({
    id: JOB_ID,
    status,
    createdAt: CREATED_AT,
    expiresAt: '2099-01-01T00:00:00.000Z',
    lines: [
        {
            lineIndex: 0,
            sourceLine: '2 cups milk',
            status: 'parsed',
            progress: null,
            proposal: {
                raw: '2 cups milk',
                quantity: { kind: 'exact', value: 2 },
                unit: 'cup',
                statedMeasure: '2 cups',
                foods: [{ name: 'milk', prep: null, ...(match === null ? {} : { match }) }],
                reviewReasons: [],
            },
        },
    ],
});

const ACCEPTED = {
    ...jobWith(null, 'running'),
    lines: [{ ...jobWith(null).lines[0], status: 'pending', proposal: null, progress: { phase: 'queued' } }],
};

/** A UUID for an ingredient: the contract refuses any other id, and the hex of the food's own id keeps it distinct. */
const uuidOf = (id: string): string =>
    `00000000-0000-4000-8000-${[...new TextEncoder().encode(id)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 12)
        .padEnd(12, '0')}`;

const ingredientOf = (id: string, name: string) => ({
    id: uuidOf(id),
    name,
    foodId: id,
    foodResolutionStatus: 'RESOLVED',
    isUserEntered: false,
    createdAt: CREATED_AT,
});

/** What the service holds, and what each route answers from it. */
interface Server {
    /** What `GET` answers. */
    job: unknown;
    /** What `POST /matches` leaves behind (and answers); `undefined` leaves the job as it is. */
    afterMatches: unknown;
    /** What the create answers. */
    create: () => Response;
}

function server(job: unknown, over: Partial<Server> = {}): Server {
    return { job, afterMatches: undefined, create: () => json(ACCEPTED, 202), ...over };
}

function routesOf(state: Server) {
    return ({ method, path, body }: RecordedRequest): Response => {
        const route = `${method} ${path}`;

        switch (route) {
            case 'POST /api/v1/recipe-parse-jobs':
                return state.create();
            case `GET /api/v1/recipe-parse-jobs/${JOB_ID}`:
                return json(state.job, 200);
            case `POST /api/v1/recipe-parse-jobs/${JOB_ID}/matches`:
                state.job = state.afterMatches ?? state.job;

                return json(state.job, 202);

            case 'POST /api/v1/ingredients/by-food': {
                const { foodId } = body as { foodId: string };
                const names: Record<string, string> = {
                    food_whole: 'Whole milk',
                    food_skim: 'Skim milk',
                    food_oat: 'Oat milk',
                };

                return json(ingredientOf(foodId, names[foodId] ?? foodId), 200);
            }

            case 'POST /api/v1/ingredients':
                return json(
                    ingredientOf(`free_${(body as { name: string }).name}`, (body as { name: string }).name),
                    201,
                );
            default:
                return json({ code: 'UNEXPECTED', message: route }, 500);
        }
    };
}

const quotaResponse = () =>
    json(
        {
            code: 'IMPORT_QUOTA_EXCEEDED',
            message: 'The daily import allowance is spent',
            details: { resetsAt: '2026-10-27T08:00:00.000Z' },
        },
        429,
    );

/** A new recipe's Ingredients section: the draft, the row editor, the paste, the sheet, and a Publish that asks first. */
const Host: FC<{ readonly onValues: (values: RecipeFormValues) => void; readonly seed?: RecipeFormValues }> = ({
    onValues,
    seed,
}) => {
    const [values, setValues] = useState(() => seed ?? { ...defaultRecipeFormValues(), title: 'Pasted Bread' });
    const [hold] = useState(createPasteHold);
    const [asking, setAsking] = useState(false);
    const dispatch = (action: DraftAction): void =>
        setValues((current) => {
            const next = applyDraftAction(current, action);
            onValues(next);

            return next;
        });
    const rowEditor = useIngredientRowEditor({ surface: { kind: 'createForm', dispatch }, lines: values.ingredients });
    const paste = useIngredientsPaste({
        hold,
        offered: true,
        keepsSource: true,
        dispatch,
        lineKeys: values.ingredients.map((line) => line.key),
        initiallyOpen: !values.ingredients.length,
        rowEditor,
        keep: 'tabSession',
        autoBind: true,
    });

    return (
        <>
            <RecipeIngredientsFields
                values={values}
                onChange={setValues}
                nutrition={makeIngredientNutrition()}
                lookupRetry={makeLookupRetry()}
                rowEditor={rowEditor}
                paste={paste.view}
            />
            <PasteListSheet sheet={paste.sheet} submitting={paste.submitting} failed={paste.failed} />
            <button type="button" onClick={() => (paste.openChoices.facts === undefined ? undefined : setAsking(true))}>
                Publish
            </button>
            {paste.openChoices.facts === undefined ? null : (
                <PublishOpenChoicesSheet
                    open={asking}
                    facts={paste.openChoices.facts}
                    onChooseNow={() => {
                        setAsking(false);
                        paste.openChoices.chooseNow();
                    }}
                    onPublishAnyway={() => setAsking(false)}
                    onOpenChange={setAsking}
                />
            )}
        </>
    );
};

function renderHost(
    state: Server,
    onValues: (values: RecipeFormValues) => void = () => undefined,
    seed?: RecipeFormValues,
    food?: Route,
) {
    const origins = twoOrigins({ recipe: routesOf(state), ...(food === undefined ? {} : { food }) });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const tree = (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={origins.recipes}>
                <FoodServiceProvider client={origins.food} subject="user_cook">
                    <Host onValues={onValues} {...(seed === undefined ? {} : { seed })} />
                </FoodServiceProvider>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
    const view = render(tree);

    return { ...view, queryClient, origins, sent: () => origins.sentTo('recipe') };
}

/** Paste `text` through the open sheet. */
async function paste(text: string): Promise<void> {
    const user = userEvent.setup();
    const sheet = screen.getByRole('dialog', { name: 'Paste a list' });

    await user.type(within(sheet).getByRole('textbox', { name: 'Ingredient lines' }), text);
    await user.click(within(sheet).getByRole('button', { name: /^Add \d+ ingredients?$/ }));
}

const routesSent = (requests: readonly RecordedRequest[]) =>
    requests.map((request) => `${request.method} ${request.path.replace(JOB_ID, '{job}')}`);

describe('Paste a list, matched — confident lines bind, and nothing is looked up by name', () => {
    it('⛔ a confident match binds through by-food; the line is drawn ONCE; the create carries its source', async () => {
        const state = server(jobWith(null), { afterMatches: jobWith(CONFIDENT) });
        let latest: RecipeFormValues | undefined;
        const { sent } = renderHost(state, (values) => {
            latest = values;
        });

        await paste('2 cups milk');

        await waitFor(() => expect(latest?.ingredients).toHaveLength(1));
        expect(routesSent(sent())).toEqual([
            'POST /api/v1/recipe-parse-jobs',
            'GET /api/v1/recipe-parse-jobs/{job}',
            'POST /api/v1/recipe-parse-jobs/{job}/matches',
            'POST /api/v1/ingredients/by-food',
        ]);
        expect(sent().at(-1)?.body).toEqual({ foodId: 'food_whole' });
        expect(routesSent(sent())).not.toContain('POST /api/v1/ingredients/by-name');

        // One line, one place: Whole milk is named once, by the matched list, not again by an ordinary row.
        expect(await screen.findAllByText('Whole milk')).toHaveLength(1);
        expect(screen.getByRole('button', { name: 'Change the food for 2 cups milk' })).toBeTruthy();

        const body = toCreateRecipeInput(latest ?? defaultRecipeFormValues(), RecipeStatus.DRAFT);

        expect(body.ingredients[0]).toMatchObject({
            quantity: { kind: 'exact', value: 2 },
            unit: 'cups',
            sourceLine: '2 cups milk',
            sourcePhrase: 'milk',
        });
        expect(createRecipeRequestSchema.safeParse(body).error?.issues ?? []).toEqual([]);
    });

    it('asks for matches ONCE, however many times the job is read again', async () => {
        const state = server(jobWith(null), { afterMatches: jobWith(CONFIDENT) });
        const { sent, queryClient } = renderHost(state);

        await paste('2 cups milk');
        await screen.findByText('Whole milk');
        await act(async () => {
            await queryClient.invalidateQueries();
            await queryClient.invalidateQueries();
        });

        expect(routesSent(sent()).filter((route) => route.endsWith('/matches'))).toHaveLength(1);
    });
});

describe('Paste a list, matched — a default is shown and never selected', () => {
    it('⛔ joins the line as written, shows the Default tag with nothing chosen, and binds only the food the cook picks', async () => {
        const user = userEvent.setup();
        const state = server(jobWith(null), { afterMatches: jobWith(DEFAULT) });
        const { sent } = renderHost(state);

        await paste('2 cups milk');

        const whole = await screen.findByRole('button', { name: 'Whole milk, Default' });

        expect(screen.getByText('Choose the milk you use')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /, chosen$/ })).toBeNull();
        expect(sent().filter((request) => request.path === '/api/v1/ingredients')).toHaveLength(1);
        expect(sent().find((request) => request.path === '/api/v1/ingredients')?.body).toEqual({ name: 'milk' });
        // Joined as written: no food was admitted, so the default's id has not left the browser.
        expect(sent().filter((request) => request.path === '/api/v1/ingredients/by-food')).toEqual([]);

        await user.click(screen.getByRole('button', { name: 'Skim milk' }));

        await screen.findByText(/Skim milk\s+· your choice/u);
        const admitted = sent().filter((request) => request.path === '/api/v1/ingredients/by-food');

        expect(admitted.map((request) => request.body)).toEqual([{ foodId: 'food_skim' }]);
        expect(whole.isConnected).toBe(false);
    });

    it('every line the cook fixes keeps a direct way to search for a food (owner ruling I1)', async () => {
        const state = server(jobWith(null), { afterMatches: jobWith(DEFAULT) });

        renderHost(state);
        await paste('2 cups milk');

        expect(await screen.findByRole('button', { name: 'Search for a food for 2 cups milk' })).toBeTruthy();
    });
});

describe('Paste a list, matched — Search for a food', () => {
    const NEEDS_CHOICE: Match = {
        state: 'needsChoice',
        reason: 'noProposal',
        proposed: null,
        candidates: candidates(OAT, WHOLE),
    };

    it('⛔ hands the line to the one food picker, and a food found there binds it as the cook’s; the line is never drawn twice', async () => {
        const user = userEvent.setup();
        const state = server(jobWith(null), { afterMatches: jobWith(NEEDS_CHOICE) });
        const food = foodSearches({
            catalog: () => json({ results: [{ id: 'food_skim', name: 'Skim milk', score: 0.9 }] }),
            authored: () => json({ results: [] }),
        });
        const { sent } = renderHost(state, undefined, undefined, food);

        await paste('2 cups milk');
        await user.click(await screen.findByRole('button', { name: 'Search for a food for 2 cups milk' }));

        // The line is the picker's now, on its own words: one field, and the matched list does not draw it as well.
        const wordsField = (): HTMLInputElement | undefined =>
            screen.queryAllByRole<HTMLInputElement>('combobox').find((each) => each.value === 'milk');

        await waitFor(() => expect(wordsField()).toBeDefined());
        expect(screen.queryByText('Choose a food')).toBeNull();

        await user.click(wordsField() as HTMLInputElement);
        await user.keyboard('s');
        const catalog = await screen.findByRole('group', { name: 'Food catalog' }, { timeout: 3000 });

        await user.click(within(catalog).getByRole('option', { name: 'Skim milk' }));

        // Bound as the cook's, and drawn by the matched list again.
        await screen.findByText(/Skim milk\s+· your choice/u);
        expect(wordsField()).toBeUndefined();
        expect(
            sent()
                .filter((request) => request.path === '/api/v1/ingredients/by-food')
                .map((request) => request.body),
        ).toEqual([{ foodId: 'food_skim' }]);
    });
});

describe('Paste a list, matched — a line that is still being checked', () => {
    it('⛔ binds to the food the review confirmed when nobody chose, and says nothing was the cook’s', async () => {
        const state = server(jobWith(null), { afterMatches: jobWith(CHECKING) });
        const { sent, queryClient } = renderHost(state);

        await paste('2 cups milk');
        await screen.findByRole('button', { name: /^Use this/ });
        expect(sent().filter((request) => request.path === '/api/v1/ingredients/by-food')).toEqual([]);

        state.job = jobWith({ ...CONFIDENT, reason: 'reviewVerified', proposed: WHOLE });
        await act(async () => {
            await queryClient.invalidateQueries();
        });

        await waitFor(() =>
            expect(
                sent()
                    .filter((request) => request.path === '/api/v1/ingredients/by-food')
                    .map((r) => r.body),
            ).toEqual([{ foodId: 'food_whole' }]),
        );
        expect(await screen.findByText('Whole milk')).toBeTruthy();
        expect(screen.queryByText(/your choice/u)).toBeNull();
    });

    it('⛔ NEVER replaces a pick the cook made: the pick stays, with one quiet sentence, and no food is admitted', async () => {
        const user = userEvent.setup();
        const state = server(jobWith(null), { afterMatches: jobWith(CHECKING) });
        const { sent, queryClient } = renderHost(state);

        await paste('2 cups milk');
        await user.click(await screen.findByRole('button', { name: /^Use this: Oat milk/ }));
        await screen.findByText(/Oat milk\s+· your choice/u);
        const before = sent().filter((request) => request.path === '/api/v1/ingredients/by-food').length;

        state.job = jobWith({ ...CONFIDENT, reason: 'reviewVerified', proposed: WHOLE });
        await act(async () => {
            await queryClient.invalidateQueries();
        });

        expect(await screen.findByText('Our check suggested Whole milk. Your choice stays.')).toBeTruthy();
        expect(screen.getByText(/Oat milk\s+· your choice/u)).toBeTruthy();
        expect(sent().filter((request) => request.path === '/api/v1/ingredients/by-food')).toHaveLength(before);
    });
});

describe('Paste a list, matched — the daily limit (004 FR-022)', () => {
    it('⛔ lands every line as written with the notice; the sheet closes and shows no error; nothing is matched', async () => {
        const state = server(jobWith(null), { create: quotaResponse });
        let latest: RecipeFormValues | undefined;
        const { sent } = renderHost(state, (values) => {
            latest = values;
        });

        await paste('2 cups milk\n1 tsp salt');

        await waitFor(() => expect(latest?.ingredients).toHaveLength(2));
        expect(routesSent(sent()).filter((route) => route.includes('by-name') || route.includes('by-food'))).toEqual(
            [],
        );
        expect(routesSent(sent()).filter((route) => route.endsWith('/matches'))).toEqual([]);
        expect(
            sent()
                .filter((request) => request.path === '/api/v1/ingredients')
                .map((request) => request.body),
        ).toEqual([{ name: 'milk' }, { name: 'salt' }]);
        expect(await screen.findByText(/You’ve added a lot today\. Matching starts again at/u)).toBeTruthy();
        expect(screen.queryByRole('dialog', { name: 'Paste a list' })).toBeNull();
        expect(screen.queryByText(/We couldn’t start reading that/u)).toBeNull();
    });
});

describe('Paste a list, matched — what happens around the match', () => {
    it('⛔ offline the paste is attempted and refused at once, never queued; the sheet keeps the text', async () => {
        const user = userEvent.setup();
        const state = server(jobWith(null), { create: () => Response.error() });

        renderHost(state);
        act(() => onlineManager.setOnline(false));

        const sheet = screen.getByRole('dialog', { name: 'Paste a list' });
        await user.type(within(sheet).getByRole('textbox', { name: 'Ingredient lines' }), '2 cups milk');
        await user.click(within(sheet).getByRole('button', { name: 'Add 1 ingredient' }));

        expect(await within(sheet).findByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t start reading that. Your text is still here — try again.',
        );
        expect(within(sheet).getByRole('textbox', { name: 'Ingredient lines' })).toHaveProperty('value', '2 cups milk');
    });

    it('a line the server reads as stalled waits on the cook; Add as written joins it as written, claiming no phrase', async () => {
        const user = userEvent.setup();
        const stalled = {
            ...ACCEPTED,
            lines: [{ ...ACCEPTED.lines[0], progress: { phase: 'stalled' } }],
        };
        const state = server(stalled, { create: () => json(stalled, 202) });
        let latest: RecipeFormValues | undefined;
        const { sent } = renderHost(state, (values) => {
            latest = values;
        });

        await paste('2 cups milk');
        await user.click(await screen.findByRole('button', { name: 'Add as written: 2 cups milk' }));

        await waitFor(() => expect(latest?.ingredients).toHaveLength(1));
        expect(
            sent()
                .filter((request) => request.path === '/api/v1/ingredients')
                .map((request) => request.body),
        ).toEqual([{ name: 'milk' }]);
        expect(routesSent(sent())).not.toContain('POST /api/v1/ingredients/by-name');

        const body = toCreateRecipeInput(latest ?? defaultRecipeFormValues(), RecipeStatus.DRAFT);

        expect(body.ingredients[0]).toMatchObject({ sourceLine: '2 cups milk' });
        expect(body.ingredients[0]).not.toHaveProperty('sourcePhrase');
    });

    it('⛔ the overlay is memory: a remount of the same draft shows ordinary rows and no matched list (ADR-0057)', async () => {
        const state = server(jobWith(null), { afterMatches: jobWith(DEFAULT) });
        let latest: RecipeFormValues | undefined;
        const first = renderHost(state, (values) => {
            latest = values;
        });

        await paste('2 cups milk');
        await screen.findByRole('button', { name: 'Whole milk, Default' });
        first.unmount();

        renderHost(server(jobWith(null)), () => undefined, latest);

        expect(await screen.findByText('milk')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Whole milk, Default' })).toBeNull();
        expect(screen.queryByText('Choose the milk you use')).toBeNull();
    });
});

describe('Paste a list, matched — publishing with lines that have no food yet (R23)', () => {
    it('names the open lines, and Choose now opens the first of them', async () => {
        const user = userEvent.setup();
        const state = server(jobWith(null), { afterMatches: jobWith(DEFAULT) });

        renderHost(state);
        await paste('2 cups milk');
        await screen.findByRole('button', { name: 'Whole milk, Default' });

        await user.click(screen.getByRole('button', { name: 'Publish' }));

        const sheet = await screen.findByRole('dialog', { name: '1 ingredient has no food yet' });

        expect(within(sheet).getByText(/milk/u)).toBeTruthy();

        await user.click(within(sheet).getByRole('button', { name: 'Choose now' }));

        expect(await screen.findByRole('button', { name: 'Whole milk, Default' })).toBeTruthy();
    });
});
