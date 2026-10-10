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

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
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
            screen.getByRole('heading', { name: 'Recipes' }),
            'focus',
        );
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2: the frame's heading says its name, so the frame carries none and the
 * heading is the one node that says it (N4).
 */
describe('CollectionListFrame (native) — N1: the frame’s name is said once, by its heading', () => {
    // Slice 3 (buildSpec §5.1): Collections is a segment of the Recipes destination, so the H1 reads "Recipes".
    it('says "Recipes" through one header, and no node is labelled with it', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                {null}
            </CollectionListFrame>,
        );

        expect(screen.getAllByRole('heading', { name: 'Recipes' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('Recipes')).toEqual([]);
    });
});

/**
 * Slice 3 replaced the slice 2 secondary header Button with the floating create button (buildSpec §5.1). The FAB's
 * own face is pinned by `@commise/ui`'s `CreateFab` suite; this pins that the frame offers ONE create control.
 */
describe('CollectionListFrame (native) — the floating create button (UI overhaul slice 3)', () => {
    it('offers exactly one "New collection" control, the floating button', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <Text>boundary content</Text>
            </CollectionListFrame>,
        );

        expect(screen.getAllByRole('button', { name: 'New collection' })).toHaveLength(1);
    });

    it('hides it during the first run, whose own start buttons take its place (buildSpec §3.4)', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0} firstRun>
                <Text>boundary content</Text>
            </CollectionListFrame>,
        );

        expect(screen.queryByRole('button', { name: 'New collection' })).toBeNull();
    });
});
