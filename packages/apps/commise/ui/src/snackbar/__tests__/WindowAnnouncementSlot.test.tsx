/**
 * The web window's announcement slot: the visually hidden polite region in every window that speaks the text the
 * windows are handed while the window is on top, and only when that text changes. Run against the real snackbar host
 * and the real `WindowScope`, with nothing mocked.
 *
 * Why it exists: Radix hides everything outside an open dialog from screen readers, so a notice on the page below
 * cannot be heard while a window is open. The slot says it inside the window instead.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { type JSX, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { WindowScope } from '../../overlay/WindowScope.js';
import { present } from '../../testing/present.js';
import { snackbarRegionOf } from '../../testing/windowSnackbar.js';
import { SnackbarHost } from '../SnackbarHost.js';
import { WindowAnnouncementContext } from '../windowAnnouncement.js';

afterEach(cleanup);

const TITLE = 'You are offline';

/** One window's box, so a window's own elements are read through it. */
const Box = ({ id, children }: { readonly id: string; readonly children?: ReactNode }): JSX.Element => (
    <div data-testid={id}>{children}</div>
);

/**
 * The slot of the window in the box: the status element right before the snackbar region. Only the box's own children
 * are read, because a window nested in it holds slots of its own.
 */
const slotOf = (id: string): Element => {
    const own = [...screen.getByTestId(id).children].filter((node) => node.getAttribute('role') === 'status');

    expect(own).toHaveLength(2);

    return present(own.at(0), 'the announcement slot');
};

/** The windows, handed the announcement the way a notice mount hands it. */
function Windows({ text, speaks = true, inner = false, open = true }: Props): JSX.Element {
    return (
        <WindowAnnouncementContext value={{ text, speaks }}>
            <SnackbarHost>
                {open ? (
                    <Box id="outer">
                        <WindowScope>{inner ? <InnerWindow /> : null}</WindowScope>
                    </Box>
                ) : null}
            </SnackbarHost>
        </WindowAnnouncementContext>
    );
}

const InnerWindow = (): JSX.Element => (
    <Box id="inner">
        <WindowScope />
    </Box>
);

interface Props {
    readonly text: string;
    readonly speaks?: boolean;
    readonly inner?: boolean;
    readonly open?: boolean;
}

describe('the web window announcement slot', () => {
    it('speaks the text once when it begins while the window is on top, in a region of its own', () => {
        const { rerender } = render(<Windows text="" />);

        expect(slotOf('outer').textContent).toBe('');

        rerender(<Windows text={TITLE} />);

        // Kills: no slot in the outlet (the window says nothing and the notice below is hidden from the reader).
        expect(slotOf('outer').textContent).toBe(TITLE);
        // Kills: the text written into the snackbar's own region, which would double up with a snackbar shown at once.
        expect(snackbarRegionOf(screen.getByTestId('outer')).textContent).toBe('');
        expect(screen.getAllByText(TITLE)).toHaveLength(1);
        // Kills: a slot that is visible, which would draw the notice a second time inside the window.
        expect(slotOf('outer').className).toContain('sr-only');
    });

    it('keeps the slot out of the snackbar region, and the region last', () => {
        render(<Windows text={TITLE} />);

        const region = snackbarRegionOf(screen.getByTestId('outer'));

        // Kills: a slot nested in the region, where two live regions in one tree speak twice on some screen readers.
        expect(region.querySelector('[role="status"]')).toBeNull();
        expect(region.parentElement?.lastElementChild).toBe(region);
    });

    it('stays silent for text that was already there when the window opened', () => {
        const { rerender } = render(<Windows text={TITLE} open={false} />);

        rerender(<Windows text={TITLE} />);

        // Kills: speaking on becoming the top window, which would read out an old state every time a window opened.
        expect(slotOf('outer').textContent).toBe('');
    });

    it('speaks the text twice for offline, online, offline', () => {
        const { rerender } = render(<Windows text="" />);
        const heard: string[] = [];

        for (const text of [TITLE, '', TITLE]) {
            rerender(<Windows text={text} />);
            heard.push(slotOf('outer').textContent);
        }

        // Kills: a slot that remembers it spoke the title once, so the second offline spell is silent.
        expect(heard).toEqual([TITLE, '', TITLE]);
    });

    it('goes quiet the moment the text clears, so going online says nothing', () => {
        const { rerender } = render(<Windows text="" />);

        rerender(<Windows text={TITLE} />);
        rerender(<Windows text="" />);

        // Kills: a slot that holds the last title, which would repeat it when anything redraws the window.
        expect(slotOf('outer').textContent).toBe('');
    });

    it('speaks in the window on top only, and says nothing again when a window above it closes', () => {
        const { rerender } = render(<Windows text="" inner />);

        rerender(<Windows text={TITLE} inner />);

        // Kills: every window speaking, which reads the text out once per open window.
        expect(slotOf('inner').textContent).toBe(TITLE);
        expect(slotOf('outer').textContent).toBe('');

        rerender(<Windows text={TITLE} />);

        // Kills: speaking on becoming the top again, when the window above it closed and the text did not change.
        expect(slotOf('outer').textContent).toBe('');
    });

    it('speaks the title again for a spell that begins after the window opened over a standing one', () => {
        const { rerender } = render(<Windows text={TITLE} />);

        rerender(<Windows text="" />);
        rerender(<Windows text={TITLE} />);

        // Kills: a slot that stays silent for good once the window opened over a standing announcement.
        expect(slotOf('outer').textContent).toBe(TITLE);
    });

    it('stays silent for the window below when a window opens over it and closes again', () => {
        const { rerender } = render(<Windows text="" />);

        rerender(<Windows text={TITLE} />);
        expect(slotOf('outer').textContent).toBe(TITLE);

        rerender(<Windows text={TITLE} inner />);
        rerender(<Windows text={TITLE} />);

        // Kills: a slot that does not note it left the top, so it speaks the same title again when it is back on top.
        expect(slotOf('outer').textContent).toBe('');
    });

    it('stays silent when the form starts to speak over a title that was already there', () => {
        const { rerender } = render(<Windows text={TITLE} speaks={false} />);

        // Kills: speaking while the form does not announce.
        expect(slotOf('outer').textContent).toBe('');

        rerender(<Windows text={TITLE} />);

        // Kills: treating a change of form as a change of text, which says an old title again.
        expect(slotOf('outer').textContent).toBe('');

        rerender(<Windows text="" />);
        rerender(<Windows text={TITLE} />);

        expect(slotOf('outer').textContent).toBe(TITLE);
    });

    it('speaks nothing for a title that arrives while the form does not speak', () => {
        const { rerender } = render(<Windows text="" speaks={false} />);

        rerender(<Windows text={TITLE} speaks={false} />);

        // Kills: a slot that ignores the form and speaks the app form's offline notice.
        expect(slotOf('outer').textContent).toBe('');
    });
});
