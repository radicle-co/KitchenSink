// @vitest-environment jsdom
/**
 * The shared "Account" group, rendered through the WEB leaves: the display-name row, its value rule, and the platform's
 * extra rows after it. The native twin of this file runs the same cases through the native leaves.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileAccountGroup } from '../ProfileAccountGroup.js';

afterEach(cleanup);

describe('ProfileAccountGroup (web)', () => {
    it('is the Account group, opening the editor from a Display name row that shows the saved name', async () => {
        const onEdit = vi.fn();
        render(
            <ProfileAccountGroup
                displayName="Ada"
                username={null}
                email="ada@example.com"
                onEditDisplayName={onEdit}
            />,
        );

        const group = screen.getByRole('region', { name: 'Account' });
        const row = within(group).getByRole('button', { name: 'Display name' });

        expect(row.textContent).toContain('Ada');
        await userEvent.click(row);
        expect(onEdit).toHaveBeenCalledOnce();
    });

    it('invites a name when none is saved', () => {
        render(
            <ProfileAccountGroup displayName="" username={null} email="ada@example.com" onEditDisplayName={vi.fn()} />,
        );

        expect(screen.getByRole('button', { name: 'Display name' }).textContent).toContain('Add your name');
    });

    // S2 (owner, 2026-10-27): the read-only facts show once, here, under the editable name. Clerk owns both.
    it('shows the read-only Username and Email rows after the display name, as plain text and never as controls', () => {
        render(
            <ProfileAccountGroup
                displayName="Ada"
                username="braise"
                email="ada@example.com"
                onEditDisplayName={vi.fn()}
            />,
        );

        expect(screen.getByText('Username')).toBeTruthy();
        expect(screen.getByText('@braise')).toBeTruthy();
        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.getByText('ada@example.com')).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('shows no Username row for a cook without one — never a “Not set” with no way to set it', () => {
        render(
            <ProfileAccountGroup
                displayName="Ada"
                username={null}
                email="ada@example.com"
                onEditDisplayName={vi.fn()}
            />,
        );

        expect(screen.queryByText('Username')).toBeNull();
        expect(screen.getByText('ada@example.com')).toBeTruthy();
    });
});
