/**
 * Component tests for `AuthSwitchLink`, the "New to Commise? Create an account" row on the sign-in and sign-up
 * screens (A-003). `buildSpec.md` §8 Order asks for an inline LINK whose text never breaks across lines; it was a
 * half-width secondary pill. react-native-web under jsdom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { AuthSwitchLink } from '../../src/components/auth/AuthSwitchLink.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe('AuthSwitchLink', () => {
    it('shows the prompt and a LINK (not a button) named by the label', () => {
        render(<AuthSwitchLink prompt="New to Commise?" label="Create an account" onPress={() => undefined} />);

        expect(screen.getByText('New to Commise?')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('calls onPress when the link is pressed', () => {
        const onPress = vi.fn();
        render(<AuthSwitchLink prompt="New to Commise?" label="Create an account" onPress={onPress} />);

        fireEvent.click(screen.getByRole('link', { name: 'Create an account' }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('keeps the link text on ONE line, however narrow the row gets', () => {
        render(<AuthSwitchLink prompt="New to Commise?" label="Create an account" onPress={() => undefined} />);

        const text = screen.getByText('Create an account');

        expect(window.getComputedStyle(text).whiteSpace).toBe('nowrap');
    });

    it('lets the prompt and link wrap onto separate lines instead of overflowing', () => {
        render(<AuthSwitchLink prompt="New to Commise?" label="Create an account" onPress={() => undefined} />);

        const row = screen.getByText('New to Commise?').parentElement as HTMLElement;

        expect(window.getComputedStyle(row).flexWrap).toBe('wrap');
    });

    it('gives the link a 48 px touch target', () => {
        render(<AuthSwitchLink prompt="New to Commise?" label="Create an account" onPress={() => undefined} />);

        const link = screen.getByRole('link', { name: 'Create an account' });

        expect(window.getComputedStyle(link.firstElementChild as HTMLElement).minHeight).toBe('48px');
    });

    it.each([
        ['light', role],
        ['dark', roleDark],
    ] as const)('paints the prompt in inkMuted and the link in actionText in the %s theme', (name, roles) => {
        systemScheme.current = name;
        render(<AuthSwitchLink prompt="New to Commise?" label="Create an account" onPress={() => undefined} />);

        expect(window.getComputedStyle(screen.getByText('New to Commise?')).color).toBe(rgb(roles.inkMuted));
        expect(window.getComputedStyle(screen.getByText('Create an account')).color).toBe(rgb(roles.actionText));
    });
});
