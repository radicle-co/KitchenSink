/**
 * Integration: Paste a list on the wire (build spec §7.5.4; blueprint A5; owner decision D10).
 *
 * Composes the REAL `useIngredientsPaste` (the paste, its sheet), the web `PasteListSheet`, TanStack Query and the real
 * `RecipeServiceClient` (request building and zod parsing) over a draft held by the real `applyDraftAction`, with only
 * `fetch` doubled. What it proves that no unit test can: the pasted text reaches `POST /recipe-parse-jobs` as the
 * contract's body, the job's answer is polled and each line is looked up through `POST /ingredients/by-name`, and the
 * CREATE body the draft then produces carries each line's source while the contract still accepts it. Offline, the paste
 * is attempted and refused at once, never queued (A5).
 */
import { RecipeStatus } from '@kitchensink/recipe-core';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createRecipeRequestSchema } from '@kitchensink/schema-recipe';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useIngredientsPaste } from '../../src/editor/useIngredientsPaste.js';
import { PasteListSheet } from '../../src/form/PasteListSheet.js';
import { applyDraftAction } from '../../src/form/props.js';
import { defaultRecipeFormValues, type RecipeFormValues } from '../../src/form/values.js';
import { toCreateRecipeInput } from '../../src/form/wire.js';

afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
});

const JOB_ID = '00000000-0000-4000-8000-00000000e301';
const FLOUR_ID = '00000000-0000-4000-8000-0000000000f1';

const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The parse job, complete: one line read as two cups of flour, sifted. */
const COMPLETE_JOB = {
    id: JOB_ID,
    status: 'complete',
    createdAt: '2026-10-09T10:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    lines: [
        {
            lineIndex: 0,
            sourceLine: '2 cups flour, sifted',
            status: 'parsed',
            proposal: {
                raw: '2 cups flour, sifted',
                quantity: { kind: 'exact', value: 2 },
                unit: 'cup',
                statedMeasure: '2 cups',
                foods: [{ name: 'flour', prep: 'sifted' }],
                reviewReasons: [],
            },
        },
    ],
};

/** The wire double: records each request, answers the parse job and the by-name lookup; `beforeJob` holds the job. */
function wire(beforeJob: () => Promise<void> = async () => undefined) {
    const requests: { readonly route: string; readonly body: unknown }[] = [];

    const fetchDouble = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        const url = new URL(request.url);

        // The client's own contract probe is not part of the flow.
        if (url.pathname === '/health') {
            return json({}, 200);
        }

        const route = `${request.method} ${url.pathname}`;
        const text = request.method === 'GET' ? '' : await request.text();

        requests.push({ route, body: text === '' ? undefined : JSON.parse(text) });

        switch (route) {
            case 'POST /api/v1/recipe-parse-jobs':
                await beforeJob();

                return json(
                    {
                        ...COMPLETE_JOB,
                        status: 'running',
                        lines: [{ ...COMPLETE_JOB.lines[0], status: 'pending', proposal: null }],
                    },
                    202,
                );
            case `GET /api/v1/recipe-parse-jobs/${JOB_ID}`:
                return json(COMPLETE_JOB, 200);
            case 'POST /api/v1/ingredients/by-name':
                // The wire's ingredient: the lookup admitted it and is still resolving it (R19: the parse bound nothing).
                return json(
                    {
                        id: FLOUR_ID,
                        name: 'flour',
                        foodResolutionStatus: 'PENDING',
                        isUserEntered: false,
                        createdAt: '2026-10-09T10:00:01.000Z',
                    },
                    202,
                );
            default:
                return json({ message: `unexpected ${route}` }, 500);
        }
    };

    return {
        requests,
        client: new RecipeServiceClient({ baseUrl: 'https://recipes.test', token: 'tok', fetch: fetchDouble }),
    };
}

/** A new recipe's Ingredients section: its draft, the paste, and the sheet. */
const Editor: FC<{ readonly onValues: (values: RecipeFormValues) => void }> = ({ onValues }) => {
    const [values, setValues] = useState(() => ({ ...defaultRecipeFormValues(), title: 'Pasted Bread' }));
    const paste = useIngredientsPaste({
        offered: true,
        keepsSource: true,
        dispatch: (action) =>
            setValues((current) => {
                const next = applyDraftAction(current, action);
                onValues(next);

                return next;
            }),
        lineCount: values.ingredients.length,
        initiallyOpen: true,
    });

    return (
        <>
            <ul aria-label="Reading">
                {paste.view.reading.map((row) => (
                    <li key={row.key}>{`${row.sourceLine}: ${row.state}`}</li>
                ))}
            </ul>
            <PasteListSheet sheet={paste.sheet} submitting={paste.submitting} failed={paste.failed} />
        </>
    );
};

function renderEditor(client: RecipeServiceClient, onValues: (values: RecipeFormValues) => void): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <Editor onValues={onValues} />
            </RecipeServiceProvider>
        </QueryClientProvider>,
    );
}

describe('Paste a list — on the wire', () => {
    it('sends the paste, looks each read line up by name, and the create then carries what it was read from', async () => {
        const user = userEvent.setup();
        const { client, requests } = wire();
        let latest: RecipeFormValues | undefined;
        renderEditor(client, (values) => {
            latest = values;
        });

        const sheet = screen.getByRole('dialog', { name: 'Paste a list' });
        await user.type(within(sheet).getByRole('textbox', { name: 'Ingredient lines' }), '2 cups flour, sifted');
        await user.click(within(sheet).getByRole('button', { name: 'Add 1 ingredient' }));

        await waitFor(() => expect(latest?.ingredients).toHaveLength(1));
        expect(requests.map((request) => request.route)).toEqual([
            'POST /api/v1/recipe-parse-jobs',
            `GET /api/v1/recipe-parse-jobs/${JOB_ID}`,
            'POST /api/v1/ingredients/by-name',
        ]);
        expect(requests[0]?.body).toEqual({ text: '2 cups flour, sifted' });
        expect(requests[2]?.body).toEqual({ name: 'flour' });

        // The editor's first checkpoint creates the recipe as a draft (slice 7): that is the create a paste rides.
        const body = toCreateRecipeInput(latest ?? defaultRecipeFormValues(), RecipeStatus.DRAFT);
        expect(body.ingredients[0]).toMatchObject({
            ingredientId: FLOUR_ID,
            quantity: { kind: 'exact', value: 2 },
            unit: 'cup',
            preparation: 'sifted',
            sourceLine: '2 cups flour, sifted',
            sourcePhrase: 'flour',
        });
        expect(createRecipeRequestSchema.safeParse(body).error?.issues ?? []).toEqual([]);
        expect(within(screen.getByRole('list', { name: 'Reading' })).queryAllByRole('listitem')).toEqual([]);
    });

    it('⛔ offline the paste is attempted and refused at once, never queued; the sheet keeps the text', async () => {
        const user = userEvent.setup();
        const offline = new RecipeServiceClient({
            baseUrl: 'https://recipes.test',
            token: 'tok',
            fetch: () => Promise.reject(new TypeError('Failed to fetch')),
        });
        renderEditor(offline, () => undefined);
        act(() => onlineManager.setOnline(false));

        const sheet = screen.getByRole('dialog', { name: 'Paste a list' });
        await user.type(within(sheet).getByRole('textbox', { name: 'Ingredient lines' }), '2 cups flour');
        await user.click(within(sheet).getByRole('button', { name: 'Add 1 ingredient' }));

        expect(await within(sheet).findByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t start reading that. Your text is still here — try again.',
        );
        expect(within(sheet).getByRole('textbox', { name: 'Ingredient lines' })).toHaveProperty(
            'value',
            '2 cups flour',
        );
    });

    /**
     * Finding 11: a paste whose job was accepted just before the connection dropped. Its poll and its by-name lookup
     * pause rather than fail, the rows say they are waiting, and on reconnect they finish by themselves.
     */
    it('a paste that loses its connection waits, says so, and finishes on reconnect', async () => {
        const user = userEvent.setup();
        let releaseJob: (() => void) | undefined;
        const { client, requests } = wire(
            () =>
                new Promise((resolve) => {
                    releaseJob = resolve;
                }),
        );
        let latest: RecipeFormValues | undefined;
        renderEditor(client, (values) => {
            latest = values;
        });

        const sheet = screen.getByRole('dialog', { name: 'Paste a list' });
        await user.type(within(sheet).getByRole('textbox', { name: 'Ingredient lines' }), '2 cups flour, sifted');
        await user.click(within(sheet).getByRole('button', { name: 'Add 1 ingredient' }));
        await waitFor(() => expect(releaseJob).toBeDefined());

        act(() => onlineManager.setOnline(false));
        await act(async () => {
            releaseJob?.();
        });

        const reading = screen.getByRole('list', { name: 'Reading' });
        await waitFor(() =>
            expect(
                within(reading)
                    .getAllByRole('listitem')
                    .map((item) => item.textContent),
            ).toEqual(['2 cups flour, sifted: waiting']),
        );
        expect(requests.map((request) => request.route)).toEqual(['POST /api/v1/recipe-parse-jobs']);

        act(() => onlineManager.setOnline(true));

        await waitFor(() => expect(latest?.ingredients).toHaveLength(1));
        expect(requests.map((request) => request.route)).toEqual([
            'POST /api/v1/recipe-parse-jobs',
            `GET /api/v1/recipe-parse-jobs/${JOB_ID}`,
            'POST /api/v1/ingredients/by-name',
        ]);
    });
});
