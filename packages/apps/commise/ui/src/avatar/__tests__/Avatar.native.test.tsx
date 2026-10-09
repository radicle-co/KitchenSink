/**
 * The native Avatar (buildSpec §3.3, §3.8): a button named by its label in a 44 pt target, whose disc is blank while the
 * profile loads, shows initials with a name, and the `user` glyph without one or after a failed read — never the old
 * `'·'` (M8).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { Avatar } from '../Avatar.native.js';

afterEach(cleanup);

describe('Avatar (native)', () => {
    it('is a button named by its label, showing the initials', () => {
        const onPress = vi.fn();
        render(<Avatar status="ready" initials="EM" label="Profile, Eliza M" onPress={onPress} />);

        const button = screen.getByRole('button', { name: 'Profile, Eliza M' });
        fireEvent.click(button);

        expect(button.textContent).toBe('EM');
        expect(onPress).toHaveBeenCalledOnce();
    });

    it('is a blank disc while loading', () => {
        render(<Avatar status="loading" initials="EM" label="Profile" onPress={() => undefined} />);

        const button = screen.getByRole('button', { name: 'Profile' });

        expect(button.textContent).toBe('');
        expect(button.querySelector('[data-commise-stub="icon"]')).toBeNull();
    });

    it('shows the user glyph without a name and after a failed read, never a dot', () => {
        for (const status of ['ready', 'failed'] as const) {
            const { unmount } = render(
                <Avatar status={status} initials="" label="Profile" onPress={() => undefined} />,
            );

            const button = screen.getByRole('button', { name: 'Profile' });

            expect(button.textContent).toBe('');
            expect(button.querySelector('[data-commise-stub="icon"]')?.getAttribute('data-icon-name')).toBe('user');
            unmount();
        }
    });

    it('keeps a 44 pt target around the 32 pt disc', () => {
        render(<Avatar status="ready" initials="EM" label="Profile, Eliza M" onPress={() => undefined} />);

        const style = getComputedStyle(screen.getByRole('button'));

        expect(style.minWidth).toBe('44px');
        expect(style.minHeight).toBe('44px');
    });
});
