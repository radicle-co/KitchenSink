/**
 * Sheet (native) — setting the sheet aside while the host asks a question, and bringing it back as it was.
 *
 * Designer ruling 2026-11-03: the sheet stays hidden under the discard dialog (RN shows one window at a time on iOS), on
 * conditions. Keep editing must bring back the text (the host's), the SCROLL POSITION (this file), and focus on the field
 * that had it (the host's, `CollectionSheet`). `held` is that setting-aside: the window leaves with no exit and no scrim fade,
 * nothing is reported as dismissed, and the opening is not a new one, so the panel is not started fresh.
 *
 * ⚠️ The scroller is recorded, because jsdom has no layout: what a device does is `overlayBackOrder.yaml`.
 */
import { act, cleanup, screen } from '@testing-library/react';
import { createElement, forwardRef, useImperativeHandle, type ComponentProps } from 'react';
import { Text, type Modal as ModalType, type ScrollView as ScrollViewType } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '../../testing/tamaguiTesting.native.js';
import type { SheetProps } from '../props.js';
import { Sheet } from '../Sheet.native.js';

const state = vi.hoisted(() => ({
    modal: undefined as ComponentProps<typeof ModalType> | undefined,
    scroll: undefined as ComponentProps<typeof ScrollViewType> | undefined,
    scrollTo: vi.fn(),
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, { ...props, onShow: undefined, onDismiss: undefined });
        },
        ScrollView: forwardRef<{ scrollTo: typeof state.scrollTo }, ComponentProps<typeof ScrollViewType>>(
            (props, ref) => {
                state.scroll = props;
                useImperativeHandle(ref, () => ({ scrollTo: state.scrollTo }));

                return createElement(actual.ScrollView, props);
            },
        ),
    };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, right: 6, bottom: 16, left: 4 }),
}));
vi.mock('../../layout/useKeyboardShown.native.js', () => ({ useKeyboardShown: () => false }));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => false }));

beforeEach(() => {
    state.modal = undefined;
    state.scroll = undefined;
    state.scrollTo.mockClear();
});

afterEach(cleanup);

const propsFor = (overrides: Partial<SheetProps> = {}): SheetProps => ({
    open: true,
    onOpenChange: vi.fn(),
    title: 'New collection',
    closeLabel: 'Close',
    size: 'content',
    children: <Text>Body</Text>,
    ...overrides,
});

/** The cook scrolls to `y` and lets go. */
const scrollsTo = (y: number): void => {
    act(() => state.scroll?.onMomentumScrollEnd?.({ nativeEvent: { contentOffset: { x: 0, y } } } as never));
};

describe('a held sheet', () => {
    it('leaves the window at once, with no exit to wait for, and shows it again when released', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);

        rerender(<Sheet {...props} held />);

        expect(state.modal?.visible).toBe(false);

        rerender(<Sheet {...props} held={false} />);

        expect(state.modal?.visible).toBe(true);
        expect(screen.getByText('Body')).toBeTruthy();
    });

    it('reports nothing as dismissed, since the sheet is coming back', () => {
        const onDismissed = vi.fn();
        const props = propsFor({ onDismissed });
        const { rerender } = render(<Sheet {...props} />);

        rerender(<Sheet {...props} held />);
        rerender(<Sheet {...props} held={false} />);

        expect(onDismissed).not.toHaveBeenCalled();
    });

    it('is not a close: the host is asked nothing, and a real close afterwards is still reported once', () => {
        const onDismissed = vi.fn();
        const props = propsFor({ onDismissed });
        const { rerender } = render(<Sheet {...props} />);

        rerender(<Sheet {...props} held />);
        rerender(<Sheet {...props} held={false} />);
        rerender(<Sheet {...props} open={false} />);

        expect(onDismissed).toHaveBeenCalledTimes(1);
        expect(props.onOpenChange).not.toHaveBeenCalled();
    });
});

describe('the scroll position', () => {
    it('is put back after a hold', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);

        scrollsTo(180);
        rerender(<Sheet {...props} held />);
        state.scrollTo.mockClear();
        rerender(<Sheet {...props} held={false} />);

        expect(state.scrollTo).toHaveBeenCalledWith({ y: 180, animated: false });
    });

    it('is not restored at a fresh opening, which starts at the top', () => {
        const props = propsFor();
        const { rerender } = render(<Sheet {...props} />);

        scrollsTo(180);
        rerender(<Sheet {...props} open={false} />);
        state.scrollTo.mockClear();
        rerender(<Sheet {...props} open />);

        expect(state.scrollTo).not.toHaveBeenCalled();
    });

    it('is not asked for at the first opening, where there is nothing to put back', () => {
        render(<Sheet {...propsFor()} />);

        expect(state.scrollTo).not.toHaveBeenCalled();
    });
});
