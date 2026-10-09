// @vitest-environment jsdom
/**
 * Web render leaves of the Profile page. Every state the page owns is asserted by role and name: the loading
 * skeleton, the failed header with its retry, the ready header, a pressable row in each tone, the hint, the busy
 * state, a link row, and the display-name sheet's field, Save gate and failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DisplayNameSheet } from '../DisplayNameSheet.js';
import { ProfileGroup } from '../ProfileGroup.js';
import { ProfileHeader } from '../ProfileHeader.js';
import { ProfileRow } from '../ProfileRow.js';
import { ProfileValueRow } from '../ProfileValueRow.js';
import { DISPLAY_NAME_MAX_LENGTH } from '../model.js';
import type { DisplayNameSheetProps, ProfileRowProps } from '../props.js';

afterEach(cleanup);

const noop = () => undefined;

describe('ProfileHeader (web)', () => {
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
        expect(screen.getByText('EM').getAttribute('aria-hidden')).toBe('true');
    });

    it('lets an unbroken email wrap anywhere instead of overflowing 320 px', () => {
        render(
            <ProfileHeader read={{ status: 'ready', displayName: '', email: 'a@b.co' }} initials="" onRetry={noop} />,
        );

        expect(screen.getByText('a@b.co').className).toContain('[overflow-wrap:anywhere]');
    });

    it('reports a failed read with a Try again control that retries', async () => {
        const onRetry = vi.fn();

        render(<ProfileHeader read={{ status: 'failed' }} initials="" onRetry={onRetry} />);

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t load your profile.');

        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledOnce();
    });
});

describe('ProfileRow (web)', () => {
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

        expect(button.className).toContain('text-danger-text');
        expect(button.textContent).toContain('Signs you out.');
    });

    it('is named by its label alone and described by its value and hint', () => {
        render(<ProfileRow {...row({ label: 'Close account', value: 'v', hint: 'Signs you out.', tone: 'danger' })} />);

        const button = screen.getByRole('button', { name: 'Close account' });

        const described = (button.getAttribute('aria-describedby') ?? '').split(' ');

        expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual(['v', 'Signs you out.']);
    });

    it('keeps the sign-out style ordinary ink, never red', () => {
        render(<ProfileRow {...row({ label: 'Sign out', chevron: false })} />);

        expect(screen.getByRole('button', { name: 'Sign out' }).className).not.toContain('danger');
    });

    it('is at least 56 px tall', () => {
        render(<ProfileRow {...row()} />);

        expect(screen.getByRole('button').className).toContain('min-h-14');
    });

    it('cannot be pressed again while busy, and says so', async () => {
        const onPress = vi.fn();

        render(<ProfileRow {...row({ busy: true, onPress })} />);

        const button = screen.getByRole('button');

        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.getAttribute('aria-disabled')).toBe('true');

        await userEvent.click(button);

        expect(onPress).not.toHaveBeenCalled();
    });

    it('is a link when it has a destination, and a plain click goes to onPress', async () => {
        const onPress = vi.fn();

        render(<ProfileRow {...row({ label: 'Food data sources', href: '/en/legal/sources', onPress })} />);

        const link = screen.getByRole('link', { name: /Food data sources/ });

        expect(link.getAttribute('href')).toBe('/en/legal/sources');

        await userEvent.click(link);

        expect(onPress).toHaveBeenCalledOnce();
    });
});

describe('ProfileValueRow and ProfileGroup (web)', () => {
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

        expect(screen.getByRole('region', { name: 'Preferences' })).toBeTruthy();
        expect(screen.getByRole('heading', { level: 2, name: 'Preferences' })).toBeTruthy();
    });

    it('names a group with no visible heading by its label', () => {
        render(
            <ProfileGroup label="Account">
                <ProfileValueRow label="Email" value="x" />
            </ProfileGroup>,
        );

        expect(screen.getByRole('region', { name: 'Account' })).toBeTruthy();
        expect(screen.queryByRole('heading')).toBeNull();
    });
});

describe('DisplayNameSheet (web)', () => {
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

        expect(screen.getByRole('dialog', { name: 'What should we call you?' })).toBeTruthy();
        expect((screen.getByRole('textbox', { name: 'What should we call you?' }) as HTMLInputElement).value).toBe(
            'Eliza',
        );
    });

    it('renders nothing while closed', () => {
        render(<DisplayNameSheet {...sheet({ open: false })} />);

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('reports each edit and saves only when Save is pressed', async () => {
        const onDraftChange = vi.fn();
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ draft: '', onDraftChange, onSave })} />);

        await userEvent.type(screen.getByRole('textbox'), 'E');

        expect(onDraftChange).toHaveBeenCalledWith('E');
        expect(onSave).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).toHaveBeenCalledOnce();
    });

    it('submits on Enter, so the keyboard reaches Save too', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ onSave })} />);

        await userEvent.type(screen.getByRole('textbox'), '{Enter}');

        expect(onSave).toHaveBeenCalledOnce();
    });

    it('disables Save while the name cannot be saved, and never fires it', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ canSave: false, onSave })} />);

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSave).not.toHaveBeenCalled();
    });

    it('does not submit from the keyboard while Save is disabled', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ canSave: false, onSave })} />);

        await userEvent.type(screen.getByRole('textbox'), '{Enter}');

        expect(onSave).not.toHaveBeenCalled();
    });

    it('shows Saving… and cannot be pressed again while the save is in flight', async () => {
        const onSave = vi.fn();

        render(<DisplayNameSheet {...sheet({ saving: true, onSave })} />);

        await userEvent.click(screen.getByRole('button', { name: /Sav/ }));

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /Sav/ }).getAttribute('aria-busy')).toBe('true');
    });

    it('announces a failed save and marks the field invalid', () => {
        render(<DisplayNameSheet {...sheet({ failed: true })} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t save your name. Please try again.');
        expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
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
describe('DisplayNameSheet (web) — the length limit', () => {
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

        expect(screen.getByRole('textbox', { name: 'What should we call you?' }).getAttribute('maxlength')).toBe(
            String(DISPLAY_NAME_MAX_LENGTH),
        );
    });
});
