import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import type {
    KeyboardAvoidingView as KeyboardAvoidingViewType,
    Modal as ModalType,
    ScrollView as ScrollViewType,
} from 'react-native';

import { ConfirmDialog } from '../ConfirmDialog.js';
import type { ConfirmDialogProps } from '../props.js';

/**
 * ConfirmDialog (native) — the house B6 confirmation modal (RN `Modal`), mirroring
 * `RecipeDeleteDialog.native`'s accessible-alert card pattern.
 *
 * The real Modal and ScrollView are wrapped: the Modal to record the orientations its window supports, which
 * react-native-web cannot show, and the ScrollView to mark its element, because jsdom has no layout to measure
 * whether the actions can be scrolled to.
 */
const state = vi.hoisted(() => ({ modal: undefined as ComponentProps<typeof ModalType> | undefined }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Modal: (props: ComponentProps<typeof ModalType>) => {
            state.modal = props;

            return createElement(actual.Modal, props);
        },
        ScrollView: (props: ComponentProps<typeof ScrollViewType>) =>
            createElement(
                'div',
                { 'data-scroll-region': props.keyboardShouldPersistTaps ?? 'never' },
                createElement(actual.ScrollView, props),
            ),
        KeyboardAvoidingView: (props: ComponentProps<typeof KeyboardAvoidingViewType>) =>
            createElement('div', { 'data-keyboard-avoider': true }, createElement(actual.KeyboardAvoidingView, props)),
    };
});

afterEach(cleanup);

function baseProps(overrides: Partial<ConfirmDialogProps> = {}): ConfirmDialogProps {
    return {
        open: true,
        title: 'Discard unsaved changes?',
        description: 'You have unsaved changes. Leaving now will discard them.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        ...overrides,
    };
}

describe('ConfirmDialog (native)', () => {
    it('renders nothing while closed', () => {
        render(<ConfirmDialog {...baseProps({ open: false })} />);

        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders an accessible alert, with its title header and its body copy, when open', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const alert = screen.getByRole('alert');

        expect(within(alert).getByRole('heading', { name: 'Discard unsaved changes?' })).toBeTruthy();
        expect(screen.getByText('You have unsaved changes. Leaving now will discard them.')).toBeTruthy();
    });
    it('confirming calls onConfirm', () => {
        const onConfirm = vi.fn();
        render(<ConfirmDialog {...baseProps({ onConfirm })} />);

        fireEvent.click(screen.getByLabelText('Discard changes'));

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('cancelling calls onCancel', () => {
        const onCancel = vi.fn();
        render(<ConfirmDialog {...baseProps({ onCancel })} />);

        fireEvent.click(screen.getByLabelText('Keep editing'));

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    // A Modal's window on iOS is portrait only unless it says otherwise (WCAG 2.2 SC 1.3.4).
    it('opens a window that supports every orientation', () => {
        render(<ConfirmDialog {...baseProps()} />);

        expect(state.modal?.supportedOrientations).toEqual(
            expect.arrayContaining(['portrait', 'landscape-left', 'landscape-right']),
        );
    });

    // A landscape phone is about 360 dp tall, and at 200% text the body pushes the actions below the window, where a
    // card that does not scroll strands them (WCAG 2.2 SC 1.4.4).
    it('keeps its body and both actions in a scroll region, so a short window can still reach them', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const region = screen.getByRole('alert').querySelector('[data-scroll-region]');

        expect(region).not.toBeNull();
        expect(region?.contains(screen.getByText('You have unsaved changes. Leaving now will discard them.'))).toBe(
            true,
        );
        expect(region?.contains(screen.getByLabelText('Keep editing'))).toBe(true);
        expect(region?.contains(screen.getByLabelText('Discard changes'))).toBe(true);
    });

    // `docs/design/compactHeightLayout.md` §9: the card is the design system's `DialogFrame`, so it clears the keyboard
    // and the safe area, and the first tap with the keyboard up reaches an action.
    it('sits on the design system’s dialog frame: in the keyboard avoider, in a region whose first tap lands', () => {
        render(<ConfirmDialog {...baseProps()} />);

        for (const action of [screen.getByLabelText('Keep editing'), screen.getByLabelText('Discard changes')]) {
            expect(action.closest('[data-keyboard-avoider]')).not.toBeNull();
            expect(action.closest('[data-scroll-region]')?.getAttribute('data-scroll-region')).toBe('handled');
        }

        expect(state.modal?.statusBarTranslucent).toBe(true);
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 rule 2: the alert's title header names it, so the alert carries no name; the
 * title is said once, by the header inside the alert (N4).
 */
describe('ConfirmDialog (native) — N1: the alert’s name is said once, by its title header', () => {
    it('says the title through one header inside the alert, and no node is labelled with it', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const headings = screen.getAllByRole('heading', { name: 'Discard unsaved changes?' });
        expect(headings).toHaveLength(1);
        expect(within(screen.getByRole('alert')).getByRole('heading', { name: 'Discard unsaved changes?' })).toBe(
            headings[0],
        );
        expect(screen.queryAllByLabelText('Discard unsaved changes?')).toEqual([]);
    });
});
