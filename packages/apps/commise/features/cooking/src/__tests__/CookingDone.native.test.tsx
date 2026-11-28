/**
 * The native Done body: the title as the screen's heading in the large-title role, the recipe line, and "The screen can
 * turn off again" only where the screen was kept on. On opening, screen-reader focus moves to the title. Done's two
 * actions are pinned in the foot now, so their cases moved to CookingDoneActions.native.test.tsx.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingDone, type NativeCookingDoneProps } from '../CookingDone.native.js';

// react-native-web does not implement `sendAccessibilityEvent`; the focus move is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

function doneProps(overrides: Partial<NativeCookingDoneProps> = {}): NativeCookingDoneProps {
    return {
        title: 'All 6 steps done',
        enjoy: 'Roast chicken. Enjoy it.',
        screenNote: 'The screen can turn off again.',
        titleSignal: 0,
        ...overrides,
    };
}

describe('CookingDone (native)', () => {
    // The board's Done body keeps 12 between its lines.
    it('keeps 12 between the title and the lines under it', () => {
        render(<CookingDone {...doneProps()} />);

        const body = screen.getByRole('heading', { name: 'All 6 steps done' }).parentElement;

        expect(body === null ? '' : getComputedStyle(body).gap).toBe('var(--t-space-3)');
    });

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

    it('moves the cursor onto the title again each time the signal advances, and not on a plain re-render', () => {
        const { rerender } = render(<CookingDone {...doneProps()} />);

        rerender(<CookingDone {...doneProps({ titleSignal: 1 })} />);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(2);

        rerender(<CookingDone {...doneProps({ titleSignal: 1, enjoy: 'Soup. Enjoy it.' })} />);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(2);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(
            screen.getByRole('heading', { name: 'All 6 steps done' }),
            'focus',
        );
    });

    it('says the screen can turn off only when it was kept on', () => {
        const { unmount } = render(<CookingDone {...doneProps()} />);
        expect(screen.getByText('The screen can turn off again.')).toBeTruthy();
        unmount();

        render(<CookingDone {...doneProps({ screenNote: undefined })} />);
        expect(screen.queryByText('The screen can turn off again.')).toBeNull();
    });

    it('says a timer holds the screen on, instead of the line that it can turn off', () => {
        render(<CookingDone {...doneProps({ screenNote: 'The screen stays on until your Roast timer ends.' })} />);

        expect(screen.getByText('The screen stays on until your Roast timer ends.')).toBeTruthy();
        expect(screen.queryByText('The screen can turn off again.')).toBeNull();
    });
});
