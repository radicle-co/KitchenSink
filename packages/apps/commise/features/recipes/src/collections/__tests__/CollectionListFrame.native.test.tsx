/**
 * Native component tests for the collection-list FRAME — the chrome outside the list's suspense boundary. Moved from
 * the retired `CollectionList.native.test.tsx` ("chrome", and the notice's focus move, now the `headingFocusSignal`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityInfo, Text } from 'react-native';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { CollectionListFrame } from '../CollectionListFrame.native.js';

// react-native-web does not implement `sendAccessibilityEvent`; the focus hand-off is asserted as the call it makes.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

afterEach(cleanup);

const noop = () => undefined;

describe('CollectionListFrame (native)', () => {
    it('renders the heading, the create action and whatever the boundary below it renders', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <Text>boundary content</Text>
            </CollectionListFrame>,
        );

        expect(screen.getByRole('heading', { name: 'Collections' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New collection' })).toBeTruthy();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('reports create requests upward', () => {
        const onCreate = vi.fn();
        render(
            <CollectionListFrame onCreate={onCreate} headingFocusSignal={0}>
                {null}
            </CollectionListFrame>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'New collection' }));

        expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('⛔ moves the screen-reader cursor to the heading when the recovery signal advances, and not on mount', () => {
        const { rerender } = render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                {null}
            </CollectionListFrame>,
        );

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        rerender(
            <CollectionListFrame onCreate={noop} headingFocusSignal={1}>
                {null}
            </CollectionListFrame>,
        );

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('heading', { name: 'Collections' }),
            'focus',
        );
    });
});
