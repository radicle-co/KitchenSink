/**
 * Native render leaves of the Profile page. Every state the page owns is asserted by role and name: the loading
 * skeleton, the failed header with its retry, the ready header, a pressable row in each tone, the hint, the busy
 * state, a link row, and the display-name sheet's field, Save gate and failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccessibilityInfo } from 'react-native';

/**
 * ⚠️ `sendAccessibilityEvent` is MOCKED because react-native-web does not implement it: what is proven is the contract
 * with React Native (the right node, the `'focus'` event, only on a CHANGED signal), not that a screen reader honours it.
 */
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DisplayNameSheet } from '../DisplayNameSheet.native.js';
import { ProfileGroup } from '../ProfileGroup.native.js';
import { ProfileHeader } from '../ProfileHeader.native.js';
import { ProfileRow } from '../ProfileRow.native.js';
import { ProfileValueRow } from '../ProfileValueRow.native.js';
import { DISPLAY_NAME_MAX_LENGTH } from '../model.js';
import type { DisplayNameSheetProps, ProfileRowProps } from '../props.js';

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

const noop = () => undefined;

describe('ProfileHeader (native)', () => {
    it('shows a busy skeleton while the profile loads, with no error', () => {
        render(<ProfileHeader read={{ status: 'loading' }} initials="" onRetry={noop} />);

        expect(screen.getByRole('status', { name: 'Loading your profile' })).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows the name and the email once ready, with the initials decorative', () => {
        render(
            <ProfileHeader
                read={{ status: 'ready', displayName: 'Eliza Moreno', email: 'eliza@example.com' }}
                initials="EM"
                onRetry={noop}
            />,
        );

        expect(screen.getByText('Eliza Moreno')).toBeTruthy();
        expect(screen.getByText('eliza@example.com')).toBeTruthy();
        expect(screen.getByText('EM').closest('[aria-hidden="true"]')).toBeTruthy();
    });

    it('shows only the email for a cook with no name yet — the page never invents one', () => {
        render(
            <ProfileHeader read={{ status: 'ready', displayName: '', email: 'a@b.co' }} initials="" onRetry={noop} />,
        );

        expect(screen.getByText('a@b.co')).toBeTruthy();
        expect(screen.queryByText('Not set')).toBeNull();
    });

    it('reports a failed read with a Try again control that retries', async () => {
        const onRetry = vi.fn();

        render(<ProfileHeader read={{ status: 'failed' }} initials="" onRetry={onRetry} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your profile.');

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledOnce();
    });
});

describe('ProfileRow (native)', () => {
    const row = (overrides: Partial<ProfileRowProps> = {}): ProfileRowProps => ({
        label: 'Display name',
        tone: 'ink',
        chevron: true,
        onPress: noop,
        ...overrides,
    });

    it('is a button named for its label, whose value is part of what is announced', async () => {
        const onPress = vi.fn();

        render(<ProfileRow {...row({ value: 'Eliza', onPress })} />);

        const button = screen.getByRole('button', { name: /Display name/ });

        expect(button.textContent).toContain('Eliza');

        await userEvent.click(button);

        expect(onPress).toHaveBeenCalledOnce();
    });

    it('renders the danger tone as text, with its consequence hint inside the same control', () => {
        render(
            <ProfileRow {...row({ label: 'Close account', hint: 'Signs you out.', tone: 'danger', chevron: true })} />,
        );

        const button = screen.getByRole('button', { name: /Close account/ });

        expect(button.textContent).toContain('Signs you out.');
    });

    it('paints the danger label in a different colour from an ordinary row, and sign-out stays ordinary ink', () => {
        const colourOf = (label: string): string => screen.getByText(label).style.color;

        render(
            <>
                <ProfileRow {...row({ label: 'Close account', tone: 'danger' })} />
                <ProfileRow {...row({ label: 'Sign out', tone: 'ink', chevron: false })} />
                <ProfileRow {...row({ label: 'Display name', tone: 'ink' })} />
            </>,
        );

        expect(colourOf('Close account')).not.toBe('');
        expect(colourOf('Close account')).not.toBe(colourOf('Display name'));
        expect(colourOf('Sign out')).toBe(colourOf('Display name'));
    });

    it('cannot be pressed again while busy, and says so', async () => {
        const onPress = vi.fn();

        render(<ProfileRow {...row({ busy: true, onPress })} />);

        const button = screen.getByRole('button');

        expect(button.getAttribute('aria-disabled')).toBe('true');

        await userEvent.click(button, { pointerEventsCheck: 0 });

        expect(onPress).not.toHaveBeenCalled();
    });

    // §10 "Dialogs and sheets": focus returns to the trigger. A sheet this row opened cannot tell React Native where the
    // cursor was, so the host advances `focusSignal` when the sheet closes.
    it('takes the screen-reader cursor back when its focus signal advances, and not on mount', () => {
        const { rerender } = render(<ProfileRow {...row({ label: 'Food data sources', focusSignal: 0 })} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        rerender(<ProfileRow {...row({ label: 'Food data sources', focusSignal: 1 })} />);

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('button', { name: 'Food data sources' }),
            'focus',
        );
    });

    it('ignores a web destination: a row is a button that calls onPress', async () => {
        const onPress = vi.fn();

        render(<ProfileRow {...row({ label: 'Food data sources', href: '/en/legal/sources', onPress })} />);

        expect(screen.queryByRole('link')).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: /Food data sources/ }));

        expect(onPress).toHaveBeenCalledOnce();
    });
});

describe('ProfileValueRow and ProfileGroup (native)', () => {
    it('lists a read-only value as a term and its definition, not a control', () => {
        render(<ProfileValueRow label="Email" value="eliza@example.com" />);

        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.getByText('eliza@example.com')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('names a group by its H2 heading', () => {
        render(
            <ProfileGroup heading="Preferences">
                <ProfileValueRow label="Email" value="x" />
            </ProfileGroup>,
        );

        expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
    });

    it('draws a group with no visible heading as its rows alone', () => {
        render(
            <ProfileGroup label="Account">
                <ProfileValueRow label="Email" value="x" />
            </ProfileGroup>,
        );

        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.queryByRole('heading')).toBeNull();
    });
});

describe('DisplayNameSheet (native)', () => {
    const sheet = (overrides: Partial<DisplayNameSheetProps> = {}): DisplayNameSheetProps => ({
        open: true,
        onOpenChange: noop,
        draft: 'Eliza',
        onDraftChange: noop,
        canSave: true,
        saving: false,
        failed: false,
        onSave: noop,
        ...overrides,
    });

    it('is a dialog titled “What should we call you?” holding one labelled field with the draft', () => {
        render(<DisplayNameSheet {...sheet()} />);

        expect(screen.getByRole('heading', { name: 'What should we call you?' })).toBeTruthy();
        expect((screen.getByLabelText('What should we call you?') as HTMLInputElement).value).toBe('Eliza');
    });

    it('renders nothing while closed', () => {
        render(<DisplayNameSheet {...sheet({ open: false })} />);

        expect(screen.queryByRole('heading')).toBeNull();
    });

    it('reports each edit and saves only when Save is pressed', async () => {
        const onDraftChange = vi.fn();
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ draft: '', onDraftChange, onSave })} />);

        await userEvent.type(screen.getByLabelText('What should we call you?'), 'E');

        expect(onDraftChange).toHaveBeenCalledWith('E');
        expect(onSave).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledOnce();
    });

    it('submits on Enter, so the keyboard reaches Save too', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ onSave })} />);

        await userEvent.type(screen.getByLabelText('What should we call you?'), '{Enter}');

        expect(onSave).toHaveBeenCalledOnce();
    });

    it('disables Save while the name cannot be saved, and never fires it', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ canSave: false, onSave })} />);

        const save = screen.getByRole('button', { name: 'Save' });

        expect(save.getAttribute('aria-disabled')).toBe('true');

        await userEvent.click(save, { pointerEventsCheck: 0 });

        expect(onSave).not.toHaveBeenCalled();
    });

    it('does not submit from the keyboard while Save is disabled', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ canSave: false, onSave })} />);

        await userEvent.type(screen.getByLabelText('What should we call you?'), '{Enter}');

        expect(onSave).not.toHaveBeenCalled();
    });

    it('shows Saving… and cannot be pressed again while the save is in flight', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ saving: true, onSave })} />);

        await userEvent.click(screen.getByRole('button', { name: /Sav/ }), { pointerEventsCheck: 0 });

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /Sav/ }).getAttribute('aria-disabled')).toBe('true');
    });

    it('announces a failed save and marks the field invalid', () => {
        render(<DisplayNameSheet {...sheet({ failed: true })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t save your name. Please try again.');
        expect(screen.getByLabelText('What should we call you?').getAttribute('aria-invalid')).toBe('true');
    });

    it('closes through onOpenChange(false)', async () => {
        const onOpenChange = vi.fn();

        render(<DisplayNameSheet {...sheet({ onOpenChange })} />);

        await userEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

/**
 * The field stops a name at the identity service's limit. Without it a long name was typed in full and Save went
 * quietly disabled, with nothing saying why.
 */
describe('DisplayNameSheet (native) — the length limit', () => {
    it('stops the field at the display name’s limit', () => {
        render(
            <DisplayNameSheet
                open
                onOpenChange={noop}
                draft=""
                onDraftChange={noop}
                canSave={false}
                saving={false}
                failed={false}
                onSave={noop}
            />,
        );

        expect(screen.getByLabelText('What should we call you?').getAttribute('maxlength')).toBe(
            String(DISPLAY_NAME_MAX_LENGTH),
        );
    });
});
