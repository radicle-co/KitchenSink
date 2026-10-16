/**
 * Component tests for the mobile AccountDangerZone (rendered via react-native-web under jsdom — see
 * `vitest.native.config.ts`). Verifies the two DISTINCT account actions (CR-002 / U4b): CLOSE reads as
 * recoverable (never "permanently deleted") and closes via `useDeleteAccount`; ERASE drives the shared
 * phrase-gated, donate-election `AccountEraseDialog` (owner-only recipes offered, confirm gated on the exact
 * phrase) and, on success, signs the viewer out. The dialog's full state matrix is covered in
 * `@commise/features-account`; here we assert the mobile WIRING.
 *
 * The two SESSION-ENDING exits are covered as first-class states (ADR-0009 / B17): both go through the app's
 * one sign-out COMMAND (never Clerk's `signOut` directly), a failed closure is reported instead of stopping
 * silently, and an erasure that was ACCEPTED but whose sign-out failed says so TRUTHFULLY — the erasure
 * succeeded server-side, so the alert must never be the dialog's "we couldn't erase, try again" copy.
 *
 * Local-run note (per repo constraint): mobile-app `.native` screen tests can fail locally on the Clerk/expo
 * ESM graph — this suite mocks `@clerk/expo` + the platform hooks so it stays isolated, and it is
 * CI-verified regardless. The shared dialog's behaviour is additionally covered locally by
 * `@commise/features-account`'s own native tests.
 *
 * The two erasure calls are doubled with REAL `useMutation`s over controllable functions, not `mutate` stubs that
 * fire `onSuccess` by hand: the defect pinned here (review P1 #3) is that TanStack drops observer callbacks after
 * unmount, and a hand-fired stub cannot drop anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { useAllOwnerRecipes } from '@kitchensink/recipe-service-client/hooks';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { accountDangerMessages } from '@commise/features-account/danger';
import { profileMessages } from '@commise/features-account/profile';

import { AccountDangerZone } from '../../src/components/account/AccountDangerZone.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { useDeleteAccount } from '../../src/hooks/useDeleteAccount.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

const { signOut, signOutAndVerify } = vi.hoisted(() => ({ signOut: vi.fn(), signOutAndVerify: vi.fn() }));
vi.mock('@clerk/expo', () => ({
    useAuth: () => ({ signOut }),
    useClerk: () => ({ signOut, loaded: true, status: 'ready', session: null }),
}));
vi.mock('../../src/hooks/useSignOutAndVerify.js', () => ({
    useSignOutAndVerify: () => ({ signOutAndVerify }),
}));

/** The recipe-side erasure call, and the ACCOUNT-level one (plan U2) — separate calls, both needed. */
const { erasureFn, accountEraseFn } = vi.hoisted(() => ({ erasureFn: vi.fn(), accountEraseFn: vi.fn() }));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
    useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
    useAllOwnerRecipes: vi.fn(),
    useRequestAccountErasure: () => useMutation({ mutationFn: (request: unknown) => erasureFn(request) }),
}));

// `useEraseAccount` is the ACCOUNT-level erasure (plan U2) — a different call from the recipe-side
// `useRequestAccountErasure` above, and the one that makes an erasure reach identity, Clerk and food.
// Its default double ACCEPTS, so the tests below exercise the exit path they are about.
vi.mock('../../src/hooks/useDeleteAccount.js', () => ({ useDeleteAccount: vi.fn() }));
vi.mock('../../src/hooks/useEraseAccount.js', () => ({
    useEraseAccount: () => useMutation({ mutationFn: () => accountEraseFn() }),
}));

const useRecipesMock = vi.mocked(useAllOwnerRecipes);
const useDeleteAccountMock = vi.mocked(useDeleteAccount);

const deleteMutate = vi.fn();

/** Render with a real `QueryClient`, which the erasure sequence's mutation needs. */
function renderZone(): ReturnType<typeof render> {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactElement }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    return render(<AccountDangerZone />, { wrapper: wrapper as never });
}

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

const { close, erase } = accountDangerMessages.en;
const { account } = mobileMessages.en;

function setDeleteAccount(state: { isPending?: boolean; isError?: boolean } = {}): void {
    useDeleteAccountMock.mockReturnValue({
        mutate: deleteMutate,
        isPending: state.isPending ?? false,
        isError: state.isError ?? false,
    } as unknown as ReturnType<typeof useDeleteAccount>);
}

beforeEach(() => {
    erasureFn.mockReset().mockResolvedValue(undefined);
    accountEraseFn.mockReset().mockResolvedValue(undefined);
    signOut.mockReset().mockResolvedValue(undefined);
    signOutAndVerify.mockReset().mockResolvedValue(undefined);
    deleteMutate.mockReset();
    setDeleteAccount();
    setRecipes([]);
});

afterEach(() => {
    systemScheme.current = null;
    cleanup();
});

describe('AccountDangerZone (native) — closure vs erasure are distinct', () => {
    it('offers both a recoverable close and an irreversible erase', () => {
        renderZone();

        expect(screen.getByRole('button', { name: 'Close account' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Erase my data' })).toBeTruthy();
    });
});

/**
 * ⚠️ REWRITTEN in UI-overhaul slice 9. The two triggers were design-system `Button`s (a neutral `secondary` tier and a
 * `destructive` tier, 44 pt floor, a spinner while busy). They are now the Profile page's `ProfileRow`s in the `danger`
 * tone (`buildSpec.md` §9.1): the label and the hint carry the danger, the row is 56 pt, and busy is a disabled row that
 * says so (`aria-busy`), not a spinner. Same two actions, same flows; only the surface changed.
 */
describe.each([
    ['light', role],
    ['dark', roleDark],
] as const)('AccountDangerZone (native) — the Profile danger rows (%s theme)', (name, roles) => {
    beforeEach(() => {
        systemScheme.current = name;
    });

    it('is a Danger zone group with both rows and each one’s consequence as its hint', () => {
        renderZone();

        expect(screen.getByRole('heading', { name: profileMessages.en.dangerZone, level: 2 })).toBeTruthy();
        expect(screen.getByText(close.rowHint)).toBeTruthy();
        expect(screen.getByText(erase.rowHint)).toBeTruthy();
    });

    it('paints both labels in dangerText and both hints in inkMuted, on role colours', () => {
        renderZone();

        for (const label of [close.trigger, erase.trigger]) {
            expect(window.getComputedStyle(screen.getByText(label)).color, label).toBe(rgb(roles.dangerText));
        }

        for (const hint of [close.rowHint, erase.rowHint]) {
            expect(window.getComputedStyle(screen.getByText(hint)).color, hint).toBe(rgb(roles.inkMuted));
        }
    });

    it('clears a 56 pt target on both rows', () => {
        renderZone();

        for (const label of [close.trigger, erase.trigger]) {
            const row = screen.getByRole('button', { name: label });

            expect(window.getComputedStyle(row).minHeight, label).toBe('56px');
        }
    });

    it('paints the closure failure alert in dangerText', () => {
        setDeleteAccount({ isError: true });
        renderZone();

        expect(window.getComputedStyle(screen.getByRole('alert')).color).toBe(rgb(roles.dangerText));
    });
});

describe('AccountDangerZone (native) — closing is busy-locked', () => {
    it('disables the closure row and says it is busy while in flight, so it cannot be double-fired', () => {
        // Idle: the row is live.
        const { unmount } = renderZone();
        expect(screen.getByRole('button', { name: close.trigger }).getAttribute('aria-busy')).not.toBe('true');
        unmount();

        setDeleteAccount({ isPending: true });
        renderZone();

        const busyRow = screen.getByRole('button', { name: close.busyLabel });
        expect(busyRow.getAttribute('aria-busy')).toBe('true');
        expect(busyRow.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(busyRow);
        expect(screen.queryByText(/not permanent deletion/i)).toBeNull();
        expect(deleteMutate).not.toHaveBeenCalled();
    });
});

describe('AccountDangerZone (native) — close (recoverable)', () => {
    it('confirms closure with recoverable copy, not permanent deletion', () => {
        renderZone();

        fireEvent.click(screen.getByRole('button', { name: 'Close account' }));

        expect(screen.getByText(/not permanent deletion/i)).toBeTruthy();
        expect(screen.queryByText(/permanently deleted/i)).toBeNull();
    });

    it('closes the account on confirm', () => {
        renderZone();

        fireEvent.click(screen.getByRole('button', { name: 'Close account' }));
        const confirms = screen.getAllByRole('button', { name: 'Close account' });
        fireEvent.click(confirms[confirms.length - 1] as HTMLElement);

        expect(deleteMutate).toHaveBeenCalledTimes(1);
    });

    it('reports a FAILED closure instead of stopping silently (B17)', () => {
        setDeleteAccount({ isError: true });
        renderZone();

        expect(screen.getByRole('alert').textContent).toBe(close.error);
    });

    it('shows no closure alert while nothing has failed', () => {
        renderZone();

        expect(screen.queryByText(close.error)).toBeNull();
    });
});

describe('AccountDangerZone (native) — erase (irreversible)', () => {
    it('offers only owner-only recipes for the donate election', () => {
        setRecipes([
            makeRecipe('pub', 'Public Published', 'public', 'published'),
            makeRecipe('priv', 'Private Published', 'private', 'published'),
        ]);
        renderZone();

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));

        expect(screen.getByRole('checkbox', { name: 'Private Published' })).toBeTruthy();
        expect(screen.queryByRole('checkbox', { name: 'Public Published' })).toBeNull();
    });

    /** Drive the erasure flow to its confirmed state, with `priv` elected for donation. */
    function confirmErasure(): void {
        setRecipes([makeRecipe('priv', 'Private Published', 'private', 'published')]);
        renderZone();

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Private Published' }));
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'ERASE MY DATA' } });

        const eraseButtons = screen.getAllByRole('button', { name: 'Erase my data' });
        fireEvent.click(eraseButtons[eraseButtons.length - 1] as HTMLElement);
    }

    /**
     * ⛔ THE REGRESSION (review P1 #3), pinned on mobile as well as web. Recipes, account and sign-out used to be
     * chained through `onSuccess` observer callbacks, which TanStack drops once the screen unmounts: leaving the
     * danger zone during the recipe step erased the recipes and then never deleted the account or ended the session.
     */
    it('⛔ still erases the account and ends the session when the screen unmounts during the recipe step', async () => {
        let finishRecipes!: () => void;
        erasureFn.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishRecipes = resolve;
                }),
        );
        confirmErasure();
        await waitFor(() => expect(erasureFn).toHaveBeenCalledTimes(1));

        cleanup();
        finishRecipes();

        await waitFor(() => expect(accountEraseFn).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(signOutAndVerify).toHaveBeenCalledTimes(1));
    });

    /**
     * ⛔ THE REGRESSION (plan U2), pinned on mobile as well as web — the cross-platform rule exists because
     * a fix applied to one platform is exactly the kind that silently misses the other.
     *
     * "Erase my data" used to call the RECIPE service and nothing else, then sign the viewer out. That looks
     * like success while the identity row, the Clerk account, the avatar and food's rows all survive.
     */
    it('ALSO erases the account itself, not only the recipes', async () => {
        confirmErasure();

        await waitFor(() => expect(accountEraseFn).toHaveBeenCalledTimes(1));
        expect(erasureFn).toHaveBeenCalledTimes(1);
    });

    it('runs recipes, then account, then the sign-out — in that order', async () => {
        confirmErasure();

        await waitFor(() => expect(signOutAndVerify).toHaveBeenCalledTimes(1));
        const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0] ?? 0;
        expect(order(erasureFn)).toBeLessThan(order(accountEraseFn));
        expect(order(accountEraseFn)).toBeLessThan(order(signOutAndVerify));
    });

    /**
     * ⛔ THE FLOW STAYS BUSY UNTIL THE VIEWER HAS LEFT, as on web. Both legs answering ends both erasure calls
     * while the sign-out still runs; an idle dialog then offered Confirm again (a second recipe leg against an
     * erased account) and Cancel.
     */
    it('⛔ keeps Confirm busy and Cancel disabled while the sign-out runs', async () => {
        signOutAndVerify.mockImplementation(() => new Promise<void>(() => undefined));
        confirmErasure();
        await waitFor(() => expect(signOutAndVerify).toHaveBeenCalledTimes(1));

        const eraseButtons = screen.getAllByRole('button', { name: 'Erase my data' });
        expect(eraseButtons[eraseButtons.length - 1]?.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('aria-disabled')).toBe('true');
        expect(erasureFn).toHaveBeenCalledTimes(1);
    });

    it('does NOT sign the viewer out when the account erasure fails — the account still exists', async () => {
        accountEraseFn.mockRejectedValue(new Error('500'));
        confirmErasure();

        expect(await screen.findByText(erase.error)).toBeTruthy();
        expect(accountEraseFn).toHaveBeenCalledTimes(1);
        expect(signOutAndVerify).not.toHaveBeenCalled();
    });

    it('does NOT touch the account or the session when the recipe erasure fails', async () => {
        erasureFn.mockRejectedValue(new Error('503'));
        confirmErasure();

        expect(await screen.findByText(erase.error)).toBeTruthy();
        expect(accountEraseFn).not.toHaveBeenCalled();
        expect(signOutAndVerify).not.toHaveBeenCalled();
    });

    it('erases with the typed phrase + donate election, then signs out on success', async () => {
        confirmErasure();

        await waitFor(() => expect(erasureFn).toHaveBeenCalledTimes(1));
        expect(erasureFn.mock.calls[0]?.[0]).toEqual({
            confirmationPhrase: 'ERASE MY DATA',
            publishRecipeIds: ['priv'],
        });
        // The app's one sign-out COMMAND — a raw `signOut()` has no failure path and no post-condition.
        await waitFor(() => expect(signOutAndVerify).toHaveBeenCalledTimes(1));
        expect(signOut).not.toHaveBeenCalled();
    });

    it('reports an accepted erasure whose sign-out FAILED, without claiming the erasure failed', async () => {
        signOutAndVerify.mockRejectedValue(new Error('sign-out did not take effect: session sess_live is active'));
        confirmErasure();

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe(account.eraseSignOutFailed);
        // The erasure DID succeed (202), so inviting a retry of it would be a lie.
        expect(screen.queryByText(erase.error)).toBeNull();
        // …and the raw error never reaches the viewer.
        expect(screen.queryByText(/sess_live/)).toBeNull();
    });

    it('dismisses the now-dead dialog when the exit fails, and offers signing out as the recovery', async () => {
        signOutAndVerify.mockRejectedValue(new Error('nope'));
        confirmErasure();

        await screen.findByRole('alert');
        // The dialog would otherwise trap focus inside a flow whose account no longer exists.
        expect(screen.queryByLabelText('Confirmation phrase')).toBeNull();
        expect(screen.getByRole('button', { name: profileMessages.en.signOut })).toBeTruthy();
    });

    it('does not erase while the phrase gate is unsatisfied', () => {
        renderZone();

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));
        const eraseButtons = screen.getAllByRole('button', { name: 'Erase my data' });
        fireEvent.click(eraseButtons[eraseButtons.length - 1] as HTMLElement);

        expect(erasureFn).not.toHaveBeenCalled();
    });
});

/**
 * ⛔ THE SECOND LEG'S OWN STATES (plan U2), pinned on mobile as well as web.
 *
 * The erasure is TWO calls — recipes, then the account — and the dialog's `submitting`/`submitError` cover
 * both. Cases that drive only the RECIPE leg would stay green if the account leg's states were dropped. Not cosmetic:
 *
 * - Without the busy state, the destructive confirm is re-enabled the instant the recipe leg resolves, while
 *   the ACCOUNT erasure is still in flight. A second tap fires a second irreversible request.
 * - Without the error state, an account-erasure FAILURE is completely silent: the recipes are gone, the account
 *   is not, and the dialog says nothing — the "looks like it worked" shape U2 exists to eliminate.
 */
describe('AccountDangerZone (native) — the ACCOUNT-erasure leg has its own busy and error states', () => {
    it('stays busy while the ACCOUNT erasure is in flight, even once the recipe leg has resolved', async () => {
        accountEraseFn.mockImplementation(() => new Promise<void>(() => undefined));
        renderZone();

        fireEvent.click(screen.getByRole('button', { name: erase.trigger }));
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'ERASE MY DATA' } });
        const idleConfirms = screen.getAllByRole('button', { name: erase.confirm });
        fireEvent.click(idleConfirms[idleConfirms.length - 1] as HTMLElement);
        await waitFor(() => expect(accountEraseFn).toHaveBeenCalledTimes(1));

        expect(screen.getByText(erase.busyLabel)).toBeTruthy();
        const confirms = screen.getAllByRole('button', { name: erase.confirm });
        const confirm = confirms[confirms.length - 1] as HTMLElement;
        expect(confirm.getAttribute('aria-disabled')).toBe('true');
    });

    it('surfaces a FAILED account erasure, not just a failed recipe erasure (B17)', async () => {
        accountEraseFn.mockRejectedValue(new Error('500'));
        renderZone();

        fireEvent.click(screen.getByRole('button', { name: erase.trigger }));
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'ERASE MY DATA' } });
        const confirms = screen.getAllByRole('button', { name: erase.confirm });
        fireEvent.click(confirms[confirms.length - 1] as HTMLElement);

        expect(await screen.findByText(erase.error)).toBeTruthy();
    });
});
