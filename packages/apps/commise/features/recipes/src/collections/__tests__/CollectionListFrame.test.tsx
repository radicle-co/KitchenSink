// @vitest-environment jsdom
/**
 * Component tests for the web collection-list FRAME — the chrome that renders outside the list's suspense boundary,
 * so a pending or failed read never unmounts the heading or the create action.
 *
 * Moved from the retired `CollectionList.test.tsx` ("chrome", and the notice's focus move, which now arrives as the
 * frame's `headingFocusSignal` because the notice sits inside the boundary and the heading outside it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CollectionListFrame } from '../CollectionListFrame.js';

afterEach(cleanup);

const noop = () => undefined;

describe('CollectionListFrame (web)', () => {
    it('renders the heading, the create action and whatever the boundary below it renders', () => {
        render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                <p>boundary content</p>
            </CollectionListFrame>,
        );

        expect(screen.getByRole('heading', { name: 'Collections' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New collection' })).toBeTruthy();
        expect(screen.getByText('boundary content')).toBeTruthy();
    });

    it('reports create requests upward', async () => {
        const user = userEvent.setup();
        const onCreate = vi.fn();
        render(
            <CollectionListFrame onCreate={onCreate} headingFocusSignal={0}>
                {null}
            </CollectionListFrame>,
        );

        await user.click(screen.getByRole('button', { name: 'New collection' }));

        expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it('⛔ moves focus to the heading when the recovery signal advances, and not on mount', () => {
        const { rerender } = render(
            <CollectionListFrame onCreate={noop} headingFocusSignal={0}>
                {null}
            </CollectionListFrame>,
        );

        expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Collections' }));

        rerender(
            <CollectionListFrame onCreate={noop} headingFocusSignal={1}>
                {null}
            </CollectionListFrame>,
        );

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Collections' }));
    });
});
