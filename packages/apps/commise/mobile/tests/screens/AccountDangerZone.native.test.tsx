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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAllOwnerRecipes, useRequestAccountErasure } from '@kitchensink/recipe-service-client/hooks';
import { palette } from '@commise/ui';
import { accountDangerMessages } from '@commise/features-account/danger';

import { AccountDangerZone } from '../../src/components/account/AccountDangerZone.js';
import { mobileMessages } from '../../src/i18n/messages.js';
import { useDeleteAccount } from '../../src/hooks/useUserProfile.js';

const { signOut, signOutAndVerify } = vi.hoisted(() => ({ signOut: vi.fn(), signOutAndVerify: vi.fn() }));
vi.mock('@clerk/expo', () => ({
    useAuth: () => ({ signOut }),
    useClerk: () => ({ signOut, loaded: true, status: 'ready', session: null }),
}));
vi.mock('../../src/hooks/useSignOutAndVerify.js', () => ({
    useSignOutAndVerify: () => ({ signOutAndVerify }),
}));

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
    signOut.mockReset().mockResolvedValue(undefined);
    signOutAndVerify.mockReset().mockResolvedValue(undefined);
    deleteMutate.mockReset();
    erasureMutate.mockReset();
    setDeleteAccount();
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

describe('AccountDangerZone (native) — design-system surfaces (U4b)', () => {
    it('paints the close trigger as the coral-outlined secondary tier, on palette', () => {
        render(<AccountDangerZone />);

        const trigger = screen.getByRole('button', { name: close.trigger });

        // The label is the tier's slate — NOT the off-palette `#2C3E50` the hand-rolled Pressable used, and
        // not the mockups' coral-as-text (2.40:1, below the WCAG-AA floor the DS tier holds at 5.24:1).
        expect(window.getComputedStyle(screen.getByText(close.trigger)).color).toBe(rgb(palette.slate));
        // …and its surface carries the design system's own accent edge, not an inlined mist hex.
        expect(borderColours(trigger)).toContain(rgb(palette.coral));
    });

    it('paints the erase trigger as the destructive tier, on palette', () => {
        render(<AccountDangerZone />);

        const trigger = screen.getByRole('button', { name: erase.trigger });

        // `palette.error`, NOT the off-palette `#E74C3C`.
        expect(window.getComputedStyle(screen.getByText(erase.trigger)).color).toBe(rgb(palette['error-dark']));
        expect(borderColours(trigger)).toContain(rgb(palette.error));
    });

    it('clears the 44pt touch floor on both triggers (U4 / RC-3)', () => {
        render(<AccountDangerZone />);

        for (const name of [close.trigger, erase.trigger]) {
            const trigger = screen.getByRole('button', { name });
            const surface = [trigger, ...Array.from(trigger.querySelectorAll<HTMLElement>('*'))].find(
                (node) => window.getComputedStyle(node).minHeight === '44px',
            );

            expect(surface, `${name} does not reach a 44pt target`).toBeDefined();
        }
    });

    it('shows the design-system busy spinner while the closure is in flight', () => {
        // Idle: no progress indicator anywhere. (The spinner lives in the Button's aria-hidden icon slot, so
        // it is queried with `hidden` — busy is announced through accessibilityState.busy.)
        const { unmount } = render(<AccountDangerZone />);
        expect(screen.queryByRole('progressbar', { hidden: true })).toBeNull();
        unmount();

        setDeleteAccount({ isPending: true });
        render(<AccountDangerZone />);

        // A real spinner, not merely a swapped label — and the control is out of action while in flight.
        expect(screen.getByRole('progressbar', { hidden: true })).toBeTruthy();
        const busyTrigger = screen.getByRole('button', { name: close.busyLabel });
        expect(busyTrigger.getAttribute('aria-disabled')).toBe('true');

        fireEvent.click(busyTrigger);
        expect(deleteMutate).not.toHaveBeenCalled();
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

    it('reports a FAILED closure instead of stopping silently (B17)', () => {
        setDeleteAccount({ isError: true });
        render(<AccountDangerZone />);

        expect(screen.getByRole('alert').textContent).toBe(close.error);
    });

    it('shows no closure alert while nothing has failed', () => {
        render(<AccountDangerZone />);

        expect(screen.queryByText(close.error)).toBeNull();
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

    /** Drive the erasure flow to its confirmed state, with `priv` elected for donation. */
    function confirmErasure(): void {
        setRecipes([makeRecipe('priv', 'Private Published', 'private', 'published')]);
        render(<AccountDangerZone />);

        fireEvent.click(screen.getByRole('button', { name: 'Erase my data' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Private Published' }));
        fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'ERASE MY DATA' } });

        const eraseButtons = screen.getAllByRole('button', { name: 'Erase my data' });
        fireEvent.click(eraseButtons[eraseButtons.length - 1] as HTMLElement);
    }

    it('erases with the typed phrase + donate election, then signs out on success', async () => {
        erasureMutate.mockImplementation((_request: unknown, options?: { onSuccess?: () => void }) =>
            options?.onSuccess?.(),
        );
        confirmErasure();

        expect(erasureMutate).toHaveBeenCalledTimes(1);
        expect(erasureMutate.mock.calls[0]?.[0]).toEqual({
            confirmationPhrase: 'ERASE MY DATA',
            publishRecipeIds: ['priv'],
        });
        // The app's one sign-out COMMAND — a raw `signOut()` has no failure path and no post-condition.
        await waitFor(() => expect(signOutAndVerify).toHaveBeenCalledTimes(1));
        expect(signOut).not.toHaveBeenCalled();
    });

    it('reports an accepted erasure whose sign-out FAILED, without claiming the erasure failed', async () => {
        erasureMutate.mockImplementation((_request: unknown, options?: { onSuccess?: () => void }) =>
            options?.onSuccess?.(),
        );
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
        erasureMutate.mockImplementation((_request: unknown, options?: { onSuccess?: () => void }) =>
            options?.onSuccess?.(),
        );
        signOutAndVerify.mockRejectedValue(new Error('nope'));
        confirmErasure();

        await screen.findByRole('alert');
        // The dialog would otherwise trap focus inside a flow whose account no longer exists.
        expect(screen.queryByLabelText('Confirmation phrase')).toBeNull();
        expect(screen.getByRole('button', { name: account.signOutAction })).toBeTruthy();
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

/** A design-token hex (`#RRGGBB`) as the `rgb(r, g, b)` string a resolved computed style reports. */
function rgb(hex: string): string {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

    return `rgb(${channels.join(', ')})`;
}

/**
 * Every border colour resolved anywhere in `root`'s subtree. react-native-web compiles a `StyleSheet`
 * `borderColor` to an atomic class, so the honest read is the computed style of each candidate node — the
 * button's visible surface is whichever descendant carries the tier's border.
 */
function borderColours(root: HTMLElement): readonly string[] {
    return [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))].map(
        (node) => window.getComputedStyle(node).borderTopColor,
    );
}
