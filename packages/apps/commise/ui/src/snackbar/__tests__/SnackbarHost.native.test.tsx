import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';
import { Pressable, Text } from 'react-native';

import { PopupInsetsContext } from '../../popupInsets/popupInsetsContext.js';
import { role } from '../../tokens/colors.js';
import { SnackbarHost } from '../SnackbarHost.native.js';
import type { SnackbarInput } from '../props.js';
import { useSnackbar } from '../useSnackbar.js';

/**
 * SnackbarHost + UndoSnackbar (native) — the native half of spec §1.11: one at a time, a new one commits the old, six
 * seconds, a polite `status` that never takes focus, 16 pt above the bottom chrome. ⚠️ Native has no hover, and React
 * Native cannot see where the screen-reader cursor is, so SC 2.2.1's pause is expressed as: while a screen reader runs,
 * the snackbar does not time out at all (it stays until its action is taken or a newer one replaces it).
 */

/** The screen reader as the test sets it, and the listener the host registered. */
const reader = vi.hoisted(() => ({ on: false, listener: undefined as ((on: boolean) => void) | undefined }));

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    reader.on = false;
    reader.listener = undefined;
    vi.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockImplementation(() => Promise.resolve(reader.on));
    vi.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
        event: string,
        listener: (on: boolean) => void,
    ) => {
        if (event === 'screenReaderChanged') {
            reader.listener = listener;
        }

        return { remove: () => undefined };
    }) as typeof AccessibilityInfo.addEventListener);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function Screen({ input }: { readonly input: SnackbarInput }): JSX.Element {
    const { show } = useSnackbar();

    return (
        <Pressable accessibilityRole="button" onPress={() => show(input)}>
            <Text>{`show ${input.message}`}</Text>
        </Pressable>
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

describe('SnackbarHost (native)', () => {
    it('shows the message as a polite status', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');

        const status = screen.getByRole('status');

        expect(status.textContent).toBe('Removed Pasta');
        expect(status.getAttribute('aria-live')).toBe('polite');
    });

    it('commits after six seconds, once', () => {
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        advance(6000);
        advance(60_000);

        expect(onTimeout).toHaveBeenCalledOnce();
        expect(screen.queryByText('Removed Pasta')).toBeNull();
    });

    it('takes its action instead of committing', () => {
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
    });

    it('commits the snackbar a new one replaces', () => {
        const first = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout: first }} />
                <Screen input={{ message: 'Removed Soup' }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        showFrom('Removed Soup');

        expect(first).toHaveBeenCalledOnce();
        expect(screen.getByRole('status').textContent).toBe('Removed Soup');
    });

    it('does not time out while a screen reader is running, and runs out its time once it stops', async () => {
        reader.on = true;
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout }} />
            </SnackbarHost>,
        );
        await act(async () => {
            await Promise.resolve();
        });

        showFrom('Removed Pasta');
        advance(60_000);
        expect(onTimeout).not.toHaveBeenCalled();

        act(() => reader.listener?.(false));
        advance(6000);
        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('sits 16pt above the page’s bottom chrome', () => {
        render(
            <PopupInsetsContext value={() => ({ top: 0, bottom: 80 })}>
                <SnackbarHost>
                    <Screen input={{ message: 'Removed Pasta' }} />
                </SnackbarHost>
            </PopupInsetsContext>,
        );

        showFrom('Removed Pasta');

        expect(getComputedStyle(screen.getByRole('status')).bottom).toBe('96px');
    });
});

describe('UndoSnackbar (native)', () => {
    it('is ink with a paper message, its action in seafoam-light at a 44pt target', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', action: { label: 'Undo', onAction: vi.fn() } }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');

        const message = screen.getByText('Removed Pasta');
        const undo = screen.getByRole('button', { name: 'Undo' });

        expect(getComputedStyle(message).color).toBe('rgb(255, 255, 255)');
        expect(getComputedStyle(message.parentElement as HTMLElement).backgroundColor).toBe(
            `rgb(${[1, 3, 5].map((at) => parseInt(role.ink.slice(at, at + 2), 16)).join(', ')})`,
        );
        expect(getComputedStyle(undo).minHeight).toBe('44px');
    });
});
