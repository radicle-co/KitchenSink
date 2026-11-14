/**
 * The web `LiveRegion`: text whose appearance and changes are spoken, and, with an `occurrence`, spoken again when the
 * same text is said once more (`docs/design/rowEditorOpenDecisions.md` R8). A live region speaks at a change of its
 * text, so the same text twice is silent; two mounted regions that hand the text to each other in turn make every
 * occurrence a change from empty on a region that already exists.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
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
            <LiveRegion politeness="assertive" occurrence={occurrence} className="text-danger-text">
                {''}
            </LiveRegion>,
        );

        expect(screen.getAllByRole('alert').map((region) => region.className)).toEqual(
            occurrence === undefined ? ['sr-only'] : ['sr-only', 'sr-only'],
        );

        rerender(
            <LiveRegion politeness="assertive" occurrence={occurrence} className="text-danger-text">
                The change didn’t save.
            </LiveRegion>,
        );

        expect(screen.getAllByRole('alert').map((region) => region.className)).toEqual(
            occurrence === undefined ? ['text-danger-text'] : ['text-danger-text', 'sr-only'],
        );
    });
});

/**
 * A live region speaks a CHANGE of its text, and many screen readers say nothing for text that is in the region when it
 * mounts. A screen that opens WITH a message to say (a link to an ingredient the draft does not hold) asks for
 * `announceOnMount`: the region mounts empty and holds the message from the next commit, so the message arrives as a
 * change.
 */
describe('LiveRegion (web) — announceOnMount', () => {
    /** The region's text at each commit, read in a layout effect of a sibling that mounts after the region. */
    function mountRecording(announceOnMount: boolean): string[] {
        const seen: string[] = [];

        const Probe = (): null => {
            useLayoutEffect(() => {
                seen.push(document.querySelector('[role="status"]')?.textContent ?? '');
            });

            return null;
        };

        render(
            <>
                <LiveRegion politeness="polite" {...(announceOnMount ? { announceOnMount } : {})}>
                    We couldn’t find that ingredient.
                </LiveRegion>
                <Probe />
            </>,
        );

        return seen;
    }

    it('mounts empty and holds the message from the next commit', () => {
        const seen = mountRecording(true);

        expect(seen[0]).toBe('');
        expect(textsOf('status')).toEqual(['We couldn’t find that ingredient.']);
    });

    it('without it the message is in the region at mount, as before', () => {
        expect(mountRecording(false)[0]).toBe('We couldn’t find that ingredient.');
    });

    // A region that did not ask for `announceOnMount` holds no deferred value: text present at mount, and every update,
    // is in the very render it is given (an alert read straight after the render that raised it).
    it('without it an alert is there at mount, and an update is in the same render', () => {
        const seen: string[] = [];

        const Probe = (): null => {
            useLayoutEffect(() => {
                seen.push(document.querySelector('[role="alert"]')?.textContent ?? '');
            });

            return null;
        };

        const view = (text: string) => (
            <>
                <LiveRegion politeness="assertive">{text}</LiveRegion>
                <Probe />
            </>
        );
        const { rerender } = render(view('Could not save.'));

        expect(seen).toEqual(['Could not save.']);

        rerender(view('Could not save it either.'));

        expect(seen.at(-1)).toBe('Could not save it either.');
        expect(seen).not.toContain('');
    });
});
