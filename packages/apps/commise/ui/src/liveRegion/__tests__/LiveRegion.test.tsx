/**
 * The web `LiveRegion`: text whose appearance and changes are spoken, and, with an `occurrence`, spoken again when the
 * same text is said once more (`docs/design/rowEditorOpenDecisions.md` R8). A live region speaks at a change of its
 * text, so the same text twice is silent; two mounted regions that hand the text to each other in turn make every
 * occurrence a change from empty on a region that already exists.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LiveRegion } from '../LiveRegion.js';

afterEach(cleanup);

const textsOf = (role: 'alert' | 'status'): readonly string[] =>
    screen.getAllByRole(role).map((region) => region.textContent ?? '');

describe('LiveRegion (web)', () => {
    it('is one region: an alert when assertive, a status when polite', () => {
        render(<LiveRegion politeness="assertive">The change didn’t save.</LiveRegion>);
        expect(textsOf('alert')).toEqual(['The change didn’t save.']);

        cleanup();
        render(<LiveRegion politeness="polite">2 foods found</LiveRegion>);
        expect(textsOf('status')).toEqual(['2 foods found']);
    });

    it('says the same message again at each occurrence: it moves to the other mounted region in turn', () => {
        const limit = 'You’ve reached your limit for USDA lookups. You can try again at 3:05 PM.';
        const { rerender } = render(
            <LiveRegion politeness="assertive" occurrence={1}>
                {limit}
            </LiveRegion>,
        );

        expect(textsOf('alert')).toEqual([limit, '']);

        rerender(
            <LiveRegion politeness="assertive" occurrence={2}>
                {limit}
            </LiveRegion>,
        );
        expect(textsOf('alert')).toEqual(['', limit]);

        rerender(
            <LiveRegion politeness="assertive" occurrence={3}>
                {limit}
            </LiveRegion>,
        );
        expect(textsOf('alert')).toEqual([limit, '']);
    });

    it('a new message with no new occurrence stays in its region, where it is a change already', () => {
        const { rerender } = render(
            <LiveRegion politeness="assertive" occurrence={1}>
                First.
            </LiveRegion>,
        );

        rerender(
            <LiveRegion politeness="assertive" occurrence={1}>
                Second.
            </LiveRegion>,
        );

        expect(textsOf('alert')).toEqual(['Second.', '']);
    });

    it('visually hidden: out of sight, still in the accessibility tree', () => {
        render(
            <LiveRegion politeness="polite" visuallyHidden>
                Saved.
            </LiveRegion>,
        );

        expect(screen.getByRole('status').className).toContain('sr-only');
    });

    it.each([
        ['one region', undefined],
        ['two regions', 1],
    ])('%s: a region with nothing to say takes no space, and keeps its classes once it speaks', (_case, occurrence) => {
        const { rerender } = render(
            <LiveRegion politeness="assertive" occurrence={occurrence} className="text-error-dark">
                {''}
            </LiveRegion>,
        );

        expect(screen.getAllByRole('alert').map((region) => region.className)).toEqual(
            occurrence === undefined ? ['sr-only'] : ['sr-only', 'sr-only'],
        );

        rerender(
            <LiveRegion politeness="assertive" occurrence={occurrence} className="text-error-dark">
                The change didn’t save.
            </LiveRegion>,
        );

        expect(screen.getAllByRole('alert').map((region) => region.className)).toEqual(
            occurrence === undefined ? ['text-error-dark'] : ['text-error-dark', 'sr-only'],
        );
    });
});
