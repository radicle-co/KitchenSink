import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { createElement, type ComponentProps, type ComponentType } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { KeyboardAvoidingView as KeyboardAvoidingViewType, Modal as ModalType } from 'react-native';

import { ConfirmDialog } from '../ConfirmDialog.js';
import type { ConfirmDialogProps } from '../props.js';
import { rgb, rolesFor } from '../../testing/systemColorScheme.js';
import { nativeTokens } from '../../tokens/native.js';
import { DISPLAY_FONT_SCALE_CAP } from '../../text/scaledType.js';
import {
    pressFrameOf,
    render,
    renderWithTamagui,
    resolvedColour,
    resolvedStyle,
} from '../../testing/tamaguiTesting.native.js';

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
        KeyboardAvoidingView: (props: ComponentProps<typeof KeyboardAvoidingViewType>) =>
            createElement('div', { 'data-keyboard-avoider': true }, createElement(actual.KeyboardAvoidingView, props)),
    };
});

// REWRITTEN for the Tamagui card: the dialog's scroller is Tamagui's `ScrollView`, marked the same way.
vi.mock('tamagui', async (importOriginal) => {
    const { withMarkedScrollView } = await import('../../testing/markedScrollView.native.js');

    return withMarkedScrollView(
        await importOriginal<{ ScrollView: ComponentType<{ keyboardShouldPersistTaps?: string }> }>(),
    );
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
    // The two polite status lines are the typed LiveRegion: a type role and a colour role, not a hand-picked style, so
    // they grow with the system text size and follow the scheme.
    it.each([
        ['busy', { busy: true, busyLabel: 'Discarding…' }, 'Discarding…'],
        ['unavailable', { unavailable: 'Offline. Try again online.' }, 'Offline. Try again online.'],
    ] as const)('says its %s status line in the meta role, in inkMuted', (_state, overrides, text) => {
        render(<ConfirmDialog {...baseProps(overrides)} />);

        const line = screen.getByText(text);

        expect(resolvedColour(line, 'color')).toBe(rgb(rolesFor('light').inkMuted));
        expect(resolvedStyle(line, 'fontSize')).toBe(`${String(nativeTokens.type.meta.fontSize)}px`);
    });

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
    // Parity with the web dialog, whose title is `sectionTitle` (`buildSpec.md` §1.5): Manrope sets names only (F8).
    it('sets its title in Inter, never the display face', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const title = screen.getAllByRole('heading')[0] as HTMLElement;
        const families = Array.from(document.styleSheets)
            .flatMap((sheet) => Array.from(sheet.cssRules))
            .filter(
                (rule): rule is CSSStyleRule =>
                    rule instanceof CSSStyleRule &&
                    title.className.split(' ').some((name) => rule.selectorText === `.${name}`),
            )
            .map((rule) => rule.style.getPropertyValue('font-family'))
            .concat(title.style.getPropertyValue('font-family'))
            .filter((family) => family !== '');

        expect(families.length).toBeGreaterThan(0);
        expect(families.join(' ')).not.toMatch(/Manrope/u);
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

    // REWRITTEN (designer ruling 2026-11-11): the actions no longer scroll with the body. At the largest iOS text the body
    // pushed Stay and Leave below the fold, so a cook had to scroll the dialog to answer it. The BODY scrolls, so a short
    // window still reaches all of it (WCAG 2.2 SC 1.4.4), and the two actions stay pinned in view under it.
    it('scrolls its body and keeps both actions pinned outside the scroll, in view', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const alert = screen.getByRole('alert');
        const region = alert.querySelector('[data-scroll-region]');

        expect(region).not.toBeNull();
        expect(region?.contains(screen.getByText('You have unsaved changes. Leaving now will discard them.'))).toBe(
            true,
        );

        for (const action of [screen.getByLabelText('Keep editing'), screen.getByLabelText('Discard changes')]) {
            expect(alert.contains(action)).toBe(true);
            expect(region?.contains(action)).toBe(false);
        }
    });

    // `docs/design/compactHeightLayout.md` §9: the card is the design system's `DialogFrame`, so it clears the keyboard
    // and the safe area, and the first tap with the keyboard up reaches an action.
    it('sits on the design system’s dialog frame: its actions in the keyboard avoider, its body in a region whose first tap lands', () => {
        render(<ConfirmDialog {...baseProps()} />);

        for (const action of [screen.getByLabelText('Keep editing'), screen.getByLabelText('Discard changes')]) {
            expect(action.closest('[data-keyboard-avoider]')).not.toBeNull();
        }

        // The body's region still lets a first tap through with the keyboard up.
        expect(
            screen.getByRole('alert').querySelector('[data-scroll-region]')?.getAttribute('data-scroll-region'),
        ).toBe('handled');

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
    // REWRITTEN: Keep used to default to an x. An x reads as close or discard, the opposite of "keep my work", so Keep is text
    // only unless a caller names a glyph that means something (the designer's ruling 2026-11-03).
    it('draws the confirm as the filled destructive tone with its glyph, and Keep as secondary with no glyph', () => {
        render(<ConfirmDialog {...baseProps()} />);

        const confirm = screen.getByRole('button', { name: 'Discard changes' });
        const keep = screen.getByRole('button', { name: 'Keep editing' });

        expect(confirm.querySelector<HTMLElement>('[data-commise-stub="icon"]')?.dataset['iconName']).toBe('trash');
        expect(keep.querySelector('[data-commise-stub="icon"]')).toBeNull();
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

    /**
     * Owner ruling 2026-10-17, "Don't allow users to delete while saving": a confirm can be UNAVAILABLE with a reason. The
     * reason is announced politely and drawn as text (not colour alone), the confirm is disabled, and Keep still closes it.
     */
    it('⛔ while unavailable, the confirm is disabled and fires nothing, the reason is said, and Keep still closes it', () => {
        const onConfirm = vi.fn();
        const onKeep = vi.fn();
        render(<ConfirmDialog {...baseProps({ unavailable: 'Saving…', onConfirm, onKeep })} />);

        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

        expect(screen.getByText('Saving…')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Discard changes' }).getAttribute('aria-disabled')).toBe('true');
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onKeep).toHaveBeenCalledOnce();
    });

    it('⛔ an available confirm says nothing about saving and fires', () => {
        const onConfirm = vi.fn();
        render(<ConfirmDialog {...baseProps({ onConfirm })} />);

        expect(screen.queryByText('Saving…')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

        expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('shows a failure inside the dialog, but not while a retry is in flight', () => {
        const { rerender } = render(<ConfirmDialog {...baseProps({ error: 'We couldn’t discard. Try again.' })} />);

        expect(screen.getByText('We couldn’t discard. Try again.')).toBeTruthy();

        rerender(<ConfirmDialog {...baseProps({ error: 'We couldn’t discard. Try again.', busy: true })} />);

        expect(screen.queryByText('We couldn’t discard. Try again.')).toBeNull();
    });

    it('stacks its buttons, destructive on top, in a dialog narrower than 400pt', () => {
        render(<ConfirmDialog {...baseProps()} />);

        // Each button sits in its press-scale frame, so the row of actions is the frame's parent.
        const actions = pressFrameOf(screen.getByRole('button', { name: 'Keep editing' })).parentElement as HTMLElement;

        expect(getComputedStyle(actions).flexDirection).toBe('column-reverse');
    });
});

/**
 * Designer ruling 2026-11-11: the body is never drawn larger than the title. The title's role stops growing at 1.5×
 * (`DISPLAY_FONT_SCALE_CAP`); the body's own role grows to 2×, so at iOS's largest accessibility size (about 3.1×) the body
 * outgrew the title and filled the card. The dialog caps its copy at the title's ceiling.
 */
describe('ConfirmDialog (native) text size', () => {
    const BODY = 'You have unsaved changes. Leaving now will discard them.';
    const fontSizeOf = (element: HTMLElement): number => Number.parseFloat(resolvedStyle(element, 'fontSize'));

    it.each([
        ['at 1x', 1, 1],
        ['at 1.3x', 1.3, 1.3],
        ['at the largest text size', 3.1, DISPLAY_FONT_SCALE_CAP],
    ] as const)('draws its body %s at its capped scale, never past the title', (_label, scale, grown) => {
        renderWithTamagui(<ConfirmDialog {...baseProps()} />, 'light', scale);

        const body = fontSizeOf(screen.getByText(BODY));
        const title = fontSizeOf(within(screen.getByRole('alert')).getByRole('heading'));

        expect(body).toBeCloseTo(nativeTokens.type.body.fontSize * grown, 5);
        expect(body / nativeTokens.type.body.fontSize).toBeLessThanOrEqual(
            title / nativeTokens.type.sectionTitle.fontSize + 1e-9,
        );
    });

    it('keeps both actions out of the scrolling body at the largest text size', () => {
        renderWithTamagui(<ConfirmDialog {...baseProps()} />, 'light', 3.1);

        const region = screen.getByRole('alert').querySelector('[data-scroll-region]');

        expect(region?.contains(screen.getByText(BODY))).toBe(true);
        expect(region?.contains(screen.getByLabelText('Keep editing'))).toBe(false);
        expect(region?.contains(screen.getByLabelText('Discard changes'))).toBe(false);
    });
});
