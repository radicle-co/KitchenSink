/**
 * The snackbar inside an open web sheet — the integration of the real `SnackbarHost` and the real `Sheet` (Radix
 * Dialog), neither mocked.
 *
 * While a modal Radix dialog is open, Radix keeps Tab inside its content, hides everything outside it from screen
 * readers, and closes the dialog on a press outside. So a snackbar the host draws at the page's foot is visible but
 * cannot be focused, read or pressed. An open sheet offers the host an outlet inside its content, and the host draws
 * the one snackbar there. The queue, the timer and the pause stay in the host, so closing the sheet moves the snackbar
 * back without ending it.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useContext, useState, type JSX, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resizeEntryOf } from '../../testing/resizeObserver.js';
import { OverlayDepthContext } from '../../overlay/overlayDepthContext.js';
import { Sheet } from '../../sheet/Sheet.js';
import { SnackbarHost } from '../SnackbarHost.js';
import { SnackbarOutlet } from '../SnackbarOutlet.js';
import type { SnackbarInput } from '../props.js';
import { useSnackbar } from '../useSnackbar.js';

/** Every `ResizeObserver` the sheet creates, so a test can serve the footer's height (jsdom lays nothing out). */
const observers = new Set<{
    readonly callback: ResizeObserverCallback;
    readonly observed: Set<Element>;
    readonly observer: ResizeObserver;
}>();

class RecordingResizeObserver implements ResizeObserver {
    private readonly record: {
        readonly callback: ResizeObserverCallback;
        readonly observed: Set<Element>;
        readonly observer: ResizeObserver;
    };

    public constructor(callback: ResizeObserverCallback) {
        this.record = { callback, observed: new Set(), observer: this };
        observers.add(this.record);
    }

    public observe(target: Element): void {
        this.record.observed.add(target);
    }

    public unobserve(target: Element): void {
        this.record.observed.delete(target);
    }

    public disconnect(): void {
        observers.delete(this.record);
    }
}

beforeEach(() => {
    globalThis.ResizeObserver = RecordingResizeObserver;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    observers.clear();
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

/** A button that shows one snackbar. */
function Shower({ input }: { readonly input: SnackbarInput }): JSX.Element {
    const { show } = useSnackbar();

    return (
        <button type="button" onClick={() => show(input)}>
            {`show ${input.message}`}
        </button>
    );
}

/** One sheet, controlled by the test. */
function OneSheet({
    open,
    title,
    onOpenChange = () => undefined,
    children,
}: {
    readonly open: boolean;
    readonly title: string;
    readonly onOpenChange?: (open: boolean) => void;
    readonly children?: ReactNode;
}): JSX.Element {
    return (
        <Sheet open={open} onOpenChange={onOpenChange} title={title} closeLabel={`Close ${title}`} size="page">
            {children}
        </Sheet>
    );
}

/** Every status region that holds the message. */
function regionsHolding(message: string): HTMLElement[] {
    return screen.getAllByRole('status', { hidden: true }).filter((region) => region.textContent?.includes(message));
}

const showFrom = (message: string): void => {
    fireEvent.click(screen.getByRole('button', { name: `show ${message}` }));
};

describe('the snackbar inside an open web sheet (integration: real host, real Sheet)', () => {
    it('draws in exactly one region, inside the open sheet', () => {
        render(
            <SnackbarHost>
                <OneSheet open title="Ingredients">
                    <Shower input={{ message: 'Ticks cleared' }} />
                </OneSheet>
            </SnackbarHost>,
        );

        showFrom('Ticks cleared');

        const [region, ...others] = regionsHolding('Ticks cleared');

        expect(others).toStrictEqual([]);
        expect(screen.getByRole('dialog', { name: 'Ingredients' }).contains(region ?? null)).toBe(true);
    });

    it('lets a keyboard reach Undo from inside the open sheet, and Undo works', async () => {
        const user = userEvent.setup();
        const onAction = vi.fn();
        render(
            <SnackbarHost>
                <OneSheet open title="Ingredients">
                    <Shower input={{ message: 'Ticks cleared', action: { label: 'Undo', onAction } }} />
                </OneSheet>
            </SnackbarHost>,
        );

        await user.click(screen.getByRole('button', { name: 'show Ticks cleared' }));

        let reached = false;

        // Walk the sheet's focus order once round; a trap that leaves the snackbar out never reaches Undo.
        for (let step = 0; step < 10 && !reached; step += 1) {
            await user.tab();
            reached = document.activeElement === screen.getByRole('button', { name: 'Undo' });
        }

        expect(reached).toBe(true);

        await user.keyboard('{Enter}');

        expect(onAction).toHaveBeenCalledOnce();
    });

    it('moves the same snackbar back to the host when the sheet closes, and its Undo still works', () => {
        const onAction = vi.fn();
        const input: SnackbarInput = { message: 'Ticks cleared', action: { label: 'Undo', onAction } };

        /** The sheet's opener stays outside it, so the snackbar's Undo is reachable once the sheet is gone. */
        function Page(): JSX.Element {
            const [open, setOpen] = useState(true);

            return (
                <>
                    <Shower input={input} />
                    <button type="button" onClick={() => setOpen(false)}>
                        close sheet
                    </button>
                    <OneSheet open={open} title="Ingredients" onOpenChange={setOpen}>
                        <p>List</p>
                    </OneSheet>
                </>
            );
        }

        render(
            <SnackbarHost>
                <Page />
            </SnackbarHost>,
        );

        // Shown while the sheet is open: Radix hides the page from the accessibility tree, so the button is found by
        // its text, not its role.
        act(() => {
            screen.getByText('show Ticks cleared').click();
        });

        expect(within(screen.getByRole('dialog', { name: 'Ingredients' })).getByRole('status').textContent).toContain(
            'Ticks cleared',
        );

        act(() => {
            screen.getByText('close sheet').click();
        });

        const [region, ...others] = regionsHolding('Ticks cleared');

        expect(others).toStrictEqual([]);
        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(within(region ?? document.body).getByRole('button', { name: 'Undo' }));

        expect(onAction).toHaveBeenCalledOnce();
    });

    it('draws in the sheet opened inside another sheet', () => {
        render(
            <SnackbarHost>
                <OneSheet open title="Ingredients">
                    <OneSheet open title="Confirm">
                        <Shower input={{ message: 'Ticks cleared' }} />
                    </OneSheet>
                </OneSheet>
            </SnackbarHost>,
        );

        showFrom('Ticks cleared');

        const [region, ...others] = regionsHolding('Ticks cleared');

        expect(others).toStrictEqual([]);
        expect(screen.getByRole('dialog', { name: 'Confirm' }).contains(region ?? null)).toBe(true);
    });

    it('gives its children depth 1 in a sheet and 2 in a nested sheet, which orders the outlets', () => {
        const Probe = ({ id }: { readonly id: string }): JSX.Element => (
            <output data-testid={id}>{useContext(OverlayDepthContext)}</output>
        );

        render(
            <SnackbarHost>
                <OneSheet open title="Outer">
                    <Probe id="outer" />
                    <OneSheet open title="Inner">
                        <Probe id="inner" />
                    </OneSheet>
                </OneSheet>
            </SnackbarHost>,
        );

        expect(screen.getByTestId('outer').textContent).toBe('1');
        expect(screen.getByTestId('inner').textContent).toBe('2');
    });

    it('keeps a status region mounted in the sheet before any snackbar arrives, so the change is announced', () => {
        render(
            <SnackbarHost>
                <OneSheet open title="Ingredients" />
            </SnackbarHost>,
        );

        expect(within(screen.getByRole('dialog', { name: 'Ingredients' })).getByRole('status').textContent).toBe('');
    });
});

describe('SnackbarOutlet (web) outside a snackbar host', () => {
    it('draws nothing, so a sheet with no host above it still opens', () => {
        render(<SnackbarOutlet depth={1} />);

        expect(screen.queryByRole('status')).toBeNull();
    });
});

/** A sheet with a footer holding Clear ticks, and the snackbar shown from inside it. */
function FooteredSheet(): JSX.Element {
    return (
        <SnackbarHost>
            <Sheet
                open
                onOpenChange={() => undefined}
                title="Ingredients"
                closeLabel="Close Ingredients"
                size="page"
                footer={<button type="button">Clear ticks</button>}
            >
                <Shower input={{ message: 'Ticks cleared', action: { label: 'Undo', onAction: () => undefined } }} />
            </Sheet>
        </SnackbarHost>
    );
}

/** Give the sheet, its title row and its footer their heights, and report a resize to every observer. */
function layOut(heights: { readonly sheet: number; readonly titleRow: number; readonly footer: number }): void {
    const panel = screen.getByRole('dialog').firstElementChild as HTMLElement;
    const titleRow = screen.getByRole('button', { name: 'Close Ingredients' }).parentElement as HTMLElement;
    const footer = screen.getByRole('button', { name: 'Clear ticks' }).parentElement as HTMLElement;

    for (const [node, height] of [
        [panel, heights.sheet],
        [titleRow, heights.titleRow],
        [footer, heights.footer],
    ] as const) {
        node.getBoundingClientRect = () => new DOMRect(0, 0, 320, height);
    }

    act(() => {
        for (const record of observers) {
            record.callback([...record.observed].map(resizeEntryOf), record.observer);
        }
    });
}

/** The status region of the open sheet, and the box that tells it how tall the footer is. */
const sheetRegion = (): HTMLElement => within(screen.getByRole('dialog')).getByRole('status');
const insetOf = (region: HTMLElement): string =>
    region.closest<HTMLElement>('[style*="--sheet-footer-inset"]')?.style.getPropertyValue('--sheet-footer-inset') ??
    '';

describe('the snackbar over a sheet footer (web)', () => {
    it("sits the pinned footer's height up, so the 16 gap is above the footer and the actions stay clear", () => {
        render(<FooteredSheet />);
        layOut({ sheet: 600, titleRow: 56, footer: 80 });

        // Kills: an outlet that ignores the footer and draws over its actions (the defect this rule exists for).
        expect(insetOf(sheetRegion())).toBe('80px');
        expect(sheetRegion().className).toContain('bottom-[calc(var(--sheet-footer-inset,0px)+1rem)]');
    });

    it('follows the footer when it grows', () => {
        render(<FooteredSheet />);
        layOut({ sheet: 600, titleRow: 56, footer: 80 });
        layOut({ sheet: 600, titleRow: 56, footer: 104 });

        expect(insetOf(sheetRegion())).toBe('104px');
    });

    it('adds no inset once the footer scrolls with the content, because it no longer sits at the foot', () => {
        render(<FooteredSheet />);
        layOut({ sheet: 300, titleRow: 64, footer: 92 });

        // Kills: keeping the pinned inset after the flip, which lifts the snackbar off the foot for nothing.
        expect(insetOf(sheetRegion())).toBe('');
    });

    it('adds no inset to a sheet with no footer', () => {
        render(
            <SnackbarHost>
                <OneSheet open title="Ingredients" />
            </SnackbarHost>,
        );

        expect(insetOf(sheetRegion())).toBe('');
    });

    it("puts Undo after the footer's Clear ticks in the focus order, and never moves focus to it by itself", () => {
        render(<FooteredSheet />);
        layOut({ sheet: 600, titleRow: 56, footer: 80 });
        showFrom('Ticks cleared');

        const clear = screen.getByRole('button', { name: 'Clear ticks' });
        const undo = screen.getByRole('button', { name: 'Undo' });

        // Kills: an outlet placed before the footer, so Undo comes first; and an autofocus on Undo (D-4's condition).
        expect(clear.compareDocumentPosition(undo) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
        expect(document.activeElement).not.toBe(undo);
    });
});
