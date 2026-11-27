/**
 * The native window's announcement slot: a visually hidden polite live region in each presenting window that speaks the
 * text the windows are handed while the window is on top, and only when that text changes. Run against the real
 * snackbar host and the real `OverlayHost`, with nothing mocked.
 *
 * ⚠️ react-native-web draws a `Modal` in the same document, so this proves WHICH window holds the text and WHEN it
 * changes. It cannot prove that TalkBack or VoiceOver speaks it: that needs a device.
 */
import { cleanup, screen, within } from '@testing-library/react';
import { AccessibilityInfo, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX, ReactNode } from 'react';

import { OverlayHost } from '../../overlay/OverlayHost.native.js';
import { present } from '../../testing/present.js';
import { render } from '../../testing/tamaguiTesting.native.js';
import { SnackbarHost } from '../SnackbarHost.native.js';
import { WindowAnnouncementContext } from '../windowAnnouncement.js';

beforeEach(() => {
    vi.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockImplementation(() => Promise.resolve(false));
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const TITLE = 'You are offline';

/** One window, with a label inside so the test can find the window's own subtree. */
function Window({
    label,
    presenting = true,
    children,
}: {
    readonly label: string;
    readonly presenting?: boolean;
    readonly children?: ReactNode;
}): JSX.Element {
    return (
        <OverlayHost visible transparent onDismissRequest={() => undefined} presenting={presenting}>
            <Text>{label}</Text>
            {children}
        </OverlayHost>
    );
}

/** The windows, handed the announcement the way a notice mount hands it. */
function Windows({
    text,
    inner = false,
    presenting = true,
}: {
    readonly text: string;
    readonly inner?: boolean;
    readonly presenting?: boolean;
}): JSX.Element {
    return (
        <WindowAnnouncementContext value={text}>
            <SnackbarHost>
                <Window label="Outer" presenting={presenting}>
                    {inner ? <Window label="Inner" /> : null}
                </Window>
            </SnackbarHost>
        </WindowAnnouncementContext>
    );
}

/** The window whose label is given: the `aria-modal` root react-native-web draws for a `Modal`. */
function windowNamed(label: string): HTMLElement {
    return present(screen.getByText(label).closest<HTMLElement>('[aria-modal="true"]'), `the window "${label}"`);
}

/** The window's polite live regions that are not the snackbar's own `status` region: its announcement slots. */
const slotsIn = (win: HTMLElement): HTMLElement[] =>
    [...win.querySelectorAll<HTMLElement>('[aria-live="polite"]')].filter(
        (node) => node.getAttribute('role') !== 'status',
    );

describe('the native window announcement slot', () => {
    it('speaks the text once when it begins while the window is on top, outside the snackbar region', () => {
        const { rerender } = render(<Windows text="" />);

        expect(slotsIn(windowNamed('Outer'))).toHaveLength(1);
        expect(slotsIn(windowNamed('Outer'))[0]?.textContent).toBe('');

        rerender(<Windows text={TITLE} />);

        // Kills: no slot in the outlet (the window says nothing and the notice below cannot be reached).
        expect(slotsIn(windowNamed('Outer'))[0]?.textContent).toBe(TITLE);
        // Kills: the text written into the snackbar's own region.
        expect(within(windowNamed('Outer')).getByRole('status').textContent).toBe('');
        expect(screen.getAllByText(TITLE)).toHaveLength(1);
    });

    it('stays silent for text that was already there when the window opened', () => {
        const { rerender } = render(<Windows text={TITLE} presenting={false} />);

        rerender(<Windows text={TITLE} />);

        // Kills: speaking on becoming the top window.
        expect(slotsIn(windowNamed('Outer'))[0]?.textContent).toBe('');
    });

    it('speaks the text twice for offline, online, offline', () => {
        const { rerender } = render(<Windows text="" />);
        const heard: (string | undefined)[] = [];

        for (const text of [TITLE, '', TITLE]) {
            rerender(<Windows text={text} />);
            heard.push(slotsIn(windowNamed('Outer'))[0]?.textContent);
        }

        // Kills: a slot that remembers it spoke the title once.
        expect(heard).toEqual([TITLE, '', TITLE]);
    });

    it('speaks in the window on top only, and says nothing again when the window above it closes', () => {
        const { rerender } = render(<Windows text="" inner />);

        rerender(<Windows text={TITLE} inner />);

        // Kills: every window speaking, which reads the text out once per open window.
        expect(slotsIn(windowNamed('Inner'))[0]?.textContent).toBe(TITLE);
        expect(slotsIn(windowNamed('Outer'))[0]?.textContent).toBe('');

        rerender(<Windows text={TITLE} />);

        // Kills: speaking on becoming the top again when the text did not change.
        expect(slotsIn(windowNamed('Outer'))[0]?.textContent).toBe('');
    });

    it('holds no slot while the window does not present', () => {
        render(<Windows text={TITLE} presenting={false} />);

        // Kills: a slot mounted before the window presents, which would speak into a window nobody sees.
        expect(slotsIn(windowNamed('Outer'))).toHaveLength(0);
    });
});
