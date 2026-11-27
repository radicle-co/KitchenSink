import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { JSX } from 'react';

import { PopupInsetsProvider } from '../../popupInsets/PopupInsetsProvider.js';
import { SnackbarHost } from '../SnackbarHost.js';
import { useSnackbar } from '../useSnackbar.js';

/**
 * Where the web host centres the snackbar across the viewport (issue 508, designer D21 and D95): over the content
 * column the page states, never over the sidebar, and over the whole viewport where no page states one. The column is a
 * measured box, so a change of it (a sidebar collapse) moves the status region with no fixed sidebar width anywhere.
 * Written before the change.
 */
afterEach(cleanup);

function Screen(): JSX.Element {
    const { show } = useSnackbar();

    return (
        <button type="button" onClick={() => show({ message: 'Removed Pasta' })}>
            show
        </button>
    );
}

const region = (): HTMLElement => screen.getByRole('status');
const chrome = () => ({ top: 0, bottom: 0 });

describe('SnackbarHost (web), across the viewport', () => {
    it('sits over the whole viewport where no page states a column, as before', () => {
        render(
            <SnackbarHost>
                <PopupInsetsProvider reader={chrome}>
                    <Screen />
                </PopupInsetsProvider>
            </SnackbarHost>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'show' }));

        expect(region().style.left).toBe('0px');
        expect(region().style.right).toBe('0px');
    });

    it('sits over the content column a page states, not over the sidebar beside it', () => {
        render(
            <SnackbarHost>
                <PopupInsetsProvider reader={chrome} column={() => ({ left: 256, right: 0 })}>
                    <Screen />
                </PopupInsetsProvider>
            </SnackbarHost>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'show' }));

        expect(region().style.left).toBe('256px');
        expect(region().style.right).toBe('0px');
    });

    it('follows the column when its box changes, as a sidebar collapse does', () => {
        let column = { left: 256, right: 0 };
        let tell: () => void = () => undefined;

        render(
            <SnackbarHost>
                <PopupInsetsProvider
                    reader={chrome}
                    column={() => column}
                    watch={(onChange) => {
                        tell = onChange;

                        return () => undefined;
                    }}
                >
                    <Screen />
                </PopupInsetsProvider>
            </SnackbarHost>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'show' }));
        column = { left: 72, right: 0 };
        act(() => {
            tell();
        });

        expect(region().style.left).toBe('72px');
    });

    it('draws the status region with its offsets inline and not the full-width inset class', () => {
        render(
            <SnackbarHost>
                <Screen />
            </SnackbarHost>,
        );

        expect(region().className.split(/\s+/u)).not.toContain('inset-x-0');
    });
});
