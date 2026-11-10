/**
 * Component tests for FoodPageContainer (private foods spec section 5): the route's own wiring over the shared food page
 * session. The session and the two views are replaced by stubs, because their states are covered in
 * `features/recipes/src/foodPage/__tests__`; what this file pins is what only the container decides: the title (the
 * food's name, else the fallback), Back going to My recipes, and the edit sheet mounted on the session's edit handle.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { expectOneBackInBarAndOneInHeader } from '@commise/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoodPageContainer } from '@/components/foods/FoodPageContainer';

const { pushMock, sessionRef, sessionArgs } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    sessionRef: { current: {} as Record<string, unknown> },
    sessionArgs: [] as unknown[][],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

vi.mock('@commise/features-recipes/food-page', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useFoodPage: (...args: unknown[]) => {
        sessionArgs.push(args);

        return sessionRef.current;
    },
    FoodPageView: ({ onLeave }: { readonly onLeave: () => void }) => (
        <button type="button" onClick={onLeave}>
            leave the food page
        </button>
    ),
    FoodEditSheet: ({ session }: { readonly session: unknown }) => (
        <p>{session === sessionRef.current['edit'] ? 'edit sheet on the session' : 'edit sheet on something else'}</p>
    ),
}));

afterEach(() => {
    vi.clearAllMocks();
    sessionArgs.length = 0;
    onlineManager.setOnline(true);
});

const mount = (state: unknown) => {
    sessionRef.current = { state, edit: { marker: 'edit' } };

    return render(
        <LocaleProvider locale="en">
            <FoodPageContainer foodId="food_1" locale="en" />
        </LocaleProvider>,
    );
};

describe('FoodPageContainer', () => {
    it.each([
        [false, true],
        [true, false],
    ])('hands the session the app’s connectivity reading (offline: %s)', (offline, online) => {
        onlineManager.setOnline(online);
        mount({ kind: 'loading' });

        expect(sessionArgs.at(-1)).toEqual(['food_1', { offline }]);
    });

    it('titles the page with the food’s name', () => {
        mount({ kind: 'private', food: { name: 'Oat milk' } });

        expect(screen.getAllByRole('heading', { level: 1, name: 'Oat milk' }).length).toBeGreaterThan(0);
    });

    it('titles a page with no food with the fallback, not the word undefined', () => {
        mount({ kind: 'loading' });

        expect(screen.queryByText(/undefined/u)).toBeNull();
        expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
    });

    it('mounts the edit sheet on the session’s own edit handle', () => {
        mount({ kind: 'private', food: { name: 'Oat milk' } });

        expect(screen.getByText('edit sheet on the session')).toBeTruthy();
    });

    it('leaving the page goes to My recipes in the locale', async () => {
        mount({ kind: 'private', food: { name: 'Oat milk' } });

        await userEvent.setup().click(screen.getByRole('button', { name: 'leave the food page' }));

        expect(pushMock).toHaveBeenCalledWith('/en/recipes');
    });

    it('Back goes to My recipes in the locale', async () => {
        mount({ kind: 'private', food: { name: 'Oat milk' } });

        await userEvent.setup().click(screen.getAllByRole('link', { name: /my recipes/iu })[0] as HTMLElement);

        expect(pushMock).toHaveBeenCalledWith('/en/recipes');
    });

    it('has one Back in the pinned bar and one as the header’s eyebrow, so a wide screen has one too', () => {
        mount({ kind: 'private', food: { name: 'Oat milk' } });

        expectOneBackInBarAndOneInHeader('Back to My recipes');
    });

    it('starts at the page gutter the shell gives: no gutter of its own and not centred (buildSpec 1.3)', () => {
        mount({ kind: 'private', food: { name: 'Oat milk' } });
        const content = screen.getByRole('button', { name: 'leave the food page' }).parentElement as HTMLElement;

        expect(content.className).not.toMatch(/\bpx-\d|\bmx-auto\b/u);
    });
});
