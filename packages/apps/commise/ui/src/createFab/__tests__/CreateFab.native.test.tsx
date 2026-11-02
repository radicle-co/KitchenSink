/**
 * The native CreateFab (buildSpec §3.4; D13): named by its label in every form; steel-tinted interactive Liquid Glass
 * on iOS 26 and a solid `action` surface elsewhere; a disc while a phone scrolls down; a tablet keeps its label; hidden
 * with the keyboard and while it yields.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { render } from '../../testing/tamaguiTesting.native.js';
import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

const env = vi.hoisted(() => ({
    glass: false,
    width: 390,
    keyboard: false,
    insets: { left: 0, right: 0 },
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
vi.mock('react-native-safe-area-context', async () => {
    const stub = await import('../../testing/safeAreaContext.native.js');

    return { ...stub, useSafeAreaInsets: () => ({ ...stub.STUB_INSETS, ...env.insets }) };
});
vi.mock('../../screenEnvironment/useWindowWidth.native.js', () => ({ useWindowWidth: () => env.width }));
vi.mock('../../screenEnvironment/useKeyboardOpen.native.js', () => ({ useKeyboardOpen: () => env.keyboard }));

import type { ScrollBind } from '../../scrollHost/props.js';
import { ScrollHost } from '../../scrollHost/ScrollHost.native.js';
import { role } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import { SnackbarHost } from '../../snackbar/SnackbarHost.native.js';
import { useSnackbar } from '../../snackbar/useSnackbar.js';
import { CreateFab } from '../CreateFab.native.js';
import { FAB_BOTTOM_MARGIN_PX } from '../createFabPolicy.js';

beforeEach(() => {
    env.glass = false;
    env.width = 390;
    env.keyboard = false;
    env.insets = { left: 0, right: 0 };
    env.glassProps = [];
});
afterEach(cleanup);

function renderFab(yielded = false, onPress = vi.fn()): { scroll: (y: number) => void } {
    const seen: { bind?: ScrollBind } = {};

    render(
        <ScrollHost>
            {(bind) => {
                seen.bind = bind;

                return <CreateFab label="New recipe" icon="plus" onPress={onPress} yielded={yielded} />;
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

    it('draws steel-tinted, interactive Liquid Glass on iOS 26', () => {
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

    it('hides with the keyboard and while it yields', () => {
        env.keyboard = true;
        renderFab();
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
        cleanup();

        env.keyboard = false;
        renderFab(true);
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('stays while it has focus when it must yield, and goes once focus leaves', () => {
        const tree = (yielded: boolean) => (
            <ScrollHost>
                {() => <CreateFab label="New recipe" icon="plus" onPress={vi.fn()} yielded={yielded} />}
            </ScrollHost>
        );
        const { rerender } = render(tree(false));

        act(() => fab().focus());
        rerender(tree(true));
        expect(fab()).toBeTruthy();

        act(() => fab().blur());
        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    // Owner 2026-10-13: held sideways, a side cutout or the 3-button navigation bar sits where the button's corner is.
    // It keeps its margin from the window's edge PLUS the inset on that side, so it is never under either.
    describe('sideways insets', () => {
        /** The button's end margin. A per-render style lands inline, and react-native-web resolves `end` to `right` (LTR). */
        const endOffset = (): string => fab().style.right;

        it('keeps its 16 dp margin when there is no side inset', () => {
            renderFab();

            expect(endOffset()).toBe('16px');
        });

        it('adds the inset on its own side: a 48 dp navigation bar moves a phone’s button to 64 dp', () => {
            env.insets = { left: 0, right: 48 };
            renderFab();

            expect(endOffset()).toBe('64px');
        });

        it('adds only the END-side inset to a tablet’s larger margin, and ignores the other side', () => {
            env.width = 1024;
            env.insets = { left: 59, right: 20 };
            renderFab();

            expect(endOffset()).toBe(`${String(nativeTokens.spacing[6] + 20)}px`);
        });
    });
});

// Bug sweep P7: the snackbar floats over the same corner as the button and covered it. The host (the app's root, outside
// the screen) tells the button how tall the snackbar is; the button rises above it by that plus 8 (Material's rule).
describe('CreateFab (native) — clear of a showing snackbar', () => {
    function Opener(): ReactElement {
        const { show } = useSnackbar();

        return (
            <Pressable
                accessibilityRole="button"
                onPress={() =>
                    show({ message: 'Recipe deleted', action: { label: 'Undo', onAction: () => undefined } })
                }
            >
                <Text>open snackbar</Text>
            </Pressable>
        );
    }

    function renderWithHost(): void {
        render(
            <SnackbarHost>
                <ScrollHost>
                    {() => (
                        <>
                            <Opener />
                            <CreateFab label="New recipe" icon="plus" onPress={vi.fn()} />
                        </>
                    )}
                </ScrollHost>
            </SnackbarHost>,
        );
    }

    /** Reports the snackbar region's height as react-native-web would: it stores the handler on the node. */
    const measureSnackbar = (height: number): void => {
        const region = screen.getByRole('status') as HTMLElement & {
            __reactLayoutHandler?: (event: unknown) => void;
        };

        act(() => region.__reactLayoutHandler?.({ nativeEvent: { layout: { y: 0, height } } }));
    };

    // The margin the screens' reserved foot is computed from (`FAB_RESERVED_BOTTOM_PX`), so the two cannot disagree.
    it('sits FAB_BOTTOM_MARGIN_PX (16) above the foot when no snackbar shows', () => {
        renderWithHost();

        expect(fab().style.bottom).toBe(`${String(FAB_BOTTOM_MARGIN_PX)}px`);
        expect(FAB_BOTTOM_MARGIN_PX).toBe(16);
    });

    it('rises above a showing snackbar by its height plus 8, and comes back down when it goes', () => {
        renderWithHost();

        fireEvent.click(screen.getByRole('button', { name: 'open snackbar' }));
        measureSnackbar(56);

        expect(fab().style.bottom).toBe('80px');

        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

        expect(fab().style.bottom).toBe('16px');
    });

    it('ignores a height reported while nothing shows', () => {
        renderWithHost();
        measureSnackbar(56);

        expect(fab().style.bottom).toBe('16px');
    });
});

describe('CreateFab (native) — a focus request', () => {
    it('takes focus when asked and says so once, which is how a sheet gives focus back to its opener', () => {
        const handled = vi.fn();
        render(
            <CreateFab
                label="New recipe"
                icon="plus"
                onPress={vi.fn()}
                focusRequested
                onFocusRequestHandled={handled}
            />,
        );

        expect(document.activeElement).toBe(fab());
        expect(handled).toHaveBeenCalledOnce();
    });

    it('does not take focus unless asked', () => {
        render(<CreateFab label="New recipe" icon="plus" onPress={vi.fn()} />);

        expect(document.activeElement).not.toBe(fab());
    });
});
