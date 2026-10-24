/**
 * The native sign-out row: an ink Profile row named by its state, with the localized failure beneath it. Not
 * destructive, so never red (`buildSpec.md` §9.1). Every state is asserted by role and name.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { SignOutRow } from '../SignOutRow.native.js';

afterEach(cleanup);

describe('SignOutRow (native)', () => {
    it('is a "Sign out" row that presses through, with no alert', async () => {
        const onPress = vi.fn();
        render(<SignOutRow busy={false} failed={false} onPress={onPress} />);

        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

        expect(onPress).toHaveBeenCalledOnce();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('reads "Signing out…", busy and unpressable, while the sign-out runs', async () => {
        const onPress = vi.fn();
        render(<SignOutRow busy failed={false} onPress={onPress} />);

        const button = screen.getByRole('button', { name: 'Signing out…' });

        // A disabled native row sets `pointer-events: none`; the click is still tried, and must do nothing.
        await userEvent.click(button, { pointerEventsCheck: 0 });

        expect(button.getAttribute('aria-disabled')).toBe('true');
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
