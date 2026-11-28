/**
 * The foot the navigator gives the snackbar host: the tab bar on a tab, and on a task the larger of the home
 * indicator and the height a task screen's own bottom bar reports. Tabs and tasks are stubs that show the foot they
 * read and call the reporter, so what is asserted is the navigator's arithmetic.
 */
import { renderWithProviders } from '@commise/test-utils';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { StackActions } from '@react-navigation/native';
import type { ComponentType, JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { navigationRef } from '../../src/navigation/navigationRef.js';
import { TAB_BAR } from './pageFootProbe.js';

const HOME_INDICATOR = 34;

vi.mock('@sentry/react-native', () => ({ captureException: vi.fn() }));
vi.mock('react-native-safe-area-context', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: 'user_1' }) }));
vi.mock('../../src/navigation/TabsNavigator.js', async () => {
    const { TabsProbe } = await import('./pageFootProbe.js');

    return { TabsNavigator: TabsProbe };
});
/** The height each stub dock reports, by recipe id. */
const dockHeights = vi.hoisted(() => new Map<string, number>());
vi.mock('../../src/navigation/tasks.js', async () => {
    const { DockProbe } = await import('./dockProbe.js');
    const { useRoute } = await import('@react-navigation/native');

    function Cooking(): JSX.Element {
        const { params } = useRoute();
        const { recipeId } = params as { recipeId: string };

        return <DockProbe name={`cooking ${recipeId}`} height={dockHeights.get(recipeId) ?? 0} />;
    }

    return {
        taskScreens: (stack: { Screen: ComponentType<{ name: string; children: () => JSX.Element }> }) => (
            <>
                <stack.Screen name="CookingMode">{() => <Cooking />}</stack.Screen>
                <stack.Screen name="FoodDetail">{() => <DockProbe name="food" height={0} />}</stack.Screen>
            </>
        ),
    };
});

const { RootNavigator } = await import('../../src/navigation/RootNavigator.js');

afterEach(() => {
    cleanup();
    dockHeights.clear();
});

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const foot = (name: string) => screen.getByRole('heading', { name: new RegExp(`^${name} foot`) }).textContent;
const HOME = String(HOME_INDICATOR);
/** The foot a reported dock height makes: the screen pads the home indicator OUTSIDE, so the two add. */
const above = (dock: number): string => String(HOME_INDICATOR + dock);

/** Pushes, so a second cooking screen sits on top of the first instead of replacing its params. */
function openCooking(recipeId: string): void {
    act(() => {
        navigationRef.dispatch(StackActions.push('CookingMode', { recipeId }));
    });
}

describe('the foot the navigator provides', () => {
    it('is the tab bar on a tab, and ignores a dock height reported there', () => {
        renderWithProviders(<RootNavigator />);
        press('Measure tab bar');
        press('Report 90');

        expect(foot('tabs')).toBe(`tabs foot ${String(TAB_BAR)}`);
    });

    it('is the home indicator on a task whose bottom bar reports 0', () => {
        dockHeights.set('a', 0);
        renderWithProviders(<RootNavigator />);
        openCooking('a');

        expect(foot('cooking a')).toBe(`cooking a foot ${HOME}`);
    });

    it('lifts by the height a task reports, on top of the home indicator the screen pads outside it', () => {
        dockHeights.set('a', 90);
        renderWithProviders(<RootNavigator />);
        openCooking('a');

        expect(foot('cooking a')).toBe(`cooking a foot ${above(90)}`);
    });

    it('adds a dock height smaller than the home indicator to it, never takes the larger of the two', () => {
        dockHeights.set('a', 10);
        renderWithProviders(<RootNavigator />);
        openCooking('a');

        expect(foot('cooking a')).toBe(`cooking a foot ${above(10)}`);
    });

    it('drops the height while another task is above, and has it back on return without a new report', () => {
        dockHeights.set('a', 90);
        renderWithProviders(<RootNavigator />);
        openCooking('a');

        act(() => {
            navigationRef.navigate('FoodDetail', { foodId: 'f1', from: 'recipe' });
        });
        expect(foot('food')).toBe(`food foot ${HOME}`);

        act(() => {
            navigationRef.goBack();
        });
        expect(foot('cooking a')).toBe(`cooking a foot ${above(90)}`);
    });

    it('tells two screens of the same name apart by route key, each keeping its own height', () => {
        dockHeights.set('a', 90);
        dockHeights.set('b', 60);
        renderWithProviders(<RootNavigator />);
        openCooking('a');
        openCooking('b');
        expect(foot('cooking b')).toBe(`cooking b foot ${above(60)}`);

        act(() => {
            navigationRef.goBack();
        });
        expect(foot('cooking a')).toBe(`cooking a foot ${above(90)}`);
    });
});
