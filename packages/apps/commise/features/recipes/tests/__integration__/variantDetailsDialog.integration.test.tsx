/**
 * The details dialog, composed (curated U14): the REAL `useVariantDetailsDialog`, TanStack Query, the real
 * `FoodServiceClient` with its zod parsing of `GET /api/v1/foods/{id}`, and the real web leaf on the real `Sheet`.
 * Only `fetch` is a double (owner ruling 2026-09-20: integration tests mock their dependencies).
 *
 * The host here is the create form's: a pick writes a local value and sends nothing (§S8.9). It proves the seam a
 * real host plugs into: the read crosses the wire shape, the list groups the parsed variants, and each outcome
 * reaches the port once, with nothing else sent.
 */
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeFoodResponse } from '../../src/details/__fixtures__/foodResponse.js';
import { BEEF_BRISKET, BONELESS_SKINLESS_CHICKEN_THIGHS } from '../../src/details/__fixtures__/seedVariants.js';
import type { DetailsDialogEntry, DetailsDialogOutcome } from '../../src/details/detailsDialogMachine.js';
import { useVariantDetailsDialog } from '../../src/details/useVariantDetailsDialog.js';
import { VariantDetailsDialog } from '../../src/details/VariantDetailsDialog.js';

afterEach(cleanup);

/** A food client whose `fetch` answers each root id from `foods`, and records every request. */
function stubbedFood(foods: Readonly<Record<string, unknown>>, status = 200) {
    const requests: string[] = [];
    const client = new FoodServiceClient({
        baseUrl: 'https://food.test',
        fetch: (input) => {
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

            requests.push(`${url.pathname}`);
            const id = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
            const body = foods[id];

            return Promise.resolve(
                body === undefined
                    ? new Response(
                          JSON.stringify({ code: 'FOOD_NOT_FOUND', message: 'no such food', details: { id } }),
                          {
                              status: 404,
                              headers: { 'content-type': 'application/json' },
                          },
                      )
                    : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
            );
        },
    });

    return { client, requests };
}

/** The create form's host: it opens the dialog, writes a pick into local state, and shows what the line holds. */
const FormHost: FC<{
    readonly rootId: string;
    readonly entry: DetailsDialogEntry;
    readonly onOutcome: (o: DetailsDialogOutcome) => void;
}> = ({ rootId, entry, onOutcome }) => {
    const [open, setOpen] = useState(true);
    const [line, setLine] = useState('root only');
    const details = useVariantDetailsDialog({
        open,
        rootId,
        entry,
        onOutcome: (outcome) => {
            onOutcome(outcome);
            setOpen(false);

            if (outcome.kind === 'committed') {
                setLine(outcome.variant.parts.map((part) => part.text).join(' · '));
            } else if (outcome.kind === 'removed') {
                setLine('root only');
            }
        },
    });

    return (
        <>
            <p>Line: {line}</p>
            <VariantDetailsDialog open={open} foodName="beef brisket" details={details} />
        </>
    );
};

/** Render the host under a fresh query client and `client`. */
function renderHost(client: FoodServiceClient, rootId: string, entry: DetailsDialogEntry) {
    const onOutcome = vi.fn<(outcome: DetailsDialogOutcome) => void>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
        <QueryClientProvider client={queryClient}>
            <FoodServiceProvider client={client} subject="user_1">
                <FormHost rootId={rootId} entry={entry} onOutcome={onOutcome} />
            </FoodServiceProvider>
        </QueryClientProvider>,
    );

    return onOutcome;
}

describe('variant details dialog — composed over the real food client', () => {
    it('reads the root over the wire, groups brisket by cut (AE8), and a pick writes the form value only', async () => {
        const { client, requests } = stubbedFood({
            root_brisket: makeFoodResponse({ id: 'root_brisket', variants: [...BEEF_BRISKET] }),
        });
        const onOutcome = renderHost(client, 'root_brisket', { mode: 'add' });

        const listbox = await screen.findByRole('listbox');

        expect(within(listbox).getAllByRole('group')).toHaveLength(5);
        const first = within(within(listbox).getByRole('group', { name: 'flat half' })).getAllByRole('option')[0]!;

        expect(first.getAttribute('aria-label')).toBe('lean only, 0-inch trim, select, 124 cal, flat half');
        fireEvent.click(first);

        expect(onOutcome).toHaveBeenCalledTimes(1);
        expect(onOutcome.mock.calls[0]?.[0]).toMatchObject({ kind: 'committed', mode: 'add' });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getByText('Line: flat half · lean only · 0-inch trim · select')).toBeTruthy();
        expect(requests.filter((path) => path.startsWith('/api/v1/foods/'))).toEqual(['/api/v1/foods/root_brisket']);
    });

    it('searches the parsed list and narrows it without regrouping', async () => {
        const { client } = stubbedFood({
            root_brisket: makeFoodResponse({ id: 'root_brisket', variants: [...BEEF_BRISKET] }),
        });

        renderHost(client, 'root_brisket', { mode: 'add' });
        const search = await screen.findByRole('combobox', { name: 'Search 40 options' });

        fireEvent.change(search, { target: { value: 'navel' } });

        expect(screen.getAllByRole('group')).toHaveLength(1);
        expect(screen.getByRole('group', { name: 'navel end' })).toBeTruthy();
    });

    it('in edit mode, choosing the current row closes the dialog and writes nothing', async () => {
        const thigh = BONELESS_SKINLESS_CHICKEN_THIGHS[0]!;
        const { client, requests } = stubbedFood({
            root_thighs: makeFoodResponse({ id: 'root_thighs', variants: [...BONELESS_SKINLESS_CHICKEN_THIGHS] }),
        });
        const onOutcome = renderHost(client, 'root_thighs', {
            mode: 'edit',
            current: { id: thigh.id, parts: thigh.parts },
        });

        fireEvent.click(await screen.findByRole('option', { name: /, Current, /u }));

        expect(onOutcome.mock.calls).toEqual([[{ kind: 'dismissed' }]]);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getByText('Line: root only')).toBeTruthy();
        expect(requests.filter((path) => path.startsWith('/api/v1/foods/'))).toEqual(['/api/v1/foods/root_thighs']);
    });

    it('in edit mode, Remove details unbinds the variant', async () => {
        const thigh = BONELESS_SKINLESS_CHICKEN_THIGHS[0]!;
        const { client } = stubbedFood({
            root_thighs: makeFoodResponse({ id: 'root_thighs', variants: [...BONELESS_SKINLESS_CHICKEN_THIGHS] }),
        });
        const onOutcome = renderHost(client, 'root_thighs', {
            mode: 'edit',
            current: { id: thigh.id, parts: thigh.parts },
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Remove details' }));

        expect(onOutcome.mock.calls).toEqual([[{ kind: 'removed' }]]);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('a root food cannot answer shows the failure with Try again, and nothing is committed', async () => {
        const { client } = stubbedFood({});
        const onOutcome = renderHost(client, 'root_missing', { mode: 'add' });

        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
        expect(onOutcome).not.toHaveBeenCalled();
    });

    it('a variant food sends with no calorie figure reads as "no figure", never 0, after the real parse', async () => {
        const { client } = stubbedFood({
            root_one: makeFoodResponse({
                id: 'root_one',
                variants: [{ id: 'V1', parts: [{ attribute: 'grade', text: 'select' }] }],
            }),
        });

        renderHost(client, 'root_one', { mode: 'add' });

        expect(await screen.findByRole('option', { name: 'select, no calorie figure' })).toBeTruthy();
    });
});
