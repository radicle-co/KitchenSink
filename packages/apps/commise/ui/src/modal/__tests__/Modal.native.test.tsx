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
import { createElement, type ComponentProps } from 'react';
import { Text, type Modal as ModalType } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
    cleanup();
    state.modal = undefined;
});

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

        expect(state.modal).toMatchObject({
            visible: true,
            transparent: true,
            animationType: 'slide',
            onRequestClose,
            onShow,
        });
        expect(screen.getByText('Body')).toBeTruthy();
    });
});
