import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccessibilityInfo, Text } from 'react-native';
import type { FC } from 'react';

import { moveScreenReaderFocus } from '../moveScreenReaderFocus.native.js';
import { useScreenReaderFocusOnMount } from '../useScreenReaderFocusOnMount.native.js';

/**
 * ⚠️ `sendAccessibilityEvent` is MOCKED because react-native-web does not implement it — the renderer these
 * suites run on has no screen-reader cursor to move. What is proven is the contract with React Native: the
 * right node, the `'focus'` event, exactly once per mount. Whether VoiceOver/TalkBack honour an event fired
 * straight after mount is a DEVICE check this tier cannot make.
 */
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

const Titled: FC<{ readonly label: string }> = ({ label }) => {
    const ref = useScreenReaderFocusOnMount<Text>();

    return <Text ref={ref}>{label}</Text>;
};

describe('useScreenReaderFocusOnMount (native)', () => {
    it('moves screen-reader focus onto the node it is attached to, once, as it mounts', () => {
        render(<Titled label="Create “grandma blend”" />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByText('Create “grandma blend”'),
            'focus',
        );
    });

    it('does NOT pull focus back on a re-render — only a fresh mount moves it', () => {
        const { rerender } = render(<Titled label="Before" />);
        rerender(<Titled label="After" />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
    });
});

describe('moveScreenReaderFocus (native)', () => {
    it('is a no-op for a node that is not mounted — never a crash', () => {
        moveScreenReaderFocus(null);
        moveScreenReaderFocus(undefined);

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();
    });
});
