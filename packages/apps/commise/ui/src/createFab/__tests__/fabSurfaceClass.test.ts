/**
 * The web floating button's classes (designer ruling, web only, designAnswers.md 2026-11-02): it floats only from a
 * viewport at least `FAB_FLOATS_FROM_HEIGHT_PX` tall, through the theme's `fab-floats` variant. Shorter, it is an
 * ordinary inline control in the page header, where `CreateFab` is placed (right after the page's H1).
 */
import { describe, expect, it } from 'vitest';

import { fabSurfaceClass } from '../fabSurfaceClass.js';

const tokens = (presentation: 'icon' | 'extended'): readonly string[] => fabSurfaceClass(presentation).split(' ');

describe.each(['icon', 'extended'] as const)('fabSurfaceClass (%s)', (presentation) => {
    it('floats only through the fab-floats variant: position, corner and stacking are all behind it', () => {
        const classes = tokens(presentation);

        for (const utility of ['fixed', 'end-4', 'z-40', 'medium:end-6']) {
            expect(classes).not.toContain(utility);
        }

        expect(classes).toEqual(
            expect.arrayContaining([
                'fab-floats:fixed',
                'fab-floats:end-4',
                'fab-floats:z-40',
                'fab-floats:medium:end-6',
            ]),
        );
    });

    it('still leaves for the sidebar from 840 and keeps its surface', () => {
        expect(tokens(presentation)).toEqual(expect.arrayContaining(['nav:hidden', 'rounded-full', 'bg-action']));
    });
});
