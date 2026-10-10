/**
 * The focused-task routes (`navigation/tasks.tsx`): each adapts the navigator to the editor screen's callbacks. Its leave
 * subscription must be STABLE across the route's renders (staff-code-quality, 2026-10-09 review): an inline function was
 * a new dependency each render, so the screen removed and re-added its `beforeRemove` listener every time the route
 * re-rendered. A real native stack; the editor screen is a stub that records what it is handed.
 */
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RootStackParamList } from '../../src/navigation/routes.js';

/** Every `subscribeToLeave` the stub was handed, one per render. */
const handed = vi.hoisted(() => ({ leaves: [] as unknown[], setParams: undefined as (() => void) | undefined }));

vi.mock('../../src/screens/RecipeEditorScreen.js', () => ({
    RecipeEditorScreen: (props: { readonly subscribeToLeave?: unknown }) => {
        const navigation = useNavigation();

        handed.leaves.push(props.subscribeToLeave);
        handed.setParams = () => navigation.setParams({ section: 'steps' } as never);

        return null;
    },
}));

const { taskScreens } = await import('../../src/navigation/tasks.js');

afterEach(() => {
    cleanup();
    handed.leaves = [];
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
                <NavigationContainer initialState={{ routes: [{ name, params }] }}>
                    <Stack.Navigator>{taskScreens(Stack)}</Stack.Navigator>
                </NavigationContainer>,
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
