/**
 * @module @commise/ui/modal — the one React Native `Modal` the apps open.
 *
 * React Native's `Modal` opens a window of its own. On iOS that window supports portrait only unless
 * `supportedOrientations` names more (React Native 0.86, `RCTModalHostViewComponentView.mm`), so a sheet, menu or
 * dialog opened in landscape would turn the screen back to portrait, which fails WCAG 2.2 SC 1.3.4 the moment any
 * modal opens. This adapter fixes the prop to every orientation and takes it out of the API, so no caller can lock one
 * again. Android ignores the prop.
 *
 * It also keeps Android's Back from doing two things at once. With a field focused in the modal, the input method takes
 * the Back key's DOWN and hides the keyboard, and the modal's dialog then takes the key's UP and asks to close (React
 * Native 0.86 `ReactModalHostView`, which closes on `ACTION_UP`). So one Back, meant for the keyboard, also closed a
 * sheet or raised its discard question (measured on the API 34 emulator). Here a close request that arrives while the
 * keyboard is still open closes the keyboard only, as Back does on every other screen; the next Back closes the modal.
 * iOS is left alone: its close request is a gesture on the sheet, never the keyboard's key. Every other prop passes
 * through.
 *
 * A raw `Modal` import from `react-native` anywhere else in the apps fails
 * `packages/infra/global/__tests__/modalAdapterImports.test.ts`.
 *
 * @pattern Adapter over React Native's `Modal`
 */
import type { FC } from 'react';
import { Keyboard, Modal as NativeModal, Platform, type ModalProps as NativeModalProps } from 'react-native';

import { hasFocusedField } from '../textInput/TextInput.native.js';

/** Every orientation. iOS intersects it with the app's own (`app.json` "orientation": "default" allows all). */
const EVERY_ORIENTATION: NonNullable<NativeModalProps['supportedOrientations']> = [
    'portrait',
    'portrait-upside-down',
    'landscape-left',
    'landscape-right',
];

/**
 * Whether the keyboard is open for a field. Both halves, because `Keyboard.isVisible()` is the LAST shown/hidden event
 * React Native heard, not the live keyboard: a sheet that closes with its keyboard up may never report the hide, and a
 * stale `true` alone would swallow the next modal's Back. A focused field clears when it blurs or unmounts. Reads the
 * keyboard and focus state.
 *
 * @returns Whether a close request now would really be meant for the keyboard.
 */
function keyboardServesAField(): boolean {
    return Keyboard.isVisible() && hasFocusedField();
}

/** React Native's `Modal` props, less the orientation lock this adapter owns. */
export type ModalProps = Omit<NativeModalProps, 'supportedOrientations'>;

/**
 * React Native's `Modal` with its window open to every orientation, whose Back closes the keyboard before the modal. A
 * presentational component: it renders its props and holds no state. Native only, because only React Native's `Modal`
 * opens a window of its own.
 */
export const Modal: FC<ModalProps> = ({ onRequestClose, ...props }) => (
    <NativeModal
        {...props}
        onRequestClose={
            onRequestClose === undefined
                ? undefined
                : (event) => {
                      if (Platform.OS === 'android' && keyboardServesAField()) {
                          Keyboard.dismiss();

                          return;
                      }

                      onRequestClose(event);
                  }
        }
        supportedOrientations={EVERY_ORIENTATION}
    />
);
