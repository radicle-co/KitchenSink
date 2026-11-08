/**
 * `surfaceToneOf` is the web component tests' reader of the surface a control sits on: jsdom has no stylesheet, so the
 * inherited `--cm-surface` cannot be computed, and the tests read the SAME thing the cascade reads, which is the nearest
 * ancestor that states a tone. (The cascade itself is proved in a real browser, `surfaceToneCascade.spec.ts`.)
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SURFACE_TONE_CLASS } from '../../surfaceTone/surfaceToneClass.js';
import { SURFACE_TONE_NAMES } from '../../surfaceTone/surfaceTone.js';
import { surfaceToneOf } from '../surfaceToneOf.js';

describe('surfaceToneOf', () => {
    it('reads each tone from the element that states it', () => {
        for (const tone of SURFACE_TONE_NAMES) {
            const { unmount } = render(
                <div className={SURFACE_TONE_CLASS[tone]}>
                    <button type="button">inside {tone}</button>
                </div>,
            );

            expect(surfaceToneOf(screen.getByRole('button'))).toBe(tone);
            unmount();
        }
    });

    it('answers the canvas for a control outside every surface', () => {
        render(<button type="button">bare</button>);

        expect(surfaceToneOf(screen.getByRole('button'))).toBe('canvas');
    });

    it('lets the innermost surface win, and a container that states nothing inherit its parent’s', () => {
        render(
            <div className={SURFACE_TONE_CLASS.paper}>
                <section>
                    <div className={SURFACE_TONE_CLASS.muted}>
                        <div>
                            <button type="button">nested</button>
                        </div>
                    </div>
                    <button type="button">sibling</button>
                </section>
            </div>,
        );

        expect(surfaceToneOf(screen.getByRole('button', { name: 'nested' }))).toBe('muted');
        expect(surfaceToneOf(screen.getByRole('button', { name: 'sibling' }))).toBe('paper');
    });

    it('does not mistake a bare background class for a stated tone', () => {
        render(
            <div className="bg-surface-muted">
                <button type="button">painted only</button>
            </div>,
        );

        expect(surfaceToneOf(screen.getByRole('button'))).toBe('canvas');
    });
});
