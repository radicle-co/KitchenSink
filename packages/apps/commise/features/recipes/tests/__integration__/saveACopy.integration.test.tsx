/**
 * Integration: Save a copy on the wire (slice 5; `docs/architecture/uiOverhaulBlueprint.md` A14).
 *
 * Composes the REAL `useSaveCopy`, the real Discover footer, TanStack Query, the design system's `SnackbarHost` and the
 * real `RecipeServiceClient` (request building and zod parsing), with only `fetch` doubled. What it proves that no unit
 * test can: a second press while a copy is saving sends NO second request (a retry would make two copies), the control's
 * state comes from the mutation cache (so it survives its card being redrawn), and the snackbar's Edit opens the COPY.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { makeRecipeDetail } from '@kitchensink/recipe-core/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DiscoveryFooter } from '../../src/discovery/DiscoveryFooter.js';
import { useSaveCopy } from '../../src/hooks/useSaveCopy.js';

const SOURCE = '00000000-0000-4000-8000-0000000000a1';
const COPY = '00000000-0000-4000-8000-0000000000b2';

afterEach(cleanup);

/** The wire double: it records the clone requests and answers one when `release` is called. */
function wire() {
    const clones: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });

    const fetchDouble = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input));

        if (url.pathname === '/health') {
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        }

        clones.push(`${input instanceof Request ? input.method : (init?.method ?? 'GET')} ${url.pathname}`);
        await gate;

        return new Response(JSON.stringify(makeRecipeDetail({ id: COPY })), {
            status: 201,
            headers: { 'content-type': 'application/json' },
        });
    };

    return {
        clones,
        release,
        client: new RecipeServiceClient({ baseUrl: 'https://recipes.test', token: 'tok', fetch: fetchDouble }),
    };
}

/** One card's footer, as the Discover leaves draw it from the hook. */
const Card: FC<{ readonly onEdit: (copyId: string) => void }> = ({ onEdit }) => {
    const saveCopy = useSaveCopy(onEdit);

    return (
        <DiscoveryFooter title="Sunday Roast" state={saveCopy.stateOf(SOURCE)} onSave={() => saveCopy.save(SOURCE)} />
    );
};

describe('Save a copy on the wire (integration)', () => {
    it('sends one clone however often it is pressed, then offers Edit on the copy', async () => {
        const user = userEvent.setup();
        const onEdit = vi.fn();
        const { clones, release, client } = wire();
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <RecipeServiceProvider client={client}>
                    <SnackbarHost>
                        <Card onEdit={onEdit} />
                    </SnackbarHost>
                </RecipeServiceProvider>
            </QueryClientProvider>,
        );

        await user.click(screen.getByRole('button', { name: 'Save a copy of Sunday Roast' }));
        const busy = await screen.findByRole('button', { name: 'Saving a copy of Sunday Roast' });
        await user.click(busy);
        await user.click(busy);

        expect(clones).toEqual([`POST /api/v1/recipes/${SOURCE}/clone`]);

        await act(async () => {
            release();
        });

        expect(await screen.findByText('Saved a copy to My recipes.')).toBeTruthy();
        expect(onEdit).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Edit' }));
        expect(onEdit).toHaveBeenCalledExactlyOnceWith(COPY);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Saved a copy of Sunday Roast' })).toBeTruthy());
        expect(clones).toHaveLength(1);
    });
});
