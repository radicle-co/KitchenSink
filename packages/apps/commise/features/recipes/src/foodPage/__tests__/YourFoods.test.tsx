// @vitest-environment jsdom
/**
 * Web tests for the "Your foods" Profile row and list (spec section 16, F19, and revision 4): the row’s accessible name
 * carries the count of new decisions, the dot shows only with one, and each list row names the food with the same badges
 * the food page shows.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YourFoodsList } from '../YourFoodsList.js';
import { YourFoodsRow } from '../YourFoodsRow.js';
import type { YourFoodsListProps } from '../yourFoodsViewProps.js';

afterEach(cleanup);

const ITEMS: YourFoodsListProps['items'] = [
    { id: 'f1', name: 'Oat milk', publicationState: 'asked', updatedAt: '2026-11-09T10:00:00.000Z' },
    { id: 'f2', name: 'Spice mix', publicationState: 'private', updatedAt: '2026-11-08T10:00:00.000Z' },
];

const list = (props: Partial<YourFoodsListProps> = {}) =>
    render(
        <YourFoodsList
            phase="ready"
            items={ITEMS}
            hasMore={false}
            loadingMore={false}
            onOpen={vi.fn()}
            onRetry={vi.fn()}
            onLoadMore={vi.fn()}
            {...props}
        />,
    );

describe('YourFoodsRow (web)', () => {
    it('with no new decision it is named "Your foods" and draws no dot', () => {
        const { container } = render(<YourFoodsRow unseenDecisions={0} onPress={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Your foods' })).toBeTruthy();
        expect(container.querySelector('.bg-action')).toBeNull();
    });

    it('with one it is named "Your foods, 1 new decision" and draws the 8 px dot', () => {
        const { container } = render(<YourFoodsRow unseenDecisions={1} onPress={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Your foods, 1 new decision' })).toBeTruthy();
        expect(container.querySelector('.bg-action.size-2')).not.toBeNull();
    });

    it('pluralises: 3 new decisions', () => {
        render(<YourFoodsRow unseenDecisions={3} onPress={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Your foods, 3 new decisions' })).toBeTruthy();
    });

    it('is a link when it has a destination, and a plain click is the app’s own navigation', async () => {
        const onPress = vi.fn();
        render(<YourFoodsRow unseenDecisions={0} href="/en/foods" onPress={onPress} />);

        await userEvent.click(screen.getByRole('link', { name: 'Your foods' }));
        expect(onPress).toHaveBeenCalledOnce();
    });
});

describe('YourFoodsList (web)', () => {
    it('names each food with the badges its page shows', () => {
        list();

        expect(screen.getByText('Oat milk')).toBeTruthy();
        expect(screen.getByText('Waiting for review')).toBeTruthy();
        expect(screen.getByText('Spice mix')).toBeTruthy();
    });

    it('opening a row calls onOpen with that food', async () => {
        const onOpen = vi.fn();
        list({ onOpen, hrefOf: (id) => `/en/foods/${id}` });

        await userEvent.click(screen.getByRole('link', { name: /Spice mix/u }));
        expect(onOpen).toHaveBeenCalledWith('f2');
    });

    it('empty, loading and failed are states of the list; failed retries', async () => {
        const onRetry = vi.fn();
        const { unmount } = list({ items: [] });

        expect(screen.getByText(/You haven’t made any foods yet/u)).toBeTruthy();
        unmount();
        list({ phase: 'error', onRetry });
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledOnce();
    });

    it('Show more appears only when there is more, and asks for it', async () => {
        const onLoadMore = vi.fn();
        list({ hasMore: true, onLoadMore });

        await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
        expect(onLoadMore).toHaveBeenCalledOnce();
    });
});
