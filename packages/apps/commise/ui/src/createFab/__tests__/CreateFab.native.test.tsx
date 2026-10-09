/**
 * The native CreateFab (buildSpec §3.4; D13): named by its label in every form; seafoam-tinted interactive Liquid Glass
 * on iOS 26 and a solid `action` surface elsewhere; a disc while a phone scrolls down; a tablet keeps its label; hidden
 * with the keyboard and in first run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const env = vi.hoisted(() => ({
    glass: false,
    width: 390,
    keyboard: false,
    glassProps: [] as Record<string, unknown>[],
}));

vi.mock('expo-glass-effect', async () => {
    const { View } = await import('react-native');

    return {
        isLiquidGlassAvailable: () => env.glass,
        isGlassEffectAPIAvailable: () => env.glass,
        GlassView: ({ children, ...props }: Record<string, unknown> & { children?: unknown }) => {
            env.glassProps.push(props);

            return <View testID="glass-view">{children as never}</View>;
        },
    };
});
vi.mock('../../screenEnvironment/useWindowWidth.native.js', () => ({ useWindowWidth: () => env.width }));
vi.mock('../../screenEnvironment/useKeyboardOpen.native.js', () => ({ useKeyboardOpen: () => env.keyboard }));

import type { ScrollBind } from '../../scrollHost/props.js';
import { ScrollHost } from '../../scrollHost/ScrollHost.native.js';
import { role } from '../../tokens/colors.js';
import { CreateFab } from '../CreateFab.native.js';

beforeEach(() => {
    env.glass = false;
    env.width = 390;
    env.keyboard = false;
    env.glassProps = [];
});
afterEach(cleanup);

function renderFab(firstRun = false, onPress = vi.fn()): { scroll: (y: number) => void } {
    const seen: { bind?: ScrollBind } = {};

    render(
        <ScrollHost>
            {(bind) => {
                seen.bind = bind;

                return <CreateFab label="New recipe" icon="plus" onPress={onPress} firstRun={firstRun} />;
            }}
        </ScrollHost>,
    );

    return {
        scroll: (y) =>
            act(() =>
                seen.bind?.onScroll({
                    nativeEvent: {
                        contentOffset: { y },
                        layoutMeasurement: { height: 800 },
                        contentSize: { height: 4000 },
                    },
                }),
            ),
    };
}

const fab = (): HTMLElement => screen.getByRole('button', { name: 'New recipe' });

describe('CreateFab (native)', () => {
    it('is a button named by its label that runs the create action, with the label on its face', () => {
        const onPress = vi.fn();
        renderFab(false, onPress);

        fireEvent.click(fab());

        expect(onPress).toHaveBeenCalledOnce();
        expect(screen.getAllByText('New recipe').length).toBeGreaterThanOrEqual(1);
    });

    it('draws seafoam-tinted, interactive Liquid Glass on iOS 26', () => {
        env.glass = true;
        renderFab();

        expect(screen.getByTestId('glass-view')).toBeTruthy();
        expect(env.glassProps[0]).toMatchObject({ tintColor: role.action, isInteractive: true, colorScheme: 'auto' });
    });

    it('draws a solid action surface everywhere else', () => {
        renderFab();

        expect(screen.queryByTestId('glass-view')).toBeNull();
    });

    it('shrinks to a disc while a phone scrolls down, keeping its name, and grows back on scroll up', () => {
        const { scroll } = renderFab();
        const visibleLabels = (): number =>
            screen.queryAllByText('New recipe').filter((node) => node.getAttribute('aria-hidden') !== 'true').length;

        expect(visibleLabels()).toBe(1);
        scroll(600);
        expect(visibleLabels()).toBe(0);
        expect(fab()).toBeTruthy();
        scroll(200);
        expect(visibleLabels()).toBe(1);
    });

    it('keeps the label on a tablet while scrolling down', () => {
        env.width = 820;
        const { scroll } = renderFab();

        scroll(600);

        expect(
            screen.queryAllByText('New recipe').filter((node) => node.getAttribute('aria-hidden') !== 'true'),
        ).toHaveLength(1);
    });

    it('stays a disc when its label is wider than half the window (a long translation, a large text size)', () => {
        renderFab();
        // react-native-web stores `onLayout` on the node as `__reactLayoutHandler`; the twin is the aria-hidden label.
        const twin = screen.getAllByText('New recipe').find((node) => node.getAttribute('aria-hidden') === 'true') as
            (HTMLElement & { __reactLayoutHandler?: (event: unknown) => void }) | undefined;

        act(() => twin?.__reactLayoutHandler?.({ nativeEvent: { layout: { width: 200, height: 20 } } }));

        expect(
            screen.queryAllByText('New recipe').filter((node) => node.getAttribute('aria-hidden') !== 'true'),
        ).toHaveLength(0);
        expect(fab()).toBeTruthy();
    });

    it('hides with the keyboard and in first run', () => {
        env.keyboard = true;
        renderFab();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        cleanup();

        env.keyboard = false;
        renderFab(true);
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });
});
