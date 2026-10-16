// @vitest-environment jsdom
/**
 * Orchestration tests for the account ERASURE container (web; CR-002 / U4b). The pure dialog's own state
 * matrix is covered in `@commise/features-account`; here we verify the WIRING: the flow is deferred until
 * opened, the recipe fetch feeds the donate election (filtered to owner-only), the confirm sends the typed
 * phrase + the donate election to the erasure, recipes then account then sign-out run in order, and each step's
 * pending/error state reaches the dialog. Plus the FAKE-EXIT path (B23: a sign-out issued before clerk-js loads
 * resolves without revoking anything, so the exit must report a failure rather than look like success).
 *
 * The two erasure calls are doubled with REAL `useMutation`s over controllable functions, not with `mutate`
 * stubs that fire `onSuccess` by hand: the defect this suite pins (review P1 #3) is that TanStack drops
 * observer callbacks after unmount, and a hand-fired stub cannot drop anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GoneError } from '@kitchensink/recipe-service-client';
import type { ReactNode } from 'react';

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
/** The recipe-side erasure call, and the ACCOUNT-level one (plan U2) — separate on purpose: recipe erases recipes,
 * identity erases the account and fans out, and the flow is only complete when BOTH are accepted. */
const { erasureFn, accountEraseFn } = vi.hoisted(() => ({ erasureFn: vi.fn(), accountEraseFn: vi.fn() }));

vi.mock('@/components/auth/useEraseAccount', async () => {
    const { useMutation } = await import('@tanstack/react-query');

    return { useEraseAccount: () => useMutation({ mutationFn: () => accountEraseFn() }) };
});

// The election consumes the FULL owner list (paged to completion) — see useAllOwnerRecipes. A capped
// single-page hook would silently omit (and then erasure would destroy) owner-only recipes past the cap.
vi.mock('@kitchensink/recipe-service-client/hooks', async () => {
    const { useMutation } = await import('@tanstack/react-query');

    return {
        // U5 — the analytics emitter's context read; a resolved stub keeps emission inert in leaf tests.
        useRecipeServiceClient: () => ({ emitAnalyticsEvents: async () => undefined }),
        useAllOwnerRecipes: () => recipesState.current,
        useRequestAccountErasure: () => useMutation({ mutationFn: (request: unknown) => erasureFn(request) }),
    };
});

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
    // Default: both erasure calls are ACCEPTED, so the tests below exercise the step they are about.
    erasureFn.mockReset().mockResolvedValue(undefined);
    accountEraseFn.mockReset().mockResolvedValue(undefined);
    recipesState.current = { recipes: [], isLoading: false, isError: false };
    clerkState.loaded = true;
    clerkState.status = 'ready';
    clerkState.session = { id: 'sess_live' };
});

afterEach(cleanup);

const { AccountEraseForm } = await import('../AccountEraseForm');

function renderForm() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    return render(<AccountEraseForm />, { wrapper });
}

async function openFlow(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Erase my data' }));

    return user;
}

/** Type the exact phrase and press the destructive confirm. */
async function confirmErasure(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.type(screen.getByLabelText('Confirmation phrase'), 'ERASE MY DATA');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erase my data' }));
}

describe('AccountEraseForm (web) — deferral', () => {
    it('renders only the trigger until opened (the recipe fetch is not shown)', () => {
        renderForm();

        expect(screen.getByRole('button', { name: 'Erase my data' })).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens the erasure dialog on trigger activation', async () => {
        await openFlow();

        expect(screen.getByRole('dialog', { name: 'Erase my data' })).toBeTruthy();
    });
});

/**
 * ⛔ THE REGRESSION (review P1 #3). Recipes, account and sign-out used to be chained through `onSuccess` observer
 * callbacks, which TanStack drops once the form unmounts. A browser Back or route change during the recipe step
 * therefore erased the recipes and then never deleted the account or ended the session.
 */
describe('AccountEraseForm (web) — the form unmounting mid-erasure', () => {
    it('⛔ still erases the account and ends the session when the form unmounts during the recipe step', async () => {
        let finishRecipes!: () => void;
        erasureFn.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishRecipes = resolve;
                }),
        );
        const user = await openFlow();
        await confirmErasure(user);
        await vi.waitFor(() => expect(erasureFn).toHaveBeenCalledTimes(1));

        cleanup();
        finishRecipes();

        await vi.waitFor(() => expect(accountEraseFn).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
    });
});

describe('AccountEraseForm (web) — the exit RESOLVED without ending the session (B23)', () => {
    it('takes the failed-exit path instead of dropping a still-authenticated viewer on the public page', async () => {
        // Exactly the premount no-op: the sign-out resolves, nothing is revoked, the session stays live.
        signOut.mockResolvedValueOnce(undefined);
        const user = await openFlow();

        await confirmErasure(user);

        expect(await screen.findByRole('alert')).toHaveProperty(
            'textContent',
            'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
        );
        expect(navigateTo).not.toHaveBeenCalled();
    });
});

/**
 * ⛔ THE FLOW STAYS BUSY UNTIL THE VIEWER HAS LEFT. Both legs answering ends both erasure calls, but the
 * sign-out is still running; a dialog that went idle then offered Confirm again (a second recipe leg, against an
 * account already erased) and Cancel.
 */
describe('AccountEraseForm (web) — busy through the sign-out', () => {
    it('⛔ keeps Confirm blocked and Cancel disabled while the sign-out runs', async () => {
        signOut.mockImplementation(() => new Promise<void>(() => undefined));
        const user = await openFlow();

        await confirmErasure(user);
        await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('button', { name: 'Erase my data' }).getAttribute('aria-busy')).toBe('true');
        expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true);
        expect(erasureFn).toHaveBeenCalledTimes(1);
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
     * These tests pin both halves of the fix: the account-level call is MADE, and the viewer is NOT
     * signed out when it fails. The second is the one that matters — signing out on a failed erasure is
     * precisely what made the old bug invisible, because the viewer never saw the account survive.
     */
    it('ALSO erases the account itself, not only the recipes', async () => {
        const user = await openFlow();

        await confirmErasure(user);

        await vi.waitFor(() => expect(accountEraseFn).toHaveBeenCalledTimes(1));
        expect(erasureFn).toHaveBeenCalledTimes(1);
    });

    it('does NOT sign the viewer out when the account erasure fails — the account still exists', async () => {
        // The recipe leg succeeded, the account leg did not: the account is still there, so ending the
        // session here would strand the user with no signal that their erasure did not happen.
        accountEraseFn.mockRejectedValue(new Error('500'));
        const user = await openFlow();

        await confirmErasure(user);

        expect(await screen.findByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t start erasing your data. Please try again.',
        );
        expect(signOut).not.toHaveBeenCalled();
        expect(navigateTo).not.toHaveBeenCalled();
    });

    it('reaches the account step on a retry whose recipe leg answers 410 ALREADY_ERASED', async () => {
        // First attempt: the recipe job is accepted, the account leg fails. By the retry the recipe job has completed,
        // so the service answers 410 instead of 202 — which must count as done, or the account can never be erased.
        accountEraseFn.mockRejectedValueOnce(new Error('500'));
        const user = await openFlow();
        await confirmErasure(user);
        await screen.findByRole('alert');

        erasureFn.mockRejectedValue(new GoneError('Account has already been erased', 'ACCOUNT_ALREADY_ERASED'));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erase my data' }));

        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
        expect(accountEraseFn).toHaveBeenCalledTimes(2);
    });

    it('does NOT touch the account or the session when the recipe erasure fails', async () => {
        erasureFn.mockRejectedValue(new Error('503'));
        const user = await openFlow();

        await confirmErasure(user);

        expect(await screen.findByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t start erasing your data. Please try again.',
        );
        expect(accountEraseFn).not.toHaveBeenCalled();
        expect(signOut).not.toHaveBeenCalled();
    });

    it('runs recipes, then account, then sign-out, then leaves — in that order', async () => {
        const user = await openFlow();

        await confirmErasure(user);

        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
        const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0] ?? 0;
        expect(order(erasureFn)).toBeLessThan(order(accountEraseFn));
        expect(order(accountEraseFn)).toBeLessThan(order(signOut));
        expect(order(signOut)).toBeLessThan(order(navigateTo));
    });

    it('sends the typed phrase and the donate election, then signs out on success', async () => {
        recipesState.current = {
            recipes: [makeRecipe('priv', 'Private Published', 'private', 'published')],
            isLoading: false,
            isError: false,
        };
        const user = await openFlow();

        await user.click(screen.getByRole('checkbox', { name: 'Private Published' }));
        await confirmErasure(user);

        expect(erasureFn).toHaveBeenCalledTimes(1);
        expect(erasureFn.mock.calls[0]?.[0]).toEqual({
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

        expect(erasureFn).not.toHaveBeenCalled();
    });
});

/**
 * The post-202 exit used to be fire-and-forget. If `signOut` (or the navigation) failed AFTER the erasure had
 * already been accepted, the rejection was swallowed and the viewer was stranded on an authenticated account page
 * for an account that no longer exists — with no feedback and no way to tell whether the erasure had happened.
 *
 * The copy here is deliberately NOT the dialog's `submitError` ("we couldn't START erasing…") — the erasure
 * DID succeed, so inviting a retry of it would be a lie. The one outstanding action is to leave the session,
 * so the recovery IS a sign-out control.
 */
describe('AccountEraseForm (web) — a failed exit AFTER the erasure was accepted', () => {
    /** Accept the erasure (both calls succeed), with the sign-out as the test configured it. */
    async function erase(): Promise<void> {
        const user = await openFlow();

        await confirmErasure(user);
    }

    it('surfaces a distinct alert (and a sign-out escape) when the sign-out rejects', async () => {
        signOut.mockReset().mockRejectedValue(new Error('clerk unreachable'));

        await erase();

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe(
            'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
        );
        // The viewer is not left with a dead page: the recovery is the ordinary sign-out control.
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
        // And the dead dialog is dismissed — it would otherwise trap focus away from the alert.
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('surfaces the same alert when the sign-out resolves but the navigation throws', async () => {
        navigateTo.mockImplementation(() => {
            throw new Error('navigation blocked');
        });

        await erase();

        expect((await screen.findByRole('alert')).textContent).toBe(
            'Your data is being erased, but we couldn’t sign you out. Sign out to finish leaving this account.',
        );
    });

    it('shows no such alert on the happy path', async () => {
        await erase();

        await vi.waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/'));
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('AccountEraseForm (web) — step state', () => {
    it('reflects the recipe step in flight as busy', async () => {
        erasureFn.mockImplementation(() => new Promise<void>(() => undefined));
        const user = await openFlow();

        await confirmErasure(user);

        expect(await screen.findByText('Erasing…')).toBeTruthy();
    });
});

/**
 * ⛔ THE SECOND LEG'S OWN STATES (plan U2). The erasure is TWO calls — recipes, then the account — and the
 * dialog's `submitting`/`submitError` cover both. Every case above that drives only the RECIPE leg would stay
 * green if the account leg's busy and error states were dropped; that is not cosmetic:
 *
 * - Without the busy arm, the confirm control is re-enabled the instant the recipe leg resolves, while the
 *   ACCOUNT erasure is still in flight. A viewer clicking again fires a second irreversible request.
 * - Without the error arm, an account-erasure FAILURE is completely silent. The dialog just sits there: the
 *   recipes are already gone, the account is not, and nothing on screen says so — which is exactly the
 *   "looks like it worked" shape U2 exists to eliminate.
 */
describe('AccountEraseForm (web) — the ACCOUNT-erasure leg has its own busy and error states', () => {
    it('stays busy while the ACCOUNT erasure is in flight, even once the recipe leg has resolved', async () => {
        accountEraseFn.mockImplementation(() => new Promise<void>(() => undefined));
        const user = await openFlow();

        await confirmErasure(user);
        await vi.waitFor(() => expect(accountEraseFn).toHaveBeenCalledTimes(1));

        expect(screen.getByText('Erasing…')).toBeTruthy();
        // …and the destructive control cannot be fired a second time while it is. The dialog's confirm is the
        // design system's `Button`: a busy `Button` stays FOCUSABLE (`aria-disabled` + `aria-busy`, its click
        // cancelled) rather than natively `disabled`, so focus is not dropped from the control just pressed (SC 2.4.3).
        const confirm = within(screen.getByRole('dialog')).getByRole<HTMLButtonElement>('button', {
            name: 'Erase my data',
        });
        expect(confirm.getAttribute('aria-disabled')).toBe('true');
        expect(confirm.getAttribute('aria-busy')).toBe('true');
    });

    it('surfaces a FAILED account erasure, not just a failed recipe erasure (B17)', async () => {
        accountEraseFn.mockRejectedValue(new Error('500'));
        const user = await openFlow();

        await confirmErasure(user);

        expect(await screen.findByRole('alert')).toHaveProperty(
            'textContent',
            'We couldn’t start erasing your data. Please try again.',
        );
    });
});
