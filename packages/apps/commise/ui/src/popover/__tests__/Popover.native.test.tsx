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
vi.mock('../../sheet/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));

beforeEach(() => {
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});
afterEach(cleanup);

const renderPopover = (): void => {
    render(
        <Popover
            triggerLabel="About Kale"
            triggerIcon={<Text>i</Text>}
            title="Kale"
            closeLabel="Close details for Kale"
        >
            <Text>No match for this.</Text>
        </Popover>,
    );
};

const trigger = (): HTMLElement => screen.getByRole('button', { name: 'About Kale' });

describe('Popover (native)', () => {
    it('is closed at rest: a named, collapsed button and no sheet', () => {
        renderPopover();

        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('dialog', { name: 'Kale' })).toBeNull();
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

        expect(screen.getByRole('dialog', { name: 'Kale' }).textContent).toContain('No match for this.');
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
    });

    it('closes through Close and hands the screen-reader cursor back to the trigger', () => {
        renderPopover();
        fireEvent.click(trigger());
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();

        fireEvent.click(screen.getByRole('button', { name: 'Close details for Kale' }));

        expect(screen.queryByRole('dialog', { name: 'Kale' })).toBeNull();
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), 'focus');
    });

    it('hands its content a close action that closes the sheet', () => {
        render(
            <Popover triggerLabel="About Kale" triggerIcon={<Text>i</Text>} title="Kale" closeLabel="Close Kale">
                {(close) => (
                    <Text accessibilityRole="button" onPress={close}>
                        Do it
                    </Text>
                )}
            </Popover>,
        );
        fireEvent.click(trigger());

        fireEvent.click(screen.getByRole('button', { name: 'Do it' }));

        expect(screen.queryByRole('dialog', { name: 'Kale' })).toBeNull();
    });

    it('reads BUSY on the trigger while its work runs', () => {
        render(
            <Popover triggerLabel="About Kale" triggerIcon={<Text>i</Text>} title="Kale" closeLabel="Close Kale" busy>
                <Text>Body</Text>
            </Popover>,
        );

        expect(trigger().getAttribute('aria-busy')).toBe('true');
        // V1 sign-off 3b: busy to the eye too — the glyph gives way to a spinner in the same box.
        expect(screen.queryByText('i')).toBeNull();
    });

    it('does not move the screen-reader cursor on mount (nothing was closed yet)', () => {
        renderPopover();

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });
});
