/**
 * The web AvatarDisc (`buildSpec.md` §3.2, §3.3): blank while the profile loads, initials on `action` with a name, the `user`
 * glyph without one or when the read failed; a 32 disc, or the 24 `tab` glyph in a box of CSS px (never rem: a glyph does
 * not scale with the text, and the icons beside it are 24); and an `active` ring that is a shadow, so it adds no layout size.
 * REWRITES the old `Avatar` suite: the button is gone with the title-row avatar (owner ruling 2026-11-11), and the `large`
 * form with it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { AvatarDisc } from '../AvatarDisc.js';

afterEach(cleanup);

const disc = (container: HTMLElement): HTMLElement => container.querySelector('[data-avatar-disc]') as HTMLElement;

describe('AvatarDisc (web)', () => {
    it('is decorative: hidden from assistive tech, the control it sits in carries the name', () => {
        const { container } = render(<AvatarDisc status="ready" initials="EM" />);

        expect(disc(container).getAttribute('aria-hidden')).toBe('true');
    });

    it('shows the initials on the action fill', () => {
        const { container } = render(<AvatarDisc status="ready" initials="EM" />);

        expect(disc(container).textContent).toBe('EM');
        expect(disc(container).className).toContain('bg-action');
    });

    it('is blank while the profile loads: no initials, no glyph', () => {
        const { container } = render(<AvatarDisc status="loading" initials="EM" />);

        expect(disc(container).textContent).toBe('');
        expect(container.querySelector('svg')).toBeNull();
    });

    it.each([
        ['has no name', 'ready', ''],
        ['failed', 'failed', 'EM'],
    ] as const)('shows the user glyph, never an error, when the profile %s', (_what, status, initials) => {
        const { container } = render(<AvatarDisc status={status} initials={initials} />);

        expect(container.querySelector('svg')).not.toBeNull();
    });

    describe('size', () => {
        it('defaults to the 32 disc', () => {
            const { container } = render(<AvatarDisc status="ready" initials="EM" />);

            expect(disc(container).className).toContain('size-8');
        });

        it('draws the tab form as a 24 by 24 box in px, not rem, whatever the text size', () => {
            const { container } = render(<AvatarDisc size="tab" status="ready" initials="EM" />);

            expect(disc(container).style.width).toBe('24px');
            expect(disc(container).style.height).toBe('24px');
            expect(disc(container).className).not.toMatch(/\bsize-/u);
        });

        it.each([
            ['default', 12],
            ['tab', 10],
        ] as const)(
            "draws the %s disc's initials at %i px, set in px so the text size cannot grow them",
            (size, px) => {
                const { getByText } = render(<AvatarDisc size={size} status="ready" initials="MW" />);

                expect(getByText('MW').style.fontSize).toBe(`${String(px)}px`);
            },
        );
    });

    describe('the active ring', () => {
        it('is a 2 ink ring drawn as a shadow, which takes no layout room, and never a border', () => {
            const { container } = render(<AvatarDisc size="tab" status="ready" initials="EM" active />);

            expect(disc(container).className).toContain('ring-2');
            expect(disc(container).className).toContain('ring-ink');
            expect(disc(container).className).not.toMatch(/\bborder/u);
        });

        it('is absent when the disc is not active', () => {
            const { container } = render(<AvatarDisc size="tab" status="ready" initials="EM" />);

            expect(disc(container).className).not.toContain('ring-2');
        });
    });
});
