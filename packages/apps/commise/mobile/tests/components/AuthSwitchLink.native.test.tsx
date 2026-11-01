/**
 * Component tests for `AuthSwitchLink`, the "New to Commise? Create an account" row on the sign-in and sign-up
 * screens (A-003). `buildSpec.md` §8 Order asks for an inline LINK whose text never breaks across lines; it was a
 * half-width secondary pill. react-native-web under jsdom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
// The text is the design system's Tamagui `Text`, so the tree renders in its provider.
import { render, resolvedColour } from '@commise/ui/testing/tamagui';

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

    it('takes no press while the screen is busy (a sign-in is in flight, plan 012 D10)', () => {
        const onPress = vi.fn();
        render(<AuthSwitchLink prompt="New to Commise?" label="Create an account" onPress={onPress} disabled />);

        fireEvent.click(screen.getByRole('link', { name: 'Create an account' }));

        expect(onPress).not.toHaveBeenCalled();
        expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('aria-disabled')).toBe('true');
    });

    // REWRITTEN (owner ruling, 2026-11-01): the link was held to ONE line so the row, not the link, wrapped. At the
    // system's largest text the link alone was wider than the screen and read "Create an accou..". A control's label
    // wraps and is never cut off, so it may now break onto a second line.
    it('lets the link text wrap rather than cutting it off', () => {
        render(<AuthSwitchLink prompt="New to Commise?" label="Create an account" onPress={() => undefined} />);

        const text = window.getComputedStyle(screen.getByText('Create an account'));

        expect(text.whiteSpace).not.toBe('nowrap');
        expect(text.textOverflow).not.toBe('ellipsis');
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

        // REWRITTEN for ADR-0080: Tamagui theme colours, read through the resolver as a device paints them.
        expect(resolvedColour(screen.getByText('New to Commise?'), 'color')).toBe(rgb(roles.inkMuted));
        expect(resolvedColour(screen.getByText('Create an account'), 'color')).toBe(rgb(roles.actionText));
    });
});
