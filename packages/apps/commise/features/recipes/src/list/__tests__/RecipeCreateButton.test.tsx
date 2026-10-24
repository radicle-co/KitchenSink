// @vitest-environment jsdom
/**
 * Component tests for the web create entry (build spec §3.4; owner decision D4; blueprint Part C slice 8): one tap opens
 * the empty editor. It replaces the interim create dial and its menu, so nothing here discloses a menu.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RecipeCreateButton } from '../RecipeCreateButton.js';

afterEach(cleanup);

describe('RecipeCreateButton (web)', () => {
    it.each(['fab', 'sidebar', 'rail'] as const)(
        'the %s form is ONE button named "New recipe" that opens the editor in one tap, with no menu',
        async (appearance) => {
            const user = userEvent.setup();
            const onCreateRecipe = vi.fn();
            render(<RecipeCreateButton appearance={appearance} onCreateRecipe={onCreateRecipe} />);

            const button = screen.getByRole('button', { name: 'New recipe' });
            expect(button.getAttribute('aria-haspopup')).toBeNull();

            await user.click(button);

            expect(onCreateRecipe).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('menu')).toBeNull();
        },
    );

    it('the floating form is the pinned CreateFab: its glyph is an SVG beside the label, never the text "+"', () => {
        render(<RecipeCreateButton onCreateRecipe={vi.fn()} />);

        const fab = screen.getByRole('button', { name: 'New recipe' });

        expect(fab.className).toContain('fixed');
        expect(fab.querySelector('svg')).not.toBeNull();
        expect(fab.textContent).not.toContain('+');
    });

    it('the floating form is not drawn while the screen yields it: first load in flight or first run (§3.4)', () => {
        render(<RecipeCreateButton onCreateRecipe={vi.fn()} yielded />);

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    // W-02: the tip was an in-flow `absolute start-full` span inside the rail, whose `overflow-y-auto` also clips x — a 4 px
    // sliver on hover, nothing on focus. It is the design system's portalled Tooltip now, so no ancestor can cut it.
    describe('the rail form’s tooltip (SC 1.4.13)', () => {
        /** The portalled tip, which lives on `document.body` and is hidden from assistive technology. */
        const tip = (): HTMLElement | null => document.body.querySelector('[data-tooltip]');

        const renderRail = (): HTMLElement => {
            render(
                <div data-rail="" style={{ overflow: 'hidden', width: 80 }}>
                    <RecipeCreateButton appearance="rail" onCreateRecipe={vi.fn()} />
                </div>,
            );

            return screen.getByRole('button', { name: 'New recipe' });
        };

        it('draws no tip at rest, and none inside the button’s own wrapper', () => {
            const button = renderRail();

            expect(tip()).toBeNull();
            expect(button.parentElement?.querySelector(':scope > [aria-hidden="true"]')).toBeNull();
        });

        it('shows the label beside the button on hover, OUTSIDE the clipping rail', async () => {
            const user = userEvent.setup();
            const button = renderRail();

            await user.hover(button);

            expect(tip()?.textContent).toBe('New recipe');
            expect(tip()?.closest('[data-rail]')).toBeNull();
            expect(tip()?.getAttribute('data-placement')).toBe('right');
        });

        it('shows on keyboard focus too, which the clipped tip never did', async () => {
            const user = userEvent.setup();
            const button = renderRail();

            await user.tab();

            expect(document.activeElement).toBe(button);
            expect(tip()?.textContent).toBe('New recipe');
        });

        it('is dismissed by Escape without the pointer moving', async () => {
            const user = userEvent.setup();
            const button = renderRail();

            await user.hover(button);
            expect(tip()).not.toBeNull();

            await user.keyboard('{Escape}');

            expect(tip()).toBeNull();
        });

        it('leaves the button’s name to the button: the tip adds no second name for a screen reader', async () => {
            const user = userEvent.setup();
            const button = renderRail();

            await user.hover(button);

            expect(screen.getAllByText('New recipe')).toHaveLength(1);
            expect(button.getAttribute('aria-describedby')).toBeNull();
            expect(tip()?.getAttribute('aria-hidden')).toBe('true');
        });

        it.each(['fab', 'sidebar'] as const)(
            'the %s form has no tooltip, because its label is drawn',
            async (appearance) => {
                const user = userEvent.setup();
                render(<RecipeCreateButton appearance={appearance} onCreateRecipe={vi.fn()} />);

                await user.hover(screen.getByRole('button', { name: 'New recipe' }));

                expect(tip()).toBeNull();
            },
        );
    });
});
