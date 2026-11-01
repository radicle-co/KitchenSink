/**
 * The shared "Account" group, rendered through the NATIVE leaves (the native config resolves `./ProfileRow.js` to the
 * `.native.tsx` file): the display-name row, its value rule, and the platform's extra rows after it. Mobile passes none.
 */
import { cleanup, screen } from '@testing-library/react';
// Its leaves draw through the design system's Tamagui `Text` (ADR-0080), so the tree renders in its provider.
import { render } from '@commise/ui/testing/tamagui';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileAccountGroup } from '../ProfileAccountGroup.js';

afterEach(cleanup);

describe('ProfileAccountGroup (native)', () => {
    it('opens the editor from a Display name row that shows the saved name', async () => {
        const onEdit = vi.fn();
        render(
            <ProfileAccountGroup
                displayName="Ada"
                username={null}
                email="ada@example.com"
                onEditDisplayName={onEdit}
            />,
        );

        expect(screen.getByText('Ada')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Display name' }));
        expect(onEdit).toHaveBeenCalledOnce();
    });

    it('invites a name when none is saved, and shows no other row', () => {
        render(
            <ProfileAccountGroup displayName="" username={null} email="ada@example.com" onEditDisplayName={vi.fn()} />,
        );

        expect(screen.getByText('Add your name')).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(1);
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
