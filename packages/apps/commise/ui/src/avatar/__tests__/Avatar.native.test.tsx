/**
 * The native Avatar (buildSpec §3.3, §3.8): a button named by its label in a 44 pt target, whose disc is blank while the
 * profile loads, shows initials with a name, and the `user` glyph without one or after a failed read — never the old
 * `'·'` (M8).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { render, renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
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

    // The Home header draws a 36 disc with a shadow and a 1 px divider ring; every other place keeps the 32 disc.
    describe('size', () => {
        const discOf = (): HTMLElement => {
            const disc = screen.getByRole('button').firstElementChild;

            if (!(disc instanceof HTMLElement)) {
                throw new Error('The avatar has no disc.');
            }

            return disc;
        };

        it('defaults to the 32 pt disc with no shadow and no ring', () => {
            render(<Avatar status="ready" initials="EM" label="Profile" onPress={() => undefined} />);
            const disc = discOf();

            expect(resolvedStyle(disc, 'width')).toBe('32px');
            expect(resolvedStyle(disc, 'height')).toBe('32px');
            expect(resolvedStyle(disc, 'borderTopWidth')).not.toBe('1px');
            expect(resolvedStyle(disc, 'boxShadow')).toBe('');
        });

        it('draws the large disc at 36 pt with a 1 pt ring and a shadow', () => {
            render(<Avatar size="large" status="ready" initials="EM" label="Profile" onPress={() => undefined} />);
            const disc = discOf();

            expect(resolvedStyle(disc, 'width')).toBe('36px');
            expect(resolvedStyle(disc, 'height')).toBe('36px');
            expect(resolvedStyle(disc, 'borderTopWidth')).toBe('1px');
            expect(resolvedStyle(disc, 'boxShadow')).not.toBe('');
        });

        it.each(['default', 'large'] as const)('keeps the 44 pt target around the %s disc', (size) => {
            render(<Avatar size={size} status="ready" initials="EM" label="Profile" onPress={() => undefined} />);
            const style = getComputedStyle(screen.getByRole('button'));

            expect(style.minWidth).toBe('44px');
            expect(style.minHeight).toBe('44px');
        });

        it('still shows the initials on the large disc', () => {
            render(<Avatar size="large" status="ready" initials="EM" label="Profile" onPress={() => undefined} />);

            expect(screen.getByRole('button').textContent).toBe('EM');
        });
    });
});

// Device logcat showed `[tamagui] a variant set "elevation", which is not a style` on every launch while the large disc spread
// the elevation token into a variant. Tamagui accepts a shadow as props on the component, never inside a variant.
// ⚠️ Whether jsdom's Tamagui build logs this warning is not guaranteed (the web build skips some native-only checks), so the
// source test below pins the cause too: the token is applied as props, not spread into `variants`.
describe('Avatar (native) — no Tamagui warning', () => {
    it.each(['default', 'large'] as const)('logs no [tamagui] warning when the %s disc renders', (size) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        render(<Avatar size={size} status="ready" initials="EM" label="Profile" onPress={() => undefined} />);

        const messages = [...warn.mock.calls, ...error.mock.calls].map((call) => String(call[0]));
        warn.mockRestore();
        error.mockRestore();
        expect(messages.filter((message) => message.includes('[tamagui]'))).toEqual([]);
    });

    it('logs no [tamagui] warning when the disc module is loaded fresh', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.resetModules();

        await import('../AvatarDisc.native.js');

        const messages = warn.mock.calls.map((call) => String(call[0]));
        warn.mockRestore();
        expect(messages.filter((message) => message.includes('[tamagui]'))).toEqual([]);
    });

    it('does not spread the elevation token inside a variant', async () => {
        const { readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const source = readFileSync(join(process.cwd(), 'src/avatar/AvatarDisc.native.tsx'), 'utf8');
        const variants = source.slice(source.indexOf('variants:'), source.indexOf('});', source.indexOf('variants:')));

        expect(variants).not.toMatch(/elevation/u);
    });
});

// Designer ruling c10ecadbf (2026-11-03): initials do not scale; they are 40% of the disc's diameter (rounded down to an
// even size), so two letters fit at every size. A fit test on real font metrics proves the fit
// (`features/recipes/src/format/__tests__/discGeometry.fit.test.ts`).
describe('Avatar (native) — initials are 40% of the disc and do not scale', () => {
    it.each([
        ['default', 12],
        ['large', 14],
    ] as const)("draws the %s disc's initials at %i pt at system scale 2", (size, px) => {
        renderWithTamagui(
            <Avatar size={size} status="ready" initials="MW" label="Profile" onPress={() => undefined} />,
            'light',
            2,
        );
        const initials = screen.getByText('MW');

        expect(resolvedStyle(initials, 'fontSize')).toBe(`${String(px)}px`);
    });

    it('draws the same size at system scale 1', () => {
        renderWithTamagui(
            <Avatar status="ready" initials="MW" label="Profile" onPress={() => undefined} />,
            'light',
            1,
        );

        expect(resolvedStyle(screen.getByText('MW'), 'fontSize')).toBe('12px');
    });
});
