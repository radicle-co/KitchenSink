/**
 * DialogFrame (native) on Tamagui's Dialog — what the component tier CAN prove: the props the frame hands the engine, the
 * one request every close makes, the role and name of the card, and the tone the card paints. A dialog has no drag and no
 * driver, so there is no motion here to leave to a device; the window's fade is React Native's (`dialogAnimationType`).
 *
 * ⚠️ Tamagui's `Dialog` is the real one, wrapped to record the props it was given, so the engine's own close can be raised
 * (jsdom has no outside press to raise it from). `Modal` is the real one, wrapped the same way, so Android Back can be.
 */
import { act, cleanup, screen } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import { Text, type Modal as ModalType } from 'react-native';
import { Dialog } from '@tamagui/dialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MODAL_CLOSE_EVENT } from '../../testing/modalCloseEvent.native.js';
import { rgb, rolesFor } from '../../testing/systemColorScheme.js';
import { renderWithTamagui, resolvedColour } from '../../testing/tamaguiTesting.native.js';
import { DialogFrame } from '../DialogFrame.native.js';
import type { DialogFrameProps } from '../props.js';

const state = vi.hoisted(() => ({
    modal: undefined as ComponentProps<typeof ModalType> | undefined,
    engine: undefined as ComponentProps<typeof Dialog> | undefined,
    content: undefined as Record<string, unknown> | undefined,
    scroll: undefined as Record<string, unknown> | undefined,
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, { ...props, onShow: undefined });
        },
    };
});
vi.mock('@tamagui/dialog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tamagui/dialog')>();
    const Recorded = Object.assign((props: ComponentProps<typeof Dialog>) => {
        state.engine = props;

        return createElement(actual.Dialog, props);
    }, actual.Dialog);

    const Content = (props: Record<string, unknown>) => {
        state.content = props;

        return createElement(actual.Dialog.Content, props);
    };

    return { ...actual, Dialog: Object.assign(Recorded, { Content }) };
});
vi.mock('tamagui', async (importOriginal) => {
    const actual = await importOriginal<typeof import('tamagui')>();

    const ScrollView = (props: Record<string, unknown>) => {
        state.scroll = props;

        return createElement(actual.ScrollView, props);
    };

    return { ...actual, ScrollView };
});
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, right: 6, bottom: 16, left: 4 }),
}));
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => false }));

beforeEach(() => {
    state.modal = undefined;
    state.engine = undefined;
    state.content = undefined;
    state.scroll = undefined;
});

afterEach(cleanup);

const propsFor = (overrides: Partial<DialogFrameProps> = {}): DialogFrameProps => ({
    open: true,
    onRequestClose: vi.fn(),
    title: 'Delete this recipe?',
    role: 'alert',
    children: <Text>Body</Text>,
    ...overrides,
});

describe('the props the frame hands Tamagui’s Dialog', () => {
    it('keeps the engine in our window: modal is the literal false, no state of its own', () => {
        renderWithTamagui(<DialogFrame {...propsFor()} />, 'light');

        expect(state.engine?.modal).toBe(false);
        expect(state.engine?.defaultOpen).toBeUndefined();
        expect(state.engine?.open).toBe(true);
    });

    it.each(['alert', 'dialog'] as const)('names the card with the %s role the host asked for', (role) => {
        renderWithTamagui(<DialogFrame {...propsFor({ role })} />, 'light');

        expect(state.content?.['role']).toBe(role);
        expect(state.content?.['aria-modal']).toBe(true);
    });

    it('names the dialog by a heading', () => {
        renderWithTamagui(<DialogFrame {...propsFor()} />, 'light');

        expect(screen.getByRole('heading', { name: 'Delete this recipe?' })).toBeTruthy();
    });
});

describe('the engine’s skin', () => {
    // Tamagui's root `Dialog` carries a v2 skin (`border-color`, `borderRadius: '4'`, `elevate`) whose defaults log an unknown
    // colour, a non-token radius and a missing `shadow-color` on a device, and the debug toast covers the screen. The frame
    // uses the unskinned behaviour package, whose Content has no defaults of its own.
    it('uses the unskinned Dialog, so no skin default reaches the card', () => {
        renderWithTamagui(<DialogFrame {...propsFor()} />, 'light');

        expect(state.engine).toBeDefined();
        expect(state.content?.['elevate']).toBeUndefined();
    });
});

describe('the card’s scroller', () => {
    // With the keyboard up, the first tap on an action must press it, not only close the keyboard.
    it('lets the first tap with the keyboard up reach a control', () => {
        renderWithTamagui(<DialogFrame {...propsFor()} />, 'light');

        expect(state.scroll?.['keyboardShouldPersistTaps']).toBe('handled');
    });
});

describe('the close routes', () => {
    it('answers Android Back with one request', () => {
        const props = propsFor();
        renderWithTamagui(<DialogFrame {...props} />, 'light');

        act(() => state.modal?.onRequestClose?.(MODAL_CLOSE_EVENT));

        expect(props.onRequestClose).toHaveBeenCalledTimes(1);
    });

    it('turns the engine’s own close into the same request', () => {
        const props = propsFor();
        renderWithTamagui(<DialogFrame {...props} />, 'light');

        act(() => state.engine?.onOpenChange?.(false));

        expect(props.onRequestClose).toHaveBeenCalledTimes(1);
    });

    it('ignores the engine reporting open, which is the host’s own doing', () => {
        const props = propsFor();
        renderWithTamagui(<DialogFrame {...props} />, 'light');

        act(() => state.engine?.onOpenChange?.(true));

        expect(props.onRequestClose).not.toHaveBeenCalled();
    });

    it('stays up when the host ignores the request (a veto, such as a submitting form)', () => {
        renderWithTamagui(<DialogFrame {...propsFor()} />, 'light');

        act(() => state.modal?.onRequestClose?.(MODAL_CLOSE_EVENT));

        expect(screen.getByText('Body')).toBeTruthy();
    });
});

describe('the card’s tone', () => {
    it.each(['light', 'dark'] as const)('paints the paperOverlay fill in the %s scheme', (scheme) => {
        renderWithTamagui(<DialogFrame {...propsFor()} />, scheme);

        const card = screen.getByRole(propsFor().role).closest('[role]') ?? screen.getByRole(propsFor().role);

        expect(resolvedColour(card, 'backgroundColor')).toBe(rgb(rolesFor(scheme).paperOverlay));
    });
});
