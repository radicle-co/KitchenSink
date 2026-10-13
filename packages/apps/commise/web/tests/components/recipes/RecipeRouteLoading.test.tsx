/**
 * The recipe routes' loading boundaries (D3, `buildSpec.md` §6.7 and §6.6). `loading.tsx` shows while a segment's server
 * render resolves; the container's own boundary shows while its query does. They must be the SAME skeleton, or the swap
 * from one to the other shifts the layout.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecipeDetailRouteLoading } from '@/components/recipes/RecipeDetailRouteLoading';
import { RecipeVersionsRouteLoading } from '@/components/recipes/RecipeVersionsRouteLoading';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useParams: () => ({ locale: 'en', id: 'rec_1' }),
    useRouter: () => ({ push: pushMock }),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const inLocale = (ui: React.ReactElement) => render(<LocaleProvider locale="en">{ui}</LocaleProvider>);

describe('RecipeDetailRouteLoading', () => {
    it('is the recipe page’s skeleton, named for what is loading', () => {
        const { container } = inLocale(<RecipeDetailRouteLoading />);

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toHaveTextContent('Loading recipe');
        expect(container.querySelector('.aspect-\\[4\\/3\\]')).not.toBeNull();
    });
});

describe('RecipeVersionsRouteLoading', () => {
    it('is the history’s skeleton under its header, with a way back to the recipe', async () => {
        const user = userEvent.setup();
        const { container } = inLocale(<RecipeVersionsRouteLoading />);

        expect(screen.getByRole('status', { name: 'Loading version history' })).toBeInTheDocument();
        expect(container.querySelectorAll('[data-skeleton-row]')).toHaveLength(3);

        await user.click(screen.getAllByRole('link', { name: 'Back to recipe' })[0] as HTMLElement);

        expect(pushMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });
});
