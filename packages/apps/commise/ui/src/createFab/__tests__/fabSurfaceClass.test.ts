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

    // Designer ruling, web only (`nativeBoards/designAnswers.md`, commit 438f7e542): below 400 px of window height the button
    // gets its own row under the page header, after the greeting and the date, 16 below the date, start-aligned, in normal
    // flow and with no shadow. Every one of those is a class that must NOT be on the floating button, so each sits behind
    // the same `fab-floats` variant or is only meaningful in flow.
    it('has no shadow below the floating height: the shadow sits behind fab-floats', () => {
        const classes = tokens(presentation);

        expect(classes).not.toContain('shadow-lg');
        expect(classes).toContain('fab-floats:shadow-lg');
    });

    it('takes its own start-aligned row 16 below the header in flow, and gives the margin up once it floats', () => {
        const classes = tokens(presentation);

        expect(classes).toEqual(
            expect.arrayContaining(['col-span-3', 'justify-self-start', 'mt-4', 'fab-floats:mt-0']),
        );

        for (const out of ['absolute', 'fixed', 'sticky', 'justify-self-end', 'ms-auto']) {
            expect(classes).not.toContain(out);
        }
    });
});
