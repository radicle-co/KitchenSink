/**
 * Component tests for the mobile account notices (`SuspensionBanner`, `ImpersonationWarning`) rendered via
 * react-native-web under jsdom.
 *
 * Two invariants beyond "it renders": every user-facing string resolves from `mobileMessages` (a hardcoded
 * English literal is a repo-mandate violation, and these notices are shown at the worst possible moment),
 * and every colour is a ROLE of the scheme the device is in (D15), so the notice reads in the dark theme too —
 * the banners previously carried raw `palette` values baked into one theme at import.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { role, roleDark } from '@commise/ui/colors';

import { ImpersonationWarning } from '../../src/components/ImpersonationWarning.js';
import { SuspensionBanner } from '../../src/components/SuspensionBanner.js';
import { mobileMessages } from '../../src/i18n/messages.js';

afterEach(() => {
    cleanup();
    scheme.current = null;
});

/** The system colour scheme the next render sees. */
const scheme = vi.hoisted(() => ({ current: null as 'light' | 'dark' | null }));
vi.mock('react-native', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-native')>()),
    useColorScheme: () => scheme.current,
}));

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

        const t = mobileMessages.en.suspension;
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText(t.title)).toBeTruthy();
        expect(screen.getByText(t.message)).toBeTruthy();
    });

    it.each(THEMES)('paints the notice from the %s theme’s roles, accented with the danger tone', (name, colors) => {
        scheme.current = name;
        const { container } = render(<SuspensionBanner status="suspended" />);
        const banner = container.firstElementChild as HTMLElement;
        const style = window.getComputedStyle(banner);

        expect(style.borderLeftColor).toBe(toRgb(colors.danger));
        expect(style.backgroundColor).toBe(toRgb(colors.surfaceMuted));
        expect(window.getComputedStyle(screen.getByText(mobileMessages.en.suspension.title)).color).toBe(
            toRgb(colors.ink),
        );
        expect(window.getComputedStyle(screen.getByText(mobileMessages.en.suspension.message)).color).toBe(
            toRgb(colors.inkMuted),
        );
    });
});

describe('ImpersonationWarning', () => {
    it('explains the block with the localized copy', () => {
        render(<ImpersonationWarning />);

        const t = mobileMessages.en.impersonation;
        expect(screen.getByRole('alert')).toBeTruthy();
        expect(screen.getByText(t.title)).toBeTruthy();
        expect(screen.getByText(t.message)).toBeTruthy();
    });

    it('appends the session id through the localized template when one is known', () => {
        render(<ImpersonationWarning sessionId="sess_42" />);

        const t = mobileMessages.en.impersonation;
        expect(screen.getByText(`${t.message} ${t.sessionLabel.replace('{sessionId}', 'sess_42')}`)).toBeTruthy();
    });

    it('omits the session line entirely when no session id is known', () => {
        render(<ImpersonationWarning />);

        expect(screen.queryByText(/Session:/)).toBeNull();
    });

    it.each(THEMES)(
        'accents the notice with the caution tone in the %s theme (it is a caution, not a failure)',
        (name, colors) => {
            scheme.current = name;
            const { container } = render(<ImpersonationWarning />);
            const banner = container.firstElementChild as HTMLElement;

            expect(window.getComputedStyle(banner).borderLeftColor).toBe(toRgb(colors.attention));
            expect(window.getComputedStyle(banner).borderLeftColor).not.toBe(toRgb(colors.danger));
        },
    );
});
