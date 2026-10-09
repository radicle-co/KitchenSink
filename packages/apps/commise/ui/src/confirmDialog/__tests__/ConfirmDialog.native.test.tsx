import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ComponentProps } from 'react';
import { AccessibilityInfo } from 'react-native';
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
        // react-native-web does not implement `sendAccessibilityEvent`; the focus on Keep reads its calls.
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
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
        body: 'You have unsaved changes. Leaving now will discard them.',
        confirm: { label: 'Discard changes', icon: 'trash' },
        keep: { label: 'Keep editing' },
        onConfirm: vi.fn(),
        onKeep: vi.fn(),
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

    it('cancelling calls onKeep', () => {
        const onKeep = vi.fn();
        render(<ConfirmDialog {...baseProps({ onKeep })} />);

        fireEvent.click(screen.getByLabelText('Keep editing'));

        expect(onKeep).toHaveBeenCalledTimes(1);
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

/** Slice 2 of the UI overhaul (blueprint Part B, ConfirmDialog; spec §6.5) — the native half of the web leaf's cases. */
describe('ConfirmDialog (native) — the overhaul contract', () => {
    it('draws the confirm as the filled destructive tone with its glyph, and Keep as secondary with an x', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const confirm = screen.getByRole('button', { name: 'Discard changes' });
        const keep = screen.getByRole('button', { name: 'Keep editing' });

        expect(confirm.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe('trash');
        expect(keep.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe('x');
    });

    it('puts Keep first, so a stacked pair reads destructive on top only through its layout', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));

        expect(names.indexOf('Keep editing')).toBeLessThan(names.indexOf('Discard changes'));
    });

    it('moves the screen-reader cursor to Keep when it opens', () => {
        vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
        render(<ConfirmDialog {...baseProps()} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('button', { name: 'Keep editing' }),
            'focus',
        );
    });

    it('while busy, spins the confirm and cannot fire again, says so, and Keep can still close it', () => {
        const onConfirm = vi.fn();
        const onKeep = vi.fn();
        render(<ConfirmDialog {...baseProps({ busy: true, busyLabel: 'Discarding…', onConfirm, onKeep })} />);

        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

        expect(screen.getByRole('button', { name: 'Discard changes' }).getAttribute('aria-busy')).toBe('true');
        expect(screen.getByText('Discarding…')).toBeTruthy();
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onKeep).toHaveBeenCalledOnce();
    });

    it('shows a failure inside the dialog, but not while a retry is in flight', () => {
        const { rerender } = render(<ConfirmDialog {...baseProps({ error: 'We couldn’t discard. Try again.' })} />);

        expect(screen.getByText('We couldn’t discard. Try again.')).toBeTruthy();

        rerender(<ConfirmDialog {...baseProps({ error: 'We couldn’t discard. Try again.', busy: true })} />);

        expect(screen.queryByText('We couldn’t discard. Try again.')).toBeNull();
    });

    it('stacks its buttons, destructive on top, in a dialog narrower than 400pt', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const actions = screen.getByRole('button', { name: 'Keep editing' }).parentElement as HTMLElement;

        expect(getComputedStyle(actions).flexDirection).toBe('column-reverse');
    });
});
