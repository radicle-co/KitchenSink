import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

import { PopupInsetsContext } from '../../popupInsets/popupInsetsContext.js';
import { SnackbarHost } from '../SnackbarHost.js';
import type { SnackbarInput } from '../props.js';
import { useSnackbar } from '../useSnackbar.js';

/**
 * SnackbarHost + UndoSnackbar (web) — spec §1.11: one at a time, a new one commits the old, six seconds unless the
 * pointer or focus is inside it (SC 2.2.1), a polite status that never takes focus, `ink` with a `paper` message and a
 * `seafoam-light` action at a 44px target, 16px above the bottom chrome, at most 36rem wide.
 */

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** A screen that shows whatever snackbar the test hands it, from a button. */
function Screen({ input }: { readonly input: SnackbarInput }): JSX.Element {
    const { show } = useSnackbar();

    return (
        <button type="button" onClick={() => show(input)}>
            {`show ${input.message}`}
        </button>
    );
}

const showFrom = (message: string): void => {
    fireEvent.click(screen.getByRole('button', { name: `show ${message}` }));
};

const advance = (ms: number): void => {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
};

const statusText = (): string => screen.getByRole('status').textContent ?? '';

describe('SnackbarHost (web)', () => {
    it('refuses a screen that asks for a snackbar outside a host', () => {
        expect(() => render(<Screen input={{ message: 'x' }} />)).toThrow(/SnackbarHost/u);
    });

    it('says nothing until asked, from a status region that is always mounted', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );

        expect(statusText()).toBe('');
    });

    it('shows the message politely, and does not move focus', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );
        const opener = screen.getByRole('button', { name: 'show Removed Pasta' });
        opener.focus();

        showFrom('Removed Pasta');

        expect(statusText()).toBe('Removed Pasta');
        expect(document.activeElement).toBe(opener);
    });

    it('commits after six seconds: onTimeout runs once and the snackbar goes', () => {
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        advance(5999);
        expect(onTimeout).not.toHaveBeenCalled();

        advance(1);
        expect(onTimeout).toHaveBeenCalledOnce();
        expect(statusText()).toBe('');

        advance(60_000);
        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('runs for the duration a screen asks for', () => {
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Saved', onTimeout, durationMs: 2000 }} />
            </SnackbarHost>,
        );

        showFrom('Saved');
        advance(2000);

        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('takes its action instead of committing: onAction runs, onTimeout never does', () => {
        const onAction = vi.fn();
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', action: { label: 'Undo', onAction }, onTimeout }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        advance(60_000);

        expect(onAction).toHaveBeenCalledOnce();
        expect(onTimeout).not.toHaveBeenCalled();
        expect(statusText()).toBe('');
    });

    it('commits the snackbar a new one replaces, once, and then times the new one', () => {
        const first = vi.fn();
        const second = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout: first }} />
                <Screen input={{ message: 'Removed Soup', onTimeout: second }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        advance(2000);
        showFrom('Removed Soup');

        expect(first).toHaveBeenCalledOnce();
        expect(statusText()).toBe('Removed Soup');

        advance(6000);

        expect(second).toHaveBeenCalledOnce();
        expect(first).toHaveBeenCalledOnce();
    });

    it('pauses while the pointer is over it, and runs out its own remaining time after', () => {
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        advance(4000);
        fireEvent.pointerEnter(screen.getByText('Removed Pasta'));
        advance(60_000);
        expect(onTimeout).not.toHaveBeenCalled();

        fireEvent.pointerLeave(screen.getByText('Removed Pasta'));
        advance(1999);
        expect(onTimeout).not.toHaveBeenCalled();

        advance(1);
        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('pauses while focus is inside it', () => {
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', action: { label: 'Undo', onAction: vi.fn() }, onTimeout }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        fireEvent.focus(screen.getByRole('button', { name: 'Undo' }));
        advance(60_000);
        expect(onTimeout).not.toHaveBeenCalled();

        fireEvent.blur(screen.getByRole('button', { name: 'Undo' }));
        advance(6000);
        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('sits 16px above the page’s bottom chrome, read as it shows', () => {
        render(
            <PopupInsetsContext value={() => ({ top: 0, bottom: 64 })}>
                <SnackbarHost>
                    <Screen input={{ message: 'Removed Pasta' }} />
                </SnackbarHost>
            </PopupInsetsContext>,
        );

        showFrom('Removed Pasta');

        expect(screen.getByRole('status').style.bottom).toBe('80px');
    });
});

describe('UndoSnackbar (web)', () => {
    const tokensOf = (element: Element | null): readonly string[] => element?.className.split(/\s+/u) ?? [];

    it('is ink with a paper message of at most two lines, at most 36rem wide', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        const message = screen.getByText('Removed Pasta');

        // The inverse roles (`darkTheme.md` §1), so the bar inverts in BOTH themes rather than baking light `ink`.
        expect(tokensOf(message)).toEqual(expect.arrayContaining(['line-clamp-2', 'text-inverse-ink']));
        expect(tokensOf(message.parentElement)).toEqual(expect.arrayContaining(['bg-inverse', 'max-w-[36rem]']));
    });

    it('draws its action in the inverseAction role at a 44px target', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', action: { label: 'Undo', onAction: vi.fn() } }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');

        expect(tokensOf(screen.getByRole('button', { name: 'Undo' }))).toEqual(
            expect.arrayContaining(['text-inverse-action', 'min-h-11', 'min-w-11']),
        );
    });

    it('rises into place only when motion is allowed', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');

        expect(tokensOf(screen.getByText('Removed Pasta').parentElement)).toEqual(
            expect.arrayContaining(['motion-safe:starting:translate-y-2', 'starting:opacity-0']),
        );
    });
});
