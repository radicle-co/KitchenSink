// @vitest-environment jsdom
/**
 * The shared "Account" group, rendered through the WEB leaves: the display-name row, its value rule, and the platform's
 * extra rows after it. The native twin of this file runs the same cases through the native leaves.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileAccountGroup } from '../ProfileAccountGroup.js';
import { ProfileValueRow } from '../ProfileValueRow.js';

afterEach(cleanup);

describe('ProfileAccountGroup (web)', () => {
    it('is the Account group, opening the editor from a Display name row that shows the saved name', async () => {
        const onEdit = vi.fn();
        render(<ProfileAccountGroup displayName="Ada" onEditDisplayName={onEdit} />);

        const group = screen.getByRole('region', { name: 'Account' });
        const row = within(group).getByRole('button', { name: 'Display name' });

        expect(row.textContent).toContain('Ada');
        await userEvent.click(row);
        expect(onEdit).toHaveBeenCalledOnce();
    });

    it('invites a name when none is saved', () => {
        render(<ProfileAccountGroup displayName="" onEditDisplayName={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Display name' }).textContent).toContain('Add your name');
    });

    it('shows the platform’s extra rows after the display name, and none when there are none', () => {
        const { rerender } = render(<ProfileAccountGroup displayName="Ada" onEditDisplayName={vi.fn()} />);

        expect(screen.queryByText('Email')).toBeNull();

        rerender(
            <ProfileAccountGroup displayName="Ada" onEditDisplayName={vi.fn()}>
                <ProfileValueRow label="Email" value="ada@example.com" />
            </ProfileAccountGroup>,
        );

        expect(screen.getByText('Email')).toBeTruthy();
        expect(screen.getByText('ada@example.com')).toBeTruthy();
    });
});
