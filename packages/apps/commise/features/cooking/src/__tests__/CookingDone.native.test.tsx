/**
 * The native Done body: the title as the screen's heading in the large-title role, the recipe line, and "The screen can
 * turn off again" only where the screen was kept on. On opening, screen-reader focus moves to the title. Done's two
 * actions are pinned in the foot now, so their cases moved to CookingDoneActions.native.test.tsx.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingDone } from '../CookingDone.native.js';
import type { CookingDoneProps } from '../cookingViewProps.js';

// react-native-web does not implement `sendAccessibilityEvent`; the focus move is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

function doneProps(overrides: Partial<CookingDoneProps> = {}): CookingDoneProps {
    return {
        title: 'All 6 steps done',
        enjoy: 'Roast chicken. Enjoy it.',
        screenOff: 'The screen can turn off again.',
        ...overrides,
    };
}

describe('CookingDone (native)', () => {
    it('heads the screen with the title', () => {
        render(<CookingDone {...doneProps()} />);

        expect(screen.getByRole('heading', { name: 'All 6 steps done' })).toBeTruthy();
        expect(screen.getByText('Roast chicken. Enjoy it.')).toBeTruthy();
    });

    it('moves screen-reader focus to the title once, when it opens', () => {
        const { rerender } = render(<CookingDone {...doneProps()} />);

        const title = screen.getByRole('heading', { name: 'All 6 steps done' });
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(title, 'focus');

        rerender(<CookingDone {...doneProps({ enjoy: 'Soup. Enjoy it.' })} />);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    });

    it('says the screen can turn off only when it was kept on', () => {
        const { unmount } = render(<CookingDone {...doneProps()} />);
        expect(screen.getByText('The screen can turn off again.')).toBeTruthy();
        unmount();

        render(<CookingDone {...doneProps({ screenOff: undefined })} />);
        expect(screen.queryByText('The screen can turn off again.')).toBeNull();
    });
});
