/**
 * Sheet (native) on Tamagui's Sheet — what the component tier CAN prove about the engine: the props the sheet hands it
 * and the lifecycle it keeps around it. It cannot prove a drag, a spring or a completion callback, because the test lane's
 * driver is a CSS shim (ADR-0080 §6): those are `overlaySwipeDismiss.yaml`, `overlayBackOrder.yaml` and the reduce-motion
 * run on a device.
 *
 * ⚠️ Tamagui's `Sheet` is the real one, wrapped to record the props it was given; the test then calls `onOpenChange` and
 * `onTransition` itself, as the engine would. `Modal` is the real one, wrapped the same way, so `onRequestClose` (Android
 * Back) can be raised: react-native-web does not raise it from a test.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import {
    Text,
    type KeyboardAvoidingView as KeyboardAvoidingViewType,
    type Modal as ModalType,
    type View as ViewType,
} from 'react-native';
import { Sheet as TamaguiSheet } from 'tamagui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MODAL_CLOSE_EVENT } from '../../testing/modalCloseEvent.native.js';
import { render, renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import type { SheetProps } from '../props.js';
import { Sheet } from '../Sheet.native.js';
import { SHEET_EXIT_FALLBACK_MS } from '../sheetEngineLifecycle.js';

type EngineProps = ComponentProps<typeof TamaguiSheet>;

const swipe = vi.hoisted(() => ({ onDismiss: undefined as (() => void) | undefined }));

const state = vi.hoisted(() => ({
    reduceMotion: false as boolean | undefined,
    width: 390,
    modal: undefined as ComponentProps<typeof ModalType> | undefined,
    views: [] as ComponentProps<typeof ViewType>[],
    engine: undefined as ComponentProps<typeof TamaguiSheet> | undefined,
    overlay: undefined as Record<string, unknown> | undefined,
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: state.width }),
        View: (props: ComponentProps<typeof ViewType>) => {
            state.views.push(props);

            return createElement(actual.View, props);
        },
        KeyboardAvoidingView: (props: ComponentProps<typeof KeyboardAvoidingViewType>) =>
            createElement('div', { 'data-keyboard-avoider': true }, createElement(actual.KeyboardAvoidingView, props)),
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, { ...props, onShow: undefined, onDismiss: undefined });
        },
    };
});
vi.mock('tamagui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('tamagui')>();
    const Recorded = Object.assign((props: EngineProps) => {
        state.engine = props;

        return createElement(actual.Sheet, props);
    }, actual.Sheet);

    const Overlay = (props: Record<string, unknown>) => {
        state.overlay = props;

        return createElement(actual.Sheet.Overlay, props);
    };

    return { ...actual, Sheet: Object.assign(Recorded, { Overlay }) };
});
vi.mock('../../keyboardAvoider/KeyboardLift.native.js', async () => {
    const { createElement: h } = await import('react');

    return {
        KeyboardLift: ({
            children,
            topInset,
            bottomInset,
        }: {
            children: ReactNode;
            topInset: number;
            bottomInset: number;
        }) =>
            h(
                'div',
                { 'data-keyboard-lift': true, 'data-top-inset': topInset, 'data-bottom-inset': bottomInset },
                children,
            ),
    };
});
vi.mock('../useSwipeToDismiss.native.js', async () => {
    const { Animated } = await import('react-native');

    return {
        useSwipeToDismiss: (onDismiss: () => void) => {
            swipe.onDismiss = onDismiss;

            return { panHandlers: {}, translateY: new Animated.Value(0) };
        },
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, right: 6, bottom: 16, left: 4 }),
}));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => state.reduceMotion }));

beforeEach(() => {
    state.reduceMotion = false;
    state.width = 390;
    state.modal = undefined;
    state.views = [];
    state.engine = undefined;
    state.overlay = undefined;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const propsFor = (overrides: Partial<SheetProps> = {}): SheetProps => ({
    open: true,
    onOpenChange: vi.fn(),
    title: 'Filter recipes',
    closeLabel: 'Close filters',
    size: 'content',
    children: <Text>Dietary</Text>,
    ...overrides,
});

const engine = (): EngineProps => state.engine as EngineProps;

/** What Android Back does: the Modal asks to close. */
const back = (): void => {
    act(() => state.modal?.onRequestClose?.(MODAL_CLOSE_EVENT));
};

/** What the engine does when it starts to animate: a sheet with no layout never reports, and has no exit to wait for. */
const engineStartsAnimating = (): void => {
    act(() => engine().onTransition?.({ phase: 'start', cause: 'open', position: 0 }));
};

/** What the engine does at the end of its exit animation. */
const engineFinishedClosing = (): void => {
    act(() => engine().onTransition?.({ phase: 'end', cause: 'close', position: 800, finished: true }));
};

describe('the props the sheet hands Tamagui’s Sheet', () => {
    // Device gate 1 (Android): with `fit` the sheet opened collapsed, only its handle and the top of its title above the foot of
    // the screen. The engine now gets a frame as tall as the window, measured against a size its parent gives it, with the
    // panel standing at the foot of it. jsdom has no layout, so the lane pins the props that make that so; the device re-run
    // is the proof.
    it.each(['content', 'full', 'page'] as const)(
        'hands the engine a window-high frame whatever the size (%s)',
        (size) => {
            renderWithTamagui(<Sheet {...propsFor({ size })} />, 'light', 2);

            expect(engine().snapPointsMode).toBe('percent');
            expect(engine().snapPoints).toEqual([100]);
        },
    );

    // The engine sizes its content through `Sheet.Container`; the panel stands at its foot.
    it('puts the panel inside Tamagui’s Container, at the foot of the frame', () => {
        render(<Sheet {...propsFor()} />);

        const container = screen.getByRole('heading', { name: 'Filter recipes' }).closest('[data-state="open"]');

        expect(container).not.toBeNull();
        expect(getComputedStyle(container as Element).justifyContent).toBe('flex-end');
    });

    // Device gate (Android): the keyboard covered the sheet's action. The engine places its frame from the window, so the lift
    // stands INSIDE it, around the panel, and measures the box's bottom edge against the keyboard's top
    // (`KeyboardLift.native.test.tsx` pins that arithmetic).
    it('stands the keyboard lift inside the engine’s frame, around the panel', () => {
        render(<Sheet {...propsFor()} />);

        const container = screen.getByRole('heading', { name: 'Filter recipes' }).closest('[data-state="open"]');
        const lift = screen.getByRole('heading', { name: 'Filter recipes' }).closest('[data-keyboard-lift]');

        expect(lift).not.toBeNull();
        expect(container?.contains(lift)).toBe(true);
    });

    // Device gate (Android, Pixel 6): the frame is as tall as the window, and the backdrop used to pad it down by the status
    // bar, so its foot ended 48.76 dp BELOW the screen. The lift then measured an overlap larger than the keyboard is tall,
    // and the panel's action stayed under the keyboard. The frame now starts at the window top, and the status bar's room is
    // taken out of the panel's own space by the lift (`topInset`), so the frame's foot IS the screen's foot.
    it('hands the status bar inset to the lift, not to a padded backdrop that pushes the frame off the screen', () => {
        render(<Sheet {...propsFor()} />);

        const lift = screen.getByRole('heading', { name: 'Filter recipes' }).closest('[data-keyboard-lift]');

        expect(lift?.getAttribute('data-top-inset')).toBe('24');
        // The navigation bar's room too: Android's keyboard height leaves it out, and the window extends under it.
        expect(lift?.getAttribute('data-bottom-inset')).toBe('16');
    });

    it('keeps the engine in our window: modal is the literal false, no native sheet, no state of its own', () => {
        render(<Sheet {...propsFor()} />);

        expect(engine().modal).toBe(false);
        expect(engine().native).toBeUndefined();
        expect(engine().defaultOpen).toBeUndefined();
    });

    it('is controlled by open, so a request the host ignores leaves it open', () => {
        render(<Sheet {...propsFor()} />);

        expect(engine().open).toBe(true);
    });

    // Designer ruling 2026-11-02: a drag from the handle and the title row only; a drag in the content never moves the sheet.
    // Tamagui 3.1.9 drags a frame from anywhere on it and cannot limit the zone, so its drag is off and the panel's swipe asks
    // the host to close.
    it('turns the engine’s own drag off, and keeps the keyboard with our avoider', () => {
        render(<Sheet {...propsFor()} />);

        expect(engine().disableDrag).toBe(true);
        expect(engine().dismissOnSnapToBottom).toBeUndefined();
        expect(engine().moveOnKeyboardChange).toBe(false);
    });

    it('draws the scrim in the scrim role at full strength, since the engine’s skin dims its overlay again', () => {
        render(<Sheet {...propsFor()} />);

        expect(state.overlay?.['backgroundColor']).toBe('$scrim');
        // Full strength once open; the fade is the clause `enter:0 exit:0` while motion is on.
        expect(state.overlay?.['opacity']).toBe('1 enter:0 exit:0');
    });

    it('draws the scrim at plain full strength when motion is off', () => {
        state.reduceMotion = true;
        render(<Sheet {...propsFor()} />);

        expect(state.overlay?.['opacity']).toBe(1);
    });

    it('moves with the named spring when reduce motion is known to be off', () => {
        render(<Sheet {...propsFor()} />);

        expect(engine().transition).toBe('sheet');
        expect(engine().transitionConfig).toBeUndefined();
        expect(state.overlay?.['transition']).toBe('sheet');
    });

    it.each([
        ['on', true],
        ['not read yet', undefined],
    ] as const)('moves instantly, with no spring and no fade, when reduce motion is %s', (_state, answer) => {
        state.reduceMotion = answer;
        render(<Sheet {...propsFor()} />);

        expect(engine().transition).toBeUndefined();
        expect(engine().transitionConfig).toEqual({ type: 'timing', duration: 0 });
        // The overlay keeps its transition in every mode (`motionPropsOf`); with a constant opacity nothing fades.
        expect(state.overlay?.['opacity']).toBe(1);
        expect(state.overlay?.['enterStyle']).toBeUndefined();
    });
});

describe('the dismiss routes', () => {
    it('answers the screen-reader escape gesture with the same one request', () => {
        const props = propsFor();
        render(<Sheet {...props} />);

        const root = state.views.find((view) => view.onAccessibilityEscape !== undefined);

        act(() => root?.onAccessibilityEscape?.());

        expect(props.onOpenChange).toHaveBeenCalledTimes(1);
        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('answers Android Back with one close request', () => {
        const props = propsFor();
        render(<Sheet {...props} />);

        back();

        expect(props.onOpenChange).toHaveBeenCalledTimes(1);
        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('answers a press on the screen above the sheet (the scrim) with the same request', () => {
        const props = propsFor();
        render(<Sheet {...props} />);

        // The scrim catcher is the sibling that stands right behind the panel (and the tone scope around it).
        let node: Element | null = screen.getByRole('heading', { name: 'Filter recipes' }).closest('[role="dialog"]');

        while (node !== null && node.previousElementSibling === null) {
            node = node.parentElement;
        }

        fireEvent.click(node?.previousElementSibling as Element);

        expect(props.onOpenChange).toHaveBeenCalledTimes(1);
        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('answers a swipe on the handle and the title row with the same request', () => {
        const props = propsFor();
        render(<Sheet {...props} />);

        act(() => swipe.onDismiss?.());

        expect(props.onOpenChange).toHaveBeenCalledTimes(1);
        expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });

    it('stays open and rendered when the host ignores the request', () => {
        render(<Sheet {...propsFor()} />);

        back();

        expect(engine().open).toBe(true);
        expect(screen.getByText('Dietary')).toBeTruthy();
    });
});

describe('staying mounted until the exit has finished', () => {
    it('keeps the window up, with the engine told to close, until the engine reports the close done', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);
        engineStartsAnimating();

        rerender(<Sheet {...props} open={false} />);

        expect(state.modal?.visible).toBe(true);
        expect(engine().open).toBe(false);
        expect(screen.getByText('Dietary')).toBeTruthy();

        engineFinishedClosing();

        expect(state.modal?.visible).toBe(false);
    });

    it('leaves at once when the engine has never reported a transition, since nothing is animating', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);

        rerender(<Sheet {...props} open={false} />);

        expect(state.modal?.visible).toBe(false);
    });

    it.each([
        ['on', true],
        ['not read yet', undefined],
    ] as const)('unmounts at once, with no exit to wait for, when reduce motion is %s', (_state, answer) => {
        state.reduceMotion = answer;
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);
        engineStartsAnimating();

        rerender(<Sheet {...props} open={false} />);

        expect(state.modal?.visible).toBe(false);
    });

    it('hides the sheet from the screen reader as soon as open goes false, so focus can return to the opener', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);
        engineStartsAnimating();

        expect(screen.getByText('Dietary').closest('[aria-hidden="true"]')).toBeNull();

        rerender(<Sheet {...props} open={false} />);

        expect(screen.getByText('Dietary').closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('draws no window animation of its own, so only the engine animates the exit', () => {
        render(<Sheet {...propsFor()} />);

        expect(state.modal?.animationType).toBe('none');
    });

    it('does not take a close the engine reports as interrupted for a finished one', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);
        engineStartsAnimating();

        rerender(<Sheet {...props} open={false} />);
        act(() => engine().onTransition?.({ phase: 'end', cause: 'close', position: 800, finished: false }));
        act(() => engine().onTransition?.({ phase: 'start', cause: 'close', position: 800 }));

        expect(state.modal?.visible).toBe(true);
    });

    it('ignores the engine reporting an OPEN or a snap as the end of a close', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);
        engineStartsAnimating();

        rerender(<Sheet {...props} open={false} />);
        act(() => engine().onTransition?.({ phase: 'end', cause: 'open', position: 0, finished: true }));
        act(() => engine().onTransition?.({ phase: 'end', cause: 'snap', position: 0, finished: true }));

        expect(state.modal?.visible).toBe(true);
    });

    it('lets go of the window after a fallback if the engine never reports the close, so the app is not left blocked', () => {
        vi.useFakeTimers();
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);
        engineStartsAnimating();

        rerender(<Sheet {...props} open={false} />);
        act(() => {
            vi.advanceTimersByTime(SHEET_EXIT_FALLBACK_MS - 1);
        });

        expect(state.modal?.visible).toBe(true);

        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(state.modal?.visible).toBe(false);
    });

    it('treats a second Back during the exit as nothing: the host is asked once', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);
        engineStartsAnimating();

        back();
        rerender(<Sheet {...props} open={false} />);
        back();
        back();

        expect(props.onOpenChange).toHaveBeenCalledTimes(1);
    });

    it('opens again from an exit in progress, without closing the window', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);
        engineStartsAnimating();

        rerender(<Sheet {...props} open={false} />);
        rerender(<Sheet {...props} open />);
        engineFinishedClosing();

        expect(state.modal?.visible).toBe(true);
        expect(engine().open).toBe(true);
    });
});

describe('onDismissed', () => {
    it('is reported once per close, when the window has left, and never at mount or while open', () => {
        const onDismissed = vi.fn();
        const props = propsFor({ onDismissed });
        const { rerender } = render(<Sheet {...props} />);
        engineStartsAnimating();

        expect(onDismissed).not.toHaveBeenCalled();

        rerender(<Sheet {...props} open={false} />);

        expect(onDismissed).not.toHaveBeenCalled();

        engineFinishedClosing();
        engineFinishedClosing();

        expect(onDismissed).toHaveBeenCalledTimes(1);

        rerender(<Sheet {...props} open />);
        rerender(<Sheet {...props} open={false} />);
        engineFinishedClosing();

        expect(onDismissed).toHaveBeenCalledTimes(2);
    });
});

describe('a centred dialog (a wide window)', () => {
    it('keeps the window’s own fade and has no sheet engine, since a centred card has no bottom to drag to', () => {
        state.width = 700;
        render(<Sheet {...propsFor({ presentation: 'dialog' })} />);

        expect(state.engine).toBeUndefined();
        expect(state.modal?.animationType).toBe('slide');
    });
});
