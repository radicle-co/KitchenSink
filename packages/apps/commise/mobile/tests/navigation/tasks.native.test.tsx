/**
 * The focused-task routes (`navigation/tasks.tsx`): each adapts the navigator to the editor screen's callbacks. Its leave
 * subscription must be STABLE across the route's renders (staff-code-quality, 2026-10-09 review): an inline function was
 * a new dependency each render, so the screen removed and re-added its `beforeRemove` listener every time the route
 * re-rendered. A real native stack; the editor screen is a stub that records what it is handed.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { NavigationContainer, useNavigation, useRoute } from '@react-navigation/native';
import { onlineManager } from '@tanstack/react-query';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RootStackParamList } from '../../src/navigation/routes.js';
import { render } from '@commise/ui/testing/tamagui';

/** Every `subscribeToLeave` the stub was handed, one per render. */
const handed = vi.hoisted(() => ({
    leaves: [] as unknown[],
    setParams: undefined as (() => void) | undefined,
    foodPages: [] as { readonly foodId: string; readonly offline: boolean }[],
    /** The `line` each render of the editor stub was handed, and the `line` the route's params hold after each. */
    lines: [] as unknown[],
    routeLines: [] as unknown[],
}));

vi.mock('../../src/screens/RecipeEditorScreen.js', () => ({
    RecipeEditorScreen: (props: { readonly subscribeToLeave?: unknown; readonly line?: unknown }) => {
        const navigation = useNavigation();
        const route = useRoute();

        handed.leaves.push(props.subscribeToLeave);
        handed.lines.push(props.line);
        handed.routeLines.push((route.params as { readonly line?: unknown } | undefined)?.line);
        handed.setParams = () => navigation.setParams({ section: 'steps' } as never);

        return null;
    },
}));

vi.mock('@commise/features-recipes/food-page/mobile', () => ({
    FoodDetailScreen: (props: { readonly foodId: string; readonly offline: boolean }) => {
        handed.foodPages.push({ foodId: props.foodId, offline: props.offline });

        return null;
    },
}));

const { taskScreens } = await import('../../src/navigation/tasks.js');

afterEach(() => {
    cleanup();
    handed.leaves = [];
    handed.foodPages = [];
    handed.lines = [];
    handed.routeLines = [];
    onlineManager.setOnline(true);
});

describe('taskScreens', () => {
    it.each([
        ['RecipeCreate', undefined],
        ['RecipeEdit', { recipeId: 'rec_1' }],
    ] as const)(
        '⛔ %s hands the editor one leave subscription for the route`s life, across re-renders',
        async (name, params) => {
            const Stack = createNativeStackNavigator<RootStackParamList>();

            render(
                // The routes tell the cook how the editor finished (E8), through the snackbar host above the stack.
                <SnackbarHost>
                    <NavigationContainer initialState={{ routes: [{ name, params }] }}>
                        <Stack.Navigator>{taskScreens(Stack)}</Stack.Navigator>
                    </NavigationContainer>
                </SnackbarHost>,
            );
            await act(async () => {
                await Promise.resolve();
            });
            const rendersBefore = handed.leaves.length;

            // New params re-render the route component, which is where an inline function would be minted again.
            act(() => {
                handed.setParams?.();
            });

            expect(handed.leaves.length).toBeGreaterThan(rendersBefore);
            expect(new Set(handed.leaves).size).toBe(1);
            expect(typeof handed.leaves[0]).toBe('function');
        },
    );
});

/**
 * A deep link's `line` is read once, when the editor opens. Left in the route's params, a later re-render or a
 * restored navigation state would carry the address of a line the cook has since changed, so the route lets go of it
 * after use, as the web strips the hash.
 */
describe('RecipeEdit — the deep link’s line is used once', () => {
    it('hands the editor the line, then clears it from the route params', async () => {
        const Stack = createNativeStackNavigator<RootStackParamList>();
        const line = { version: 3, position: 1 };

        render(
            <SnackbarHost>
                <NavigationContainer
                    initialState={{
                        routes: [{ name: 'RecipeEdit', params: { recipeId: 'rec_1', section: 'ingredients', line } }],
                    }}
                >
                    <Stack.Navigator>{taskScreens(Stack)}</Stack.Navigator>
                </NavigationContainer>
            </SnackbarHost>,
        );
        await act(async () => {
            await Promise.resolve();
        });

        expect(handed.lines[0]).toEqual(line);
        expect(handed.routeLines[0]).toEqual(line);
        expect(handed.routeLines.at(-1)).toBeUndefined();
    });
});

describe('the food page route', () => {
    it.each([
        [false, true],
        [true, false],
    ])('hands the screen the app’s connectivity reading (offline: %s)', async (offline, online) => {
        onlineManager.setOnline(online);
        const Stack = createNativeStackNavigator<RootStackParamList>();

        render(
            <SnackbarHost>
                <NavigationContainer
                    initialState={{ routes: [{ name: 'FoodDetail', params: { foodId: 'food_1', from: 'editor' } }] }}
                >
                    <Stack.Navigator>{taskScreens(Stack)}</Stack.Navigator>
                </NavigationContainer>
            </SnackbarHost>,
        );
        await act(async () => {
            await Promise.resolve();
        });

        expect(handed.foodPages.at(-1)).toEqual({ foodId: 'food_1', offline });
    });
});
