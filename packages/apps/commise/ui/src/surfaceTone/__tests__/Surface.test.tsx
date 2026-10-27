/**
 * The web Surface: an element wearing its tone's classes. jsdom has no stylesheet, so structure is what is proved here (the
 * tone classes are the ones `surfaceToneClass` spells, and `surfaceToneOf` reads them as the cascade would); the cascade
 * itself, in a real browser, is `tests/e2e/surfaceToneCascade.spec.ts` in the web app.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { surfaceToneOf } from '../../testing/surfaceToneOf.js';
import { SURFACE_TONE_NAMES } from '../surfaceTone.js';
import { Surface } from '../Surface.js';
import { surfaceToneClass } from '../surfaceToneClass.js';

afterEach(cleanup);

describe('Surface (web)', () => {
    it.each(SURFACE_TONE_NAMES)('wears the %s classes and states the tone to a control inside it', (tone) => {
        render(
            <Surface tone={tone}>
                <button type="button">Inside</button>
            </Surface>,
        );
        const button = screen.getByRole('button', { name: 'Inside' });

        expect(button.parentElement?.className.split(' ')).toEqual(
            expect.arrayContaining(surfaceToneClass(tone).split(' ')),
        );
        expect(surfaceToneOf(button)).toBe(tone);
    });

    it('adds the caller’s classes after the tone’s, and takes a section element', () => {
        render(
            <Surface tone="paper" as="section" className="rounded-lg p-4" role="group" aria-label="Notes">
                <button type="button">Inside</button>
            </Surface>,
        );
        const group = screen.getByRole('group', { name: 'Notes' });

        expect(group.tagName).toBe('SECTION');
        expect(group.className).toBe(`${surfaceToneClass('paper')} rounded-lg p-4`);
    });

    it('is only paint when given no role or name: neither is invented', () => {
        const { container } = render(<Surface tone="muted">text</Surface>);

        expect(container.firstElementChild?.getAttribute('role')).toBeNull();
        expect(container.firstElementChild?.getAttribute('aria-label')).toBeNull();
    });

    it('lets a nested surface state its own tone, and the one around it keep its', () => {
        render(
            <Surface tone="paper">
                <Surface tone="muted">
                    <button type="button">Inner</button>
                </Surface>
                <button type="button">Outer</button>
            </Surface>,
        );

        expect(surfaceToneOf(screen.getByRole('button', { name: 'Inner' }))).toBe('muted');
        expect(surfaceToneOf(screen.getByRole('button', { name: 'Outer' }))).toBe('paper');
    });
});
