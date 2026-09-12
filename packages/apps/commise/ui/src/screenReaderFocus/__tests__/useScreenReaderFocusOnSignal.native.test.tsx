import { cleanup, render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScreenReaderFocusOnSignal } from '../useScreenReaderFocusOnSignal.native.js';

/**
 * ⚠️ `sendAccessibilityEvent` is MOCKED because react-native-web does not implement it. What is proven is the contract
 * with React Native — the right node, the `'focus'` event, only on a CHANGED signal. Whether VoiceOver/TalkBack honour
 * the event is a device check this tier cannot make.
 */
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

const Surface: FC<{ readonly signal: number }> = ({ signal }) => {
    const ref = useScreenReaderFocusOnSignal<Text>(signal);

    return <Text ref={ref}>Your recipes</Text>;
};

describe('useScreenReaderFocusOnSignal (native)', () => {
    it('does not move the screen-reader cursor on mount, whatever the signal already is', () => {
        render(<Surface signal={3} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });

    it('⛔ moves it onto the attached node when the signal CHANGES, once', () => {
        const { rerender } = render(<Surface signal={0} />);

        rerender(<Surface signal={1} />);
        rerender(<Surface signal={1} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByText('Your recipes'),
            'focus',
        );
    });
});
