/**
 * Unit tests for {@link RecipeDeletedNotice}: My recipes says "Recipe deleted" when a delete landed the cook there (owner
 * decision 2026-10-13, 4). The detail page cannot say it itself, because its snackbar host goes with it.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeDeletedNotice } from '../RecipeDeletedNotice';
import { recipesAfterDeleteHref } from '../recipesAfterDeleteHref';

const { searchState } = vi.hoisted(() => ({ searchState: { value: '' } }));

vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(searchState.value),
}));

/** Arrive at `href`, in the address and in what `useSearchParams` reads. */
function arriveAt(href: string): void {
    const url = new URL(href, 'http://localhost');
    searchState.value = url.search.slice(1);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
}

afterEach(() => {
    searchState.value = '';
    window.history.replaceState(null, '', '/');
});

describe('RecipeDeletedNotice', () => {
    it('says “Recipe deleted” as a status on the page a delete lands on', async () => {
        arriveAt(recipesAfterDeleteHref('en'));

        render(
            <SnackbarHost>
                <RecipeDeletedNotice />
            </SnackbarHost>,
        );

        expect((await screen.findByText('Recipe deleted')).closest('[role="status"]')).not.toBeNull();
        expect(window.location.search).toBe('');
    });

    it.each(['/en/recipes', '/en/recipes?deleted=0', '/en/recipes?deleted=yes'])(
        'says nothing at %s, which no delete produced',
        (href) => {
            arriveAt(href);

            render(
                <SnackbarHost>
                    <RecipeDeletedNotice />
                </SnackbarHost>,
            );

            expect(screen.queryByText('Recipe deleted')).not.toBeInTheDocument();
        },
    );
});
