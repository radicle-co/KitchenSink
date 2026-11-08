/**
 * The web Avatar (buildSpec §3.3, §3.8): a link to Profile named by its label, whose disc is blank while the profile
 * loads, shows initials when there is a name, and the `user` glyph without one or when the read failed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { Avatar } from '../Avatar.js';

afterEach(cleanup);

describe('Avatar (web)', () => {
    it('is a link to Profile, named by its label, showing the initials', () => {
        render(
            <Avatar
                status="ready"
                initials="EM"
                label="Profile, Eliza M"
                href="/en/profile"
                onPress={() => undefined}
            />,
        );

        const link = screen.getByRole('link', { name: 'Profile, Eliza M' });

        expect(link.getAttribute('href')).toBe('/en/profile');
        expect(link.textContent).toBe('EM');
    });

    it('hands a plain click to onPress and cancels the link’s own navigation', () => {
        const onPress = vi.fn();
        render(<Avatar status="ready" initials="EM" label="Profile, Eliza M" href="/en/profile" onPress={onPress} />);

        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        screen.getByRole('link').dispatchEvent(event);

        expect(onPress).toHaveBeenCalledOnce();
        expect(event.defaultPrevented).toBe(true);
    });

    it('leaves a modified click (a new tab) to the browser', () => {
        const onPress = vi.fn();
        render(<Avatar status="ready" initials="EM" label="Profile, Eliza M" href="/en/profile" onPress={onPress} />);

        fireEvent.click(screen.getByRole('link'), { metaKey: true });

        expect(onPress).not.toHaveBeenCalled();
    });

    it('is a blank disc while the profile loads: no initials, no glyph, still named', () => {
        const { container } = render(
            <Avatar status="loading" initials="EM" label="Profile" href="/en/profile" onPress={() => undefined} />,
        );

        expect(screen.getByRole('link', { name: 'Profile' }).textContent).toBe('');
        expect(container.querySelector('svg')).toBeNull();
    });

    it('shows the user glyph when the cook has no name', () => {
        const { container } = render(
            <Avatar status="ready" initials="" label="Profile" href="/en/profile" onPress={() => undefined} />,
        );

        expect(screen.getByRole('link').textContent).toBe('');
        expect(container.querySelector('svg')).not.toBeNull();
    });

    it('shows the user glyph, never an error, when the profile failed', () => {
        const { container } = render(
            <Avatar status="failed" initials="EM" label="Profile" href="/en/profile" onPress={() => undefined} />,
        );

        expect(screen.getByRole('link', { name: 'Profile' }).textContent).toBe('');
        expect(container.querySelector('svg')).not.toBeNull();
    });

    it('is a button when there is no href', () => {
        const onPress = vi.fn();
        render(<Avatar status="ready" initials="EM" label="Profile, Eliza M" onPress={onPress} />);

        fireEvent.click(screen.getByRole('button', { name: 'Profile, Eliza M' }));

        expect(onPress).toHaveBeenCalledOnce();
    });

    // The Home header draws a 36 px disc with a shadow and a 1 px divider ring; every other place keeps the 32 px disc.
    describe('size', () => {
        const discOf = (): Element | null => screen.getByRole('link', { name: 'Profile' }).firstElementChild;

        const renderAvatar = (size?: 'default' | 'large'): void => {
            render(
                <Avatar
                    {...(size === undefined ? {} : { size })}
                    status="ready"
                    initials="EM"
                    label="Profile"
                    href="/en/profile"
                    onPress={() => undefined}
                />,
            );
        };

        it('defaults to the 32 px disc with no shadow and no ring', () => {
            renderAvatar();
            const classes = discOf()?.className ?? '';

            expect(classes).toContain('size-8');
            expect(classes).not.toContain('shadow-sm');
            expect(classes).not.toContain('ring-1');
        });

        it('draws the large disc at 36 px with the small shadow and a 1 px divider ring', () => {
            renderAvatar('large');
            const classes = discOf()?.className ?? '';

            expect(classes).toContain('size-9');
            expect(classes).not.toContain('size-8');
            expect(classes).toContain('shadow-sm');
            expect(classes).toContain('ring-1');
            expect(classes).toContain('ring-line-divider');
        });

        it.each([undefined, 'large'] as const)('keeps the 44 px target (size-11) around the disc, size %s', (size) => {
            renderAvatar(size);

            expect(screen.getByRole('link', { name: 'Profile' }).className).toContain('size-11');
        });
    });
});

// Designer ruling c10ecadbf (2026-11-03): initials are 40% of the disc's diameter and do not scale with the text size.
describe('Avatar (web) — initials are 40% of the disc', () => {
    it.each([
        ['default', 12],
        ['large', 14],
    ] as const)("draws the %s disc's initials at %i px, set in px so the text size cannot grow them", (size, px) => {
        render(
            <Avatar
                size={size}
                status="ready"
                initials="MW"
                label="Profile"
                href="/en/profile"
                onPress={() => undefined}
            />,
        );
        const disc = screen.getByText('MW');

        expect(disc.style.fontSize).toBe(`${String(px)}px`);
    });
});
