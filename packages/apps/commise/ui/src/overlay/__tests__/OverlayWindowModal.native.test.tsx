/**
 * The window is the ONE modal view: the panel or card that is the dialog, and the snackbar's outlet, sit inside the same
 * `aria-modal` view (staff ruling S90 on designer D79).
 *
 * On iOS a modal view hides its siblings from VoiceOver. The outlet was a sibling of the panel that carried `aria-modal`,
 * so Undo could be tapped by a test tool and unreachable by VoiceOver. So `OverlayHost` wraps its children and the outlet
 * in one modal view, and the sheet and the dialog keep their dialog role and name without being modal themselves.
 *
 * ⚠️ react-native-web draws a `Modal` into the same document, with a modal root of its own: this proves the STRUCTURE
 * (what shares a modal ancestor), not what VoiceOver reads. That needs a device, and no agent can drive VoiceOver.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { AccessibilityInfo, Pressable, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

import { DialogFrame } from '../../dialogFrame/DialogFrame.native.js';
import { Sheet } from '../../sheet/Sheet.native.js';
import { SnackbarHost } from '../../snackbar/SnackbarHost.native.js';
import { useSnackbar } from '../../snackbar/useSnackbar.js';
import { render } from '../../testing/tamaguiTesting.native.js';
import { expectWindowIsTheModal } from '../../testing/windowModal.native.js';

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

beforeEach(() => {
    vi.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockImplementation(() => Promise.resolve(false));
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function Shower(): JSX.Element {
    const { show } = useSnackbar();

    return (
        <Pressable accessibilityRole="button" onPress={() => show({ message: 'Ticks cleared' })}>
            <Text>show</Text>
        </Pressable>
    );
}

/** The status region that holds the snackbar, once it shows. */
function snackbarRegion(): HTMLElement {
    fireEvent.click(screen.getByRole('button', { name: 'show' }));

    const region = screen
        .getAllByRole('status')
        .find((candidate) => candidate.textContent?.includes('Ticks cleared') === true);

    if (region === undefined) {
        throw new Error('The snackbar did not show.');
    }

    return region;
}

describe('the window is the one modal view', () => {
    it.each([
        [
            'a bottom sheet',
            <Sheet
                key="sheet"
                open
                onOpenChange={() => undefined}
                title="Ingredients"
                closeLabel="Close"
                size="content"
            >
                <Shower />
            </Sheet>,
            'Ingredients',
        ],
        [
            'a centred dialog',
            <DialogFrame key="dialog" open onRequestClose={() => undefined} title="Erase it?" role="dialog">
                <Shower />
            </DialogFrame>,
            'Erase it?',
        ],
    ])('holds the dialog and the snackbar of %s in one modal view, and is not itself modal', (_name, tree, title) => {
        render(<SnackbarHost>{tree}</SnackbarHost>);

        const region = snackbarRegion();
        const dialog = screen.getByRole('heading', { name: title }).closest<HTMLElement>('[role="dialog"]');

        expect(dialog).not.toBeNull();
        expect(expectWindowIsTheModal(dialog as HTMLElement).contains(region)).toBe(true);
    });
});
