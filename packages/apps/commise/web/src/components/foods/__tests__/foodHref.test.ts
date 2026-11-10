/**
 * The food page's address (private foods spec section 5): one authority for every web link to it, and one way to open it
 * in a new tab (spec D5: the page the cook opened it from stays where they left it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const basePath = vi.hoisted(() => ({ value: '' }));

vi.mock('@/lib/basePath', () => ({
    withBasePath: (path: string) => `${basePath.value}${path}`,
}));

import { foodHref, openFoodInNewTab } from '../foodHref';

afterEach(() => {
    vi.restoreAllMocks();
    basePath.value = '';
});

describe('foodHref', () => {
    it.each([
        ['en', 'food_1', '/en/foods/food_1'],
        ['fr', '01JPR1VATEF00D000000000000', '/fr/foods/01JPR1VATEF00D000000000000'],
    ])('addresses the %s page of %s under its locale', (locale, id, href) => {
        expect(foodHref(locale, id)).toBe(href);
    });

    it('encodes the id, so an id is always one path segment', () => {
        expect(foodHref('en', 'a/b?c')).toBe('/en/foods/a%2Fb%3Fc');
    });
});

describe('openFoodInNewTab', () => {
    it('opens the base-pathed address in a new tab with no opener', () => {
        basePath.value = '/pr-91';
        const open = vi.spyOn(window, 'open').mockReturnValue(null);

        openFoodInNewTab('en', 'food_1');

        expect(open).toHaveBeenCalledExactlyOnceWith('/pr-91/en/foods/food_1', '_blank', 'noopener');
    });
});
