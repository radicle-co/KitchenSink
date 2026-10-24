/**
 * Sheet (web) — the footer unpins past a limit (`docs/design/ingredientSpecialization.md` §S8.1, finding I7; owner
 * ruling, option B). When the pinned title row and the footer together take more than half the sheet's height, the
 * footer scrolls with the content; Close stays pinned in the title row.
 *
 * On web the footer is ALWAYS the scroll region's last child: pinned is `position: sticky` at the region's bottom, and
 * unpinned is the same node in normal flow. So a flip moves no node, and keyboard focus on a footer control survives
 * it (WCAG 2.2 SC 2.4.3) — the twin of the collapse's stability rule.
 *
 * jsdom lays nothing out, so this file installs a recording `ResizeObserver` and serves each node's height itself; the
 * pure rule has its own table (`layout/__tests__/pinnedFooter.test.ts`). What this file proves is the wiring: which node is measured,
 * and what the decision does to the footer.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SheetProps } from '../props.js';
import { Sheet } from '../Sheet.js';

/** Every `ResizeObserver` the Sheet creates, with what it watches. */
const observers = new Set<{ readonly callback: ResizeObserverCallback; readonly observed: Set<Element> }>();

class RecordingResizeObserver {
    private readonly record: { readonly callback: ResizeObserverCallback; readonly observed: Set<Element> };

    public constructor(callback: ResizeObserverCallback) {
        this.record = { callback, observed: new Set() };
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
    globalThis.ResizeObserver = RecordingResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
    cleanup();
    observers.clear();
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

/** A sheet opened by a sibling control, with a footer control that can hold focus. */
function Host(props: { readonly overrides?: Partial<SheetProps> }): JSX.Element {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Open
            </button>
            <Sheet
                open={open}
                onOpenChange={setOpen}
                title="Filter recipes"
                closeLabel="Close filters"
                size="content"
                footer={<button type="button">Done</button>}
                {...props.overrides}
            >
                <p>Dietary</p>
            </Sheet>
        </>
    );
}

async function openHost(element: JSX.Element): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();

    render(element);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    return user;
}

/** The sheet's own box: the panel that fills the dialog. */
const sheetBox = (): HTMLElement => screen.getByRole('dialog').firstElementChild as HTMLElement;
/** The title row: the row that holds the title and Close. */
const titleRow = (): HTMLElement => screen.getByRole('button', { name: 'Close filters' }).parentElement as HTMLElement;
/** The footer: the box that holds Done. */
const footer = (): HTMLElement => screen.getByRole('button', { name: 'Done' }).parentElement as HTMLElement;

/** Give the three boxes their heights and report a resize to every observer. */
function layOut(heights: { readonly sheet: number; readonly titleRow: number; readonly footer: number }): void {
    for (const [node, height] of [
        [sheetBox(), heights.sheet],
        [titleRow(), heights.titleRow],
        [footer(), heights.footer],
    ] as const) {
        node.getBoundingClientRect = () => new DOMRect(0, 0, 320, height);
    }

    act(() => {
        for (const record of observers) {
            record.callback(
                [...record.observed].map((target) => ({ target }) as unknown as ResizeObserverEntry),
                {} as ResizeObserver,
            );
        }
    });
}

const isSticky = (node: Element): boolean => node.className.split(/\s+/u).includes('sticky');

describe('Sheet (web) — the footer unpins past a limit', () => {
    it('keeps the footer inside the scroll region, as its last child, pinned to its bottom by default', async () => {
        await openHost(<Host />);

        const done = screen.getByRole('button', { name: 'Done' });

        expect(screen.getByText('Dietary').compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
        expect(footer().parentElement).toBe(screen.getByText('Dietary').parentElement?.parentElement);
        expect(isSticky(footer())).toBe(true);
        expect(footer().className).toContain('bottom-0');
    });

    it('stays pinned while the title row and footer take half the sheet or less', async () => {
        await openHost(<Host />);
        layOut({ sheet: 600, titleRow: 56, footer: 80 });

        expect(isSticky(footer())).toBe(true);
    });

    it('lets the footer scroll once they take more than half; Close stays in the pinned title row', async () => {
        await openHost(<Host />);
        layOut({ sheet: 300, titleRow: 64, footer: 92 });

        expect(isSticky(footer())).toBe(false);
        expect(titleRow().contains(screen.getByRole('button', { name: 'Close filters' }))).toBe(true);
    });

    it('moves no node when it flips, so keyboard focus on Done survives (SC 2.4.3)', async () => {
        const user = await openHost(<Host />);
        const done = screen.getByRole('button', { name: 'Done' });

        await user.click(done);
        layOut({ sheet: 300, titleRow: 64, footer: 92 });
        layOut({ sheet: 700, titleRow: 64, footer: 92 });

        expect(screen.getByRole('button', { name: 'Done' })).toBe(done);
        expect(document.activeElement).toBe(done);
    });

    it('pins it again when the sheet grows back', async () => {
        await openHost(<Host />);
        layOut({ sheet: 300, titleRow: 64, footer: 92 });
        layOut({ sheet: 700, titleRow: 64, footer: 92 });

        expect(isSticky(footer())).toBe(true);
    });

    // SC 2.4.11 (Focus Not Obscured): a sticky footer can hide a focused row. `scroll-padding-bottom` (W3C technique
    // C43) makes the browser scroll a focused row clear of it — while it is pinned, and only then.
    it('reserves the pinned footer’s height as the region’s scroll padding, and drops it once unpinned', async () => {
        await openHost(<Host />);
        layOut({ sheet: 600, titleRow: 56, footer: 80 });

        const region = footer().parentElement as HTMLElement;

        expect(region.style.scrollPaddingBottom).toBe('80px');

        layOut({ sheet: 300, titleRow: 64, footer: 92 });

        expect(region.style.scrollPaddingBottom).toBe('');
    });

    it('reserves no scroll padding while the footer is hidden by the collapse', async () => {
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        Object.defineProperty(window, 'visualViewport', {
            value: Object.assign(new EventTarget(), { height: 400, scale: 1, offsetTop: 0 }),
            configurable: true,
        });
        const user = await openHost(
            <Host
                overrides={{
                    toolbar: { heading: <span>Search 40 options</span>, controls: <input aria-label="Search" /> },
                }}
            />,
        );

        layOut({ sheet: 600, titleRow: 56, footer: 80 });
        await user.click(screen.getByRole('textbox', { name: 'Search' }));

        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
        expect(screen.getByText('Dietary').parentElement?.parentElement?.style.scrollPaddingBottom).toBe('');
        Reflect.deleteProperty(window, 'visualViewport');
    });

    it('stays pinned where the browser has no ResizeObserver', async () => {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
        await openHost(<Host />);

        expect(isSticky(footer())).toBe(true);
    });
});
