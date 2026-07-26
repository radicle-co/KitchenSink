/**
 * Component tests for the mobile AccountDangerZone (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). Verifies the two DISTINCT account actions (CR-002 / U4b): CLOSE reads as
 * recoverable (never "permanently deleted") and closes via `useDeleteAccount`; ERASE drives the shared
 * phrase-gated, donate-election `AccountEraseDialog` (owner-only recipes offered, confirm gated on the exact
 * phrase) and, on success, signs the viewer out. The dialog's full state matrix is covered in
 * `@commise/features-account`; here we assert the mobile WIRING.
 *
 * Local-run note (per repo constraint): mobile-app `.native` screen tests can fail locally on the Clerk/expo
 * ESM graph — this suite mocks `@clerk/expo` + the platform hooks so it stays isolated, and it is
 * CI-verified regardless. The shared dialog's behaviour is additionally covered locally by
 * `@commise/features-account`'s own native tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useAllOwnerRecipes, useRequestAccountErasure } from '@kitchensink/recipe-service-client/hooks';

import { AccountDangerZone } from '../../src/components/account/AccountDangerZone.js';
import { useDeleteAccount } from '../../src/hooks/useUserProfile.js';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ signOut }) }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useAllOwnerRecipes: vi.fn(),
    useRequestAccountErasure: vi.fn(),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({ useDeleteAccount: vi.fn() }));

const useRecipesMock = vi.mocked(useAllOwnerRecipes);
const useRequestAccountErasureMock = vi.mocked(useRequestAccountErasure);
const useDeleteAccountMock = vi.mocked(useDeleteAccount);

const deleteMutate = vi.fn();
const erasureMutate = vi.fn();

const makeRecipe = (
    id: string,
    title: string,
    visibility: 'public' | 'private',
    status: 'draft' | 'published',
): unknown => ({ id, title, visibility, status });

function setRecipes(data: unknown[], state: { isLoading?: boolean; isError?: boolean } = {}): void {
    useRecipesMock.mockReturnValue({
        recipes: data,
        isLoading: state.isLoading ?? false,
        isError: state.isError ?? false,
        isComplete: !(state.isLoading ?? false) && !(state.isError ?? false),
    } as unknown as ReturnType<typeof useAllOwnerRecipes>);
}

function setErasure(state: { isPending?: boolean; isError?: boolean } = {}): void {
    useRequestAccountErasureMock.mockReturnValue({
        mutate: erasureMutate,
        isPending: state.isPending ?? false,
        isError: state.isError ?? false,
    } as unknown as ReturnType<typeof useRequestAccountErasure>);
}

beforeEach(() => {
    signOut.mockReset().mockResolvedValue(undefined);
    deleteMutate.mockReset();
    erasureMutate.mockReset();
    useDeleteAccountMock.mockReturnValue({ mutate: deleteMutate, isPending: false } as unknown as ReturnType<
        typeof useDeleteAccount
    >);
    setRecipes([]);
    setErasure();
});

afterEach(cleanup);

describe('AccountDangerZone (native) — closure vs erasure are distinct', () => {
    it('offers both a recoverable close and an irreversible erase', () => {
        render(<AccountDangerZone />);

        expect(screen.getByRole('button', { name: 'Close account' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Erase my data' })).toBeTruthy();
    });
});

describe('AccountDangerZone (native) — close (recoverable)', () => {
    it('confirms closure with recoverable copy, not permanent deletion', () => {
        render(<AccountDangerZone />);

        fireEvent.click(screen.getByRole('button', { name: 'Close account' }));

        expect(screen.getByText(/not permanent deletion/i)).toBeTruthy();
        expect(screen.queryByText(/permanently deleted/i)).toBeNull();
    });

    it('closes the account on confirm', () => {
        render(<AccountDangerZone />);

        fireEvent.click(screen.getByRole('button', { name: 'Close account' }));
        const confirms = screen.getAllByRole('button', { name: 'Close account' });
        fireEvent.click(confirms[confirms.length - 1] as HTMLElement);

        expect(deleteMutate).toHaveBeenCalledTimes(1);
    });
});

describe('AccountDangerZone (native) — erase (irreversible)', () => {
    it('offers only owner-only recipes for the donate election', () => {
        setRecipes([
            makeRecipe('pub', 'Public Published', 'public', 'published'),
            makeRecipe('priv', 'Private Published', 'private', 'published'),
        ]);
        render(<AccountDangerZone />);

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));

        expect(screen.getByRole('checkbox', { name: 'Private Published' })).toBeTruthy();
        expect(screen.queryByRole('checkbox', { name: 'Public Published' })).toBeNull();
    });

    it('erases with the typed phrase + donate election, then signs out on success', () => {
        erasureMutate.mockImplementation((_request: unknown, options?: { onSuccess?: () => void }) =>
            options?.onSuccess?.(),
        );
        setRecipes([makeRecipe('priv', 'Private Published', 'private', 'published')]);
        render(<AccountDangerZone />);

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Private Published' }));
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'ERASE MY DATA' } });

        const eraseButtons = screen.getAllByRole('button', { name: 'Erase my data' });
        fireEvent.click(eraseButtons[eraseButtons.length - 1] as HTMLElement);

        expect(erasureMutate).toHaveBeenCalledTimes(1);
        expect(erasureMutate.mock.calls[0]?.[0]).toEqual({
            confirmationPhrase: 'ERASE MY DATA',
            publishRecipeIds: ['priv'],
        });
        expect(signOut).toHaveBeenCalledTimes(1);
    });

    it('does not erase while the phrase gate is unsatisfied', () => {
        render(<AccountDangerZone />);

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));
        const eraseButtons = screen.getAllByRole('button', { name: 'Erase my data' });
        fireEvent.click(eraseButtons[eraseButtons.length - 1] as HTMLElement);

        expect(erasureMutate).not.toHaveBeenCalled();
    });

    it('surfaces the mutation error (B17)', () => {
        setErasure({ isError: true });
        render(<AccountDangerZone />);

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));

        expect(screen.getByText('We couldn’t start erasing your data. Please try again.')).toBeTruthy();
    });
});
