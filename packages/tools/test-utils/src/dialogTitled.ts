/**
 * Find an open dialog by the header inside it. A native dialog carries no name of its own: the header text names it
 * (`docs/design/nativeContainerNames.md` N1), so a test finds the dialog by its role and then the header by its name,
 * which is how a screen-reader user meets it.
 */
import { screen, within } from '@testing-library/react';

/**
 * The innermost dialogs whose header says `name`. A dialog that holds another such dialog is left out, because
 * react-native-web draws a `Modal` as a dialog around the one inside it.
 */
const dialogsTitled = (name: string | RegExp): readonly HTMLElement[] => {
    const titled = screen
        .queryAllByRole('dialog')
        .filter((dialog) => within(dialog).queryAllByRole('heading', { name }).length > 0);

    return titled.filter((dialog) => !titled.some((other) => other !== dialog && dialog.contains(other)));
};

/**
 * The one open dialog whose header says `name`, or `null` when none does.
 *
 * @param name - The header's accessible name.
 * @returns The dialog element.
 * @throws When more than one dialog has that header.
 * @sideEffect Reads the rendered document.
 */
export function queryDialogTitled(name: string | RegExp): HTMLElement | null {
    const dialogs = dialogsTitled(name);

    if (dialogs.length > 1) {
        throw new Error(`${String(dialogs.length)} dialogs have a header named ${String(name)}.`);
    }

    return dialogs[0] ?? null;
}

/**
 * The one open dialog whose header says `name`.
 *
 * @param name - The header's accessible name.
 * @returns The dialog element.
 * @throws When no dialog, or more than one, has that header.
 * @sideEffect Reads the rendered document.
 */
export function dialogTitled(name: string | RegExp): HTMLElement {
    const dialog = queryDialogTitled(name);

    if (dialog === null) {
        throw new Error(`There is no dialog with a header named ${String(name)}.`);
    }

    return dialog;
}
