/**
 * Component tests for the mobile account-suspended notice (`SuspensionBanner`) rendered via
 * react-native-web under jsdom.
 *
 * Two invariants beyond "it renders": every user-facing string resolves from the shared, localized `authBlockMessages` (a hardcoded
 * English literal is a repo-mandate violation, and these notices are shown at the worst possible moment),
 * and every colour is a ROLE of the scheme the device is in (D15), so the notice reads in the dark theme too —
 * the banners previously carried raw `palette` values baked into one theme at import.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { authBlockMessages } from '@commise/features-account';
import { role, roleDark } from '@commise/ui/colors';
import { systemScheme } from '@commise/ui/testing/system-color-scheme';

import { SuspensionBanner } from '../../src/components/SuspensionBanner.js';

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

/** `#RRGGBB` → the `rgb(r, g, b)` form `getComputedStyle` reports. */
const toRgb = (hex: string): string => {
    const value = Number.parseInt(hex.slice(1), 16);

    return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

const THEMES = [
    ['light', role],
    ['dark', roleDark],
] as const;

describe('SuspensionBanner', () => {
    it('renders nothing for an active account', () => {
        const { container } = render(<SuspensionBanner status="active" />);

        expect(container.firstElementChild).toBeNull();
    });

    it('announces the suspension with the localized copy', () => {
        render(<SuspensionBanner status="suspended" />);

        const t = authBlockMessages.en.account_suspended;
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText(t.title)).toBeTruthy();
        expect(screen.getByText(t.body)).toBeTruthy();
    });

    it.each(THEMES)('paints the notice from the %s theme’s roles, accented with the danger tone', (name, colors) => {
        systemScheme.current = name;
        const { container } = render(<SuspensionBanner status="suspended" />);
        const banner = container.firstElementChild as HTMLElement;
        const style = window.getComputedStyle(banner);

        expect(style.borderLeftColor).toBe(toRgb(colors.danger));
        expect(style.backgroundColor).toBe(toRgb(colors.surfaceMuted));
        expect(window.getComputedStyle(screen.getByText(authBlockMessages.en.account_suspended.title)).color).toBe(
            toRgb(colors.ink),
        );
        expect(window.getComputedStyle(screen.getByText(authBlockMessages.en.account_suspended.body)).color).toBe(
            toRgb(colors.inkMuted),
        );
    });
});
