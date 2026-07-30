/**
 * Component tests for the mobile account notices (`SuspensionBanner`, `ImpersonationWarning`) rendered via
 * react-native-web under jsdom.
 *
 * Two invariants beyond "it renders": every user-facing string resolves from `mobileMessages` (a hardcoded
 * English literal is a repo-mandate violation, and these notices are shown at the worst possible moment),
 * and every colour comes from the design-system `palette` — the banners previously carried six raw Material
 * hex values that belong to no Commise token.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { palette } from '@commise/ui';

import { ImpersonationWarning, SuspensionBanner } from '../../src/components/SuspensionBanner.js';
import { mobileMessages } from '../../src/i18n/messages.js';

afterEach(cleanup);

/**
 * Every colour react-native-web actually PAINTS on the rendered subtree: the background, the text, and each
 * border that has a non-zero width (an unset border still reports jsdom's initial `rgb(0, 0, 0)`, which is
 * not an authored value and would only add noise).
 */
const colorsIn = (container: HTMLElement): readonly string[] =>
    Array.from(container.querySelectorAll<HTMLElement>('*')).flatMap((node) => {
        const style = window.getComputedStyle(node);
        const edges = (['Left', 'Right', 'Top', 'Bottom'] as const)
            .filter((edge) => Number.parseFloat(style.getPropertyValue(`border-${edge.toLowerCase()}-width`)) > 0)
            .map((edge) => style[`border${edge}Color` as const]);

        return [style.backgroundColor, style.color, ...edges];
    });

/** `#RRGGBB` → the `rgb(r, g, b)` form `getComputedStyle` reports. */
const toRgb = (hex: string): string => {
    const value = Number.parseInt(hex.slice(1), 16);

    return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

/** Colours that are neither an unset default, nor a palette entry, nor the tokenized subtle border. */
const offPaletteColors = (container: HTMLElement): readonly string[] => {
    const allowed = new Set([
        // jsdom's initial values for an unset background / text colour.
        '',
        'rgba(0, 0, 0, 0)',
        'transparent',
        'canvastext',
        // `nativeTokens.borderSubtle`, the single-sourced hairline.
        'rgba(178, 190, 195, 0.3)',
        ...Object.values(palette).map(toRgb),
    ]);

    return colorsIn(container).filter((color) => !allowed.has(color));
};

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

    it('paints only design-system palette colours (no raw Material hex)', () => {
        const { container } = render(<SuspensionBanner status="suspended" />);

        expect(offPaletteColors(container)).toEqual([]);
    });

    it('accents the notice with the error tone', () => {
        const { container } = render(<SuspensionBanner status="suspended" />);
        const banner = container.firstElementChild as HTMLElement;

        expect(window.getComputedStyle(banner).borderLeftColor).toBe(toRgb(palette.error));
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

    it('paints only design-system palette colours (no raw Material hex)', () => {
        const { container } = render(<ImpersonationWarning sessionId="sess_42" />);

        expect(offPaletteColors(container)).toEqual([]);
    });

    it('accents the notice with the warning tone (it is a caution, not a failure)', () => {
        const { container } = render(<ImpersonationWarning />);
        const banner = container.firstElementChild as HTMLElement;

        expect(window.getComputedStyle(banner).borderLeftColor).toBe(toRgb(palette.warning));
    });
});
