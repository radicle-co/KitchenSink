/**
 * Popover (native) — the design-system disclosure panel, which on a phone is a bottom sheet
 * (`@commise/ui/sheet`) opened by a TAP (`docs/design/ingredientStatusExplanation.md` §8e "moved", plan 002 R32).
 *
 * Covers: closed at rest with the trigger named, a button, collapsed and 48 dp square; a tap opens the sheet titled by
 * `title`; Close dismisses it; and on close the SCREEN-READER cursor returns to the trigger, because the sheet leaves
 * focus return to its host (`Sheet.native.tsx`) and React Native cannot read where the cursor was.
 *
 * ⚠️ `sendAccessibilityEvent` is mocked because react-native-web does not implement it; the safe-area insets and the
 * keyboard listener are mocked because their platforms do not exist under jsdom (the `Sheet.native` suite's reasons).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccessibilityInfo, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Popover } from '../Popover.native.js';

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));

beforeEach(() => {
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});
afterEach(cleanup);

const renderPopover = (): void => {
    render(
        <Popover triggerLabel="About Kale" triggerIcon="info" title="Kale" closeLabel="Close details for Kale">
            <Text>No match for this.</Text>
        </Popover>,
    );
};

const trigger = (): HTMLElement => screen.getByRole('button', { name: 'About Kale' });

describe('Popover (native)', () => {
    it('is closed at rest: a named, collapsed button and no sheet', () => {
        renderPopover();

        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('heading', { name: 'Kale' })).toBeNull();
    });

    it('meets the 48 dp native target (spec §3, 2.5.8)', () => {
        renderPopover();
        const style = getComputedStyle(trigger());

        expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(48);
        expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(48);
    });

    it('opens a sheet titled by `title` on a tap, holding the content, and marks the trigger expanded', () => {
        renderPopover();

        fireEvent.click(trigger());

        // The sheet carries no name of its own: its header names it (`docs/design/nativeContainerNames.md` N1).
        expect(screen.getByRole('heading', { name: 'Kale' }).closest('[role="dialog"]')?.textContent).toContain(
            'No match for this.',
        );
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
    });

    it('closes through Close and hands the screen-reader cursor back to the trigger', () => {
        renderPopover();
        fireEvent.click(trigger());
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Close details for Kale' }));

        expect(screen.queryByRole('heading', { name: 'Kale' })).toBeNull();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), 'focus');
    });

    it('hands its content a close action that closes the sheet', () => {
        render(
            <Popover triggerLabel="About Kale" triggerIcon="info" title="Kale" closeLabel="Close Kale">
                {(close) => (
                    <Text accessibilityRole="button" onPress={close}>
                        Do it
                    </Text>
                )}
            </Popover>,
        );
        fireEvent.click(trigger());

        fireEvent.click(screen.getByRole('button', { name: 'Do it' }));

        expect(screen.queryByRole('heading', { name: 'Kale' })).toBeNull();
    });

    it('reads BUSY on the trigger while its work runs', () => {
        render(
            <Popover triggerLabel="About Kale" triggerIcon="info" title="Kale" closeLabel="Close Kale" busy>
                <Text>Body</Text>
            </Popover>,
        );

        expect(trigger().getAttribute('aria-busy')).toBe('true');
        // V1 sign-off 3b: busy to the eye too — the glyph gives way to a spinner in the same box.
        expect(trigger().querySelector('[data-commise-stub="icon"]')).toBeNull();
    });

    // UI-overhaul slice 2: the glyph is a meaning from the icon Registry, so no host draws its own.
    it('draws the Registry glyph for the meaning it is given, while idle', () => {
        render(
            <Popover triggerLabel="About Kale" triggerIcon="triangleAlert" title="Kale" closeLabel="Close Kale">
                <Text>Body</Text>
            </Popover>,
        );

        expect(trigger().querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe(
            'triangle-alert',
        );
    });

    it('does not move the screen-reader cursor on mount (nothing was closed yet)', () => {
        renderPopover();

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });

    /**
     * A host asks for the reading cursor on this trigger (V1 sign-off item 11: the next row's glyph after a Remove). The
     * request is a level, acknowledged once handled, so it holds until the trigger exists to take it.
     */
    describe('a focus request', () => {
        const requested = (focusRequested: boolean, onFocusRequestHandled = vi.fn()) => (
            <Popover
                triggerLabel="About Kale"
                triggerIcon="info"
                title="Kale"
                closeLabel="Close Kale"
                focusRequested={focusRequested}
                onFocusRequestHandled={onFocusRequestHandled}
            >
                <Text>Body</Text>
            </Popover>
        );

        it('moves the screen-reader cursor to the trigger and acknowledges, once', () => {
            const handled = vi.fn();
            const { rerender } = render(requested(false, handled));
            expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

            rerender(requested(true, handled));

            expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
            expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), 'focus');
            expect(handled).toHaveBeenCalledTimes(1);
        });

        it('takes a request it MOUNTS with (the target may not exist when focus is asked for)', () => {
            const handled = vi.fn();

            render(requested(true, handled));

            expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
            expect(handled).toHaveBeenCalledTimes(1);
        });

        it('does nothing while no request stands', () => {
            const handled = vi.fn();
            const { rerender } = render(requested(false, handled));

            rerender(requested(false, handled));

            expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
            expect(handled).not.toHaveBeenCalled();
        });
    });
});

describe('Popover (native) — once it is gone', () => {
    it('reports `onDismissed` once the sheet has gone, and not before', () => {
        const onDismissed = vi.fn();
        render(
            <Popover
                triggerLabel="About Kale"
                triggerIcon="info"
                title="Kale"
                closeLabel="Close Kale"
                onDismissed={onDismissed}
            >
                <Text>Body</Text>
            </Popover>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'About Kale' }));
        expect(onDismissed).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Close Kale' }));

        expect(onDismissed).toHaveBeenCalledTimes(1);
    });
});

describe('Popover (native) — a text trigger (build spec §7.5.1)', () => {
    it('shows its words, keeps the name that contains them, and opens the sheet', () => {
        render(
            <Popover
                triggerLabel="Choose a match for Kale"
                triggerText="Choose a match"
                triggerIcon="triangleAlert"
                title="Kale"
                closeLabel="Close details for Kale"
            >
                <Text>No match for this.</Text>
            </Popover>,
        );

        const button = screen.getByRole('button', { name: 'Choose a match for Kale' });

        expect(button.textContent).toContain('Choose a match');
        fireEvent.click(button);
        expect(screen.getByText('No match for this.')).toBeTruthy();
    });
});
