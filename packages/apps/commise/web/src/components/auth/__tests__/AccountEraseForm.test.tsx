// @vitest-environment jsdom
/**
 * Orchestration tests for the account ERASURE container (web; CR-002 / U4b). The pure dialog's own state
 * matrix is covered in `@commise/features-account`; here we verify the WIRING: the flow is deferred until
 * opened, the recipe fetch feeds the donate election (filtered to owner-only), the confirm sends the typed
 * phrase + the donate election to the erasure mutation, a success signs the viewer out, and the mutation's
 * pending/error state reaches the dialog. Plus the FAKE-EXIT path (B23: a sign-out issued before clerk-js loads
 * resolves without revoking anything, so the exit must report a failure rather than look like success).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { signOut, clerkState } = vi.hoisted(() => ({
    signOut: vi.fn(),
    clerkState: {
        loaded: true,
        status: 'ready' as 'degraded' | 'error' | 'loading' | 'ready',
        session: null as { id: string } | null | undefined,
    },
}));
// `useAuth().signOut` is Clerk's LOAD-SAFE wrapper — the one the sign-out command must use (B23). `useClerk()`
// only supplies the load/session state the command's fail-closed post-condition reads.
vi.mock('@clerk/nextjs', () => ({
    useClerk: () => ({
        get loaded() {
            return clerkState.loaded;
        },
        get status() {
            return clerkState.status;
        },
        get session() {
            return clerkState.session;
        },
    }),
    useAuth: () => ({ signOut }),
}));

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('@/lib/navigation', () => ({ navigateTo }));

const recipesState = vi.hoisted(() => ({
    current: { recipes: [] as unknown[], isLoading: false, isError: false },
}));
const { erasureMutate } = vi.hoisted(() => ({ erasureMutate: vi.fn() }));
const erasureState = vi.hoisted(() => ({ current: { isPending: false, isError: false } }));
const { accountEraseMutate } = vi.hoisted(() => ({ accountEraseMutate: vi.fn() }));
const accountEraseState = vi.hoisted(() => ({ current: { isPending: false, isError: false } }));

// The ACCOUNT-level erasure (plan U2) — doubled at the same seam as its recipe-side sibling above. The two
// calls are separate on purpose: recipe erases recipes, identity erases the account and fans out to every
// other service, and the flow is only complete when BOTH are accepted.
vi.mock('@/components/auth/useEraseAccount', () => ({
    useEraseAccount: () => ({ mutate: accountEraseMutate, ...accountEraseState.current }),
}));

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
    signOut.mockReset().mockImplementation(async () => {
        clerkState.loaded = true;
        clerkState.session = null;
    });
    navigateTo.mockReset();
    erasureMutate.mockReset();
    // Default: the account erasure is ACCEPTED, so the tests below exercise the exit path they are about.
    // The suites that care about this call failing set their own implementation.
    accountEraseMutate.mockReset().mockImplementation((_input, options) => options?.onSuccess?.());
    accountEraseState.current = { isPending: false, isError: false };
    recipesState.current = { recipes: [], isLoading: false, isError: false };
    erasureState.current = { isPending: false, isError: false };
    clerkState.loaded = true;
    clerkState.status = 'ready';
    clerkState.session = { id: 'sess_live' };
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

describe('AccountEraseForm (web) — the exit RESOLVED without ending the session (B23)', () => {
    it('takes the failed-exit path instead of dropping a still-authenticated viewer on the public page', async () => {
        // Exactly the premount no-op: the sign-out resolves, nothing is revoked, the session stays live.
        signOut.mockResolvedValueOnce(undefined);
        erasureMutate.mockImplementation((_request: unknown, options?: { onSuccess?: () => void }) =>
            options?.onSuccess?.(),
        );
        const user = await openFlow();

        await user.type(screen.getByLabelText('Confirmation phrase'), 'ERASE MY DATA');
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erase my data' }));

        expect(await screen.findByRole('alert')).toHaveProperty(
            'textContent',
            'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
        );
        expect(navigateTo).not.toHaveBeenCalled();
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
    /**
     * ⛔ THE REGRESSION THIS SUITE EXISTS TO PREVENT (plan U2).
     *
     * "Erase my data" used to call the RECIPE service and nothing else, then sign the viewer out. That
     * looked exactly like success — dialog closes, viewer leaves — while the identity row, the Clerk
     * account, the avatar object and food's requester rows were all untouched. The user could sign straight
     * back in to the account they had just been told was destroyed.
     *
     * These two tests pin both halves of the fix: the account-level call is MADE, and the viewer is NOT
     * signed out when it fails. The second is the one that matters — signing out on a failed erasure is
     * precisely what made the old bug invisible, because the viewer never saw the account survive.
     */
    it('ALSO erases the account itself, not only the recipes', async () => {
        erasureMutate.mockImplementation((_request: unknown, options?: { onSuccess?: () => void }) =>
            options?.onSuccess?.(),
        );
        const user = await openFlow();

        await user.type(screen.getByLabelText('Confirmation phrase'), 'ERASE MY DATA');
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erase my data' }));

        expect(erasureMutate).toHaveBeenCalledTimes(1);
        expect(accountEraseMutate).toHaveBeenCalledTimes(1);
    });

    it('does NOT sign the viewer out when the account erasure fails — the account still exists', async () => {
        erasureMutate.mockImplementation((_request: unknown, options?: { onSuccess?: () => void }) =>
            options?.onSuccess?.(),
        );
        // The recipe leg succeeded, the account leg did not: the account is still there, so ending the
        // session here would strand the user with no signal that their erasure did not happen.
        accountEraseMutate.mockImplementation(() => undefined);
        const user = await openFlow();

        await user.type(screen.getByLabelText('Confirmation phrase'), 'ERASE MY DATA');
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erase my data' }));

        expect(accountEraseMutate).toHaveBeenCalledTimes(1);
        expect(signOut).not.toHaveBeenCalled();
        expect(navigateTo).not.toHaveBeenCalled();
    });

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
        // Sign out FIRST (awaited, so the session cookies are gone), THEN leave with a FULL-DOCUMENT
        // navigation: a client-side router push would re-render the authenticated shell from a payload
        // resolved for a session — and an account — that no longer exists.
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
        expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(navigateTo.mock.invocationCallOrder[0] ?? 0);
    });

    it('does not submit while the phrase gate is unsatisfied', async () => {
        const user = await openFlow();

        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erase my data' }));

        expect(erasureMutate).not.toHaveBeenCalled();
    });
});

/**
 * The post-202 exit was fire-and-forget: `onSuccess: () => void leaveSignedOut()`. If `signOut` (or the
 * navigation) failed AFTER the erasure had already been accepted, the rejection was swallowed and the viewer
 * was stranded on an authenticated account page for an account that no longer exists — with no feedback and
 * no way to tell whether the erasure had happened.
 *
 * The copy here is deliberately NOT the dialog's `submitError` ("we couldn't START erasing…") — the erasure
 * DID succeed, so inviting a retry of it would be a lie. The one outstanding action is to leave the session,
 * so the recovery IS a sign-out control.
 */
describe('AccountEraseForm (web) — a failed exit AFTER the erasure was accepted', () => {
    beforeEach(() => {
        erasureMutate.mockImplementation((_request: unknown, options?: { onSuccess?: () => void }) =>
            options?.onSuccess?.(),
        );
    });

    /** Accept the erasure (mutation succeeds), with the sign-out rejecting. */
    async function eraseWithFailedSignOut(): Promise<void> {
        const user = await openFlow();

        await user.type(screen.getByLabelText('Confirmation phrase'), 'ERASE MY DATA');
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erase my data' }));
    }

    it('surfaces a distinct alert (and a sign-out escape) when the sign-out rejects', async () => {
        signOut.mockReset().mockRejectedValue(new Error('clerk unreachable'));

        await eraseWithFailedSignOut();

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe(
            'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
        );
        // The viewer is not left with a dead page: the recovery is the ordinary sign-out control.
        expect(screen.getByRole('button', { name: 'Sign out of your account' })).toBeTruthy();
        // And the dead dialog is dismissed — it would otherwise trap focus away from the alert.
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('surfaces the same alert when the sign-out resolves but the navigation throws', async () => {
        navigateTo.mockImplementation(() => {
            throw new Error('navigation blocked');
        });

        await eraseWithFailedSignOut();

        expect((await screen.findByRole('alert')).textContent).toBe(
            'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
        );
    });

    it('shows no such alert on the happy path', async () => {
        await eraseWithFailedSignOut();

        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
        expect(screen.queryByRole('alert')).toBeNull();
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

/**
 * ⛔ THE SECOND LEG'S OWN STATES (plan U2). The erasure is TWO calls — recipes, then the account — and the
 * dialog's `submitting`/`submitError` are the OR of both. Every case above drives only the RECIPE leg, so
 * narrowing `submitting={erasure.isPending || accountErasure.isPending}` to `submitting={erasure.isPending}`
 * (and the same for `submitError`) left the whole suite green — verified by mutation. That is not cosmetic:
 *
 * - Without the busy arm, the confirm control is re-enabled the instant the recipe leg resolves, while the
 *   ACCOUNT erasure is still in flight. A viewer clicking again fires a second irreversible request.
 * - Without the error arm, an account-erasure FAILURE is completely silent. The dialog just sits there: the
 *   recipes are already gone, the account is not, and nothing on screen says so — which is exactly the
 *   "looks like it worked" shape U2 exists to eliminate.
 */
describe('AccountEraseForm (web) — the ACCOUNT-erasure leg has its own busy and error states', () => {
    it('stays busy while the ACCOUNT erasure is in flight, even once the recipe leg has resolved', async () => {
        erasureState.current = { isPending: false, isError: false };
        accountEraseState.current = { isPending: true, isError: false };
        await openFlow();

        await user_typePhrase();

        expect(screen.getByText('Erasing…')).toBeTruthy();
        // …and the destructive control cannot be fired a second time while it is.
        const confirm = within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', {
            name: 'Erase my data',
        });
        expect(confirm.disabled).toBe(true);
        expect(confirm.getAttribute('aria-busy')).toBe('true');
    });

    it('surfaces a FAILED account erasure, not just a failed recipe erasure (B17)', async () => {
        erasureState.current = { isPending: false, isError: false };
        accountEraseState.current = { isPending: false, isError: true };
        await openFlow();

        expect(screen.getByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t start erasing your data. Please try again.',
        );
    });
});

/** Type the exact confirmation phrase into the open dialog, satisfying the gate. */
async function user_typePhrase(): Promise<void> {
    await userEvent.setup().type(screen.getByLabelText('Confirmation phrase'), 'ERASE MY DATA');
}
