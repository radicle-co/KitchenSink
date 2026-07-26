// @vitest-environment jsdom
/**
 * Orchestration tests for the account ERASURE container (web; CR-002 / U4b). The pure dialog's own state
 * matrix is covered in `@commise/features-account`; here we verify the WIRING: the flow is deferred until
 * opened, the recipe fetch feeds the donate election (filtered to owner-only), the confirm sends the typed
 * phrase + the donate election to the erasure mutation, a success signs the viewer out, and the mutation's
 * pending/error state reaches the dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ signOut }) }));

const recipesState = vi.hoisted(() => ({
    current: { recipes: [] as unknown[], isLoading: false, isError: false },
}));
const { erasureMutate } = vi.hoisted(() => ({ erasureMutate: vi.fn() }));
const erasureState = vi.hoisted(() => ({ current: { isPending: false, isError: false } }));

// The election consumes the FULL owner list (paged to completion) — see useAllOwnerRecipes. A capped
// single-page hook would silently omit (and then erasure would destroy) owner-only recipes past the cap.
vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useAllOwnerRecipes: () => recipesState.current,
    useRequestAccountErasure: () => ({ mutate: erasureMutate, ...erasureState.current }),
}));

const makeRecipe = (
    id: string,
    title: string,
    visibility: 'public' | 'private',
    status: 'draft' | 'published',
): unknown => ({ id, title, visibility, status });

beforeEach(() => {
    signOut.mockReset().mockResolvedValue(undefined);
    erasureMutate.mockReset();
    recipesState.current = { recipes: [], isLoading: false, isError: false };
    erasureState.current = { isPending: false, isError: false };
});

afterEach(cleanup);

const { AccountEraseForm } = await import('../AccountEraseForm');

async function openFlow(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    render(<AccountEraseForm />);
    await user.click(screen.getByRole('button', { name: 'Erase my data' }));

    return user;
}

describe('AccountEraseForm (web) — deferral', () => {
    it('renders only the trigger until opened (the recipe fetch is not shown)', () => {
        render(<AccountEraseForm />);

        expect(screen.getByRole('button', { name: 'Erase my data' })).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens the erasure dialog on trigger activation', async () => {
        await openFlow();

        expect(screen.getByRole('dialog', { name: 'Erase my data' })).toBeTruthy();
    });
});

describe('AccountEraseForm (web) — donate election wiring', () => {
    it('shows loading while the recipe list loads', async () => {
        recipesState.current = { recipes: [], isLoading: true, isError: false };
        await openFlow();

        expect(screen.getByText('Loading your recipes')).toBeTruthy();
    });

    it('offers only owner-only recipes for donation (public+published are excluded)', async () => {
        recipesState.current = {
            recipes: [
                makeRecipe('pub', 'Public Published', 'public', 'published'),
                makeRecipe('priv', 'Private Published', 'private', 'published'),
            ],
            isLoading: false,
            isError: false,
        };
        await openFlow();

        expect(screen.getByRole('checkbox', { name: 'Private Published' })).toBeTruthy();
        expect(screen.queryByRole('checkbox', { name: 'Public Published' })).toBeNull();
    });
});

describe('AccountEraseForm (web) — confirm', () => {
    it('sends the typed phrase and the donate election, then signs out on success', async () => {
        erasureMutate.mockImplementation((_request: unknown, options?: { onSuccess?: () => void }) =>
            options?.onSuccess?.(),
        );
        recipesState.current = {
            recipes: [makeRecipe('priv', 'Private Published', 'private', 'published')],
            isLoading: false,
            isError: false,
        };
        const user = await openFlow();

        await user.click(screen.getByRole('checkbox', { name: 'Private Published' }));
        await user.type(screen.getByLabelText('Confirmation phrase'), 'ERASE MY DATA');
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erase my data' }));

        expect(erasureMutate).toHaveBeenCalledTimes(1);
        expect(erasureMutate.mock.calls[0]?.[0]).toEqual({
            confirmationPhrase: 'ERASE MY DATA',
            publishRecipeIds: ['priv'],
        });
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: '/' }));
    });

    it('does not submit while the phrase gate is unsatisfied', async () => {
        const user = await openFlow();

        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erase my data' }));

        expect(erasureMutate).not.toHaveBeenCalled();
    });
});

describe('AccountEraseForm (web) — mutation state', () => {
    it('reflects the mutation pending state as busy', async () => {
        erasureState.current = { isPending: true, isError: false };
        await openFlow();

        expect(screen.getByText('Erasing…')).toBeTruthy();
    });

    it('surfaces the mutation error (B17)', async () => {
        erasureState.current = { isPending: false, isError: true };
        await openFlow();

        expect(screen.getByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t start erasing your data. Please try again.',
        );
    });
});
