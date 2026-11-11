/**
 * The native AvatarDisc (`buildSpec.md` §3.2, §3.3): blank while loading, initials with a name, the `user` glyph without one
 * or after a failed read; 32, or the 24 `tab` glyph, which is exactly the icons' box at every system text size; and an
 * `active` ring laid OUTSIDE that box as an overlay, so it adds no layout size and the label under it keeps the others'
 * baseline (a border on the disc made it 28 and dropped the label). REWRITES the old `Avatar` suite: the button and the
 * `large` form are gone (owner ruling 2026-11-11).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { role } from '../../tokens/colors.js';
import { rgb } from '../../testing/systemColorScheme.js';
import { render, renderWithTamagui, resolvedColour, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { AvatarDisc } from '../AvatarDisc.native.js';

afterEach(cleanup);

const box = (): HTMLElement => screen.getByTestId('avatarBox');
const disc = (): HTMLElement => screen.getByTestId('avatarDisc');
const ring = (): HTMLElement => screen.getByTestId('avatarRing');

describe('AvatarDisc (native)', () => {
    it('shows the initials', () => {
        render(<AvatarDisc status="ready" initials="EM" />);

        expect(disc().textContent).toBe('EM');
    });

    it('is blank while loading', () => {
        render(<AvatarDisc status="loading" initials="EM" />);

        expect(disc().textContent).toBe('');
        expect(disc().querySelector('[data-commise-stub="icon"]')).toBeNull();
    });

    it.each([
        ['has no name', 'ready', ''],
        ['failed', 'failed', 'EM'],
    ] as const)('shows the user glyph, never a dot, when the profile %s', (_what, status, initials) => {
        render(<AvatarDisc status={status} initials={initials} />);

        expect(disc().querySelector('[data-commise-stub="icon"]')?.getAttribute('data-icon-name')).toBe('user');
    });

    it('defaults to the 32 disc', () => {
        render(<AvatarDisc status="ready" initials="EM" />);

        expect(resolvedStyle(disc(), 'width')).toBe('32px');
        expect(resolvedStyle(disc(), 'height')).toBe('32px');
    });

    // A glyph never scales with the text: the tab disc is the icons' 24 box at every font scale, active or not.
    it.each([1, 2, 3.1])(
        'draws the tab form as 24 by 24 at font scale %s, with a ring that adds no layout size',
        (scale) => {
            for (const active of [false, true]) {
                renderWithTamagui(
                    <AvatarDisc size="tab" status="ready" initials="EM" active={active} />,
                    'light',
                    scale,
                );

                expect(resolvedStyle(disc(), 'width')).toBe('24px');
                expect(resolvedStyle(disc(), 'height')).toBe('24px');
                expect(resolvedStyle(box(), 'width')).toBe('24px');
                expect(resolvedStyle(box(), 'height')).toBe('24px');
                expect(resolvedStyle(box(), 'borderTopWidth')).not.toBe('2px');
                expect(resolvedStyle(ring(), 'position')).toBe('absolute');
                cleanup();
            }
        },
    );

    it('rings the active disc in ink at 2, and paints no ring when it is not active', () => {
        render(<AvatarDisc size="tab" status="ready" initials="EM" active />);

        expect(resolvedStyle(ring(), 'borderTopWidth')).toBe('2px');
        expect(resolvedColour(ring(), 'borderTopColor')).toBe(rgb(role.ink));
        cleanup();

        render(<AvatarDisc size="tab" status="ready" initials="EM" />);

        expect(resolvedColour(ring(), 'borderTopColor')).not.toBe(rgb(role.ink));
    });
});

describe('AvatarDisc (native) — initials do not scale', () => {
    it.each([
        ['default', 12],
        ['tab', 10],
    ] as const)("draws the %s disc's initials at %i pt at system scale 2", (size, px) => {
        renderWithTamagui(<AvatarDisc size={size} status="ready" initials="MW" />, 'light', 2);

        expect(resolvedStyle(screen.getByText('MW'), 'fontSize')).toBe(`${String(px)}px`);
    });
});

// Device logcat once showed `[tamagui] a variant set "elevation", which is not a style` on every launch. No Tamagui warning
// may come from the disc.
describe('AvatarDisc (native) — no Tamagui warning', () => {
    it.each(['default', 'tab'] as const)('logs no [tamagui] warning when the %s disc renders', (size) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        render(<AvatarDisc size={size} status="ready" initials="EM" active />);

        const messages = [...warn.mock.calls, ...error.mock.calls].map((call) => String(call[0]));
        warn.mockRestore();
        error.mockRestore();
        expect(messages.filter((message) => message.includes('[tamagui]'))).toEqual([]);
    });
});
