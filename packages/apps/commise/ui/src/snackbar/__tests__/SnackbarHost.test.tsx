import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContext, useState, type FC, type JSX } from 'react';

import { PopupInsetsProvider } from '../../popupInsets/PopupInsetsProvider.js';
import { SnackbarClearanceContext } from '../snackbarClearanceContext.js';
import { SnackbarHost } from '../SnackbarHost.js';
import type { SnackbarHandle, SnackbarInput } from '../props.js';
import { useSnackbar } from '../useSnackbar.js';

/**
 * SnackbarHost + UndoSnackbar (web) — spec §1.11: one at a time, a new one commits the old, six seconds unless the
 * pointer or focus is inside it (SC 2.2.1), a polite status that never takes focus, `ink` with a `paper` message and a
 * `steel-light` action at a 44px target, 16px above the bottom chrome, at most 36rem wide.
 */

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/** A screen that shows whatever snackbar the test hands it, from a button. */
function Screen({ input }: { readonly input: SnackbarInput }): JSX.Element {
    const { show } = useSnackbar();

    return (
        <button type="button" onClick={() => show(input)}>
            {`show ${input.message}`}
        </button>
    );
}

const showFrom = (message: string): void => {
    fireEvent.click(screen.getByRole('button', { name: `show ${message}` }));
};

const advance = (ms: number): void => {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
};

/** The status region, which carries the snackbar's offset from the foot. */
const regionOf = (): HTMLElement => screen.getByRole('status');

/** A reader of a page whose bottom chrome is `bottom` px tall. */
const reader = (bottom: number) => () => ({ top: 0, bottom });

const statusText = (): string => screen.getByRole('status').textContent ?? '';

describe('SnackbarHost (web)', () => {
    it('refuses a screen that asks for a snackbar outside a host', () => {
        expect(() => render(<Screen input={{ message: 'x' }} />)).toThrow(/SnackbarHost/u);
    });

    it('says nothing until asked, from a status region that is always mounted', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );

        expect(statusText()).toBe('');
    });

    it('shows the message politely, and does not move focus', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );
        const opener = screen.getByRole('button', { name: 'show Removed Pasta' });
        opener.focus();

        showFrom('Removed Pasta');

        expect(statusText()).toBe('Removed Pasta');
        expect(document.activeElement).toBe(opener);
    });

    it('commits after six seconds: onTimeout runs once and the snackbar goes', () => {
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        advance(5999);
        expect(onTimeout).not.toHaveBeenCalled();

        advance(1);
        expect(onTimeout).toHaveBeenCalledOnce();
        expect(statusText()).toBe('');

        advance(60_000);
        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('runs for the duration a screen asks for', () => {
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Saved', onTimeout, durationMs: 2000 }} />
            </SnackbarHost>,
        );

        showFrom('Saved');
        advance(2000);

        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('takes its action instead of committing: onAction runs, onTimeout never does', () => {
        const onAction = vi.fn();
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', action: { label: 'Undo', onAction }, onTimeout }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        advance(60_000);

        expect(onAction).toHaveBeenCalledOnce();
        expect(onTimeout).not.toHaveBeenCalled();
        expect(statusText()).toBe('');
    });

    it('commits the snackbar a new one replaces, once, and then times the new one', () => {
        const first = vi.fn();
        const second = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout: first }} />
                <Screen input={{ message: 'Removed Soup', onTimeout: second }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        advance(2000);
        showFrom('Removed Soup');

        expect(first).toHaveBeenCalledOnce();
        expect(statusText()).toBe('Removed Soup');

        advance(6000);

        expect(second).toHaveBeenCalledOnce();
        expect(first).toHaveBeenCalledOnce();
    });

    it('pauses while the pointer is over it, and runs out its own remaining time after', () => {
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        advance(4000);
        fireEvent.pointerEnter(screen.getByText('Removed Pasta'));
        advance(60_000);
        expect(onTimeout).not.toHaveBeenCalled();

        fireEvent.pointerLeave(screen.getByText('Removed Pasta'));
        advance(1999);
        expect(onTimeout).not.toHaveBeenCalled();

        advance(1);
        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('pauses while focus is inside it', () => {
        const onTimeout = vi.fn();
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', action: { label: 'Undo', onAction: vi.fn() }, onTimeout }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        fireEvent.focus(screen.getByRole('button', { name: 'Undo' }));
        advance(60_000);
        expect(onTimeout).not.toHaveBeenCalled();

        fireEvent.blur(screen.getByRole('button', { name: 'Undo' }));
        advance(6000);
        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('sits 16px above the bottom chrome of the page that is mounted, read as it shows', () => {
        render(
            <SnackbarHost>
                <PopupInsetsProvider reader={reader(64)}>
                    <Screen input={{ message: 'Removed Pasta' }} />
                </PopupInsetsProvider>
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');

        expect(regionOf().style.bottom).toBe('80px');
    });

    it('re-reads the page chrome as a snackbar shows, so chrome that moved since the page mounted is followed', () => {
        let bottom = 64;

        render(
            <SnackbarHost>
                <PopupInsetsProvider reader={() => ({ top: 0, bottom })}>
                    <Screen input={{ message: 'Removed Pasta' }} />
                </PopupInsetsProvider>
            </SnackbarHost>,
        );
        bottom = 120;

        showFrom('Removed Pasta');

        expect(regionOf().style.bottom).toBe('136px');
    });

    it('sits at the 16px base when no page provides chrome', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');

        expect(regionOf().style.bottom).toBe('16px');
    });
});

/**
 * One host above the pages (plan U7a, six conditions). The host never remounts with the page: a page change swaps the
 * children, and the snackbar, its timer and its status node stay.
 */
describe('SnackbarHost (web): above the pages', () => {
    const Pages: FC<{ readonly page: 'a' | 'b'; readonly bottom: Record<'a' | 'b', number> }> = ({ page, bottom }) => (
        <PopupInsetsProvider key={page} reader={reader(bottom[page])}>
            <Screen input={{ message: `from ${page}`, durationMs: 6000 }} />
        </PopupInsetsProvider>
    );

    it('is a landmark named by its label, around the always-mounted status', () => {
        render(
            <SnackbarHost label="Notifications">
                <span />
            </SnackbarHost>,
        );

        expect(within(screen.getByRole('region', { name: 'Notifications' })).getByRole('status')).toBeTruthy();
    });

    it('re-places a snackbar that is showing when a page with chrome mounts, and when it unmounts', () => {
        const { rerender } = render(
            <SnackbarHost>
                <Screen input={{ message: 'Saved' }} />
            </SnackbarHost>,
        );

        showFrom('Saved');
        expect(regionOf().style.bottom).toBe('16px');

        rerender(
            <SnackbarHost>
                <PopupInsetsProvider reader={reader(64)}>
                    <Screen input={{ message: 'Saved' }} />
                </PopupInsetsProvider>
            </SnackbarHost>,
        );
        expect(regionOf().style.bottom).toBe('80px');

        rerender(
            <SnackbarHost>
                <Screen input={{ message: 'Saved' }} />
            </SnackbarHost>,
        );
        expect(regionOf().style.bottom).toBe('16px');
    });

    it('follows the page the cook is on, not the page that raised it, across a page change', () => {
        const bottom = { a: 64, b: 8 } as const;
        const { rerender } = render(
            <SnackbarHost>
                <Pages page="a" bottom={bottom} />
            </SnackbarHost>,
        );

        showFrom('from a');
        expect(regionOf().style.bottom).toBe('80px');

        rerender(
            <SnackbarHost>
                <Pages page="b" bottom={bottom} />
            </SnackbarHost>,
        );

        expect(regionOf().style.bottom).toBe('24px');
    });

    it('keeps the same status node, the same snackbar and the same timer across a page change', () => {
        const onTimeout = vi.fn();
        const bottom = { a: 0, b: 0 } as const;
        const { rerender } = render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', onTimeout }} />
            </SnackbarHost>,
        );
        showFrom('Removed Pasta');
        const status = screen.getByRole('status');
        advance(4000);

        rerender(
            <SnackbarHost>
                <Pages page="b" bottom={bottom} />
            </SnackbarHost>,
        );

        expect(screen.getByRole('status')).toBe(status);
        expect(statusText()).toBe('Removed Pasta');
        advance(1999);
        expect(onTimeout).not.toHaveBeenCalled();
        advance(1);
        expect(onTimeout).toHaveBeenCalledOnce();
    });

    it('never holds focus on a page change: the snackbar is not focusable and focus is not inside it', () => {
        const { rerender } = render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );
        showFrom('Removed Pasta');

        rerender(
            <SnackbarHost>
                <Pages page="b" bottom={{ a: 0, b: 0 }} />
            </SnackbarHost>,
        );

        expect(screen.getByRole('status').contains(document.activeElement)).toBe(false);
    });

    it('lets a show captured before its page unmounted still show, and the snackbar stay', () => {
        let captured: (input: SnackbarInput) => SnackbarHandle = () => ({ snackbar: true });
        const Capture: FC = () => {
            captured = useSnackbar().show;

            return null;
        };
        const { rerender } = render(
            <SnackbarHost>
                <Capture />
            </SnackbarHost>,
        );

        rerender(
            <SnackbarHost>
                <span />
            </SnackbarHost>,
        );
        act(() => {
            captured({ message: 'Undone' });
        });

        expect(statusText()).toBe('Undone');
    });

    it('closes the snackbar when the subject goes from a user to null, with no action and no commit', () => {
        const onAction = vi.fn();
        const onTimeout = vi.fn();
        const input = { message: 'Removed Pasta', action: { label: 'Undo', onAction }, onTimeout };
        const { rerender } = render(
            <SnackbarHost subject="u1">
                <Screen input={input} />
            </SnackbarHost>,
        );
        showFrom('Removed Pasta');

        rerender(
            <SnackbarHost subject={null}>
                <Screen input={input} />
            </SnackbarHost>,
        );
        advance(60_000);

        expect(statusText()).toBe('');
        expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
        expect(onAction).not.toHaveBeenCalled();
        expect(onTimeout).not.toHaveBeenCalled();
    });

    it('closes the snackbar on a change of account, and keeps it while the subject is still loading', () => {
        const input = { message: 'Removed Pasta' };
        const { rerender } = render(
            <SnackbarHost subject="u1">
                <Screen input={input} />
            </SnackbarHost>,
        );
        showFrom('Removed Pasta');

        rerender(
            <SnackbarHost subject={undefined}>
                <Screen input={input} />
            </SnackbarHost>,
        );
        expect(statusText()).toBe('Removed Pasta');

        rerender(
            <SnackbarHost subject="u2">
                <Screen input={input} />
            </SnackbarHost>,
        );
        expect(statusText()).toBe('');
    });
});

describe('UndoSnackbar (web)', () => {
    const tokensOf = (element: Element | null): readonly string[] => element?.className.split(/\s+/u) ?? [];

    it('is ink with a paper message of at most two lines, at most 36rem wide', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');
        const message = screen.getByText('Removed Pasta');

        // The inverse roles (`darkTheme.md` §1), so the bar inverts in BOTH themes rather than baking light `ink`.
        expect(tokensOf(message)).toEqual(expect.arrayContaining(['line-clamp-2', 'text-inverse-ink']));
        expect(tokensOf(message.parentElement)).toEqual(expect.arrayContaining(['bg-inverse', 'max-w-[36rem]']));
    });

    it('draws its action in the inverseAction role at a 44px target', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta', action: { label: 'Undo', onAction: vi.fn() } }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');

        expect(tokensOf(screen.getByRole('button', { name: 'Undo' }))).toEqual(
            expect.arrayContaining(['text-inverse-action', 'min-h-11', 'min-w-11']),
        );
    });

    it('rises into place only when motion is allowed', () => {
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Removed Pasta' }} />
            </SnackbarHost>,
        );

        showFrom('Removed Pasta');

        expect(tokensOf(screen.getByText('Removed Pasta').parentElement)).toEqual(
            expect.arrayContaining(['motion-safe:starting:translate-y-2', 'starting:opacity-0']),
        );
    });

    // The host publishes how tall its region is so the floating create button rises above it. The region is always
    // mounted and its box grows when a snackbar fills it, which is what the observer reports.
    it('publishes the region height to the create button, and 0 when nothing shows', () => {
        const heights = new Set<ResizeObserverCallbackStub>();
        vi.stubGlobal(
            'ResizeObserver',
            class {
                public constructor(report: ResizeObserverCallbackStub) {
                    heights.add(report);
                }

                public observe(): void {}

                public disconnect(): void {}
            },
        );
        let regionHeight = 0;
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
            () => ({ height: regionHeight }) as DOMRect,
        );
        const Clearance = (): JSX.Element => <p>{`clearance ${useContext(SnackbarClearanceContext)}`}</p>;
        render(
            <SnackbarHost>
                <Screen input={{ message: 'Saved' }} />
                <Clearance />
            </SnackbarHost>,
        );

        expect(screen.getByText('clearance 0')).toBeDefined();

        showFrom('Saved');
        regionHeight = 52;
        act(() => {
            heights.forEach((report) => report());
        });

        expect(screen.getByText('clearance 52')).toBeDefined();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
});

type ResizeObserverCallbackStub = () => void;

describe('SnackbarHost (web): withdraw', () => {
    it('takes the snackbar away without committing it, and answers the time it had left', () => {
        const onTimeout = vi.fn();
        const answers: (number | undefined)[] = [];

        function Withdrawing(): JSX.Element {
            const { show, withdraw } = useSnackbar();
            const [handle, setHandle] = useState<SnackbarHandle | undefined>(undefined);

            return (
                <>
                    <button type="button" onClick={() => setHandle(show({ message: 'Removed', onTimeout }))}>
                        open
                    </button>
                    <button
                        type="button"
                        onClick={() => answers.push(handle === undefined ? undefined : withdraw(handle))}
                    >
                        take
                    </button>
                </>
            );
        }

        render(
            <SnackbarHost>
                <Withdrawing />
            </SnackbarHost>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'open' }));
        advance(1000);
        fireEvent.click(screen.getByRole('button', { name: 'take' }));
        advance(10_000);

        expect(answers).toEqual([5000]);
        expect(statusText()).toBe('');
        expect(onTimeout).not.toHaveBeenCalled();
    });
});
