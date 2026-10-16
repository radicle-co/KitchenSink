// @vitest-environment jsdom
/**
 * The web sign-out row: an ink Profile row named by its state, with the localized failure beneath it. Not destructive,
 * so never red (`buildSpec.md` §9.1). Every state is asserted by role and name.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignOutRow } from '../SignOutRow.js';

afterEach(cleanup);

describe('SignOutRow (web)', () => {
    it('is an ink "Sign out" row that presses through', async () => {
        const onPress = vi.fn();
        render(<SignOutRow busy={false} failed={false} onPress={onPress} />);

        const row = screen.getByRole('button', { name: 'Sign out' });
        await userEvent.click(row);

        expect(onPress).toHaveBeenCalledOnce();
        expect(row.className).toContain('text-ink');
        expect(row.className).not.toContain('text-danger-text');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('reads "Signing out…", busy and unpressable, while the sign-out runs', async () => {
        const onPress = vi.fn();
        render(<SignOutRow busy failed={false} onPress={onPress} />);

        const row = screen.getByRole('button', { name: 'Signing out…' });
        await userEvent.click(row);

        expect(row.getAttribute('aria-busy')).toBe('true');
        expect(onPress).not.toHaveBeenCalled();
    });

    it('announces the localized failure and stays retryable', async () => {
        const onPress = vi.fn();
        render(<SignOutRow busy={false} failed onPress={onPress} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t sign you out. Try again.');
        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        expect(onPress).toHaveBeenCalledOnce();
    });
});
