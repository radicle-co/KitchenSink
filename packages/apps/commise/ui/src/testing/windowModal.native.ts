/**
 * @module @commise/ui/testing/window-modal: the oracle for "the dialog sits in OverlayHost's one modal window".
 *
 * `OverlayHost` wraps its content and the snackbar outlet in ONE view that carries `aria-modal`; the sheet or dialog
 * inside keeps its role and name and is not modal itself (staff ruling S90, qse record 0073). react-native-web's real
 * `Modal` draws a root of its own, with `role="dialog"` and `aria-modal`, that holds everything too. So "the closest
 * modal ancestor holds the status region" passes even if the host's view loses `aria-modal`. The window is shown to be
 * the host's view by what the react-native-web root is not: it has no role, and a second modal element sits above it.
 */
import { expect } from 'vitest';

/**
 * Assert that a dialog sits in the host's window, which is the one modal view.
 *
 * @param dialog - The element with the dialog (or alert) role.
 * @returns The window, for further checks.
 */
export function expectWindowIsTheModal(dialog: HTMLElement): HTMLElement {
    const modal = dialog.closest<HTMLElement>('[aria-modal="true"]');

    // Not "true": Tamagui's `Dialog` writes `aria-modal="false"` itself for `modal={false}`, which is not modal.
    expect(dialog.getAttribute('aria-modal')).not.toBe('true');

    if (modal === null) {
        throw new Error("The dialog has no modal ancestor: OverlayHost's window view lost `aria-modal`.");
    }

    expect(modal.hasAttribute('role')).toBe(false);
    expect(modal.parentElement?.closest('[aria-modal="true"]')).not.toBeNull();

    return modal;
}
