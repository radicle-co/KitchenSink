/**
 * The cook segment's loading frame (`/[locale]/recipes/[id]/cook/loading.tsx`): it is the only thing a cook sees while
 * the page loads, so its Exit must work and must go to the recipe page, as the settled route's Exit does.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CookingLoading from '@/app/[locale]/recipes/[id]/cook/loading';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('next/navigation', () => ({
    useParams: () => ({ locale: 'en', id: 'rec_1' }),
    useRouter: () => ({ replace: replaceMock }),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('CookingLoading', () => {
    it('draws the loading frame, and its Exit replaces the route with the recipe page', async () => {
        render(
            <LocaleProvider locale="en">
                <CookingLoading />
            </LocaleProvider>,
        );

        expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
        await userEvent.setup().click(screen.getByRole('button', { name: 'Exit cooking mode' }));

        expect(replaceMock).toHaveBeenCalledExactlyOnceWith('/en/recipes/rec_1');
    });
});
