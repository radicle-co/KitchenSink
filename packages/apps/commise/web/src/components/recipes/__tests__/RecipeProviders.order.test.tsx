// @vitest-environment jsdom
/**
 * The provider ORDER of the web recipe tree (UI audit 2): the offline queue wraps the service providers, and the
 * recipe client wraps the food client. Mobile's `RecipeServiceGate` asserts the same order in its own test, so the two
 * trees cannot drift apart again.
 *
 * WHY THE QUEUE IS OUTSIDE. A queued write outlives the screen that made it, so its owner sits above every feature
 * (`RecipeProviders`' own comment). The sender reads the client through a closure, not through context, so the queue
 * needs no provider beneath it. Mobile used to mount it inside the food provider.
 *
 * The providers are wrapped in marker elements around the REAL implementations, so the assertion is on DOM nesting and
 * the real providers still run.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSnackbar } from '@commise/ui/snackbar';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The cook Clerk reports: a user id, `null` once signed out. A test changes it between renders. */
const auth = vi.hoisted((): { userId: string | null | undefined } => ({ userId: 'user_1' }));

vi.mock('@clerk/nextjs', () => ({
    useAuth: () => ({ getToken: () => Promise.resolve('tok'), userId: auth.userId }),
    useClerk: () => ({ session: { user: { id: 'user_1' } } }),
}));

/** The `onFault` each mounted queue was handed. */
const syncProps = vi.hoisted(() => ({ onFault: [] as unknown[] }));

vi.mock('@commise/query/sync', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/query/sync')>();

    return {
        ...actual,
        SyncProvider: (props: Parameters<typeof actual.SyncProvider>[0]) => {
            syncProps.onFault.push(props.onFault);

            return (
                <div data-provider="sync">
                    <actual.SyncProvider {...props} />
                </div>
            );
        },
    };
});

vi.mock('@kitchensink/recipe-service-client/hooks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/recipe-service-client/hooks')>();

    return {
        ...actual,
        RecipeServiceProvider: (props: Parameters<typeof actual.RecipeServiceProvider>[0]) => (
            <div data-provider="recipe">
                <actual.RecipeServiceProvider {...props} />
            </div>
        ),
    };
});

vi.mock('@kitchensink/food-service-client/hooks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/food-service-client/hooks')>();

    return {
        ...actual,
        FoodServiceProvider: (props: Parameters<typeof actual.FoodServiceProvider>[0]) => (
            <div data-provider="food">
                <actual.FoodServiceProvider {...props} />
            </div>
        ),
    };
});

/** The `subject` each mounted timer provider was handed. */
const timerSubjects = vi.hoisted(() => ({ seen: [] as unknown[] }));

vi.mock('@commise/features-cooking/web', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@commise/features-cooking/web')>();

    return {
        ...actual,
        TimerProvider: (props: Parameters<typeof actual.TimerProvider>[0]) => {
            timerSubjects.seen.push(props.subject);

            return (
                <div data-provider="timer">
                    <actual.TimerProvider {...props} />
                </div>
            );
        },
    };
});

const { RecipeProviders } = await import('../RecipeProviders.js');

afterEach(() => {
    cleanup();
    auth.userId = 'user_1';
});

/** The one control these rows press: it raises a snackbar from inside the providers. */
const Raise = () => {
    const { show } = useSnackbar();

    return (
        <button type="button" onClick={() => show({ message: 'Removed Pasta' })}>
            raise
        </button>
    );
};

/** A new element each time: React skips an element it has already rendered, so the same one would not re-read Clerk. */
const tree = () => (
    <RecipeProviders>
        <Raise />
    </RecipeProviders>
);

describe('RecipeProviders (web) — provider order', () => {
    it('mounts the queue outside the recipe client, and the recipe client outside the food client', () => {
        const { container } = render(
            <RecipeProviders>
                <span>child</span>
            </RecipeProviders>,
        );

        expect(
            container.querySelector('[data-provider="sync"] [data-provider="recipe"] [data-provider="food"]'),
        ).not.toBeNull();
        expect(container.querySelector('[data-provider="recipe"] [data-provider="sync"]')).toBeNull();
        expect(container.querySelector('[data-provider="food"] [data-provider="recipe"]')).toBeNull();
    });

    it('⛔ hands the queue the app’s Sentry reporter, so an isolated sync failure is reported', async () => {
        const { reportErrorToSentry } = await import('@/lib/sentryErrorReporter');

        syncProps.onFault.length = 0;
        render(
            <RecipeProviders>
                <span>child</span>
            </RecipeProviders>,
        );

        expect(syncProps.onFault.length).toBeGreaterThan(0);
        expect(new Set(syncProps.onFault)).toStrictEqual(new Set([reportErrorToSentry]));
    });

    it('mounts the timers under the service providers and over the screens, fed the raw Clerk userId (S3a.U3)', () => {
        timerSubjects.seen.length = 0;

        const { container } = render(
            <RecipeProviders>
                <span>child</span>
            </RecipeProviders>,
        );

        expect(
            container.querySelector('[data-provider="sync"] [data-provider="food"] [data-provider="timer"] > span'),
        ).not.toBeNull();
        expect(container.querySelector('[data-provider="timer"] [data-provider="sync"]')).toBeNull();
        expect(new Set(timerSubjects.seen)).toStrictEqual(new Set(['user_1']));
    });

    it('mounts ONE snackbar host above the screens, inside the timers, named "Notifications" (plan U7a)', () => {
        const { container } = render(
            <RecipeProviders>
                <span>child</span>
            </RecipeProviders>,
        );

        expect(screen.getAllByRole('region', { name: 'Notifications' })).toHaveLength(1);
        expect(container.querySelector('[data-provider="timer"] section[aria-label="Notifications"]')).not.toBeNull();
        expect(within(screen.getByRole('region', { name: 'Notifications' })).getByRole('status')).toBeTruthy();
    });

    it('closes a snackbar when the cook signs out, and never shows it to the next cook (condition 1)', async () => {
        const user = userEvent.setup();
        const { rerender } = render(tree());

        await user.click(screen.getByRole('button', { name: 'raise' }));
        expect(screen.getByRole('status').textContent).toBe('Removed Pasta');

        auth.userId = null;
        act(() => {
            rerender(tree());
        });

        expect(screen.getByRole('status').textContent).toBe('');
    });

    it('keeps a snackbar while Clerk is still loading the cook (userId undefined changes nothing)', async () => {
        const user = userEvent.setup();
        const { rerender } = render(tree());

        await user.click(screen.getByRole('button', { name: 'raise' }));
        auth.userId = undefined;
        act(() => {
            rerender(tree());
        });

        expect(screen.getByRole('status').textContent).toBe('Removed Pasta');
    });
});
