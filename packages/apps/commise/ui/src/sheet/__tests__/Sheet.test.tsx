/**
 * Sheet (web) — the design-system sheet over `@radix-ui/react-dialog` (`docs/design/ingredientSpecialization.md`
 * §S8.1).
 *
 * Covers every state the spec names: closed; open and named (title plus `labelledBy`, `describedBy`, modal); every
 * close route; focus on open (the title, unless content took focus itself) and back to a sibling opener on close;
 * the two sizes; and the collapse, which needs an on-screen keyboard AND focus in the toolbar's controls, hides the
 * footer, moves the heading into the title row, and never remounts the focused input.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SheetProps } from '../props.js';
import { Sheet } from '../Sheet.js';

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, 'visualViewport');
});

/** Stand in for a mobile browser's visual viewport; `height` below `innerHeight` by 150+ reads as a keyboard. */
function stubViewport(
    height: number,
    scale = 1,
    offsetTop = 0,
): EventTarget & { height: number; scale: number; offsetTop: number } {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });

    const viewport = Object.assign(new EventTarget(), { height, scale, offsetTop });

    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });

    return viewport;
}

const TOOLBAR = { heading: <span>Search 40 options</span>, controls: <input aria-label="Search" /> };

/** A sheet opened by a SIBLING control, the only way the design system's callers open one. */
function Host(props: {
    readonly overrides?: Partial<SheetProps>;
    readonly onOpenChange?: (open: boolean) => void;
    readonly children?: ReactNode;
}): JSX.Element {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Open
            </button>
            <Sheet
                open={open}
                onOpenChange={(next) => {
                    props.onOpenChange?.(next);
                    setOpen(next);
                }}
                title="Add details"
                closeLabel="Close details"
                size="content"
                footer={<button type="button">Remove details</button>}
                {...props.overrides}
            >
                {props.children ?? <p>Flat half</p>}
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

describe('Sheet (web)', () => {
    it('renders nothing while closed', () => {
        render(<Host />);

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is a modal dialog named by its title then labelledBy, and described by describedBy', async () => {
        await openHost(
            <Host overrides={{ labelledBy: ['food'], describedBy: ['intro'] }}>
                <p id="food">Beef brisket</p>
                <p id="intro">Nutrition uses the one you pick.</p>
            </Host>,
        );

        const dialog = screen.getByRole('dialog', { name: 'Add details Beef brisket' });

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-describedby')).toBe('intro');
    });

    it('leaves aria-describedby unset with no describedBy', async () => {
        await openHost(<Host />);

        expect(screen.getByRole('dialog').hasAttribute('aria-describedby')).toBe(false);
    });

    it('closes through Close, named by closeLabel and 48 px square', async () => {
        const onOpenChange = vi.fn();
        const user = await openHost(<Host onOpenChange={onOpenChange} />);
        const close = screen.getByRole('button', { name: 'Close details' });

        expect(close.className).toContain('h-12');
        expect(close.className).toContain('w-12');
        // The house focus ring (`Wizard.tsx`): the browser's outline is replaced, never removed without one.
        expect(close.className).toContain('focus-visible:ring-2');
        expect(close.className).toContain('focus-visible:ring-focus-ring');

        await user.click(close);

        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('closes through Escape', async () => {
        const onOpenChange = vi.fn();
        const user = await openHost(<Host onOpenChange={onOpenChange} />);

        await user.keyboard('{Escape}');

        expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });

    it('closes through a press on the overlay', async () => {
        const onOpenChange = vi.fn();

        await openHost(<Host onOpenChange={onOpenChange} />);
        act(() => {
            fireEvent.pointerDown(document.body);
            fireEvent.pointerUp(document.body);
            fireEvent.click(document.body);
        });

        expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });

    describe('onDismissed', () => {
        it('is called once after each close, by any route, off screen and with focus back on the opener', async () => {
            const dialogsSeen: (HTMLElement | null)[] = [];
            const focusSeen: (Element | null)[] = [];
            const onDismissed = vi.fn(() => {
                dialogsSeen.push(screen.queryByRole('dialog'));
                focusSeen.push(document.activeElement);
            });
            const user = await openHost(<Host overrides={{ onDismissed }} />);

            expect(onDismissed).not.toHaveBeenCalled();

            await user.click(screen.getByRole('button', { name: 'Close details' }));
            expect(onDismissed).toHaveBeenCalledTimes(1);

            await user.click(screen.getByRole('button', { name: 'Open' }));
            expect(onDismissed).toHaveBeenCalledTimes(1);

            await user.keyboard('{Escape}');
            expect(onDismissed).toHaveBeenCalledTimes(2);
            expect(dialogsSeen).toStrictEqual([null, null]);
            expect(focusSeen).toStrictEqual([
                screen.getByRole('button', { name: 'Open' }),
                screen.getByRole('button', { name: 'Open' }),
            ]);
        });

        it('is not called for a sheet that mounts closed, or on a re-render while open', async () => {
            const onDismissed = vi.fn();
            const { rerender } = render(
                <Sheet open={false} onOpenChange={vi.fn()} title="Add details" closeLabel="Close" size="content">
                    <p>Flat half</p>
                </Sheet>,
            );

            rerender(
                <Sheet
                    open
                    onOpenChange={vi.fn()}
                    onDismissed={onDismissed}
                    title="Add details"
                    closeLabel="Close"
                    size="content"
                >
                    <p>Flat half</p>
                </Sheet>,
            );
            rerender(
                <Sheet
                    open
                    onOpenChange={vi.fn()}
                    onDismissed={onDismissed}
                    title="Edit details"
                    closeLabel="Close"
                    size="content"
                >
                    <p>Point half</p>
                </Sheet>,
            );

            expect(onDismissed).not.toHaveBeenCalled();
        });
    });

    it('moves focus to the title on open', async () => {
        await openHost(<Host />);

        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Add details' }));
    });

    it('leaves focus on content that focused itself on mount', async () => {
        await openHost(
            <Host>
                <input aria-label="Search" autoFocus />
            </Host>,
        );

        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search' }));
    });

    it('returns focus to the sibling that opened it, from Close and from Escape', async () => {
        const user = await openHost(<Host />);

        await user.click(screen.getByRole('button', { name: 'Close details' }));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));

        await user.click(screen.getByRole('button', { name: 'Open' }));
        await user.keyboard('{Escape}');
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open' }));
    });

    it('holds 85% of the viewport height from sm at size full, and grows with content at size content', async () => {
        // ⛔ EXACTLY ONE `sm:h-` utility per size. Two height utilities for one variant are decided by the order
        // Tailwind emits them, not the order they appear in the class string, so a shared `sm:h-auto` would win over
        // `sm:h-[85vh]` and make `full` a content-height dialog with every class-text check still green.
        const heights = (): readonly string[] =>
            screen
                .getByRole('dialog')
                .className.split(/\s+/u)
                .filter((utility) => utility.startsWith('sm:h-'));
        const user = await openHost(<Host overrides={{ size: 'full' }} />);

        expect(heights()).toStrictEqual(['sm:h-[85vh]']);

        await user.keyboard('{Escape}');
        cleanup();
        await openHost(<Host />);

        expect(heights()).toStrictEqual(['sm:h-auto']);
    });

    it('draws a hairline above the footer', async () => {
        await openHost(<Host />);

        expect(screen.getByRole('button', { name: 'Remove details' }).parentElement?.className).toContain('border-t');
    });

    describe('the collapse', () => {
        it('shows the heading under the title, and the footer, while nothing is collapsed', async () => {
            stubViewport(800);
            await openHost(<Host overrides={{ toolbar: TOOLBAR }} />);

            expect(screen.getByText('Search 40 options')).toBeDefined();
            expect(screen.getByRole('button', { name: 'Remove details' })).toBeDefined();
            expect(screen.getByRole('heading', { name: 'Add details' }).className).not.toContain('sr-only');
        });

        it('collapses with a keyboard open and focus in the controls, keeping the same input focused', async () => {
            stubViewport(400);
            const user = await openHost(<Host overrides={{ toolbar: TOOLBAR }} />);
            const input = screen.getByRole('textbox', { name: 'Search' });

            const close = screen.getByRole('button', { name: 'Close details' });

            await user.click(input);

            expect(screen.getByRole('heading', { name: 'Add details' }).className).toContain('sr-only');
            expect(screen.getByRole('button', { name: 'Close details' })).toBe(close);
            expect(screen.getByRole('dialog', { name: 'Add details' })).toBeDefined();
            expect(screen.getByText('Search 40 options')).toBeDefined();
            expect(screen.queryByRole('button', { name: 'Remove details' })).toBeNull();
            expect(screen.getByRole('button', { name: 'Close details' })).toBeDefined();
            expect(document.activeElement).toBe(input);
        });

        it('expands when the keyboard closes, and the same input still has focus', async () => {
            const viewport = stubViewport(400);
            const user = await openHost(<Host overrides={{ toolbar: TOOLBAR }} />);
            const input = screen.getByRole('textbox', { name: 'Search' });

            await user.click(input);
            act(() => {
                viewport.height = 800;
                viewport.dispatchEvent(new Event('resize'));
            });

            expect(screen.getByRole('button', { name: 'Remove details' })).toBeDefined();
            expect(screen.getByRole('textbox', { name: 'Search' })).toBe(input);
            expect(document.activeElement).toBe(input);
        });

        it('does not collapse when focus is outside the toolbar', async () => {
            stubViewport(400);
            const user = await openHost(
                <Host overrides={{ toolbar: TOOLBAR }}>
                    <button type="button">Flat half</button>
                </Host>,
            );

            await user.click(screen.getByRole('button', { name: 'Flat half' }));

            expect(screen.getByRole('button', { name: 'Remove details' })).toBeDefined();
        });

        it('does not collapse when the viewport is zoomed, not shrunk by a keyboard', async () => {
            stubViewport(400, 2);
            const user = await openHost(<Host overrides={{ toolbar: TOOLBAR }} />);

            await user.click(screen.getByRole('textbox', { name: 'Search' }));

            expect(screen.getByRole('button', { name: 'Remove details' })).toBeDefined();
        });

        it('never collapses a sheet with no toolbar, so its footer stays with a keyboard open', async () => {
            stubViewport(400);
            const user = await openHost(
                <Host>
                    <input aria-label="Ingredient" />
                </Host>,
            );

            await user.click(screen.getByRole('textbox', { name: 'Ingredient' }));

            expect(screen.getByRole('button', { name: 'Remove details' })).toBeDefined();
        });

        it('tracks the visible height while a keyboard is open, and clears it after', async () => {
            const viewport = stubViewport(400);

            await openHost(<Host />);
            expect(screen.getByRole('dialog').style.getPropertyValue('--sheet-visible-height')).toBe('400px');

            act(() => {
                viewport.height = 800;
                viewport.dispatchEvent(new Event('resize'));
            });

            expect(screen.getByRole('dialog').style.getPropertyValue('--sheet-visible-height')).toBe('');
        });

        /**
         * E2 I5 — the sheet sits inside the VISIBLE box, not the whole window. From 640 px it followed the visible
         * height but stayed centred on the window, so a keyboard hid 100 to 199 px of it (157 px on an upright iPad).
         */
        it('publishes the visible top with the height while a keyboard is open, and clears both after', async () => {
            const viewport = stubViewport(400, 1, 157);

            await openHost(<Host />);
            expect(screen.getByRole('dialog').style.getPropertyValue('--sheet-visible-top')).toBe('157px');

            act(() => {
                viewport.height = 800;
                viewport.offsetTop = 0;
                viewport.dispatchEvent(new Event('resize'));
            });

            expect(screen.getByRole('dialog').style.getPropertyValue('--sheet-visible-top')).toBe('');
        });

        it('pins the top to the visible box below sm, and centres inside the visible box from sm', async () => {
            await openHost(<Host />);

            const classes = screen.getByRole('dialog').className.split(/\s+/u);

            // Below sm the full-screen sheet starts where the visible box starts, which follows an iOS pan.
            expect(classes).toContain('top-[var(--sheet-visible-top,0px)]');
            expect(classes).not.toContain('top-0');
            // From sm the centre is the visible box's centre; with no keyboard the fallbacks give the window's 50%.
            expect(classes).toContain('sm:top-[calc(var(--sheet-visible-top,0px)+var(--sheet-visible-height,100%)/2)]');
            expect(classes).not.toContain('sm:top-1/2');
            expect(classes).toContain('sm:-translate-y-1/2');
        });
    });
});
