/**
 * @module @commise/ui/modal — the one React Native `Modal` the apps open.
 *
 * React Native's `Modal` opens a window of its own. On iOS that window supports portrait only unless
 * `supportedOrientations` names more (React Native 0.86, `RCTModalHostViewComponentView.mm`), so a sheet, menu or
 * dialog opened in landscape would turn the screen back to portrait, which fails WCAG 2.2 SC 1.3.4 the moment any
 * modal opens. This adapter fixes the prop to every orientation and takes it out of the API, so no caller can lock one
 * again. Android ignores the prop. Every other prop passes through.
 *
 * A raw `Modal` import from `react-native` anywhere else in the apps fails
 * `packages/infra/global/__tests__/modalAdapterImports.test.ts`.
 *
 * @pattern Adapter over React Native's `Modal`
 */
import type { FC } from 'react';
import { Modal as NativeModal, type ModalProps as NativeModalProps } from 'react-native';

/** Every orientation. iOS intersects it with the app's own (`app.json` "orientation": "default" allows all). */
const EVERY_ORIENTATION: NonNullable<NativeModalProps['supportedOrientations']> = [
    'portrait',
    'portrait-upside-down',
    'landscape-left',
    'landscape-right',
];

/** React Native's `Modal` props, less the orientation lock this adapter owns. */
export type ModalProps = Omit<NativeModalProps, 'supportedOrientations'>;

/**
 * React Native's `Modal` with its window open to every orientation. A presentational component: it renders its props
 * and holds no state. Native only, because only React Native's `Modal` opens a window of its own.
 */
export const Modal: FC<ModalProps> = (props) => <NativeModal {...props} supportedOrientations={EVERY_ORIENTATION} />;
