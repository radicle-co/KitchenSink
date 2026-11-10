/**
 * Component tests for YourFoodsContainer (private foods spec F19 and section 5.1): a pushed page from Profile, so it has
 * the pinned bar's Back below 840 and the header's eyebrow Back from it, and it starts at the page gutter the shell gives
 * (buildSpec 1.3), not inside a second one. The read and the list are replaced by stubs: the list's own states are
 * covered in `features/recipes/src/foodPage/__tests__`.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { expectOneBackInBarAndOneInHeader } from '@commise/test-utils';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { YourFoodsContainer } from '@/components/foods/YourFoodsContainer';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@kitchensink/food-service-client/hooks', () => ({
    useOwnFoods: () => ({
        data: { pages: [{ items: [] }] },
        isError: false,
        isPending: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        refetch: vi.fn(),
        fetchNextPage: vi.fn(),
    }),
}));
vi.mock('@commise/features-recipes/food-page', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    YourFoodsList: () => <p>the list</p>,
}));

afterEach(() => {
    vi.clearAllMocks();
});

const mount = () =>
    render(
        <LocaleProvider locale="en">
            <YourFoodsContainer locale="en" />
        </LocaleProvider>,
    );

describe('YourFoodsContainer', () => {
    it('is titled "Your foods" and shows the list', () => {
        mount();

        expect(screen.getAllByRole('heading', { level: 1, name: 'Your foods' }).length).toBeGreaterThan(0);
        expect(screen.getByText('the list')).toBeTruthy();
    });

    it('has one Back to Profile in the pinned bar and one as the header’s eyebrow', () => {
        mount();

        expectOneBackInBarAndOneInHeader('Back to Profile');
    });

    it('starts at the page gutter the shell gives: no gutter of its own and not centred', () => {
        mount();
        const content = screen.getByText('the list').parentElement as HTMLElement;

        expect(content.className).not.toMatch(/\bpx-\d|\bmx-auto\b/u);
    });
});
