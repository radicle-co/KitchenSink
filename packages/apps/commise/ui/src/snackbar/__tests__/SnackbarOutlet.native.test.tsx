/**
 * The snackbar inside an open native window — the integration of the real `SnackbarHost` and the real `OverlayHost`,
 * neither mocked.
 *
 * A React Native `Modal` is a window of its own, so a snackbar drawn at the app root sits under an open sheet or dialog,
 * where nobody can reach its Undo. So an open window offers the host an outlet, and the host draws the one snackbar
 * there. The queue, the timer and the screen-reader pause stay in the host.
 *
 * ⚠️ react-native-web renders a `Modal` into the same document, so this proves WHERE the snackbar is drawn and that it is
 * drawn ONCE. It cannot prove that the window draws above the app, or that a screen reader announces it: those need a
 * device.
 */
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { AccessibilityInfo, Pressable, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX, ReactNode } from 'react';

import { OverlayHost } from '../../overlay/OverlayHost.native.js';
import { render } from '../../testing/tamaguiTesting.native.js';
import { SnackbarHost } from '../SnackbarHost.native.js';
import { SnackbarOutlet } from '../SnackbarOutlet.native.js';
import type { SnackbarHandle, SnackbarInput } from '../props.js';
import { useSnackbar } from '../useSnackbar.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockImplementation(() => Promise.resolve(false));
    vi.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
        _event: string,
        _listener: (on: boolean) => void,
    ) => ({ remove: () => undefined })) as typeof AccessibilityInfo.addEventListener);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** A control that shows one snackbar and keeps the handle `show` returned. */
function Shower({
    input,
    onHandle,
}: {
    readonly input: SnackbarInput;
    readonly onHandle?: (handle: SnackbarHandle) => void;
}): JSX.Element {
    const { show } = useSnackbar();

    return (
        <Pressable
            accessibilityRole="button"
            onPress={() => {
                // Shown first: `onHandle?.(show(input))` would skip `show` when no handler is given.
                const handle = show(input);

                onHandle?.(handle);
            }}
        >
            <Text>{`show ${input.message}`}</Text>
        </Pressable>
    );
}

/** One window, open, with a label inside so the test can find the window's own subtree. */
function Window({
    label,
    presenting,
    children,
}: {
    readonly label: string;
    readonly presenting?: boolean;
    readonly children?: ReactNode;
}): JSX.Element {
    return (
        <OverlayHost
            visible
            transparent
            onDismissRequest={() => undefined}
            {...(presenting === undefined ? {} : { presenting })}
        >
            <Text>{label}</Text>
            {children}
        </OverlayHost>
    );
}

/** The window whose label is given: the `aria-modal` root react-native-web draws for a `Modal`. */
function windowNamed(label: string): HTMLElement {
    const root = screen.getByText(label).closest<HTMLElement>('[aria-modal="true"]');

    if (root === null) {
        throw new Error(`No window holds "${label}".`);
    }

    return root;
}

/** Every polite status region that holds the message. */
function regionsHolding(message: string): HTMLElement[] {
    return screen.getAllByRole('status').filter((region) => region.textContent?.includes(message) === true);
}

const showFrom = (message: string): void => {
    fireEvent.click(screen.getByRole('button', { name: `show ${message}` }));
};

describe('the snackbar inside an open native window (integration: real host, real OverlayHost)', () => {
    it('draws in exactly one region, inside the window, while the window presents', () => {
        render(
            <SnackbarHost>
                <Window label="Ingredients">
                    <Shower input={{ message: 'Ticks cleared' }} />
                </Window>
            </SnackbarHost>,
        );

        showFrom('Ticks cleared');

        const [region, ...others] = regionsHolding('Ticks cleared');

        expect(others).toStrictEqual([]);
        expect(region).toBeDefined();
        expect(windowNamed('Ingredients').contains(region ?? null)).toBe(true);
    });

    it('moves the same snackbar back to the host when the window stops presenting, and its Undo still works', () => {
        const onAction = vi.fn();
        const input: SnackbarInput = { message: 'Ticks cleared', action: { label: 'Undo', onAction } };
        const tree = (presenting: boolean): JSX.Element => (
            <SnackbarHost>
                <Window label="Ingredients" presenting={presenting}>
                    <Shower input={input} />
                </Window>
            </SnackbarHost>
        );
        const { rerender } = render(tree(true));

        showFrom('Ticks cleared');
        rerender(tree(false));

        const [region, ...others] = regionsHolding('Ticks cleared');

        expect(others).toStrictEqual([]);
        expect(windowNamed('Ingredients').contains(region ?? null)).toBe(false);

        fireEvent.click(within(region ?? document.body).getByRole('button', { name: 'Undo' }));

        expect(onAction).toHaveBeenCalledOnce();
    });

    it('draws in the window that opened last when one window opens inside another', () => {
        render(
            <SnackbarHost>
                <Window label="Ingredients">
                    <Window label="Confirm">
                        <Shower input={{ message: 'Ticks cleared' }} />
                    </Window>
                </Window>
            </SnackbarHost>,
        );

        showFrom('Ticks cleared');

        const [region, ...others] = regionsHolding('Ticks cleared');

        expect(others).toStrictEqual([]);
        expect(windowNamed('Confirm').contains(region ?? null)).toBe(true);
    });

    it('keeps a polite region mounted in the window before any snackbar arrives, so the change is announced', () => {
        render(
            <SnackbarHost>
                <Window label="Ingredients" />
            </SnackbarHost>,
        );

        const region = within(windowNamed('Ingredients')).getByRole('status');

        expect(region.getAttribute('aria-live')).toBe('polite');
        expect(region.textContent).toBe('');
    });

    it('defaults to presenting while the window is visible', () => {
        render(
            <SnackbarHost>
                <OverlayHost visible transparent onDismissRequest={() => undefined}>
                    <Text>Ingredients</Text>
                    <Shower input={{ message: 'Ticks cleared' }} />
                </OverlayHost>
            </SnackbarHost>,
        );

        showFrom('Ticks cleared');

        expect(windowNamed('Ingredients').contains(regionsHolding('Ticks cleared')[0] ?? null)).toBe(true);
    });

    it('settles the snackbar on dismiss, so its onTimeout runs once and the snackbar goes', () => {
        const onTimeout = vi.fn();
        let handle: SnackbarHandle | undefined;
        render(
            <SnackbarHost>
                <Window label="Ingredients">
                    <Shower input={{ message: 'Ticks cleared', onTimeout }} onHandle={(next) => {
                            handle = next;
                        }}
                    />
                </Window>
            </SnackbarHost>,
        );

        showFrom('Ticks cleared');
        act(() => handle?.dismiss());

        // At once, long before its own six seconds are up.
        expect(onTimeout).toHaveBeenCalledOnce();
        expect(regionsHolding('Ticks cleared')).toStrictEqual([]);

        act(() => handle?.dismiss());
        act(() => {
            vi.advanceTimersByTime(60_000);
        });

        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('ignores a dismiss after a newer snackbar replaced it', () => {
        let first: SnackbarHandle | undefined;
        render(
            <SnackbarHost>
                <Window label="Ingredients">
                    <Shower input={{ message: 'Ticks cleared' }} onHandle={(next) => {
                            first = next;
                        }}
                    />
                    <Shower input={{ message: 'Servings changed' }} />
                </Window>
            </SnackbarHost>,
        );

        showFrom('Ticks cleared');
        showFrom('Servings changed');
        act(() => first?.dismiss());

        expect(regionsHolding('Servings changed')).toHaveLength(1);
    });
});

describe('SnackbarOutlet outside a snackbar host', () => {
    it('draws nothing, so a window with no host above it still opens', () => {
        render(<SnackbarOutlet presenting depth={1} />);

        expect(screen.queryByRole('status')).toBeNull();
    });
});
