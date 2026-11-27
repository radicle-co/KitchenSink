/**
 * The foot the navigator gives the snackbar host: the tab bar on a tab, and on a task the larger of the home
 * indicator and the height a task screen's own bottom bar reports. Tabs and tasks are stubs that show the foot they
 * read and call the reporter, so what is asserted is the navigator's arithmetic.
 */
import { renderWithProviders } from '@commise/test-utils';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
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
    const { Probe } = await import('./pageFootProbe.js');

    return {
        TabsNavigator: (props: { onTabBarHeight: (height: number) => void }) => (
            <Probe name="tabs" tabBar={props.onTabBarHeight} />
        ),
    };
});
vi.mock('../../src/navigation/tasks.js', async () => {
    const { Probe: TaskProbe } = await import('./pageFootProbe.js');

    return {
        taskScreens: (stack: { Screen: ComponentType<{ name: string; children: () => JSX.Element }> }) => (
            <stack.Screen name="CookingMode">{() => <TaskProbe name="task" />}</stack.Screen>
        ),
    };
});

const { RootNavigator } = await import('../../src/navigation/RootNavigator.js');

afterEach(cleanup);

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const foot = (name: string) => screen.getByRole('heading', { name: new RegExp(`^${name} foot`) }).textContent;

function openTask(): void {
    act(() => navigationRef.navigate('CookingMode' as never));
}

describe('the foot the navigator provides', () => {
    it('is the tab bar on a tab, and ignores a dock height reported there', () => {
        renderWithProviders(<RootNavigator />);
        press('Measure tab bar');
        press('Report 90');

        expect(foot('tabs')).toBe(`tabs foot ${TAB_BAR}`);
    });

    it('is the home indicator on a task until its bottom bar reports', () => {
        renderWithProviders(<RootNavigator />);
        openTask();

        expect(foot('task')).toBe(`task foot ${HOME_INDICATOR}`);
    });

    it('lifts to a reported dock height on a task, and drops to the home indicator when it reports 0', () => {
        renderWithProviders(<RootNavigator />);
        openTask();

        press('Report 90');
        expect(foot('task')).toBe('task foot 90');

        press('Report 0');
        expect(foot('task')).toBe(`task foot ${HOME_INDICATOR}`);
    });

    it('never goes below the home indicator for a dock height smaller than it', () => {
        renderWithProviders(<RootNavigator />);
        openTask();

        press('Report 10');

        expect(foot('task')).toBe(`task foot ${HOME_INDICATOR}`);
    });
});
