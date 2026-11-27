/**
 * {@link WindowScope}: the one place a web window becomes "one level deeper, and offers the snackbar an outlet". Run
 * against the real snackbar host, with nothing mocked.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { useContext, type JSX, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { SnackbarHost } from '../../snackbar/SnackbarHost.js';
import { useSnackbar } from '../../snackbar/useSnackbar.js';
import { OverlayDepthContext } from '../overlayDepthContext.js';
import { snackbarRegionOf } from '../../testing/windowSnackbar.js';
import { WindowScope } from '../WindowScope.js';

afterEach(cleanup);

const Depth = (): JSX.Element => <output>{useContext(OverlayDepthContext)}</output>;

function Shower({ message }: { readonly message: string }): JSX.Element {
    const { show } = useSnackbar();

    return (
        <button
            type="button"
            onClick={() => {
                show({ message });
            }}
        >
            {`show ${message}`}
        </button>
    );
}

/** The window's box. The host draws its own status region too, so the scope is read through this box. */
const Box = ({ children }: { readonly children: ReactNode }): JSX.Element => <div data-testid="box">{children}</div>;
const box = (): HTMLElement => screen.getByTestId('box');

describe('WindowScope (web)', () => {
    it('gives its children one more level than the window around it', () => {
        render(
            <SnackbarHost>
                <Box>
                    <WindowScope>
                        <Depth />
                        <WindowScope>
                            <Depth />
                        </WindowScope>
                    </WindowScope>
                </Box>
            </SnackbarHost>,
        );

        expect(
            within(box())
                .getAllByText(/^[12]$/u)
                .map((node) => node.textContent),
        ).toEqual(['1', '2']);
    });

    it('adds no element of its own: its children, then the announcement slot and one status region', () => {
        render(
            <SnackbarHost>
                <Box>
                    <WindowScope>
                        <p>content</p>
                    </WindowScope>
                </Box>
            </SnackbarHost>,
        );

        // Kills: a wrapping element (a `div` around the content changes its layout and Radix's focus walk), an outlet
        // that comes before the content, and a slot that is missing, nested in the region or placed after it.
        expect([...box().children].map((node) => node.tagName)).toEqual(['P', 'SPAN', 'DIV']);
        expect([...box().children].map((node) => node.getAttribute('role'))).toEqual([null, 'status', 'status']);
        expect(box().lastElementChild?.getAttribute('role')).toBe('status');
    });

    it('draws a snackbar shown inside it in its own region, and hands it back when it closes', () => {
        function Page({ open }: { readonly open: boolean }): JSX.Element {
            return (
                <SnackbarHost>
                    <Shower message="Saved" />
                    {open ? (
                        <div role="dialog" aria-label="Window">
                            <WindowScope />
                        </div>
                    ) : null}
                </SnackbarHost>
            );
        }

        const { rerender } = render(<Page open />);
        act(() => {
            screen.getByText('show Saved').click();
        });

        // The window holds two status elements, the announcement slot and the snackbar region; this finds the region.
        expect(snackbarRegionOf(screen.getByRole('dialog')).textContent).toBe('Saved');

        rerender(<Page open={false} />);

        // Kills: an outlet that stays registered after its window unmounted, which leaves the snackbar nowhere.
        expect(screen.getAllByRole('status').filter((node) => node.textContent === 'Saved')).toHaveLength(1);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('lifts the snackbar footHeight + 16 above its foot', () => {
        render(
            <SnackbarHost>
                <Box>
                    <WindowScope footHeight={72} />
                </Box>
            </SnackbarHost>,
        );

        // The window holds two status elements, the announcement slot and the snackbar region; this finds the region.
        expect(snackbarRegionOf(box()).style.bottom).toBe('calc(72px + 1rem)');
    });

    it('sits 16 above its foot with no footHeight', () => {
        render(
            <SnackbarHost>
                <Box>
                    <WindowScope />
                </Box>
            </SnackbarHost>,
        );

        // The window holds two status elements, the announcement slot and the snackbar region; this finds the region.
        expect(snackbarRegionOf(box()).style.bottom).toBe('');
        expect(snackbarRegionOf(box()).className).toContain('bottom-4');
    });
});
