/**
 * `dialogTitled` finds an open dialog by the header inside it, because a native dialog carries no name of its own
 * (`docs/design/nativeContainerNames.md` N1). Rendered as plain DOM: the helper reads roles, not a platform.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { dialogTitled, queryDialogTitled } from '../dialogTitled.js';

afterEach(cleanup);

describe('dialogTitled', () => {
    it('returns the dialog whose header says the name, among several', () => {
        render(
            <>
                <div role="dialog" aria-label="Filter recipes">
                    <h2>Other</h2>
                </div>
                <div role="dialog" data-which="wanted">
                    <h2>Filter recipes</h2>
                </div>
            </>,
        );

        expect(dialogTitled('Filter recipes').getAttribute('data-which')).toBe('wanted');
    });

    it('matches a pattern, as a name query does', () => {
        render(
            <div role="dialog">
                <h2>Create “saffron”</h2>
            </div>,
        );

        expect(dialogTitled(/saffron/u).getAttribute('role')).toBe('dialog');
    });

    it('throws when no dialog has that header, and the query answers null', () => {
        render(
            <div role="dialog">
                <p>Filter recipes</p>
            </div>,
        );

        expect(() => dialogTitled('Filter recipes')).toThrow(/no dialog/u);
        expect(queryDialogTitled('Filter recipes')).toBeNull();
    });

    it('returns the innermost dialog when one dialog holds another (react-native-web draws a Modal as one)', () => {
        render(
            <div role="dialog" data-which="modal">
                <div role="dialog" data-which="sheet">
                    <h2>Filter recipes</h2>
                </div>
            </div>,
        );

        expect(dialogTitled('Filter recipes').getAttribute('data-which')).toBe('sheet');
    });

    it('throws when two dialogs have that header', () => {
        render(
            <>
                <div role="dialog">
                    <h2>Done</h2>
                </div>
                <div role="dialog">
                    <h2>Done</h2>
                </div>
            </>,
        );

        expect(() => dialogTitled('Done')).toThrow(/2 dialogs/u);
        expect(() => queryDialogTitled('Done')).toThrow(/2 dialogs/u);
    });
});
