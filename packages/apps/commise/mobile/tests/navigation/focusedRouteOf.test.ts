import type { NavigationState, PartialState } from '@react-navigation/native';
import { describe, expect, it } from 'vitest';

import { focusedRouteOf } from '../../src/navigation/focusedRootRoute.js';

const routes = [
    { key: 'Tabs-1', name: 'Tabs' },
    { key: 'CookingMode-2', name: 'CookingMode' },
];

describe('focusedRouteOf', () => {
    it('is the name and key of the route the state points at', () => {
        const state: PartialState<NavigationState> = { index: 1, routes };

        expect(focusedRouteOf(state)).toEqual({ name: 'CookingMode', key: 'CookingMode-2' });
    });

    it('is the first route when the state has no index', () => {
        expect(focusedRouteOf({ routes })).toEqual({ name: 'Tabs', key: 'Tabs-1' });
    });

    it('tells two routes of one name apart by key', () => {
        const state = { index: 2, routes: [...routes, { key: 'CookingMode-3', name: 'CookingMode' }] };

        expect(focusedRouteOf(state)).toEqual({ name: 'CookingMode', key: 'CookingMode-3' });
    });

    it('has neither before the container is ready', () => {
        expect(focusedRouteOf(undefined)).toEqual({ name: undefined, key: undefined });
    });
});
