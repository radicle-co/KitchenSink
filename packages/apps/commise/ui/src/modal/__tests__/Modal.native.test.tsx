/**
 * Modal (native) — the one React Native `Modal` the apps open, so every modal window follows the device's
 * orientation (WCAG 2.2 SC 1.3.4).
 *
 * React Native's `Modal` opens a window of its own, and on iOS that window supports portrait only unless
 * `supportedOrientations` names more. The adapter fixes the prop, so a sheet, menu or dialog opened in landscape stays
 * in landscape. Every other prop passes through untouched.
 *
 * ⚠️ The real Modal is wrapped to record the props it was given, because react-native-web does not implement
 * orientation: the recorded prop is the contract, and the on-device proof is the Maestro landscape flow.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { createElement, useContext, useEffect, type ComponentProps, type FC } from 'react';
import { Keyboard, Platform, Text, TextInput, type Modal as ModalType } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FieldRevealContext, type FieldRevealer } from '../../fieldReveal/fieldRevealContext.js';
import { Modal } from '../Modal.native.js';

const state = vi.hoisted(() => ({ modal: undefined as ComponentProps<typeof ModalType> | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, props);
        },
    };
});

const keyboard = vi.hoisted(() => ({ visible: false, focused: false, dismiss: vi.fn() }));

afterEach(() => {
    cleanup();
    state.modal = undefined;
    keyboard.visible = false;
    keyboard.focused = false;
    keyboard.dismiss.mockClear();
    vi.restoreAllMocks();
});

/** Pretend to be a platform for one test. */
function onPlatform(os: 'ios' | 'android'): void {
    vi.spyOn(Platform, 'OS', 'get').mockReturnValue(os);
}

/**
 * Stand the keyboard in: whether React Native last heard it shown, and whether a field holds focus (it does while the
 * keyboard serves it). By default the two agree.
 */
function keyboardOpen(open: boolean, focused: boolean = open): void {
    keyboard.visible = open;
    keyboard.focused = focused;
    vi.spyOn(Keyboard, 'isVisible').mockImplementation(() => keyboard.visible);
    vi.spyOn(Keyboard, 'dismiss').mockImplementation(keyboard.dismiss);
    // react-native-web's `TextInput.State` has no `currentlyFocusedInput` (React Native's does), so it is set, not spied.
    Object.assign(TextInput.State, {
        currentlyFocusedInput: () => (keyboard.focused ? {} : null),
    });
}

describe('Modal (native)', () => {
    it('supports every orientation, so opening it never turns a landscape screen back to portrait', () => {
        render(
            <Modal visible transparent>
                <Text>Body</Text>
            </Modal>,
        );

        expect([...(state.modal?.supportedOrientations ?? [])].sort()).toEqual([
            'landscape-left',
            'landscape-right',
            'portrait',
            'portrait-upside-down',
        ]);
    });

    it('passes every other prop through, and renders its children', () => {
        const onRequestClose = vi.fn();
        const onShow = vi.fn();

        render(
            <Modal visible transparent animationType="slide" onRequestClose={onRequestClose} onShow={onShow}>
                <Text>Body</Text>
            </Modal>,
        );

        expect(state.modal).toMatchObject({ visible: true, transparent: true, animationType: 'slide', onShow });
        expect(screen.getByText('Body')).toBeTruthy();
    });

    // Android: the Back that closes the keyboard reaches the Modal too. The IME takes the key DOWN and hides; the
    // Modal's dialog takes the key UP and asks to close (React Native 0.86 `ReactModalHostView`). Measured on the API
    // 34 emulator: one Back with the new-collection sheet's Name field focused hid the keyboard AND raised the sheet's
    // discard question. A Back while the keyboard is open closes the keyboard only, as it does on every other screen.
    describe('Back while the keyboard is open (Android)', () => {
        it('closes the keyboard and keeps the modal open', () => {
            onPlatform('android');
            keyboardOpen(true);
            const onRequestClose = vi.fn();
            render(<Modal visible onRequestClose={onRequestClose} />);

            state.modal?.onRequestClose?.({} as never);

            expect(onRequestClose).not.toHaveBeenCalled();
            expect(keyboard.dismiss).toHaveBeenCalledTimes(1);
        });

        it('closes the modal when the keyboard is closed', () => {
            onPlatform('android');
            keyboardOpen(false);
            const onRequestClose = vi.fn();
            render(<Modal visible onRequestClose={onRequestClose} />);

            state.modal?.onRequestClose?.({} as never);

            expect(onRequestClose).toHaveBeenCalledTimes(1);
            expect(keyboard.dismiss).not.toHaveBeenCalled();
        });

        // `Keyboard.isVisible()` is the LAST shown/hidden event, not the live keyboard: a sheet that closes with its
        // keyboard up may never hear the hide. With no field focused there is no keyboard to close, so a stale report
        // must not swallow the next modal's Back.
        it('closes the modal when the keyboard is reported open but no field holds focus', () => {
            onPlatform('android');
            keyboardOpen(true, false);
            const onRequestClose = vi.fn();
            render(<Modal visible onRequestClose={onRequestClose} />);

            state.modal?.onRequestClose?.({} as never);

            expect(onRequestClose).toHaveBeenCalledTimes(1);
            expect(keyboard.dismiss).not.toHaveBeenCalled();
        });

        it('leaves iOS alone: its close request is a gesture on the sheet, not the keyboard key', () => {
            onPlatform('ios');
            keyboardOpen(true);
            const onRequestClose = vi.fn();
            render(<Modal visible onRequestClose={onRequestClose} />);

            state.modal?.onRequestClose?.({} as never);

            expect(onRequestClose).toHaveBeenCalledTimes(1);
        });
    });

    // A field reveal is a scroller showing a field INSIDE it (`@commise/ui/field-reveal`). A modal opens a window of its
    // own, so no scroller outside it can show a field in it, yet React context crosses the window. Run 38447859313: the
    // row editor sheet's Unit combobox, rendered inside the recipe editor's scroller, asked the EDITOR to reveal it, and
    // the editor scrolled to Details under the sheet. The modal is the boundary, so it hands its contents the Null Object.
    describe('the field reveal', () => {
        /** A field that asks for a reveal as it mounts, the way a combobox does when its list opens. */
        const AskingField: FC = () => {
            const reveal = useContext(FieldRevealContext);

            useEffect(() => reveal({ field: { measureLayout: () => undefined }, below: 120, kind: 'list' }), [reveal]);

            return <Text>Field</Text>;
        };

        it('a field outside a modal reaches the scroller around it (the probe works)', () => {
            const outer = vi.fn<FieldRevealer>(() => () => undefined);
            render(
                <FieldRevealContext.Provider value={outer}>
                    <AskingField />
                </FieldRevealContext.Provider>,
            );

            expect(outer).toHaveBeenCalledTimes(1);
        });

        it('⛔ a field inside a modal never asks a scroller outside the modal', () => {
            const outer = vi.fn<FieldRevealer>(() => () => undefined);
            render(
                <FieldRevealContext.Provider value={outer}>
                    <Modal visible transparent>
                        <AskingField />
                    </Modal>
                </FieldRevealContext.Provider>,
            );

            expect(screen.getByText('Field')).toBeTruthy();
            expect(outer).not.toHaveBeenCalled();
        });
    });
});
