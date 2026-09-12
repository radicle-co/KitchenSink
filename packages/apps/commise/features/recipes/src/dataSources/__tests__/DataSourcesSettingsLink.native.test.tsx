/**
 * The native settings way in to the Data sources sheet (design §S16): a section headed "Food data", one line on what is
 * there, and a link titled with the page's name that opens the sheet the host mounts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessibilityInfo } from 'react-native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DataSourcesSettingsLink } from '../DataSourcesSettingsLink.native.js';

afterEach(cleanup);

// react-native-web does not implement `sendAccessibilityEvent`; the focus-return case reads the calls.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

describe('DataSourcesSettingsLink (native)', () => {
    it('takes the reading cursor back when the sheet it opened closes, and never on mount (§S16 Focus)', () => {
        const { rerender } = render(<DataSourcesSettingsLink onOpen={vi.fn()} returnFocusSignal={0} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
        rerender(<DataSourcesSettingsLink onOpen={vi.fn()} returnFocusSignal={1} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('link', { name: 'Data sources' }),
            'focus',
        );
    });

    it('heads the section "Food data" and says what the page holds', () => {
        render(<DataSourcesSettingsLink onOpen={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'Food data' })).toBeTruthy();
        expect(
            screen.getByText('Where the nutrition figures come from, and the licenses they’re used under.'),
        ).toBeTruthy();
    });

    it('opens the sheet when the link is pressed', async () => {
        const onOpen = vi.fn();
        render(<DataSourcesSettingsLink onOpen={onOpen} />);

        await userEvent.click(screen.getByRole('link', { name: 'Data sources' }));

        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});
