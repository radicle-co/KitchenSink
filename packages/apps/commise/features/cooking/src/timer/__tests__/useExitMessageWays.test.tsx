/**
 * The decorator over the ways out of cooking mode: a way out shows the timer message first, then goes. Run over a
 * real timer store and a real `SnackbarHost`, so the text a cook reads is the text the host shows.
 */
import { resolveMessages } from '@commise/i18n';
import { SnackbarHost, useSnackbar } from '@commise/ui/snackbar';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCookingRecipe } from '../../__fixtures__/makeCookingRecipe.js';
import type { CookingWays } from '../../cookingViewProps.js';
import { cookingMessages } from '../../messages.js';
import { EXIT_MESSAGE_MS } from '../exitMessage.js';
import { TimerStoreContext } from '../timerContext.js';
import { createTimerStore } from '../timerStore.js';
import { useExitMessageWays } from '../useExitMessageWays.js';

const en = resolveMessages(cookingMessages, 'en');
const STEP = {
    stepIndex: 0,
    stepDigest: 's1:0000000d',
    label: { kind: 'typed', text: 'Rice' },
    origin: { kind: 'added' },
} as const;
const RUNNING_TEXT = 'Your Rice timer keeps running.';

beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-11-20T10:00:00.000Z'), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function Ways({ ways, recipeId }: { readonly ways: CookingWays; readonly recipeId: string }): ReactNode {
    const wrapped = useExitMessageWays(ways, recipeId, makeCookingRecipe({ id: 'r1' }), en.exit.timerRunningWeb);

    return (
        <>
            <button onClick={wrapped.onLeave}>Leave</button>
            <button onClick={wrapped.onHome}>Home</button>
            <button onClick={wrapped.onEdit}>Edit</button>
        </>
    );
}

function setup(recipeId = 'r1') {
    const store = createTimerStore();
    const disconnect = store.connect();
    const ways = { onLeave: vi.fn(), onEdit: vi.fn(), onHome: vi.fn() };
    const user = {
        click: (element: HTMLElement) => {
            act(() => {
                fireEvent.click(element);
            });
        },
    };

    render(
        <TimerStoreContext value={store}>
            <SnackbarHost>
                <Ways ways={ways} recipeId={recipeId} />
            </SnackbarHost>
        </TimerStoreContext>,
    );

    return { store, ways, user, disconnect };
}

describe('useExitMessageWays', () => {
    it('shows the message and then leaves, for Leave and for Home (mutant: the way first, or no message)', () => {
        const { store, ways, user, disconnect } = setup();
        store.start({ ...STEP, recipeId: 'r1', durationMs: 60_000 });

        user.click(screen.getByRole('button', { name: 'Leave' }));

        expect(screen.getByText(new RegExp(RUNNING_TEXT, 'u'))).toBeTruthy();
        expect(ways.onLeave).toHaveBeenCalledTimes(1);

        user.click(screen.getByRole('button', { name: 'Home' }));

        expect(ways.onHome).toHaveBeenCalledTimes(1);
        disconnect();
    });

    it('reads the timer at the press, not at render (mutant: read once at render)', () => {
        const { store, ways, user, disconnect } = setup();

        user.click(screen.getByRole('button', { name: 'Leave' }));

        expect(screen.queryByText(new RegExp(RUNNING_TEXT, 'u'))).toBeNull();
        expect(ways.onLeave).toHaveBeenCalledTimes(1);

        act(() => {
            store.start({ ...STEP, recipeId: 'r1', durationMs: 60_000 });
        });
        user.click(screen.getByRole('button', { name: 'Leave' }));

        expect(screen.getByText(new RegExp(RUNNING_TEXT, 'u'))).toBeTruthy();
        disconnect();
    });

    it('leaves without a message when the only timer is another recipe’s', () => {
        const { store, ways, user, disconnect } = setup();
        store.start({ ...STEP, recipeId: 'other', durationMs: 60_000 });

        user.click(screen.getByRole('button', { name: 'Leave' }));

        expect(screen.queryByRole('status')?.textContent ?? '').not.toContain('timer');
        expect(ways.onLeave).toHaveBeenCalledTimes(1);
        disconnect();
    });

    it('does not decorate Edit, which stays the caller’s function (mutant: Edit wrapped)', () => {
        const { store, ways, user, disconnect } = setup();
        store.start({ ...STEP, recipeId: 'r1', durationMs: 60_000 });

        user.click(screen.getByRole('button', { name: 'Edit' }));

        expect(ways.onEdit).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(new RegExp(RUNNING_TEXT, 'u'))).toBeNull();
        disconnect();
    });

    it('stays for the exit message time, not the default (mutant: no duration)', () => {
        const { store, user, disconnect } = setup();
        store.start({ ...STEP, recipeId: 'r1', durationMs: 60_000 });

        user.click(screen.getByRole('button', { name: 'Leave' }));
        act(() => {
            vi.advanceTimersByTime(EXIT_MESSAGE_MS - 1);
        });

        expect(screen.getByText(new RegExp(RUNNING_TEXT, 'u'))).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(2);
        });

        expect(screen.queryByText(new RegExp(RUNNING_TEXT, 'u'))).toBeNull();
        disconnect();
    });

    it('commits an Undo that was open, once, when it shows (mutant: the Undo dropped)', () => {
        const onTimeout = vi.fn();
        const store = createTimerStore();
        const disconnect = store.connect();
        const ways = { onLeave: vi.fn(), onEdit: vi.fn(), onHome: vi.fn() };
        const user = {
            click: (element: HTMLElement) => {
                act(() => {
                    fireEvent.click(element);
                });
            },
        };
        const Open = (): ReactNode => {
            const snackbar = useSnackbar();

            return <button onClick={() => snackbar.show({ message: 'Recipe removed', onTimeout })}>Open</button>;
        };
        render(
            <TimerStoreContext value={store}>
                <SnackbarHost>
                    <Open />
                    <Ways ways={ways} recipeId="r1" />
                </SnackbarHost>
            </TimerStoreContext>,
        );
        store.start({ ...STEP, recipeId: 'r1', durationMs: 60_000 });

        user.click(screen.getByRole('button', { name: 'Open' }));
        user.click(screen.getByRole('button', { name: 'Leave' }));

        expect(onTimeout).toHaveBeenCalledTimes(1);
        disconnect();
    });

    it('needs a timer provider, like the timer list does', () => {
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() =>
            render(
                <SnackbarHost>
                    <Ways ways={{ onLeave: vi.fn(), onEdit: vi.fn(), onHome: vi.fn() }} recipeId="r1" />
                </SnackbarHost>,
            ),
        ).toThrow('need a TimerProvider');
        quiet.mockRestore();
    });
});
