// @vitest-environment jsdom
/**
 * Component tests for the web collection-list FRAME — the chrome that renders outside the list's suspense boundary,
 * so a pending or failed read never unmounts the heading or the create action.
 *
 * Moved from the retired `CollectionList.test.tsx` ("chrome", and the notice's focus move, which now arrives as the
 * frame's `headingFocusSignal` because the notice sits inside the boundary and the heading outside it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CollectionListFrame } from '../CollectionListFrame.js';
import { expectDesignSystemButton } from '../../__tests__/designSystemButton.js';

afterEach(cleanup);

const noop = () => undefined;

describe('CollectionListFrame (web)', () => {
    it('renders the heading, the create action and whatever the boundary below it renders', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <p>boundary content</p>
            </CollectionListFrame>,
        );

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
        // Slice 3: the wide screen's secondary Button beside the title, and the narrow screen's floating button. CSS
        // shows one at a time (`nav:` breakpoint); jsdom applies no media query, so both are in the tree.
        expect(screen.getAllByRole('button', { name: 'New collection' })).toHaveLength(2);
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('hides the floating button during the first run, whose own start buttons take its place (buildSpec §3.4)', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0} firstRun>
                <p>boundary content</p>
            </CollectionListFrame>,
        );

        // The wide screen's header Button stays: from 840 there is no floating button to hide.
        expect(screen.getAllByRole('button', { name: 'New collection' })).toHaveLength(1);
    });

    it('reports create requests upward', async () => {
        const user = userEvent.setup();
        const onCreate = vi.fn();
        render(
            <CollectionListFrame onCreate={onCreate} headingFocusSignal={0}>
                {null}
            </CollectionListFrame>,
        );

        await user.click(screen.getAllByRole('button', { name: 'New collection' })[0] as HTMLElement);

        expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('⛔ moves focus to the heading when the recovery signal advances, and not on mount', () => {
        const { rerender } = render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                {null}
            </CollectionListFrame>,
        );

        expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Recipes' }));

        rerender(
            <CollectionListFrame onCreate={noop} headingFocusSignal={1}>
                {null}
            </CollectionListFrame>,
        );

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Recipes' }));
    });
});

describe('CollectionListFrame (web) — the header action (slice 4, `buildSpec.md` §5.1)', () => {
    // The first run's own New collection is the view's one primary; the header's is the secondary beside the title.
    it('creates through a secondary plus Button', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <p>boundary content</p>
            </CollectionListFrame>,
        );

        expectDesignSystemButton(
            screen.getAllByRole('button', { name: 'New collection' })[0] as HTMLElement,
            'secondary',
            'plus',
        );
    });
});

describe('CollectionListFrame (web) — the segments', () => {
    it('renders My recipes · Collections with Collections current, handing a plain click over', () => {
        const onSelect = vi.fn();
        render(
            <CollectionListFrame
                onCreate={noop}
                headingFocusSignal={0}
                segments={{
                    current: 'collections',
                    href: { mine: '/en/recipes', collections: '/en/collections' },
                    onSelect,
                }}
            >
                <p>boundary content</p>
            </CollectionListFrame>,
        );

        expect(screen.getByRole('link', { name: 'Collections' }).getAttribute('aria-current')).toBe('page');

        fireEvent.click(screen.getByRole('link', { name: 'My recipes' }), { button: 0 });

        expect(onSelect).toHaveBeenCalledWith('mine');
    });
});
