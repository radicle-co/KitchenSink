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

    it('the floating form is not drawn while the screen shows its first run (§3.4)', () => {
        render(<RecipeCreateButton onCreateRecipe={vi.fn()} firstRun />);

        expect(screen.queryByRole('button', { name: 'New recipe' })).toBeNull();
    });

    it('the rail form names itself by its label and shows it as a tooltip that Escape dismisses (SC 1.4.13)', async () => {
        const user = userEvent.setup();
        render(<RecipeCreateButton appearance="rail" onCreateRecipe={vi.fn()} />);
        const button = screen.getByRole('button', { name: 'New recipe' });
        const tip = button.parentElement?.querySelector(':scope > span[aria-hidden="true"]');

        button.focus();
        await user.keyboard('{Escape}');

        expect(tip?.textContent).toBe('New recipe');
        expect(tip?.getAttribute('data-dismissed')).toBe('true');
    });
});
