/**
 * The shared "Account" group, rendered through the NATIVE leaves (the native config resolves `./ProfileRow.js` to the
 * `.native.tsx` file): the display-name row, its value rule, and the platform's extra rows after it. Mobile passes none.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileAccountGroup } from '../ProfileAccountGroup.js';

afterEach(cleanup);

describe('ProfileAccountGroup (native)', () => {
    it('opens the editor from a Display name row that shows the saved name', async () => {
        const onEdit = vi.fn();
        render(<ProfileAccountGroup displayName="Ada" onEditDisplayName={onEdit} />);

        expect(screen.getByText('Ada')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Display name' }));
        expect(onEdit).toHaveBeenCalledOnce();
    });

    it('invites a name when none is saved, and shows no other row', () => {
        render(<ProfileAccountGroup displayName="" onEditDisplayName={vi.fn()} />);

        expect(screen.getByText('Add your name')).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });
});
